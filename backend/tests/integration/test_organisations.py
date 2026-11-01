import uuid
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.models import AuditLog, OrganisationInvitation, User
from app.models.base import utcnow
from app.services.email import OutgoingEmail
from tests.integration.conftest import API, NEW_ORG, Member
from tests.integration.test_auth import (
    AUTH,
    PASSWORD,
    login,
    register,
    signed_in,
    token_from,
    unique_email,
    verified_user,
)

pytestmark = pytest.mark.integration

ALL_ROLES = [
    "administrator",
    "fleet_manager",
    "dispatcher",
    "maintenance_manager",
    "finance_manager",
    "driver",
    "read_only",
]


def members(owner: Member) -> list[dict[str, Any]]:
    response = owner.client.get(f"{API}/organisation/members")
    assert response.status_code == 200
    result: list[dict[str, Any]] = response.json()
    return result


def membership_id(owner: Member, email: str) -> str:
    return str(next(item["id"] for item in members(owner) if item["email"] == email))


def set_role(actor: Member, target_id: str, role: str) -> Any:
    return actor.client.patch(
        f"{API}/organisation/members/{target_id}", json={"role": role}, headers=actor.csrf
    )


# Creating and viewing


def test_creator_becomes_owner_and_lands_in_the_new_organisation(
    new_owner: Callable[[], Member],
) -> None:
    owner = new_owner()
    current = owner.client.get(f"{API}/organisation").json()
    assert current["role"] == "owner"
    assert current["organisation"]["name"] == "Swift Logistics"
    assert current["organisation"]["default_currency"] == "KES"
    assert "members.manage" in current["permissions"]


def test_two_organisations_can_share_a_name_without_revealing_each_other(
    new_owner: Callable[[], Member],
) -> None:
    first, second = new_owner(), new_owner()
    first_slug = first.client.get(f"{API}/organisation").json()["organisation"]["slug"]
    second_slug = second.client.get(f"{API}/organisation").json()["organisation"]["slug"]
    assert first_slug != second_slug


def test_creating_an_organisation_needs_csrf(
    client: TestClient, outbox: list[OutgoingEmail]
) -> None:
    signed_in(client, outbox)
    assert client.post(f"{API}/organisations", json=NEW_ORG).status_code == 403


def test_signed_out_users_get_401_everywhere(client: TestClient) -> None:
    assert client.get(f"{API}/organisation").status_code == 401
    assert client.get(f"{API}/organisations").status_code == 401
    assert client.get(f"{API}/organisation/members").status_code == 401


def test_new_user_without_an_organisation_must_choose_one(
    client: TestClient, outbox: list[OutgoingEmail]
) -> None:
    signed_in(client, outbox)
    response = client.get(f"{API}/organisation")
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "no_active_organisation"
    assert client.get(f"{API}/organisations").json() == []


@pytest.mark.parametrize(
    "overrides",
    [
        {"country_code": "kenya"},
        {"default_currency": "shillings"},
        {"timezone": "Mars/Olympus"},
        {"name": ""},
        {"name": "Line\nBreak"},
        {"slug": "chosen-by-client"},
        {"status": "active"},
    ],
    ids=["country", "currency", "timezone", "empty name", "newline", "slug", "status"],
)
def test_organisation_input_is_validated(
    client: TestClient, outbox: list[OutgoingEmail], overrides: dict[str, str]
) -> None:
    _, csrf = signed_in(client, outbox)
    response = client.post(f"{API}/organisations", json=NEW_ORG | overrides, headers=csrf)
    assert response.status_code == 422


def test_organisation_can_be_updated_and_is_audited(
    new_owner: Callable[[], Member], db: Session
) -> None:
    owner = new_owner()
    response = owner.client.patch(
        f"{API}/organisation",
        json={"name": "Renamed", "timezone": "Africa/Nairobi"},
        headers=owner.csrf,
    )
    assert response.status_code == 200
    assert response.json()["timezone"] == "Africa/Nairobi"
    actions = db.exec(
        select(AuditLog.action).where(AuditLog.organisation_id == uuid.UUID(owner.organisation_id))
    ).all()
    assert {"organisation.created", "organisation.updated"} <= set(actions)


