import uuid
from collections.abc import Callable
from datetime import date, timedelta
from typing import Any

import pytest
from fastapi import FastAPI
from sqlalchemy import Engine, text
from sqlmodel import Session, select

from app.db.partitions import drop_partitions_before, ensure_monthly_partitions
from app.models import AuditLog, GpsIntegration
from app.models.base import utcnow
from app.services.telemetry import simulate_tick
from tests.integration.conftest import API, Member

pytestmark = pytest.mark.integration

INGEST = f"{API}/ingest/gps"
TRACK = f"{API}/tracking"
LAGOS = (6.5244, 3.3792)


def vehicle(member: Member, registration: str = "KCA 123A") -> str:
    response = member.client.post(
        f"{API}/vehicles",
        json={
            "registration_number": registration,
            "make": "Isuzu",
            "model": "NPR",
            "vehicle_type": "truck",
            "fuel_type": "diesel",
        },
        headers=member.csrf,
    )
    assert response.status_code == 201, response.text
    return str(response.json()["id"])


def new_key(member: Member) -> str:
    response = member.client.post(
        f"{TRACK}/integrations", json={"name": "Feed"}, headers=member.csrf
    )
    assert response.status_code == 201, response.text
    return str(response.json()["key"])


def device(member: Member, vehicle_id: str | None, external: str = "D1", **extra: Any) -> Any:
    return member.client.post(
        f"{TRACK}/devices",
        json={"external_device_id": external, "vehicle_id": vehicle_id, **extra},
        headers=member.csrf,
    )


def position(external: str = "D1", minutes_ago: int = 0, **extra: Any) -> dict[str, Any]:
    return {
        "device_id": external,
        "recorded_at": (utcnow() - timedelta(minutes=minutes_ago)).isoformat(),
        "latitude": LAGOS[0],
        "longitude": LAGOS[1],
        **extra,
    }


def send(member: Member, key: str, *positions: dict[str, Any]) -> Any:
    return member.client.post(
        INGEST, json={"positions": list(positions)}, headers={"Authorization": f"Bearer {key}"}
    )


@pytest.fixture
def tracked(new_owner: Callable[[], Member]) -> tuple[Member, str, str]:
    owner = new_owner()
    car = vehicle(owner)
    assert device(owner, car).status_code == 201
    return owner, car, new_key(owner)


def latest(member: Member, car: str) -> Any:
    response = member.client.get(f"{TRACK}/vehicles/{car}/latest")
    assert response.status_code == 200, response.text
    return response.json()


# Keys


def test_key_is_shown_once_and_stored_only_as_a_hash(
    new_owner: Callable[[], Member], db: Session
) -> None:
    owner = new_owner()
    key = new_key(owner)
    assert key.startswith("fpgps_")
    listed = owner.client.get(f"{TRACK}/integrations").json()
    assert "key" not in listed[0]
    assert key not in str(listed)
    row = db.exec(select(GpsIntegration).where(GpsIntegration.key_prefix == key[:12])).one()
    assert key not in row.key_hash
    actions = db.exec(select(AuditLog).where(AuditLog.entity_id == str(row.id))).all()
    assert key not in str([item.details for item in actions])


@pytest.mark.parametrize(
    "headers", [{}, {"Authorization": "Bearer wrong"}, {"Authorization": "Basic abc"}]
)
def test_ingestion_needs_a_valid_key(
    tracked: tuple[Member, str, str], headers: dict[str, str]
) -> None:
    owner, car, _key = tracked
    response = owner.client.post(INGEST, json={"positions": [position()]}, headers=headers)
    assert response.status_code == 401
    assert latest(owner, car) is None


def test_a_signed_in_browser_session_is_not_a_key(tracked: tuple[Member, str, str]) -> None:
    owner, car, _key = tracked
    response = owner.client.post(INGEST, json={"positions": [position()]}, headers=owner.csrf)
    assert response.status_code == 401
    assert latest(owner, car) is None


