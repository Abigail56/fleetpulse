from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta
from typing import Any

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlmodel import Session

from app.db.partitions import drop_partitions_before, ensure_monthly_partitions
from app.models import (
    AuditLog,
    AuthSession,
    Organisation,
    RefreshToken,
    TrackingDevice,
    Trip,
    User,
    Vehicle,
    VehicleAssignment,
    VehicleLatestLocation,
    VehicleLocation,
)
from app.models.enums import FuelType, TripStatus, VehicleType

pytestmark = pytest.mark.integration

NOW = datetime(2026, 10, 15, 12, 0, tzinfo=UTC)
LAGOS = "SRID=4326;POINT(3.3792 6.5244)"
NEARBY = "SRID=4326;POINT(3.3800 6.5250)"
NAIROBI = "SRID=4326;POINT(36.8219 -1.2921)"


# Tenant isolation


def test_assignment_cannot_link_another_tenants_driver(
    make_org: Any, make_vehicle: Any, make_driver: Any, assert_rejected: Any
) -> None:
    org_a, org_b = make_org(), make_org()
    vehicle, foreign_driver = make_vehicle(org_a), make_driver(org_b)
    assert_rejected(
        VehicleAssignment(
            organisation_id=org_a.id, vehicle_id=vehicle.id, driver_id=foreign_driver.id
        ),
        constraint="fk_vehicle_assignments_organisation_id_driver_id_drivers",
    )


def test_assignment_cannot_link_another_tenants_vehicle(
    make_org: Any, make_vehicle: Any, make_driver: Any, assert_rejected: Any
) -> None:
    org_a, org_b = make_org(), make_org()
    foreign_vehicle, driver = make_vehicle(org_b), make_driver(org_a)
    assert_rejected(
        VehicleAssignment(
            organisation_id=org_a.id, vehicle_id=foreign_vehicle.id, driver_id=driver.id
        ),
        constraint="fk_vehicle_assignments_organisation_id_vehicle_id_vehicles",
    )


def test_trip_cannot_use_another_tenants_vehicle(
    make_org: Any, make_vehicle: Any, assert_rejected: Any
) -> None:
    org_a, org_b = make_org(), make_org()
    assert_rejected(
        Trip(
            organisation_id=org_a.id,
            vehicle_id=make_vehicle(org_b).id,
            origin_name="A",
            destination_name="B",
        ),
        constraint="fk_trips_organisation_id_vehicle_id_vehicles",
    )


def test_trip_cannot_use_another_tenants_driver(
    make_org: Any, make_driver: Any, assert_rejected: Any
) -> None:
    org_a, org_b = make_org(), make_org()
    assert_rejected(
        Trip(
            organisation_id=org_a.id,
            driver_id=make_driver(org_b).id,
            origin_name="A",
            destination_name="B",
        ),
        constraint="fk_trips_organisation_id_driver_id_drivers",
    )


def test_device_cannot_attach_to_another_tenants_vehicle(
    make_org: Any, make_vehicle: Any, assert_rejected: Any
) -> None:
    org_a, org_b = make_org(), make_org()
    assert_rejected(
        TrackingDevice(
            organisation_id=org_a.id,
            vehicle_id=make_vehicle(org_b).id,
            provider="test",
            external_device_id="cross-tenant",
        ),
        constraint="fk_tracking_devices_organisation_id_vehicle_id_vehicles",
    )


def test_telemetry_cannot_be_recorded_against_another_tenants_vehicle(
    make_org: Any, make_vehicle: Any, assert_rejected: Any
) -> None:
    org_a, org_b = make_org(), make_org()
    assert_rejected(
        VehicleLocation(
            organisation_id=org_a.id,
            vehicle_id=make_vehicle(org_b).id,
            recorded_at=NOW,
            location=LAGOS,
        ),
        constraint="fk_vehicle_locations_organisation_id_vehicle_id_vehicles",
    )