# Isolation


def test_switching_to_someone_elses_organisation_looks_like_it_does_not_exist(
    new_owner: Callable[[], Member],
) -> None:
    attacker, victim = new_owner(), new_owner()
    foreign = attacker.client.post(
        f"{API}/organisations/{victim.organisation_id}/switch", headers=attacker.csrf
    )
    unknown = attacker.client.post(
        f"{API}/organisations/{uuid.uuid4()}/switch", headers=attacker.csrf
    )
    assert foreign.status_code == unknown.status_code == 404
    assert foreign.json() == unknown.json()
    current = attacker.client.get(f"{API}/organisation").json()
    assert current["organisation"]["id"] == attacker.organisation_id


def test_members_of_another_organisation_are_not_visible(new_owner: Callable[[], Member]) -> None:
    first, second = new_owner(), new_owner()
    assert {item["email"] for item in members(first)} == {first.email}
    assert {item["email"] for item in members(second)} == {second.email}


def test_cannot_change_or_remove_a_member_of_another_organisation_by_id(
    new_owner: Callable[[], Member],
) -> None:
    attacker, victim = new_owner(), new_owner()
    target = membership_id(victim, victim.email)
    assert set_role(attacker, target, "read_only").status_code == 404
    removal = attacker.client.delete(f"{API}/organisation/members/{target}", headers=attacker.csrf)
    assert removal.status_code == 404
    assert members(victim)[0]["role"] == "owner"


def test_cannot_revoke_an_invitation_of_another_organisation_by_id(
    new_owner: Callable[[], Member],
) -> None:
    attacker, victim = new_owner(), new_owner()
    invitation = victim.client.post(
        f"{API}/organisation/invitations",
        json={"email": unique_email(), "role": "driver"},
        headers=victim.csrf,
    ).json()
    response = attacker.client.delete(
        f"{API}/organisation/invitations/{invitation['id']}", headers=attacker.csrf
    )
    assert response.status_code == 404
    assert len(victim.client.get(f"{API}/organisation/invitations").json()) == 1


def test_person_in_two_organisations_switches_and_sees_each_correctly(
    app: FastAPI,
    new_owner: Callable[[], Member],
    invite: Callable[..., Member],
    outbox: list[OutgoingEmail],
) -> None:
    first, second = new_owner(), new_owner()
    sam = invite(first, "read_only")
    sam_in_second = second.client.post(
        f"{API}/organisation/invitations",
        json={"email": sam.email, "role": "fleet_manager"},
        headers=second.csrf,
    )
    assert sam_in_second.status_code == 201
    sam.client.post(
        f"{API}/invitations/accept", json={"token": token_from(outbox[-1])}, headers=sam.csrf
    )
    assert sam.client.get(f"{API}/organisation").json()["role"] == "fleet_manager"

    switched = sam.client.post(
        f"{API}/organisations/{first.organisation_id}/switch", headers=sam.csrf
    )
    assert switched.status_code == 200
    assert sam.client.get(f"{API}/organisation").json()["role"] == "read_only"
    listed = sam.client.get(f"{API}/organisations").json()
    assert {item["role"] for item in listed} == {"read_only", "fleet_manager"}
    assert sum(item["is_active"] for item in listed) == 1

    # With two organisations, a fresh login has to choose; with one it goes straight there.
    fresh = TestClient(app)
    login(fresh, sam.email)
    assert fresh.get(f"{API}/organisation").status_code == 403
    only_org = TestClient(app)
    login(only_org, first.email)
    assert only_org.get(f"{API}/organisation").status_code == 200


# Invitations