def test_a_revoked_key_stops_working_immediately(tracked: tuple[Member, str, str]) -> None:
    owner, _car, key = tracked
    integration = owner.client.get(f"{TRACK}/integrations").json()[0]
    assert send(owner, key, position()).status_code == 202
    revoked = owner.client.delete(f"{TRACK}/integrations/{integration['id']}", headers=owner.csrf)
    assert revoked.status_code == 204
    assert send(owner, key, position(minutes_ago=1)).status_code == 401


@pytest.mark.parametrize(
    ("role", "allowed"),
    [
        ("administrator", True),
        ("fleet_manager", False),
        ("dispatcher", False),
        ("read_only", False),
    ],
)
def test_only_owners_and_administrators_handle_keys(
    role: str, allowed: bool, new_owner: Callable[[], Member], invite: Callable[..., Member]
) -> None:
    member = invite(new_owner(), role)
    response = member.client.post(
        f"{TRACK}/integrations", json={"name": "Feed"}, headers=member.csrf
    )
    assert response.status_code == (201 if allowed else 403)
    assert member.client.get(f"{TRACK}/integrations").status_code == (200 if allowed else 403)


# Ingesting


def test_a_position_is_stored_and_becomes_the_latest(
    tracked: tuple[Member, str, str],
) -> None:
    owner, car, key = tracked
    response = send(owner, key, position(speed_kph=42.5, heading_degrees=180, ignition_on=True))
    assert response.status_code == 202
    assert response.json() == {"accepted": 1, "duplicates": 0, "rejected": []}
    found = latest(owner, car)
    assert found["latitude"] == pytest.approx(LAGOS[0])
    assert found["longitude"] == pytest.approx(LAGOS[1])
    assert float(found["speed_kph"]) == 42.5
    assert found["is_stale"] is False
    assert found["is_simulated"] is False
    assert owner.client.get(f"{TRACK}/devices").json()[0]["last_seen_at"] is not None


def test_unreported_values_stay_empty_rather_than_zero(tracked: tuple[Member, str, str]) -> None:
    owner, car, key = tracked
    send(owner, key, position())
    found = latest(owner, car)
    assert found["speed_kph"] is None
    assert found["heading_degrees"] is None
    assert found["ignition_on"] is None
    assert found["signal_status"] == "unknown"


def test_a_resent_position_is_a_duplicate_not_a_second_row(
    tracked: tuple[Member, str, str],
) -> None:
    owner, car, key = tracked
    item = position()
    assert send(owner, key, item).json()["accepted"] == 1
    again = send(owner, key, item).json()
    assert again == {"accepted": 0, "duplicates": 1, "rejected": []}
    start = (utcnow() - timedelta(hours=1)).isoformat()
    end = (utcnow() + timedelta(hours=1)).isoformat()
    history = owner.client.get(
        f"{TRACK}/vehicles/{car}/history", params={"start": start, "end": end}
    ).json()
    assert len(history) == 1


def test_a_late_position_goes_to_history_without_replacing_the_latest(
    tracked: tuple[Member, str, str],
) -> None:
    owner, car, key = tracked
    send(owner, key, position(minutes_ago=1, speed_kph=10))
    response = send(owner, key, position(minutes_ago=30, speed_kph=99))
    assert response.json()["accepted"] == 1
    assert float(latest(owner, car)["speed_kph"]) == 10


def test_positions_from_before_a_device_moved_are_not_given_to_its_new_vehicle(
    tracked: tuple[Member, str, str],
) -> None:
    owner, _car, key = tracked
    other = vehicle(owner, "OTHER1")
    item = owner.client.get(f"{TRACK}/devices").json()[0]
    moved = owner.client.patch(
        f"{TRACK}/devices/{item['id']}", json={"vehicle_id": other}, headers=owner.csrf
    )
    assert moved.status_code == 200
    late = send(owner, key, position(minutes_ago=5)).json()
    assert late["rejected"][0]["reason"] == "recorded_before_reassignment"
    assert latest(owner, other) is None
    assert send(owner, key, position()).json()["accepted"] == 1
    assert latest(owner, other) is not None