def test_telemetry_cannot_use_another_tenants_device(
    make_org: Any, make_vehicle: Any, make_device: Any, assert_rejected: Any
) -> None:
    org_a, org_b = make_org(), make_org()
    assert_rejected(
        VehicleLatestLocation(
            organisation_id=org_a.id,
            vehicle_id=make_vehicle(org_a).id,
            device_id=make_device(org_b).id,
            recorded_at=NOW,
            location=LAGOS,
        ),
        constraint="fk_vehicle_latest_locations_organisation_id_device_id",
    )


# Vehicles and drivers


def new_vehicle(org: Organisation, registration: str) -> Vehicle:
    return Vehicle(
        organisation_id=org.id,
        registration_number=registration,
        make="Isuzu",
        model="NPR",
        vehicle_type=VehicleType.TRUCK,
        fuel_type=FuelType.DIESEL,
    )


def test_duplicate_registration_is_rejected_ignoring_case_and_punctuation(
    make_org: Any, make_vehicle: Any, assert_rejected: Any
) -> None:
    org = make_org()
    make_vehicle(org, "AB-123 CD")
    assert_rejected(
        new_vehicle(org, "ab123cd"),
        constraint="uq_vehicles_organisation_id_registration_active",
    )


def test_same_registration_is_allowed_in_another_organisation(
    make_org: Any, make_vehicle: Any
) -> None:
    make_vehicle(make_org(), "AB-123 CD")
    make_vehicle(make_org(), "AB-123 CD")


def test_archiving_a_vehicle_frees_its_registration(
    session: Session, make_org: Any, make_vehicle: Any
) -> None:
    org = make_org()
    archived = make_vehicle(org, "AB-123 CD")
    archived.archived_at = NOW
    session.flush()
    make_vehicle(org, "AB-123 CD")


def test_invalid_enum_value_is_rejected(session: Session, make_org: Any) -> None:
    org = make_org()
    statement = text(
        "INSERT INTO vehicles (id, organisation_id, registration_number, make, model, "
        "vehicle_type, fuel_type, odometer_km, ownership_type, status) VALUES "
        "(gen_random_uuid(), :org, 'X1', 'M', 'M', 'spaceship', 'diesel', 0, 'owned', 'idle')"
    )
    with pytest.raises(DBAPIError, match="vehicle_type"), session.begin_nested():
        session.execute(statement, {"org": org.id})


def test_vehicle_and_driver_each_have_one_current_assignment(
    make_org: Any, make_vehicle: Any, make_driver: Any, session: Session, assert_rejected: Any
) -> None:
    org = make_org()
    vehicle, other_vehicle = make_vehicle(org), make_vehicle(org)
    driver, other_driver = make_driver(org), make_driver(org)
    current = VehicleAssignment(organisation_id=org.id, vehicle_id=vehicle.id, driver_id=driver.id)
    session.add(current)
    session.flush()

    assert_rejected(
        VehicleAssignment(organisation_id=org.id, vehicle_id=vehicle.id, driver_id=other_driver.id),
        constraint="uq_vehicle_assignments_vehicle_id_current",
    )
    assert_rejected(
        VehicleAssignment(organisation_id=org.id, vehicle_id=other_vehicle.id, driver_id=driver.id),
        constraint="uq_vehicle_assignments_driver_id_current",
    )

    current.ended_at = current.started_at + timedelta(hours=1)
    session.flush()
    session.add(
        VehicleAssignment(organisation_id=org.id, vehicle_id=vehicle.id, driver_id=other_driver.id)
    )
    session.flush()


# Trips


def test_trip_underway_requires_vehicle_and_driver(make_org: Any, assert_rejected: Any) -> None:
    assert_rejected(
        Trip(
            organisation_id=make_org().id,
            status=TripStatus.DISPATCHED,
            origin_name="A",
            destination_name="B",
        ),
        constraint="ck_trips_assigned_when_underway",
    )


def test_completed_trip_requires_actual_arrival(
    make_org: Any, make_vehicle: Any, make_driver: Any, assert_rejected: Any
) -> None:
    org = make_org()
    assert_rejected(
        Trip(
            organisation_id=org.id,
            vehicle_id=make_vehicle(org).id,
            driver_id=make_driver(org).id,
            status=TripStatus.COMPLETED,
            actual_departure_at=NOW,
            origin_name="A",
            destination_name="B",
        ),
        constraint="ck_trips_arrived_when_completed",
    )


