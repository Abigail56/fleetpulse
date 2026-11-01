from collections.abc import Callable
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text
from sqlmodel import Session, select

from app.models import User
from tests.integration.conftest import API, ORIGIN, Member
from tests.integration.test_auth import PASSWORD
from tests.integration.test_tracking import vehicle

pytestmark = pytest.mark.integration

ROOT = f"{API}/admin"
READS = ["/organisations", "/users", "/audit", "/system"]


def make_admin(engine: Engine, email: str) -> None:
    with engine.begin() as connection:
        connection.execute(
            text("UPDATE users SET is_platform_admin = true WHERE email = :email"), {"email": email}
        )


@pytest.fixture
def admin(new_owner: Callable[[], Member], migrated_engine: Engine) -> Member:
    member = new_owner()
    make_admin(migrated_engine, member.email)
    return member


@pytest.fixture
def verified(admin: Member) -> Member:
    response = admin.client.post(f"{ROOT}/verify", json={"password": PASSWORD}, headers=admin.csrf)
    assert response.status_code == 200, response.text
    return admin


def act(member: Member, path: str, reason: str = "Support request 42") -> Any:
    return member.client.post(f"{ROOT}{path}", json={"reason": reason}, headers=member.csrf)


# Keeping everyone else out


@pytest.mark.parametrize("path", [*READS, "/session"])
def test_the_area_looks_nonexistent_to_everyone_else(
    new_owner: Callable[[], Member], path: str
) -> None:
    assert new_owner().client.get(f"{ROOT}{path}").status_code == 404


def test_an_organisation_owner_or_administrator_isnt_a_platform_admin(
    new_owner: Callable[[], Member], invite: Callable[..., Member]
) -> None:
    owner = new_owner()
    administrator = invite(owner, "administrator")
    for member in (owner, administrator):
        assert member.client.get(f"{ROOT}/organisations").status_code == 404
        assert (
            member.client.post(
                f"{ROOT}/verify", json={"password": PASSWORD}, headers=member.csrf
            ).status_code
            == 404
        )


def test_no_session_is_refused(app: FastAPI) -> None:
    assert TestClient(app).get(f"{ROOT}/users").status_code == 401


def test_no_request_can_grant_itself_admin(
    new_owner: Callable[[], Member], migrated_engine: Engine
) -> None:
    member = new_owner()
    member.client.patch(f"{API}/auth/me", json={"is_platform_admin": True}, headers=member.csrf)
    with migrated_engine.connect() as connection:
        value = connection.execute(
            text("SELECT is_platform_admin FROM users WHERE email = :email"),
            {"email": member.email},
        ).scalar_one()
    assert value is False


def test_me_says_who_is_an_admin(admin: Member, new_owner: Callable[[], Member]) -> None:
    assert admin.client.get(f"{API}/auth/me").json()["user"]["is_platform_admin"] is True
    assert new_owner().client.get(f"{API}/auth/me").json()["user"]["is_platform_admin"] is False


# The password check


@pytest.mark.parametrize("path", READS)
def test_an_admin_must_confirm_their_password_first(admin: Member, path: str) -> None:
    response = admin.client.get(f"{ROOT}{path}")
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "admin_verification_required"


def test_the_session_reports_whether_its_verified(admin: Member) -> None:
    assert admin.client.get(f"{ROOT}/session").json() == {"verified": False}
    admin.client.post(f"{ROOT}/verify", json={"password": PASSWORD}, headers=admin.csrf)
    assert admin.client.get(f"{ROOT}/session").json() == {"verified": True}


def test_a_wrong_password_doesnt_verify_and_is_limited(admin: Member) -> None:
    for _ in range(5):
        wrong = admin.client.post(f"{ROOT}/verify", json={"password": "nope"}, headers=admin.csrf)
        assert wrong.json()["error"]["code"] == "wrong_password"
    assert admin.client.get(f"{ROOT}/users").status_code == 403
    blocked = admin.client.post(f"{ROOT}/verify", json={"password": PASSWORD}, headers=admin.csrf)
    assert blocked.status_code == 429