def test_invited_person_without_an_account_gets_no_user_row_until_they_register(
    app: FastAPI, new_owner: Callable[[], Member], db: Session, outbox: list[OutgoingEmail]
) -> None:
    owner = new_owner()
    email = unique_email()
    owner.client.post(
        f"{API}/organisation/invitations",
        json={"email": email, "role": "dispatcher"},
        headers=owner.csrf,
    )
    invitation_token = token_from(outbox[-1])
    assert db.exec(select(User).where(User.email == email)).first() is None

    newcomer = TestClient(app)
    register(newcomer, email)
    newcomer.post(
        f"{AUTH}/verify-email", json={"token": token_from(outbox[-1]), "password": PASSWORD}
    )
    csrf = {"X-CSRF-Token": login(newcomer, email).json()["csrf_token"]}
    accepted = newcomer.post(
        f"{API}/invitations/accept", json={"token": invitation_token}, headers=csrf
    )
    assert accepted.status_code == 200
    assert newcomer.get(f"{API}/organisation").json()["role"] == "dispatcher"


def test_invitation_link_is_useless_to_anyone_else(
    app: FastAPI, new_owner: Callable[[], Member], outbox: list[OutgoingEmail]
) -> None:
    owner = new_owner()
    owner.client.post(
        f"{API}/organisation/invitations",
        json={"email": unique_email(), "role": "administrator"},
        headers=owner.csrf,
    )
    stolen_token = token_from(outbox[-1])
    thief = TestClient(app)
    _, csrf = signed_in(thief, outbox)
    response = thief.post(f"{API}/invitations/accept", json={"token": stolen_token}, headers=csrf)
    assert response.status_code == 400
    assert thief.get(f"{API}/organisation").status_code == 403
    assert len(members(owner)) == 1


def test_invitation_works_only_once(
    new_owner: Callable[[], Member], app: FastAPI, outbox: list[OutgoingEmail]
) -> None:
    owner = new_owner()
    guest = TestClient(app)
    email, csrf = signed_in(guest, outbox)
    owner.client.post(
        f"{API}/organisation/invitations",
        json={"email": email, "role": "driver"},
        headers=owner.csrf,
    )
    token = token_from(outbox[-1])
    url = f"{API}/invitations/accept"
    assert guest.post(url, json={"token": token}, headers=csrf).status_code == 200
    assert guest.post(url, json={"token": token}, headers=csrf).status_code == 400


def test_revoked_replaced_and_expired_invitations_stop_working(
    new_owner: Callable[[], Member],
    app: FastAPI,
    db: Session,
    outbox: list[OutgoingEmail],
) -> None:
    owner = new_owner()
    guest = TestClient(app)
    email, csrf = signed_in(guest, outbox)
    url = f"{API}/invitations/accept"
    invitation_url = f"{API}/organisation/invitations"
    payload = {"email": email, "role": "driver"}

    created = owner.client.post(invitation_url, json=payload, headers=owner.csrf).json()
    revoked_token = token_from(outbox[-1])
    owner.client.delete(f"{invitation_url}/{created['id']}", headers=owner.csrf)
    assert guest.post(url, json={"token": revoked_token}, headers=csrf).status_code == 400

    owner.client.post(invitation_url, json=payload, headers=owner.csrf)
    replaced_token = token_from(outbox[-1])
    owner.client.post(invitation_url, json=payload, headers=owner.csrf)
    latest_token = token_from(outbox[-1])
    assert guest.post(url, json={"token": replaced_token}, headers=csrf).status_code == 400

    row = db.exec(
        select(OrganisationInvitation).where(
            OrganisationInvitation.email == email,
            OrganisationInvitation.revoked_at == None,  # noqa: E711
        )
    ).one()
    row.expires_at = utcnow() - timedelta(seconds=1)
    db.commit()
    assert guest.post(url, json={"token": latest_token}, headers=csrf).status_code == 400


def test_inviting_an_existing_member_is_rejected(new_owner: Callable[[], Member]) -> None:
    owner = new_owner()
    response = owner.client.post(
        f"{API}/organisation/invitations",
        json={"email": owner.email, "role": "driver"},
        headers=owner.csrf,
    )
    assert response.status_code == 409