def test_a_full_batch_counts_new_duplicate_and_repeated_positions_correctly(
    new_owner: Callable[[], Member],
) -> None:
    owner = new_owner()
    cars = [vehicle(owner, f"BULK{number}") for number in range(5)]
    for number, car in enumerate(cars):
        assert device(owner, car, external=f"B{number}").status_code == 201
    key = new_key(owner)
    batch = [position(f"B{i % 5}", minutes_ago=i + 1, speed_kph=i) for i in range(500)]
    assert len({(item["device_id"], item["recorded_at"]) for item in batch}) == 500
    first = send(owner, key, *batch).json()
    assert first == {"accepted": 500, "duplicates": 0, "rejected": []}
    # Each vehicle's latest is its newest position, wherever that was in the batch.
    assert float(latest(owner, cars[0])["speed_kph"]) == 0
    assert float(latest(owner, cars[4])["speed_kph"]) == 4
    second = send(owner, key, *batch[:10], position("B0", speed_kph=999)).json()
    assert second == {"accepted": 1, "duplicates": 10, "rejected": []}
    assert float(latest(owner, cars[0])["speed_kph"]) == 999
    assert send(owner, key, batch[0], batch[0]).json()["duplicates"] == 2


def test_old_data_is_reported_as_stale(tracked: tuple[Member, str, str]) -> None:
    owner, car, key = tracked
    send(owner, key, position(minutes_ago=16))
    assert latest(owner, car)["is_stale"] is True


def test_bad_positions_are_reported_without_losing_good_ones(
    new_owner: Callable[[], Member],
) -> None:
    owner = new_owner()
    car = vehicle(owner)
    device(owner, car)
    device(owner, None, external="UNASSIGNED")
    inactive = device(owner, vehicle(owner, "OTHER1"), external="OFF").json()
    owner.client.patch(
        f"{TRACK}/devices/{inactive['id']}", json={"status": "inactive"}, headers=owner.csrf
    )
    response = send(
        owner,
        new_key(owner),
        position(),
        position("NOBODY"),
        position("UNASSIGNED"),
        position("OFF"),
        position(minutes_ago=-10),
        position(minutes_ago=60 * 24 * 31),
        position(latitude=95),
    ).json()
    assert response["accepted"] == 1
    assert [item["reason"] for item in response["rejected"]] == [
        "unknown_device",
        "device_not_assigned",
        "device_inactive",
        "timestamp_in_future",
        "timestamp_too_old",
        "invalid: latitude",
    ]


def test_an_archived_vehicle_receives_no_positions(tracked: tuple[Member, str, str]) -> None:
    owner, car, key = tracked
    owner.client.post(f"{API}/vehicles/{car}/archive", headers=owner.csrf)
    assert send(owner, key, position()).json()["rejected"][0]["reason"] == "vehicle_archived"


def test_bad_requests_are_refused(tracked: tuple[Member, str, str]) -> None:
    owner, _car, key = tracked
    headers = {"Authorization": f"Bearer {key}"}
    not_json = owner.client.post(INGEST, content=b"not json", headers=headers)
    assert not_json.status_code == 400
    assert owner.client.post(INGEST, json={"nope": []}, headers=headers).status_code == 400
    too_big = owner.client.post(INGEST, content=b"x" * 1_000_001, headers=headers)
    assert too_big.status_code == 413


def test_ingestion_is_rate_limited_per_key(app: FastAPI, tracked: tuple[Member, str, str]) -> None:
    owner, _car, key = tracked
    app.state.settings = app.state.settings.model_copy(update={"gps_requests_per_minute": 2})
    statuses = [send(owner, key, position(minutes_ago=i)).status_code for i in range(3)]
    assert statuses == [202, 202, 429]


# Isolation


def test_a_key_cannot_write_for_another_organisation(
    new_owner: Callable[[], Member],
) -> None:
    attacker, victim = new_owner(), new_owner()
    car = vehicle(victim)
    device(victim, car, external="SHARED-ID")
    response = send(attacker, new_key(attacker), position("SHARED-ID")).json()
    assert response["rejected"][0]["reason"] == "unknown_device"
    assert latest(victim, car) is None


