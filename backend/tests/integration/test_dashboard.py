import uuid
from collections.abc import Callable
from datetime import timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.models import Driver, Trip, Vehicle
from app.models.base import utcnow
from app.models.enums import (
    DriverAvailability,
    DriverStatus,
    FuelType,
    TripStatus,
    VehicleStatus,
    VehicleType,
)
from tests.integration.conftest import API, Member
from tests.integration.test_auth import signed_in

pytestmark = pytest.mark.integration


def add_vehicle(db: Session, organisation_id: str, status: VehicleStatus, **extra: Any) -> Vehicle:
    vehicle = Vehicle(
        organisation_id=uuid.UUID(organisation_id),
        registration_number=uuid.uuid4().hex[:10],
        make="Isuzu",
        model="NPR",
        vehicle_type=VehicleType.TRUCK,
        fuel_type=FuelType.DIESEL,
        status=status,
        **extra,
    )
    db.add(vehicle)
    db.commit()
    return vehicle


def add_driver(db: Session, organisation_id: str, **extra: Any) -> Driver:
    driver = Driver(
        organisation_id=uuid.UUID(organisation_id),
        first_name="Test",
        last_name="Driver",
        licence_number=uuid.uuid4().hex[:12],
        **extra,
    )
    db.add(driver)
    db.commit()
    return driver


def dashboard(member: Member) -> dict[str, Any]:
    response = member.client.get(f"{API}/dashboard")
    assert response.status_code == 200, response.text
    result: dict[str, Any] = response.json()
    return result


def test_new_organisation_reports_true_zeros(new_owner: Callable[[], Member]) -> None:
    summary = dashboard(new_owner())
    assert summary["vehicles"]["total"] == 0
    # No vehicles means utilisation is unknown, not 0%.
    assert summary["vehicles"]["utilisation_percent"] is None
    assert summary["drivers"]["total"] == 0
    assert summary["trips"] == {"in_progress": 0, "scheduled": 0}


def test_vehicles_are_counted_by_status_and_archived_ones_are_excluded(
    new_owner: Callable[[], Member], db: Session
) -> None:
    owner = new_owner()
    org = owner.organisation_id
    for status in (VehicleStatus.ACTIVE, VehicleStatus.ACTIVE, VehicleStatus.IDLE):
        add_vehicle(db, org, status)
    add_vehicle(db, org, VehicleStatus.MAINTENANCE)
    add_vehicle(db, org, VehicleStatus.ACTIVE, archived_at=utcnow())
    vehicles = dashboard(owner)["vehicles"]
    assert vehicles == {
        "total": 4,
        "active": 2,
        "idle": 1,
        "maintenance": 1,
        "out_of_service": 0,
        "utilisation_percent": 50,
    }


def test_drivers_and_licence_expiry_are_counted(
    new_owner: Callable[[], Member], db: Session
) -> None:
    owner = new_owner()
    org = owner.organisation_id
    today = utcnow().date()
    add_driver(db, org, licence_expires_on=today - timedelta(days=2))
    add_driver(db, org, licence_expires_on=today + timedelta(days=10))
    add_driver(
        db,
        org,
        availability=DriverAvailability.ON_TRIP,
        licence_expires_on=today + timedelta(days=90),
    )
    add_driver(db, org, status=DriverStatus.INACTIVE, licence_expires_on=today - timedelta(days=9))
    drivers = dashboard(owner)["drivers"]
    assert drivers == {
        "total": 3,
        "available": 2,
        "on_trip": 1,
        "off_duty": 0,
        "unavailable": 0,
        "licences_expiring_soon": 1,
        "licences_expired": 1,
    }


def test_trips_are_counted_by_stage(new_owner: Callable[[], Member], db: Session) -> None:
    owner = new_owner()
    org_id = uuid.UUID(owner.organisation_id)
    vehicle = add_vehicle(db, owner.organisation_id, VehicleStatus.ACTIVE)
    driver = add_driver(db, owner.organisation_id)
    db.add_all(
        [
            Trip(
                organisation_id=org_id,
                status=TripStatus.DRAFT,
                origin_name="A",
                destination_name="B",
            ),
            Trip(
                organisation_id=org_id,
                status=TripStatus.PLANNED,
                origin_name="A",
                destination_name="B",
            ),
            Trip(
                organisation_id=org_id,
                vehicle_id=vehicle.id,
                driver_id=driver.id,
                status=TripStatus.IN_PROGRESS,
                actual_departure_at=utcnow(),
                origin_name="A",
                destination_name="B",
            ),
        ]
    )
    db.commit()
    assert dashboard(owner)["trips"] == {"in_progress": 1, "scheduled": 1}


def test_counts_never_include_another_organisation(
    new_owner: Callable[[], Member], db: Session
) -> None:
    first, second = new_owner(), new_owner()
    add_vehicle(db, second.organisation_id, VehicleStatus.ACTIVE)
    add_driver(db, second.organisation_id)
    assert dashboard(first)["vehicles"]["total"] == 0
    assert dashboard(first)["drivers"]["total"] == 0
    assert dashboard(second)["vehicles"]["total"] == 1


def test_sections_follow_the_members_permissions(
    new_owner: Callable[[], Member], invite: Callable[..., Member]
) -> None:
    owner = new_owner()
    driver = invite(owner, "driver")
    summary = dashboard(driver)
    assert summary["vehicles"] is None
    assert summary["drivers"] is None
    assert summary["trips"] is not None
    assert dashboard(invite(owner, "read_only"))["vehicles"] is not None


def test_dashboard_needs_an_active_organisation(client: TestClient, outbox: list[Any]) -> None:
    signed_in(client, outbox)
    response = client.get(f"{API}/dashboard")
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "no_active_organisation"