def test_arrival_cannot_precede_departure(make_org: Any, assert_rejected: Any) -> None:
    assert_rejected(
        Trip(
            organisation_id=make_org().id,
            actual_departure_at=NOW,
            actual_arrival_at=NOW - timedelta(minutes=1),
            origin_name="A",
            destination_name="B",
        ),
        constraint="ck_trips_arrival_after_departure",
    )


def test_vehicle_cannot_run_two_trips_at_once(
    session: Session, make_org: Any, make_vehicle: Any, make_driver: Any, assert_rejected: Any
) -> None:
    org = make_org()
    vehicle = make_vehicle(org)

    def in_progress_trip() -> Trip:
        return Trip(
            organisation_id=org.id,
            vehicle_id=vehicle.id,
            driver_id=make_driver(org).id,
            status=TripStatus.IN_PROGRESS,
            actual_departure_at=NOW,
            origin_name="A",
            destination_name="B",
        )

    session.add(in_progress_trip())
    session.flush()
    assert_rejected(in_progress_trip(), constraint="uq_trips_vehicle_id_in_progress")


# Identity


def test_user_email_must_be_lowercase_and_unique(make_user: Any, assert_rejected: Any) -> None:
    existing = make_user()
    assert_rejected(
        User(email="Mixed@Example.com", password_hash="x", full_name="X"),
        constraint="ck_users_email_lowercase",
    )
    assert_rejected(
        User(email=existing.email, password_hash="x", full_name="X"),
        constraint="uq_users_email|ix_users_email",
    )


def test_session_can_hold_only_one_unconsumed_refresh_token(
    session: Session, make_user: Callable[[], User], assert_rejected: Any
) -> None:
    expires = NOW + timedelta(days=14)
    auth_session = AuthSession(user_id=make_user().id, expires_at=expires)
    session.add(auth_session)
    session.flush()
    first = RefreshToken(session_id=auth_session.id, token_hash="a" * 64, expires_at=expires)
    session.add(first)
    session.flush()

    assert_rejected(
        RefreshToken(session_id=auth_session.id, token_hash="b" * 64, expires_at=expires),
        constraint="uq_refresh_tokens_session_id_unconsumed",
    )

    first.consumed_at = NOW
    session.flush()
    session.add(RefreshToken(session_id=auth_session.id, token_hash="b" * 64, expires_at=expires))
    session.flush()


# Audit log


@pytest.mark.parametrize(
    "statement",
    ["UPDATE audit_logs SET action = 'tampered'", "DELETE FROM audit_logs", "TRUNCATE audit_logs"],
)
def test_audit_log_is_append_only(session: Session, statement: str) -> None:
    session.add(AuditLog(action="auth.login"))
    session.flush()
    with pytest.raises(DBAPIError, match="append-only"), session.begin_nested():
        session.execute(text(statement))


# Telemetry


def partition_holding(session: Session, org: Organisation, recorded_at: datetime) -> Any:
    return session.execute(
        text(
            "SELECT tableoid::regclass::text FROM vehicle_locations "
            "WHERE organisation_id = :org AND recorded_at = :at"
        ),
        {"org": org.id, "at": recorded_at},
    ).scalar_one()


def test_position_is_stored_in_its_month_partition(
    session: Session, make_org: Any, make_vehicle: Any
) -> None:
    org = make_org()
    ensure_monthly_partitions(session.connection(), date(2031, 3, 1), 1)
    recorded_at = datetime(2031, 3, 15, tzinfo=UTC)
    session.add(
        VehicleLocation(
            organisation_id=org.id,
            vehicle_id=make_vehicle(org).id,
            recorded_at=recorded_at,
            location=LAGOS,
        )
    )
    session.flush()
    assert partition_holding(session, org, recorded_at) == "vehicle_locations_y2031m03"