def test_two_organisations_can_register_the_same_device_id(
    new_owner: Callable[[], Member],
) -> None:
    """If this were global, one customer could block another by registering their ID first."""
    first, second = new_owner(), new_owner()
    assert device(first, vehicle(first), external="IMEI-1").status_code == 201
    assert device(second, vehicle(second), external="IMEI-1").status_code == 201
    duplicate = device(first, None, external="IMEI-1")
    assert duplicate.status_code == 409


def test_positions_of_another_organisation_are_not_reachable(
    tracked: tuple[Member, str, str], new_owner: Callable[[], Member]
) -> None:
    owner, car, key = tracked
    send(owner, key, position())
    attacker = new_owner()
    assert attacker.client.get(f"{TRACK}/latest").json() == []
    assert attacker.client.get(f"{TRACK}/vehicles/{car}/latest").status_code == 404
    start = (utcnow() - timedelta(hours=1)).isoformat()
    end = utcnow().isoformat()
    params = {"start": start, "end": end}
    assert attacker.client.get(f"{TRACK}/vehicles/{car}/history", params=params).status_code == 404
    assert attacker.client.get(f"{TRACK}/vehicles/{car}/journeys", params=params).status_code == 404
    assert attacker.client.get(f"{TRACK}/devices").json() == []


def test_a_device_cannot_use_another_organisations_vehicle_or_be_edited_across(
    new_owner: Callable[[], Member],
) -> None:
    attacker, victim = new_owner(), new_owner()
    foreign_car = vehicle(victim)
    assert device(attacker, foreign_car).status_code == 404
    victims = device(victim, foreign_car, external="V").json()
    edit = attacker.client.patch(
        f"{TRACK}/devices/{victims['id']}", json={"status": "inactive"}, headers=attacker.csrf
    )
    assert edit.status_code == 404


def test_a_vehicle_has_one_active_device(new_owner: Callable[[], Member]) -> None:
    owner = new_owner()
    car = vehicle(owner)
    device(owner, car, external="A")
    second = device(owner, car, external="B")
    assert second.status_code == 409
    assert second.json()["error"]["code"] == "vehicle_has_device"


@pytest.mark.parametrize(("role", "code"), [("read_only", 200), ("driver", 403)])
def test_viewing_positions_follows_vehicle_permission(
    role: str, code: int, tracked: tuple[Member, str, str], invite: Callable[..., Member]
) -> None:
    owner, _car, _key = tracked
    assert invite(owner, role).client.get(f"{TRACK}/latest").status_code == code


def test_read_only_cannot_manage_devices(
    tracked: tuple[Member, str, str], invite: Callable[..., Member]
) -> None:
    owner, _car, _key = tracked
    assert device(invite(owner, "read_only"), None, external="X").status_code == 403


# History and journeys


def test_history_range_is_limited_and_journeys_are_reconstructed(
    tracked: tuple[Member, str, str],
) -> None:
    owner, car, key = tracked
    send(
        owner,
        key,
        position(minutes_ago=50, latitude=0.0),
        position(minutes_ago=45, latitude=0.1),
        position(minutes_ago=5, latitude=0.2),
        position(minutes_ago=1, latitude=0.3),
    )
    start = (utcnow() - timedelta(hours=2)).isoformat()
    end = (utcnow() + timedelta(minutes=1)).isoformat()
    params = {"start": start, "end": end}
    journeys = owner.client.get(f"{TRACK}/vehicles/{car}/journeys", params=params).json()
    assert len(journeys) == 2
    assert journeys[0]["distance_km"] == pytest.approx(11.12, abs=0.01)
    too_long = {"start": (utcnow() - timedelta(days=40)).isoformat(), "end": end}
    assert owner.client.get(f"{TRACK}/vehicles/{car}/history", params=too_long).status_code == 400
    backwards = {"start": end, "end": start}
    assert owner.client.get(f"{TRACK}/vehicles/{car}/history", params=backwards).status_code == 400


# Simulator