def test_invitation_response_never_contains_the_token(new_owner: Callable[[], Member]) -> None:
    owner = new_owner()
    created = owner.client.post(
        f"{API}/organisation/invitations",
        json={"email": unique_email(), "role": "driver"},
        headers=owner.csrf,
    ).json()
    assert "token" not in str(created)
    assert "token" not in str(owner.client.get(f"{API}/organisation/invitations").json())


# Role permissions


@pytest.mark.parametrize("role", ALL_ROLES)
def test_only_owners_and_administrators_can_invite(
    role: str, new_owner: Callable[[], Member], invite: Callable[..., Member]
) -> None:
    owner = new_owner()
    member = invite(owner, role)
    response = member.client.post(
        f"{API}/organisation/invitations",
        json={"email": unique_email(), "role": "driver"},
        headers=member.csrf,
    )
    assert response.status_code == (201 if role == "administrator" else 403)


@pytest.mark.parametrize("role", ALL_ROLES)
def test_only_owners_and_administrators_can_edit_the_organisation(
    role: str, new_owner: Callable[[], Member], invite: Callable[..., Member]
) -> None:
    owner = new_owner()
    member = invite(owner, role)
    response = member.client.patch(
        f"{API}/organisation", json={"name": "Taken over"}, headers=member.csrf
    )
    assert response.status_code == (200 if role == "administrator" else 403)


@pytest.mark.parametrize(
    ("role", "allowed"),
    [("fleet_manager", True), ("driver", False), ("read_only", False), ("dispatcher", False)],
)
def test_viewing_members_needs_permission(
    role: str, allowed: bool, new_owner: Callable[[], Member], invite: Callable[..., Member]
) -> None:
    member = invite(new_owner(), role)
    status = member.client.get(f"{API}/organisation/members").status_code
    assert status == (200 if allowed else 403)


def test_permissions_cannot_be_used_without_csrf(new_owner: Callable[[], Member]) -> None:
    owner = new_owner()
    response = owner.client.patch(f"{API}/organisation", json={"name": "No token"})
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "invalid_csrf_token"


def test_administrator_cannot_touch_or_create_owners(
    new_owner: Callable[[], Member], invite: Callable[..., Member]
) -> None:
    owner = new_owner()
    admin = invite(owner, "administrator")
    owner_id = membership_id(owner, owner.email)
    admin_id = membership_id(owner, admin.email)

    assert set_role(admin, owner_id, "read_only").status_code == 403
    assert (
        admin.client.delete(
            f"{API}/organisation/members/{owner_id}", headers=admin.csrf
        ).status_code
        == 403
    )
    assert set_role(admin, admin_id, "owner").status_code == 403
    invited_owner = admin.client.post(
        f"{API}/organisation/invitations",
        json={"email": unique_email(), "role": "owner"},
        headers=admin.csrf,
    )
    assert invited_owner.status_code == 403


def test_owner_can_promote_someone_to_owner_and_changes_are_audited(
    new_owner: Callable[[], Member], invite: Callable[..., Member], db: Session
) -> None:
    owner = new_owner()
    member = invite(owner, "driver")
    target = membership_id(owner, member.email)
    assert set_role(owner, target, "owner").status_code == 200
    assert member.client.get(f"{API}/organisation").json()["role"] == "owner"
    row = db.exec(
        select(AuditLog).where(
            AuditLog.action == "member.updated",
            AuditLog.organisation_id == owner.organisation_id,
        )
    ).one()
    assert row.details == {"role_from": "driver", "role_to": "owner"}


def test_organisation_administrator_is_not_a_platform_administrator(
    new_owner: Callable[[], Member], invite: Callable[..., Member], db: Session
) -> None:
    admin = invite(new_owner(), "administrator")
    user = db.exec(select(User).where(User.email == admin.email)).one()
    assert user.is_platform_admin is False


# Keeping at least one owner


