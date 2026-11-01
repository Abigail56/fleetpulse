import uuid
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from typing import Any

import pytest
from sqlmodel import Session, select

from app.models import AuditLog, Trip
from app.models.base import utcnow
from app.models.enums import TripStatus
from tests.integration.conftest import API, Member

pytestmark = pytest.mark.integration

URL = f"{API}/drivers"
VEHICLES = f"{API}/vehicles"
VALID: dict[str, Any] = {
    "first_name": "Tunde",
    "last_name": "Adeyemi",
    "licence_number": "dl-123456",
    "phone": "+254 712 345678",
    "email": "tunde@example.com",
}
VEHICLE = {
    "registration_number": "KCA 123A",
    "make": "Isuzu",
    "model": "NPR",
    "vehicle_type": "truck",
    "fuel_type": "diesel",
}


def create(member: Member, **overrides: Any) -> Any:
    return member.client.post(URL, json=VALID | overrides, headers=member.csrf)


def created(member: Member, **overrides: Any) -> dict[str, Any]:
    response = create(member, **overrides)
    assert response.status_code == 201, response.text
    result: dict[str, Any] = response.json()
    return result


def vehicle(member: Member, registration: str = "KCA 123A") -> dict[str, Any]:
    response = member.client.post(
        VEHICLES, json=VEHICLE | {"registration_number": registration}, headers=member.csrf
    )
    assert response.status_code == 201, response.text
    result: dict[str, Any] = response.json()
    return result


def assign(member: Member, driver: dict[str, Any], car: dict[str, Any]) -> Any:
    return member.client.post(
        f"{URL}/{driver['id']}/assign", json={"vehicle_id": car["id"]}, headers=member.csrf
    )


def names(member: Member, **params: Any) -> list[str]:
    response = member.client.get(URL, params=params)
    assert response.status_code == 200, response.text
    return [item["first_name"] for item in response.json()["items"]]


def test_driver_is_created_and_licence_is_normalised(new_owner: Callable[[], Member]) -> None:
    driver = created(new_owner())
    assert driver["licence_number"] == "DL-123456"
    assert driver["status"] == "active"
    assert driver["availability"] == "available"
    assert driver["sensitive_visible"] is True
    assert driver["current_vehicle"] is None


@pytest.mark.parametrize(
    "overrides",
    [
        {"first_name": ""},
        {"first_name": "Line\nBreak"},
        {"licence_number": "x"},
        {"licence_number": "<script>"},
        {"phone": "call me"},
        {"email": "nope"},
        {"licence_country_code": "kenya"},
        {"licence_expires_on": "soon"},
        {"status": "fired"},
        {"availability": "maybe"},
        {"organisation_id": str(uuid.uuid4())},
        {"user_id": str(uuid.uuid4())},
    ],
)
def test_invalid_input_is_rejected(
    new_owner: Callable[[], Member], overrides: dict[str, Any]
) -> None:
    assert create(new_owner(), **overrides).status_code == 422


def test_duplicate_licence_is_rejected_within_an_organisation_only(
    new_owner: Callable[[], Member],
) -> None:
    owner = new_owner()
    created(owner)
    duplicate = create(owner, licence_number="DL-123456")
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == "duplicate_licence"
    created(new_owner())


def test_audit_records_field_names_but_no_personal_data(
    new_owner: Callable[[], Member], db: Session
) -> None:
    owner = new_owner()
    driver = created(owner)
    owner.client.patch(
        f"{URL}/{driver['id']}",
        json={"phone": "+254 700 000000", "availability": "off_duty"},
        headers=owner.csrf,
    )
    rows = db.exec(select(AuditLog).where(AuditLog.entity_id == driver["id"])).all()
    text = str([row.details for row in rows])
    assert "254" not in text
    assert "DL-123456" not in text
    assert "tunde@example.com" not in text
    updated = next(row for row in rows if row.action == "driver.updated")
    assert updated.details["fields"] == ["availability", "phone"]
    assert updated.details["changes"]["availability"]["to"] == "off_duty"


# Sensitive data


@pytest.mark.parametrize(
    ("role", "sees_sensitive"),
    [
        ("administrator", True),
        ("fleet_manager", True),
        ("dispatcher", True),
        ("maintenance_manager", False),
        ("finance_manager", False),
        ("read_only", False),
    ],
)
def test_licence_and_contact_details_follow_the_role(
    role: str,
    sees_sensitive: bool,
    new_owner: Callable[[], Member],
    invite: Callable[..., Member],
) -> None:
    owner = new_owner()
    driver = created(owner)
    member = invite(owner, role)
    for body in (
        member.client.get(f"{URL}/{driver['id']}").json(),
        member.client.get(URL).json()["items"][0],
    ):
        assert body["sensitive_visible"] is sees_sensitive
        if sees_sensitive:
            assert body["licence_number"] == "DL-123456"
            assert body["phone"] == VALID["phone"]
        else:
            assert body["licence_number"] == "••••3456"
            assert body["phone"] is None
            assert body["email"] is None