def test_verification_belongs_to_one_session(
    admin: Member, app: FastAPI, migrated_engine: Engine
) -> None:
    admin.client.post(f"{ROOT}/verify", json={"password": PASSWORD}, headers=admin.csrf)
    other = TestClient(app, headers={"Origin": ORIGIN})
    login = other.post(f"{API}/auth/login", json={"email": admin.email, "password": PASSWORD})
    assert login.status_code == 200, login.text
    assert other.get(f"{ROOT}/users").status_code == 403


def test_writes_need_csrf(verified: Member, new_owner: Callable[[], Member]) -> None:
    target = new_owner()
    response = verified.client.post(
        f"{ROOT}/organisations/{target.organisation_id}/suspend", json={"reason": "No token here"}
    )
    assert response.status_code in (401, 403)
    assert target.client.get(f"{API}/organisation").status_code == 200


# The database refuses by itself


@pytest.mark.parametrize(
    "statement",
    [
        "SELECT * FROM admin_organisations('', 10, 0)",
        "SELECT * FROM admin_users('', 10, 0)",
        "SELECT * FROM admin_audit('', NULL, 10, 0)",
        "SELECT * FROM admin_system_counts()",
        "SELECT admin_set_user_active(gen_random_uuid(), false, 'x')",
    ],
)
def test_the_functions_refuse_anyone_who_isnt_an_admin(
    app_engine: Engine, statement: str, new_owner: Callable[[], Member], migrated_engine: Engine
) -> None:
    member = new_owner()
    with migrated_engine.connect() as connection:
        user_id = connection.execute(
            text("SELECT id FROM users WHERE email = :email"), {"email": member.email}
        ).scalar_one()
    for setting in ("", str(user_id)):
        with app_engine.connect() as connection:
            connection.execute(
                text("SELECT set_config('app.current_user_id', :v, false)"), {"v": setting}
            )
            with pytest.raises(Exception, match="not_found"):
                connection.execute(text(statement))
            connection.rollback()


# What it shows


def test_lists_show_account_facts_across_organisations(
    verified: Member, new_owner: Callable[[], Member]
) -> None:
    other = new_owner()
    vehicle(other)
    organisations = verified.client.get(f"{ROOT}/organisations", params={"page_size": 100}).json()
    row = next(item for item in organisations["items"] if item["id"] == other.organisation_id)
    assert row["vehicles"] == 1
    assert row["members"] == 1
    assert row["status"] == "active"
    # Account facts only: nothing from inside the fleet.
    assert "registration_number" not in str(row)
    assert "KCA" not in str(row)
    users = verified.client.get(f"{ROOT}/users", params={"search": other.email}).json()
    assert [item["email"] for item in users["items"]] == [other.email]
    assert "password" not in str(users)


def test_search_treats_wildcards_as_text(verified: Member) -> None:
    result = verified.client.get(f"{ROOT}/users", params={"search": "%%%nobody%%%"}).json()
    assert result["items"] == []
    assert result["total"] == 0


def test_the_audit_log_can_be_read_and_filtered(
    verified: Member, new_owner: Callable[[], Member]
) -> None:
    other = new_owner()
    vehicle(other)
    result = verified.client.get(
        f"{ROOT}/audit", params={"organisation_id": other.organisation_id}
    ).json()
    assert result["total"] >= 1
    assert all(item["organisation_id"] == other.organisation_id for item in result["items"])
    assert any(item["action"] == "vehicle.created" for item in result["items"])
    filtered = verified.client.get(
        f"{ROOT}/audit", params={"organisation_id": other.organisation_id, "action": "vehicle."}
    ).json()
    assert {item["action"] for item in filtered["items"]} == {"vehicle.created"}