def test_position_outside_known_months_lands_in_default_partition(
    session: Session, make_org: Any, make_vehicle: Any
) -> None:
    org = make_org()
    recorded_at = datetime(2001, 1, 1, tzinfo=UTC)
    session.add(
        VehicleLocation(
            organisation_id=org.id,
            vehicle_id=make_vehicle(org).id,
            recorded_at=recorded_at,
            location=LAGOS,
        )
    )
    session.flush()
    assert partition_holding(session, org, recorded_at) == "vehicle_locations_default"


def test_duplicate_position_from_a_provider_is_rejected(
    make_org: Any, make_vehicle: Any, session: Session, assert_rejected: Any
) -> None:
    org = make_org()
    vehicle = make_vehicle(org)
    row: dict[str, Any] = {
        "organisation_id": org.id,
        "vehicle_id": vehicle.id,
        "recorded_at": NOW,
        "location": LAGOS,
    }
    session.add(VehicleLocation(**row))
    session.flush()
    # A separate statement: the ORM would refuse a second object with the same identity.
    with pytest.raises(DBAPIError, match="duplicate key"), session.begin_nested():
        session.execute(
            text(
                "INSERT INTO vehicle_locations "
                "(organisation_id, vehicle_id, recorded_at, location, signal_status, is_simulated)"
                " VALUES (:org, :vehicle, :at, :location, 'unknown', false)"
            ),
            {"org": org.id, "vehicle": vehicle.id, "at": NOW, "location": LAGOS},
        )


def test_retention_drops_only_old_monthly_partitions(session: Session) -> None:
    connection = session.connection()
    ensure_monthly_partitions(connection, date(2020, 11, 1), 3)  # crosses a year boundary
    dropped = drop_partitions_before(connection, date(2021, 1, 1))
    assert dropped == ["vehicle_locations_y2020m11", "vehicle_locations_y2020m12"]
    remaining = connection.execute(
        text(
            "SELECT count(*) FROM pg_inherits WHERE inhparent = 'vehicle_locations'::regclass "
            "AND inhrelid::regclass::text IN "
            "('vehicle_locations_y2021m01', 'vehicle_locations_default')"
        )
    ).scalar_one()
    assert remaining == 2


def test_ensure_monthly_partitions_can_be_re_run(session: Session) -> None:
    connection = session.connection()
    ensure_monthly_partitions(connection, date(2032, 12, 1), 2)
    ensure_monthly_partitions(connection, date(2032, 12, 1), 2)


def test_spatial_query_finds_nearby_vehicles_only(
    session: Session, make_org: Any, make_vehicle: Any
) -> None:
    org = make_org()
    near, far = make_vehicle(org), make_vehicle(org)
    session.add_all(
        [
            VehicleLatestLocation(
                organisation_id=org.id, vehicle_id=near.id, recorded_at=NOW, location=NEARBY
            ),
            VehicleLatestLocation(
                organisation_id=org.id, vehicle_id=far.id, recorded_at=NOW, location=NAIROBI
            ),
        ]
    )
    session.flush()
    found = (
        session.execute(
            text(
                "SELECT vehicle_id FROM vehicle_latest_locations WHERE organisation_id = :org "
                "AND ST_DWithin(location, ST_GeogFromText(:point), 1000)"
            ),
            {"org": org.id, "point": LAGOS},
        )
        .scalars()
        .all()
    )
    assert found == [near.id]


def test_latitude_and_longitude_can_be_read_back(
    session: Session, make_org: Any, make_vehicle: Any
) -> None:
    org = make_org()
    session.add(
        VehicleLatestLocation(
            organisation_id=org.id,
            vehicle_id=make_vehicle(org).id,
            recorded_at=NOW,
            location=LAGOS,
        )
    )
    session.flush()
    latitude, longitude = session.execute(
        text(
            "SELECT ST_Y(location::geometry), ST_X(location::geometry) "
            "FROM vehicle_latest_locations WHERE organisation_id = :org"
        ),
        {"org": org.id},
    ).one()
    assert latitude == pytest.approx(6.5244)
    assert longitude == pytest.approx(3.3792)