def test_last_owner_cannot_leave_be_demoted_suspended_or_removed(
    new_owner: Callable[[], Member],
) -> None:
    owner = new_owner()
    own_id = membership_id(owner, owner.email)
    assert owner.client.post(f"{API}/organisation/leave", headers=owner.csrf).status_code == 409
    assert set_role(owner, own_id, "read_only").status_code == 409
    assert (
        owner.client.delete(f"{API}/organisation/members/{own_id}", headers=owner.csrf).status_code
        == 409
    )
    suspended = owner.client.patch(
        f"{API}/organisation/members/{own_id}", json={"status": "suspended"}, headers=owner.csrf
    )
    assert suspended.status_code == 409


def test_two_owners_demoting_each_other_at_once_leaves_one(
    new_owner: Callable[[], Member], invite: Callable[..., Member]
) -> None:
    first = new_owner()
    second = invite(first, "driver")
    first_id = membership_id(first, first.email)
    second_id = membership_id(first, second.email)
    assert set_role(first, second_id, "owner").status_code == 200

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(
            pool.map(
                lambda args: set_role(*args).status_code,
                [(first, second_id, "driver"), (second, first_id, "driver")],
            )
        )
    assert sorted(results)[0] == 200
    remaining = (
        [item for item in members(first) if item["role"] == "owner"]
        if (first.client.get(f"{API}/organisation/members").status_code == 200)
        else [item for item in members(second) if item["role"] == "owner"]
    )
    assert len(remaining) == 1


# Access ends immediately


def test_removed_member_loses_access_on_their_next_request(
    new_owner: Callable[[], Member], invite: Callable[..., Member]
) -> None:
    owner = new_owner()
    member = invite(owner, "fleet_manager")
    assert member.client.get(f"{API}/organisation").status_code == 200
    target = membership_id(owner, member.email)
    assert (
        owner.client.delete(f"{API}/organisation/members/{target}", headers=owner.csrf).status_code
        == 204
    )
    assert member.client.get(f"{API}/organisation").status_code == 403
    assert member.client.get(f"{API}/organisation/members").status_code == 403


def test_suspended_member_loses_access_and_cannot_rejoin_with_an_old_invitation(
    new_owner: Callable[[], Member],
    invite: Callable[..., Member],
    outbox: list[OutgoingEmail],
    db: Session,
) -> None:
    owner = new_owner()
    member = invite(owner, "fleet_manager")
    target = membership_id(owner, member.email)

    # An invitation sent earlier is still pending when the suspension happens.
    row = db.exec(
        select(OrganisationInvitation).where(OrganisationInvitation.email == member.email)
    ).one()
    row.accepted_at = None
    db.commit()
    old_token = token_from(outbox[-1])

    suspended = owner.client.patch(
        f"{API}/organisation/members/{target}", json={"status": "suspended"}, headers=owner.csrf
    )
    assert suspended.status_code == 200
    assert member.client.get(f"{API}/organisation").status_code == 403
    rejoin = member.client.post(
        f"{API}/invitations/accept", json={"token": old_token}, headers=member.csrf
    )
    assert rejoin.status_code == 400
    assert member.client.get(f"{API}/organisation").status_code == 403


def test_member_can_leave_and_then_has_no_active_organisation(
    new_owner: Callable[[], Member], invite: Callable[..., Member]
) -> None:
    owner = new_owner()
    member = invite(owner, "driver")
    assert member.client.post(f"{API}/organisation/leave", headers=member.csrf).status_code == 204
    assert member.client.get(f"{API}/organisation").status_code == 403
    assert {item["email"] for item in members(owner)} == {owner.email}


def test_invitations_to_one_organisation_are_rate_limited(
    app: FastAPI, new_owner: Callable[[], Member]
) -> None:
    app.state.settings = app.state.settings.model_copy(update={"invitations_per_hour_per_org": 2})
    owner = new_owner()
    statuses = [
        owner.client.post(
            f"{API}/organisation/invitations",
            json={"email": unique_email(), "role": "driver"},
            headers=owner.csrf,
        ).status_code
        for _ in range(3)
    ]
    assert statuses == [201, 201, 429]


def test_helper_verified_user_needs_no_organisation(
    client: TestClient, outbox: list[OutgoingEmail]
) -> None:
    email = verified_user(client, outbox)
    assert login(client, email).status_code == 200