def test_system_status_is_honest_about_what_isnt_set_up(verified: Member) -> None:
    result = verified.client.get(f"{ROOT}/system").json()
    services = {item["name"]: item["state"] for item in result["services"]}
    assert services["Database"] == "ok"
    assert services["Redis"] == "ok"
    assert services["File storage"] == "ok"
    integrations = {item["name"]: item["state"] for item in result["integrations"]}
    assert integrations["Online payment"] == "not_configured"
    assert {item["name"] for item in result["jobs"]} >= {"alerts.sweep", "notifications.dispatch"}
    assert all(item["state"] in ("ok", "late", "never", "unknown") for item in result["jobs"])
    assert result["counts"]["organisations"] >= 1


def test_a_job_that_hasnt_run_says_so(app: FastAPI) -> None:
    from redis import Redis

    from app.services import job_health

    settings = app.state.settings
    client = Redis.from_url(str(settings.redis_url))
    client.delete(f"{job_health.KEY_PREFIX}alerts.sweep")
    states = {item["name"]: item["state"] for item in job_health.job_states(settings)}
    assert states["alerts.sweep"] == "never"
    client.set(f"{job_health.KEY_PREFIX}alerts.sweep", "2020-01-01T00:00:00+00:00")
    states = {item["name"]: item["state"] for item in job_health.job_states(settings)}
    assert states["alerts.sweep"] == "late"


# Support tools


def test_suspending_an_organisation_blocks_it_and_reactivating_restores_it(
    verified: Member, new_owner: Callable[[], Member]
) -> None:
    target = new_owner()
    car = vehicle(target)
    path = f"/organisations/{target.organisation_id}"
    assert act(verified, f"{path}/suspend").status_code == 200
    assert target.client.get(f"{API}/vehicles/{car}").status_code == 403
    assert act(verified, f"{path}/reactivate").status_code == 200
    assert target.client.get(f"{API}/vehicles/{car}").status_code == 200


def test_deactivating_a_user_ends_their_sessions_at_once(
    verified: Member, new_owner: Callable[[], Member], db: Session
) -> None:
    target = new_owner()
    user = db.exec(select(User).where(User.email == target.email)).one()
    assert act(verified, f"/users/{user.id}/deactivate").status_code == 200
    assert target.client.get(f"{API}/auth/me").status_code == 401
    assert act(verified, f"/users/{user.id}/reactivate").status_code == 200


def test_an_admin_cant_lock_themselves_out(verified: Member, db: Session) -> None:
    me = db.exec(select(User).where(User.email == verified.email)).one()
    response = act(verified, f"/users/{me.id}/deactivate")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "own_account"


def test_a_reason_is_required_and_recorded(
    verified: Member, new_owner: Callable[[], Member]
) -> None:
    target = new_owner()
    path = f"/organisations/{target.organisation_id}/suspend"
    assert act(verified, path, "").status_code == 422
    assert act(verified, path, "x").status_code == 422
    assert act(verified, path, "Fraud report 7").status_code == 200
    entries = verified.client.get(
        f"{ROOT}/audit", params={"action": "platform.organisation_suspended"}
    ).json()["items"]
    entry = next(item for item in entries if item["organisation_id"] == target.organisation_id)
    assert entry["details"]["reason"] == "Fraud report 7"
    assert entry["actor_email"] == verified.email


def test_unknown_targets_are_not_found(verified: Member) -> None:
    missing = "00000000-0000-0000-0000-000000000000"
    assert act(verified, f"/organisations/{missing}/suspend").status_code == 404
    assert act(verified, f"/users/{missing}/deactivate").status_code == 404


def test_removing_the_flag_ends_access_at_once(verified: Member, migrated_engine: Engine) -> None:
    with migrated_engine.begin() as connection:
        connection.execute(
            text("UPDATE users SET is_platform_admin = false WHERE email = :email"),
            {"email": verified.email},
        )
    assert verified.client.get(f"{ROOT}/users").status_code == 404