def test_hidden_fields_cannot_be_discovered_through_search(
    new_owner: Callable[[], Member], invite: Callable[..., Member]
) -> None:
    owner = new_owner()
    created(owner)
    viewer = invite(owner, "read_only")
    assert names(viewer, search="DL-123") == []
    assert names(viewer, search="712") == []
    assert names(viewer, search="tunde@") == []
    assert names(viewer, search="Adeyemi") == ["Tunde"]
    assert names(owner, search="DL-123") == ["Tunde"]


def test_driver_role_cannot_view_drivers(
    new_owner: Callable[[], Member], invite: Callable[..., Member]
) -> None:
    owner = new_owner()
    driver = created(owner)
    member = invite(owner, "driver")
    assert member.client.get(URL).status_code == 403
    assert member.client.get(f"{URL}/{driver['id']}").status_code == 403
    assert member.client.get(f"{URL}/{driver['id']}/assignments").status_code == 403


@pytest.mark.parametrize(
    ("role", "allowed"),
    [
        ("administrator", True),
        ("fleet_manager", True),
        ("dispatcher", False),
        ("maintenance_manager", False),
        ("finance_manager", False),
        ("read_only", False),
    ],
)
def test_only_managers_can_change_drivers(
    role: str, allowed: bool, new_owner: Callable[[], Member], invite: Callable[..., Member]
) -> None:
    owner = new_owner()
    driver = created(owner)
    car = vehicle(owner)
    member = invite(owner, role)
    code = 200 if allowed else 403
    url = f"{URL}/{driver['id']}"
    assert create(member, licence_number="OTHER-1").status_code == (201 if allowed else 403)
    edit = member.client.patch(url, json={"first_name": "X"}, headers=member.csrf)
    assert edit.status_code == code
    assert assign(member, driver, car).status_code == code
    if allowed:
        assert member.client.post(f"{url}/unassign", headers=member.csrf).status_code == code
    assert member.client.post(f"{url}/archive", headers=member.csrf).status_code == code


def test_another_organisations_driver_looks_like_it_does_not_exist(
    new_owner: Callable[[], Member],
) -> None:
    attacker, victim = new_owner(), new_owner()
    driver = created(victim)
    url = f"{URL}/{driver['id']}"
    csrf = attacker.csrf
    assert attacker.client.get(url).status_code == 404
    assert attacker.client.get(f"{url}/assignments").status_code == 404
    assert attacker.client.patch(url, json={"first_name": "X"}, headers=csrf).status_code == 404
    assert attacker.client.post(f"{url}/archive", headers=csrf).status_code == 404
    assert names(attacker) == []
    assert victim.client.get(url).json()["first_name"] == "Tunde"


def test_a_vehicle_from_another_organisation_cannot_be_assigned(
    new_owner: Callable[[], Member],
) -> None:
    attacker, victim = new_owner(), new_owner()
    driver = created(attacker)
    foreign = vehicle(victim)
    assert assign(attacker, driver, foreign).status_code == 404
    assert victim.client.get(f"{VEHICLES}/{foreign['id']}").json()["current_driver"] is None


# Listing


def test_filters_and_expiry(new_owner: Callable[[], Member]) -> None:
    owner = new_owner()
    today = utcnow().date()
    created(
        owner,
        first_name="Expired",
        licence_number="AAA1",
        licence_expires_on=str(today - timedelta(days=1)),
    )
    created(
        owner,
        first_name="Soon",
        licence_number="BBB2",
        licence_expires_on=str(today + timedelta(days=10)),
        availability="off_duty",
    )
    created(
        owner,
        first_name="Later",
        licence_number="CCC3",
        licence_expires_on=str(today + timedelta(days=100)),
        status="suspended",
    )
    assert names(owner, licence="expired") == ["Expired"]
    assert names(owner, licence="expiring") == ["Soon"]
    assert names(owner, availability="off_duty") == ["Soon"]
    assert names(owner, status="suspended") == ["Later"]
    assert names(owner, sort="licence_expires_on") == ["Expired", "Soon", "Later"]
    assert owner.client.get(URL, params={"sort": "phone"}).status_code == 422


@pytest.mark.parametrize("term", ["%", "_", "' OR 1=1 --"])
def test_search_treats_special_characters_literally(
    new_owner: Callable[[], Member], term: str
) -> None:
    owner = new_owner()
    created(owner)
    assert names(owner, search=term) == []


# Assignments


def test_assignment_shows_on_both_records_and_keeps_history(
    new_owner: Callable[[], Member],
) -> None:
    owner = new_owner()
    driver = created(owner)
    car = vehicle(owner)
    response = assign(owner, driver, car)
    assert response.status_code == 200
    assert response.json()["current_vehicle"]["registration_number"] == "KCA 123A"
    assigned = owner.client.get(f"{VEHICLES}/{car['id']}").json()
    assert assigned["current_driver"]["name"] == "Tunde Adeyemi"
    assert owner.client.get(URL).json()["items"][0]["current_vehicle"]["id"] == car["id"]

    unassigned = owner.client.post(f"{URL}/{driver['id']}/unassign", headers=owner.csrf)
    assert unassigned.json()["current_vehicle"] is None
    assert owner.client.get(f"{VEHICLES}/{car['id']}").json()["current_driver"] is None
    history = owner.client.get(f"{URL}/{driver['id']}/assignments").json()
    assert history[0]["registration_number"] == "KCA 123A"
    assert history[0]["ended_at"] is not None