def simulated(owner: Member, car: str) -> Any:
    return owner.client.post(
        f"{TRACK}/devices",
        json={
            "simulated": True,
            "vehicle_id": car,
            "start_latitude": LAGOS[0],
            "start_longitude": LAGOS[1],
        },
        headers=owner.csrf,
    )


def test_simulator_is_refused_unless_enabled(new_owner: Callable[[], Member]) -> None:
    owner = new_owner()
    response = simulated(owner, vehicle(owner))
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "simulator_disabled"
    assert owner.client.get(f"{TRACK}/config").json()["simulator_enabled"] is False


def test_simulated_positions_are_labelled_and_move(
    app: FastAPI, new_owner: Callable[[], Member], app_engine: Engine
) -> None:
    settings = app.state.settings.model_copy(update={"gps_simulator_enabled": True})
    app.state.settings = settings
    owner = new_owner()
    car = vehicle(owner)
    assert simulated(owner, car).status_code == 201
    first = latest(owner, car)
    assert first["is_simulated"] is True

    with Session(app_engine) as db:
        assert simulate_tick(db, settings) >= 1
    moved = latest(owner, car)
    assert moved["is_simulated"] is True
    assert (moved["latitude"], moved["longitude"]) != (first["latitude"], first["longitude"])
    assert owner.client.get(f"{TRACK}/devices").json()[0]["is_simulated"] is True


def test_simulator_does_nothing_when_disabled(
    app: FastAPI, new_owner: Callable[[], Member], app_engine: Engine
) -> None:
    with Session(app_engine) as db:
        assert simulate_tick(db, app.state.settings) == 0


def test_a_provider_cannot_write_through_a_simulated_device_or_claim_simulation(
    app: FastAPI, tracked: tuple[Member, str, str]
) -> None:
    app.state.settings = app.state.settings.model_copy(update={"gps_simulator_enabled": True})
    owner, car, key = tracked
    # Real device: claiming to be simulated changes nothing.
    send(owner, key, position(is_simulated=True))
    assert latest(owner, car)["is_simulated"] is False
    # Simulated device: unreachable, because it isn't under the feed's provider.
    other = vehicle(owner, "SIM1")
    created = simulated(owner, other).json()
    response = send(owner, key, position(created["external_device_id"]))
    assert response.json()["rejected"][0]["reason"] == "unknown_device"


def test_client_cannot_choose_a_simulated_devices_id(
    app: FastAPI, new_owner: Callable[[], Member]
) -> None:
    app.state.settings = app.state.settings.model_copy(update={"gps_simulator_enabled": True})
    owner = new_owner()
    response = owner.client.post(
        f"{TRACK}/devices",
        json={
            "simulated": True,
            "external_device_id": "REAL-IMEI",
            "vehicle_id": vehicle(owner),
            "start_latitude": 0,
            "start_longitude": 0,
        },
        headers=owner.csrf,
    )
    assert response.json()["external_device_id"].startswith("sim-")


# Scheduled upkeep, as the restricted role the worker uses


def test_app_role_can_run_partition_upkeep_but_nothing_wider(app_engine: Engine) -> None:
    with app_engine.connect() as connection:
        transaction = connection.begin()
        ensure_monthly_partitions(connection, date(2034, 1, 1), 2)
        dropped = drop_partitions_before(connection, date(2034, 2, 1))
        assert "vehicle_locations_y2034m01" in dropped
        assert "vehicle_locations_y2034m02" not in dropped
        transaction.rollback()


def test_retention_function_never_drops_the_default_partition(app_engine: Engine) -> None:
    with app_engine.connect() as connection:
        transaction = connection.begin()
        drop_partitions_before(connection, date(2999, 1, 1))
        remaining = connection.execute(
            text("SELECT count(*) FROM pg_inherits WHERE inhparent = 'vehicle_locations'::regclass")
        ).scalar_one()
        assert remaining == 1
        transaction.rollback()


def test_lookup_functions_reveal_nothing_without_the_key_hash(app_engine: Engine) -> None:
    with app_engine.connect() as connection:
        found = connection.execute(
            text("SELECT * FROM gps_integration_for_key(:hash)"), {"hash": uuid.uuid4().hex}
        ).all()
    assert found == []
