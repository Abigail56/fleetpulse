import uuid
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import pytest
from sqlmodel import Session, select

from app.models import AuditLog, Driver, Trip, VehicleAssignment
from app.models.base import utcnow
from app.models.enums import TripStatus
from tests.integration.conftest import API, Member

pytestmark = pytest.mark.integration

URL = f"{API}/vehicles"
VALID: dict[str, Any] = {
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


def registrations(member: Member, **params: Any) -> list[str]:
    response = member.client.get(URL, params=params)
    assert response.status_code == 200, response.text
    return [item["registration_number"] for item in response.json()["items"]]


def org_uuid(member: Member) -> uuid.UUID:
    return uuid.UUID(member.organisation_id)


# Creating and reading


def test_vehicle_is_created_with_defaults_and_audited(
    new_owner: Callable[[], Member], db: Session
) -> None:
    owner = new_owner()
    vehicle = created(owner, year=2021, vin="jtdkb20u093123456", odometer_km=1500.5)
    assert vehicle["status"] == "idle"
    assert vehicle["ownership_type"] == "owned"
    assert vehicle["vin"] == "JTDKB20U093123456"
    assert float(vehicle["odometer_km"]) == 1500.5
    assert "registration_number_normalized" not in vehicle
    assert owner.client.get(f"{URL}/{vehicle['id']}").json()["id"] == vehicle["id"]
    actions = db.exec(select(AuditLog.action).where(AuditLog.entity_id == vehicle["id"])).all()
    assert actions == ["vehicle.created"]


@pytest.mark.parametrize(
    "overrides",
    [
        {"registration_number": ""},
        {"registration_number": "---"},
        {"registration_number": "A" * 33},
        {"make": ""},
        {"make": "Line\nBreak"},
        {"year": 1800},
        {"year": 3000},
        {"vehicle_type": "spaceship"},
        {"fuel_type": "coal"},
        {"vin": "ab"},
        {"vin": "HAS SPACES 123"},
        {"odometer_km": -1},
        {"odometer_km": 1.25},
        {"status": "stolen"},
        {"organisation_id": str(uuid.uuid4())},
        {"id": str(uuid.uuid4())},
        {"archived_at": "2026-01-01T00:00:00Z"},
    ],
)
def test_invalid_input_is_rejected(
    new_owner: Callable[[], Member], overrides: dict[str, Any]
) -> None:
    assert create(new_owner(), **overrides).status_code == 422


# Duplicates


def test_duplicate_registration_ignores_case_and_punctuation(
    new_owner: Callable[[], Member],
) -> None:
    owner = new_owner()
    created(owner, registration_number="KCA-123 A")
    response = create(owner, registration_number="kca123a")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "duplicate_registration"


def test_same_registration_is_allowed_in_another_organisation(
    new_owner: Callable[[], Member],
) -> None:
    created(new_owner())
    created(new_owner())


def test_duplicate_vin_is_rejected(new_owner: Callable[[], Member]) -> None:
    owner = new_owner()
    created(owner, vin="VIN12345")
    response = create(owner, registration_number="OTHER1", vin="vin12345")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "duplicate_vin"


def test_simultaneous_duplicates_create_only_one_vehicle(
    new_owner: Callable[[], Member],
) -> None:
    owner = new_owner()
    with ThreadPoolExecutor(max_workers=4) as pool:
        statuses = sorted(pool.map(lambda _: create(owner).status_code, range(4)))
    assert statuses == [201, 409, 409, 409]
    assert registrations(owner) == [VALID["registration_number"]]


def test_renaming_onto_an_existing_registration_is_rejected(
    new_owner: Callable[[], Member],
) -> None:
    owner = new_owner()
    created(owner)
    other = created(owner, registration_number="OTHER1")
    response = owner.client.patch(
        f"{URL}/{other['id']}", json={"registration_number": "KCA123A"}, headers=owner.csrf
    )
    assert response.status_code == 409
    assert owner.client.get(f"{URL}/{other['id']}").json()["registration_number"] == "OTHER1"


# Listing


def test_search_matches_registration_make_model_and_vin(new_owner: Callable[[], Member]) -> None:
    owner = new_owner()
    created(owner, registration_number="AAA1", make="Toyota", model="Hilux", vin="VINFINDME1")
    created(owner, registration_number="BBB2", make="Isuzu", model="NPR")
    assert registrations(owner, search="aaa") == ["AAA1"]
    assert registrations(owner, search="toyo") == ["AAA1"]
    assert registrations(owner, search="npr") == ["BBB2"]
    assert registrations(owner, search="findme") == ["AAA1"]
    assert registrations(owner, search="nothing-like-this") == []


@pytest.mark.parametrize("term", ["%", "_", "\\", "' OR 1=1 --"])
def test_search_treats_special_characters_literally(
    new_owner: Callable[[], Member], term: str
) -> None:
    owner = new_owner()
    created(owner)
    assert registrations(owner, search=term) == []


def test_filters_and_sorting(new_owner: Callable[[], Member]) -> None:
    owner = new_owner()
    created(owner, registration_number="AAA1", vehicle_type="van", odometer_km=300, status="active")
    created(owner, registration_number="BBB2", odometer_km=100)
    created(owner, registration_number="CCC3", odometer_km=200, year=2020)
    assert registrations(owner, status="active") == ["AAA1"]
    assert registrations(owner, vehicle_type="van") == ["AAA1"]
    assert registrations(owner, sort="-registration_number") == ["CCC3", "BBB2", "AAA1"]
    assert registrations(owner, sort="odometer_km") == ["BBB2", "CCC3", "AAA1"]
    # A missing year sorts last in both directions.
    assert registrations(owner, sort="-year")[0] == "CCC3"
    assert owner.client.get(URL, params={"sort": "password_hash"}).status_code == 422


def test_pagination_reports_totals_without_repeats(new_owner: Callable[[], Member]) -> None:
    owner = new_owner()
    for number in range(5):
        created(owner, registration_number=f"REG{number}")
    first = owner.client.get(URL, params={"page_size": 2}).json()
    second = owner.client.get(URL, params={"page_size": 2, "page": 2}).json()
    third = owner.client.get(URL, params={"page_size": 2, "page": 3}).json()
    assert first["total"] == 5
    seen = [item["id"] for page in (first, second, third) for item in page["items"]]
    assert len(seen) == len(set(seen)) == 5
    assert owner.client.get(URL, params={"page_size": 101}).status_code == 422
    assert owner.client.get(URL, params={"page": 0}).status_code == 422


# Updating


def test_update_changes_only_what_was_sent_and_audits_it(
    new_owner: Callable[[], Member], db: Session
) -> None:
    owner = new_owner()
    vehicle = created(owner, odometer_km=1000, owner_name="Acme Leasing")
    response = owner.client.patch(
        f"{URL}/{vehicle['id']}", json={"odometer_km": 900, "make": "Toyota"}, headers=owner.csrf
    )
    assert response.status_code == 200
    body = response.json()
    assert body["make"] == "Toyota"
    assert body["model"] == "NPR"
    assert body["owner_name"] == "Acme Leasing"
    row = db.exec(
        select(AuditLog).where(
            AuditLog.entity_id == vehicle["id"], AuditLog.action == "vehicle.updated"
        )
    ).one()
    assert row.details["fields"] == ["make", "odometer_km"]
    odometer = row.details["changes"]["odometer_km"]
    assert (float(odometer["from"]), float(odometer["to"])) == (1000, 900)
    assert "Toyota" not in str(row.details["changes"])


def test_optional_fields_can_be_cleared_but_required_ones_cannot(
    new_owner: Callable[[], Member],
) -> None:
    owner = new_owner()
    vehicle = created(owner, vin="VIN12345", year=2020)
    url = f"{URL}/{vehicle['id']}"
    cleared = owner.client.patch(url, json={"vin": None, "year": None}, headers=owner.csrf)
    assert cleared.status_code == 200
    assert cleared.json()["vin"] is None
    assert owner.client.patch(url, json={"make": None}, headers=owner.csrf).status_code == 422


def test_saving_without_changes_writes_no_audit_entry(
    new_owner: Callable[[], Member], db: Session
) -> None:
    owner = new_owner()
    vehicle = created(owner)
    response = owner.client.patch(
        f"{URL}/{vehicle['id']}", json={"make": VALID["make"]}, headers=owner.csrf
    )
    assert response.status_code == 200
    assert (
        db.exec(
            select(AuditLog).where(
                AuditLog.entity_id == vehicle["id"], AuditLog.action == "vehicle.updated"
            )
        ).first()
        is None
    )


# Archiving


def test_archiving_hides_the_vehicle_and_frees_its_registration(
    new_owner: Callable[[], Member],
) -> None:
    owner = new_owner()
    vehicle = created(owner)
    archived = owner.client.post(f"{URL}/{vehicle['id']}/archive", headers=owner.csrf)
    assert archived.status_code == 200
    assert archived.json()["archived_at"] is not None
    assert registrations(owner) == []
    assert registrations(owner, archived="true") == [VALID["registration_number"]]
    assert owner.client.get(f"{URL}/{vehicle['id']}").status_code == 200
    created(owner)


def test_archived_vehicle_cannot_be_edited_until_restored(
    new_owner: Callable[[], Member],
) -> None:
    owner = new_owner()
    vehicle = created(owner)
    url = f"{URL}/{vehicle['id']}"
    owner.client.post(f"{url}/archive", headers=owner.csrf)
    blocked = owner.client.patch(url, json={"make": "Toyota"}, headers=owner.csrf)
    assert blocked.status_code == 409
    assert owner.client.post(f"{url}/restore", headers=owner.csrf).status_code == 200
    assert owner.client.patch(url, json={"make": "Toyota"}, headers=owner.csrf).status_code == 200


def test_restoring_is_refused_if_the_registration_was_reused(
    new_owner: Callable[[], Member],
) -> None:
    owner = new_owner()
    old = created(owner)
    owner.client.post(f"{URL}/{old['id']}/archive", headers=owner.csrf)
    created(owner)
    response = owner.client.post(f"{URL}/{old['id']}/restore", headers=owner.csrf)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "duplicate_registration"


def add_driver(db: Session, member: Member) -> Driver:
    driver = Driver(
        organisation_id=org_uuid(member),
        first_name="Test",
        last_name="Driver",
        licence_number=uuid.uuid4().hex[:12],
    )
    db.add(driver)
    db.commit()
    db.refresh(driver)
    return driver


def test_vehicle_on_a_trip_in_progress_cannot_be_archived(
    new_owner: Callable[[], Member], db: Session
) -> None:
    owner = new_owner()
    vehicle = created(owner)
    driver = add_driver(db, owner)
    db.add(
        Trip(
            organisation_id=org_uuid(owner),
            vehicle_id=uuid.UUID(vehicle["id"]),
            driver_id=driver.id,
            status=TripStatus.IN_PROGRESS,
            actual_departure_at=utcnow(),
            origin_name="A",
            destination_name="B",
        )
    )
    db.commit()
    response = owner.client.post(f"{URL}/{vehicle['id']}/archive", headers=owner.csrf)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "vehicle_on_trip"


def test_archiving_ends_the_current_driver_assignment(
    new_owner: Callable[[], Member], db: Session
) -> None:
    owner = new_owner()
    vehicle = created(owner)
    driver = add_driver(db, owner)
    assignment = VehicleAssignment(
        organisation_id=org_uuid(owner), vehicle_id=uuid.UUID(vehicle["id"]), driver_id=driver.id
    )
    db.add(assignment)
    db.commit()
    assert owner.client.post(f"{URL}/{vehicle['id']}/archive", headers=owner.csrf).is_success
    db.refresh(assignment)
    assert assignment.ended_at is not None


# Isolation


def test_another_organisations_vehicle_looks_like_it_does_not_exist(
    new_owner: Callable[[], Member],
) -> None:
    attacker, victim = new_owner(), new_owner()
    vehicle = created(victim)
    url = f"{URL}/{vehicle['id']}"
    unknown = f"{URL}/{uuid.uuid4()}"
    assert attacker.client.get(url).status_code == 404
    assert attacker.client.get(url).json() == attacker.client.get(unknown).json()
    assert attacker.client.patch(url, json={"make": "X"}, headers=attacker.csrf).status_code == 404
    assert attacker.client.post(f"{url}/archive", headers=attacker.csrf).status_code == 404
    assert attacker.client.post(f"{url}/restore", headers=attacker.csrf).status_code == 404
    assert registrations(attacker) == []
    assert victim.client.get(url).json()["make"] == VALID["make"]
    assert victim.client.get(url).json()["archived_at"] is None


def test_switching_organisation_changes_which_vehicles_are_seen(
    new_owner: Callable[[], Member], invite: Callable[..., Member]
) -> None:
    first, second = new_owner(), new_owner()
    created(first, registration_number="FIRST1")
    created(second, registration_number="SECOND2")
    assert registrations(first) == ["FIRST1"]
    assert registrations(second) == ["SECOND2"]


# Permissions


@pytest.mark.parametrize(
    ("role", "can_view", "can_manage"),
    [
        ("administrator", True, True),
        ("fleet_manager", True, True),
        ("dispatcher", True, False),
        ("maintenance_manager", True, False),
        ("finance_manager", True, False),
        ("read_only", True, False),
        ("driver", False, False),
    ],
)
def test_role_permissions(
    role: str,
    can_view: bool,
    can_manage: bool,
    new_owner: Callable[[], Member],
    invite: Callable[..., Member],
) -> None:
    owner = new_owner()
    vehicle = created(owner)
    member = invite(owner, role)
    url = f"{URL}/{vehicle['id']}"
    assert member.client.get(URL).status_code == (200 if can_view else 403)
    assert member.client.get(url).status_code == (200 if can_view else 403)
    assert create(member, registration_number="NEW1").status_code == (201 if can_manage else 403)
    assert member.client.patch(url, json={"make": "X"}, headers=member.csrf).status_code == (
        200 if can_manage else 403
    )
    assert member.client.post(f"{url}/archive", headers=member.csrf).status_code == (
        200 if can_manage else 403
    )


def test_writes_need_csrf_and_reads_need_a_session(
    client: Any, new_owner: Callable[[], Member]
) -> None:
    owner = new_owner()
    assert owner.client.post(URL, json=VALID).status_code == 403
    assert client.get(URL).status_code == 401


def test_dashboard_reflects_real_vehicles(new_owner: Callable[[], Member]) -> None:
    owner = new_owner()
    created(owner, status="active")
    created(owner, registration_number="OTHER1", status="maintenance")
    archived = created(owner, registration_number="GONE1", status="active")
    owner.client.post(f"{URL}/{archived['id']}/archive", headers=owner.csrf)
    vehicles = owner.client.get(f"{API}/dashboard").json()["vehicles"]
    assert vehicles["total"] == 2
    assert vehicles["active"] == 1
    assert vehicles["maintenance"] == 1
    assert vehicles["utilisation_percent"] == 50