def test_a_vehicle_and_a_driver_each_have_one_current_assignment(
    new_owner: Callable[[], Member],
) -> None:
    owner = new_owner()
    first, second = created(owner), created(owner, licence_number="OTHER-1")
    car, other_car = vehicle(owner), vehicle(owner, "OTHER1")
    assert assign(owner, first, car).status_code == 200
    taken = assign(owner, second, car)
    assert taken.status_code == 409
    assert taken.json()["error"]["code"] == "vehicle_already_assigned"
    busy = assign(owner, first, other_car)
    assert busy.status_code == 409
    assert busy.json()["error"]["code"] == "driver_already_assigned"


def test_simultaneous_assignments_of_a_vehicle_leave_one_driver(
    new_owner: Callable[[], Member],
) -> None:
    owner = new_owner()
    drivers = [created(owner, licence_number=f"LIC-{number}") for number in range(3)]
    car = vehicle(owner)
    with ThreadPoolExecutor(max_workers=3) as pool:
        statuses = sorted(pool.map(lambda item: assign(owner, item, car).status_code, drivers))
    assert statuses == [200, 409, 409]


def test_inactive_drivers_and_archived_vehicles_cannot_be_assigned(
    new_owner: Callable[[], Member],
) -> None:
    owner = new_owner()
    suspended = created(owner, licence_number="SUS-1", status="suspended")
    active = created(owner)
    car = vehicle(owner)
    assert assign(owner, suspended, car).json()["error"]["code"] == "driver_not_active"
    owner.client.post(f"{VEHICLES}/{car['id']}/archive", headers=owner.csrf)
    assert assign(owner, active, car).json()["error"]["code"] == "vehicle_archived"


def test_unassigning_someone_with_no_vehicle_is_reported(new_owner: Callable[[], Member]) -> None:
    owner = new_owner()
    driver = created(owner)
    response = owner.client.post(f"{URL}/{driver['id']}/unassign", headers=owner.csrf)
    assert response.status_code == 409


# Archiving


def test_archiving_frees_the_licence_ends_the_assignment_and_can_be_restored(
    new_owner: Callable[[], Member],
) -> None:
    owner = new_owner()
    driver = created(owner)
    car = vehicle(owner)
    assign(owner, driver, car)
    url = f"{URL}/{driver['id']}"
    assert owner.client.post(f"{url}/archive", headers=owner.csrf).status_code == 200
    assert names(owner) == []
    assert names(owner, archived="true") == ["Tunde"]
    assert owner.client.get(f"{VEHICLES}/{car['id']}").json()["current_driver"] is None
    assert owner.client.patch(url, json={"first_name": "X"}, headers=owner.csrf).status_code == 409

    replacement = created(owner)
    blocked = owner.client.post(f"{url}/restore", headers=owner.csrf)
    assert blocked.status_code == 409
    owner.client.post(f"{URL}/{replacement['id']}/archive", headers=owner.csrf)
    assert owner.client.post(f"{url}/restore", headers=owner.csrf).status_code == 200


def test_driver_on_a_trip_in_progress_cannot_be_archived(
    new_owner: Callable[[], Member], db: Session
) -> None:
    owner = new_owner()
    driver = created(owner)
    car = vehicle(owner)
    db.add(
        Trip(
            organisation_id=uuid.UUID(owner.organisation_id),
            vehicle_id=uuid.UUID(car["id"]),
            driver_id=uuid.UUID(driver["id"]),
            status=TripStatus.IN_PROGRESS,
            actual_departure_at=utcnow(),
            origin_name="A",
            destination_name="B",
        )
    )
    db.commit()
    response = owner.client.post(f"{URL}/{driver['id']}/archive", headers=owner.csrf)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "driver_on_trip"


# Two people editing


@pytest.mark.parametrize(
    ("url", "maker", "field"),
    [(URL, created, "first_name"), (VEHICLES, vehicle, "make")],
    ids=["driver", "vehicle"],
)
def test_an_edit_based_on_old_data_is_refused(
    new_owner: Callable[[], Member], url: str, maker: Callable[..., dict[str, Any]], field: str
) -> None:
    owner = new_owner()
    record = maker(owner)
    target = f"{url}/{record['id']}"
    loaded_at = record["updated_at"]
    first = owner.client.patch(
        target, json={field: "First", "expected_updated_at": loaded_at}, headers=owner.csrf
    )
    assert first.status_code == 200
    stale = owner.client.patch(
        target, json={field: "Second", "expected_updated_at": loaded_at}, headers=owner.csrf
    )
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "stale_update"
    assert owner.client.get(target).json()[field] == "First"
    fresh = owner.client.patch(
        target,
        json={field: "Second", "expected_updated_at": first.json()["updated_at"]},
        headers=owner.csrf,
    )
    assert fresh.status_code == 200
