import itertools
import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, col, func, or_, select

from app.core.errors import ApiError
from app.models import AuditLog, Defect, Driver, Trip, User, Vehicle
from app.models.base import utcnow
from app.models.enums import (
    DefectSeverity,
    DefectStatus,
    DriverAvailability,
    DriverStatus,
    TripStatus,
    VehicleStatus,
)
from app.services.audit import record_audit
from app.services.geo import distance_km
from app.services.telemetry import position_history

# The only ways a trip's status can change. Completed and cancelled trips are final.
TRANSITIONS: dict[TripStatus, frozenset[TripStatus]] = {
    TripStatus.DRAFT: frozenset({TripStatus.PLANNED, TripStatus.CANCELLED}),
    TripStatus.PLANNED: frozenset({TripStatus.DISPATCHED, TripStatus.CANCELLED}),
    TripStatus.DISPATCHED: frozenset({TripStatus.IN_PROGRESS, TripStatus.CANCELLED}),
    TripStatus.IN_PROGRESS: frozenset({TripStatus.COMPLETED, TripStatus.CANCELLED}),
    TripStatus.COMPLETED: frozenset(),
    TripStatus.CANCELLED: frozenset(),
}
# Once a driver has been told about a trip, only these can change without cancelling it.
UNDERWAY_EDITABLE = frozenset({"estimated_arrival_at", "dispatch_notes"})
CLOCK_SKEW = timedelta(minutes=5)
DISTANCE_POINT_LIMIT = 20000
ROUTE_POINT_LIMIT = 5000
OPTION_LIMIT = 5000
ROUTE_END_MARGIN = timedelta(seconds=1)


def _not_found() -> ApiError:
    return ApiError(404, "not_found", "Trip not found.")


def _escape_like(term: str) -> str:
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _commit(db: Session) -> None:
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        message = str(exc.orig)
        if "uq_trips_vehicle_id_in_progress" in message:
            raise ApiError(
                409, "vehicle_on_trip", "That vehicle is already on a trip in progress."
            ) from exc
        if "uq_trips_driver_id_in_progress" in message:
            raise ApiError(
                409, "driver_on_trip", "That driver is already on a trip in progress."
            ) from exc
        raise


def driver_for_user(
    db: Session, organisation_id: uuid.UUID, user_id: uuid.UUID
) -> uuid.UUID | None:
    return db.exec(
        select(Driver.id).where(
            Driver.organisation_id == organisation_id, Driver.user_id == user_id
        )
    ).first()


def _rows(organisation_id: uuid.UUID) -> Any:
    return (
        select(Trip, Vehicle.registration_number, Driver.first_name, Driver.last_name)
        .join(
            Vehicle,
            (col(Vehicle.id) == Trip.vehicle_id)
            & (col(Vehicle.organisation_id) == organisation_id),
            isouter=True,
        )
        .join(
            Driver,
            (col(Driver.id) == Trip.driver_id) & (col(Driver.organisation_id) == organisation_id),
            isouter=True,
        )
        .where(Trip.organisation_id == organisation_id)
    )


def list_trips(
    db: Session,
    organisation_id: uuid.UUID,
    *,
    only_driver_id: uuid.UUID | None,
    only_own: bool,
    search: str | None,
    statuses: list[TripStatus],
    vehicle_id: uuid.UUID | None,
    driver_id: uuid.UUID | None,
    page: int,
    page_size: int,
) -> tuple[list[Any], int]:
    if only_own and only_driver_id is None:
        return [], 0
    query = _rows(organisation_id)
    if only_own:
        query = query.where(Trip.driver_id == only_driver_id)
    if statuses:
        query = query.where(col(Trip.status).in_(statuses))
    if vehicle_id:
        query = query.where(Trip.vehicle_id == vehicle_id)
    if driver_id:
        query = query.where(Trip.driver_id == driver_id)
    if search:
        pattern = f"%{_escape_like(search.strip())}%"
        fields = (
            Trip.origin_name,
            Trip.destination_name,
            Vehicle.registration_number,
            Driver.first_name,
            Driver.last_name,
        )
        query = query.where(or_(*[col(field).ilike(pattern, escape="\\") for field in fields]))
    total = db.exec(select(func.count()).select_from(query.subquery())).one()
    rows = db.exec(
        query.order_by(
            col(Trip.planned_departure_at).desc().nulls_last(), col(Trip.created_at).desc()
        )
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return list(rows), total


def get_row(
    db: Session,
    organisation_id: uuid.UUID,
    trip_id: uuid.UUID,
    *,
    only_driver_id: uuid.UUID | None,
    only_own: bool,
) -> Any:
    row = db.exec(_rows(organisation_id).where(Trip.id == trip_id)).first()
    # Someone else's trip looks the same as one that doesn't exist.
    if row is None or (only_own and (only_driver_id is None or row[0].driver_id != only_driver_id)):
        raise _not_found()
    return row


def _locked(db: Session, organisation_id: uuid.UUID, trip_id: uuid.UUID) -> Trip:
    trip = db.exec(
        select(Trip)
        .where(Trip.id == trip_id, Trip.organisation_id == organisation_id)
        .with_for_update()
    ).first()
    if trip is None:
        raise _not_found()
    return trip


def _active_vehicle(db: Session, organisation_id: uuid.UUID, vehicle_id: uuid.UUID) -> Vehicle:
    vehicle = db.exec(
        select(Vehicle).where(
            Vehicle.id == vehicle_id,
            Vehicle.organisation_id == organisation_id,
            col(Vehicle.archived_at).is_(None),
        )
    ).first()
    if vehicle is None:
        raise ApiError(404, "vehicle_not_found", "That vehicle wasn't found.")
    return vehicle


def _active_driver(db: Session, organisation_id: uuid.UUID, driver_id: uuid.UUID) -> Driver:
    driver = db.exec(
        select(Driver).where(
            Driver.id == driver_id,
            Driver.organisation_id == organisation_id,
            col(Driver.archived_at).is_(None),
        )
    ).first()
    if driver is None:
        raise ApiError(404, "driver_not_found", "That driver wasn't found.")
    return driver


def _check_times(planned: datetime | None, estimated: datetime | None) -> None:
    if planned and estimated and estimated < planned:
        raise ApiError(
            422, "arrival_before_departure", "The estimated arrival must be after the departure."
        )


def _check_ready(db: Session, trip: Trip, today: date) -> tuple[Vehicle, Driver]:
    """Run before dispatch and again at departure, since either can change in between."""
    if trip.vehicle_id is None or trip.driver_id is None:
        raise ApiError(409, "not_assigned", "Assign a vehicle and a driver first.")
    vehicle = _active_vehicle(db, trip.organisation_id, trip.vehicle_id)
    if vehicle.status in (VehicleStatus.MAINTENANCE, VehicleStatus.OUT_OF_SERVICE):
        raise ApiError(409, "vehicle_unavailable", "That vehicle isn't available for trips.")
    defect = db.exec(
        select(Defect.id).where(
            Defect.organisation_id == trip.organisation_id,
            Defect.vehicle_id == trip.vehicle_id,
            Defect.status == DefectStatus.OPEN,
            Defect.severity == DefectSeverity.CRITICAL,
        )
    ).first()
    if defect is not None:
        raise ApiError(409, "vehicle_defect", "That vehicle has a critical defect to fix first.")
    driver = _active_driver(db, trip.organisation_id, trip.driver_id)
    if driver.status != DriverStatus.ACTIVE:
        raise ApiError(409, "driver_unavailable", "That driver isn't active.")
    if driver.licence_expires_on and driver.licence_expires_on < today:
        raise ApiError(409, "licence_expired", "That driver's licence has expired.")
    return vehicle, driver


def _record(db: Session, trip: Trip, actor_id: uuid.UUID, action: str, **details: Any) -> None:
    record_audit(
        db,
        action,
        actor_user_id=actor_id,
        organisation_id=trip.organisation_id,
        entity_type="trip",
        entity_id=trip.id,
        details=details or None,
    )


def create_trip(
    db: Session, organisation_id: uuid.UUID, actor_id: uuid.UUID, values: dict[str, Any]
) -> Trip:
    _check_times(values.get("planned_departure_at"), values.get("estimated_arrival_at"))
    if values.get("vehicle_id"):
        _active_vehicle(db, organisation_id, values["vehicle_id"])
    if values.get("driver_id"):
        _active_driver(db, organisation_id, values["driver_id"])
    trip = Trip(organisation_id=organisation_id, created_by_user_id=actor_id, **values)
    db.add(trip)
    db.flush()
    _record(db, trip, actor_id, "trip.created")
    _commit(db)
    return trip


def update_trip(
    db: Session,
    organisation_id: uuid.UUID,
    trip_id: uuid.UUID,
    actor_id: uuid.UUID,
    changes: dict[str, Any],
) -> Trip:
    trip = _locked(db, organisation_id, trip_id)
    if trip.status in (TripStatus.COMPLETED, TripStatus.CANCELLED):
        raise ApiError(409, "trip_closed", "A completed or cancelled trip can't be changed.")
    if trip.status in (TripStatus.DISPATCHED, TripStatus.IN_PROGRESS) and (
        set(changes) - UNDERWAY_EDITABLE
    ):
        raise ApiError(
            409,
            "trip_underway",
            "Only the estimated arrival and notes can change after dispatch. "
            "To change anything else, cancel this trip and create a new one.",
        )
    for field in ("origin_name", "destination_name"):
        if field in changes and changes[field] is None:
            raise ApiError(422, "missing_place", "Origin and destination are required.")
    _check_times(
        changes.get("planned_departure_at", trip.planned_departure_at),
        changes.get("estimated_arrival_at", trip.estimated_arrival_at),
    )
    if changes.get("vehicle_id"):
        _active_vehicle(db, organisation_id, changes["vehicle_id"])
    if changes.get("driver_id"):
        _active_driver(db, organisation_id, changes["driver_id"])
    for field, value in changes.items():
        setattr(trip, field, value)
    trip.updated_at = utcnow()
    db.add(trip)
    # Names only: notes and places can contain personal details.
    _record(db, trip, actor_id, "trip.updated", fields=sorted(changes))
    _commit(db)
    return trip


def _ensure_allowed(trip: Trip, target: TripStatus) -> None:
    if target not in TRANSITIONS[trip.status]:
        raise ApiError(
            409,
            "invalid_transition",
            f"A trip that is {trip.status.value.replace('_', ' ')} can't move to "
            f"{target.value.replace('_', ' ')}.",
        )


def _set_status(trip: Trip, target: TripStatus) -> None:
    trip.status = target
    trip.updated_at = utcnow()


def plan_trip(
    db: Session, organisation_id: uuid.UUID, trip_id: uuid.UUID, actor_id: uuid.UUID
) -> Trip:
    trip = _locked(db, organisation_id, trip_id)
    _ensure_allowed(trip, TripStatus.PLANNED)
    if trip.planned_departure_at is None:
        raise ApiError(409, "missing_departure", "Set a planned departure time first.")
    _set_status(trip, TripStatus.PLANNED)
    db.add(trip)
    _record(db, trip, actor_id, "trip.planned")
    _commit(db)
    return trip


def dispatch_trip(
    db: Session, organisation_id: uuid.UUID, trip_id: uuid.UUID, actor_id: uuid.UUID, today: date
) -> Trip:
    trip = _locked(db, organisation_id, trip_id)
    _ensure_allowed(trip, TripStatus.DISPATCHED)
    _check_ready(db, trip, today)
    _set_status(trip, TripStatus.DISPATCHED)
    db.add(trip)
    _record(db, trip, actor_id, "trip.dispatched")
    _commit(db)
    return trip


def start_trip(
    db: Session,
    organisation_id: uuid.UUID,
    trip_id: uuid.UUID,
    actor_id: uuid.UUID,
    today: date,
    departed_at: datetime | None,
) -> Trip:
    trip = _locked(db, organisation_id, trip_id)
    _ensure_allowed(trip, TripStatus.IN_PROGRESS)
    _, driver = _check_ready(db, trip, today)
    now = utcnow()
    departed = departed_at or now
    if departed > now + CLOCK_SKEW:
        raise ApiError(422, "time_in_future", "The departure time can't be in the future.")
    trip.actual_departure_at = departed
    _set_status(trip, TripStatus.IN_PROGRESS)
    driver.availability = DriverAvailability.ON_TRIP
    db.add_all([trip, driver])
    _record(db, trip, actor_id, "trip.started")
    _commit(db)
    return trip


def _release_driver(db: Session, trip: Trip) -> None:
    driver = db.get(Driver, trip.driver_id) if trip.driver_id else None
    # Someone marked off duty in the meantime stays off duty.
    if driver and driver.availability == DriverAvailability.ON_TRIP:
        driver.availability = DriverAvailability.AVAILABLE
        db.add(driver)


def gps_distance(
    db: Session, organisation_id: uuid.UUID, vehicle_id: uuid.UUID, start: datetime, end: datetime
) -> tuple[Decimal, str] | None:
    """The sum of straight lines between positions. Without two positions there's no answer."""
    rows = position_history(
        db, organisation_id, vehicle_id, start, end + ROUTE_END_MARGIN, DISTANCE_POINT_LIMIT
    )
    if len(rows) < 2:
        return None
    total = sum(
        distance_km(a["latitude"], a["longitude"], b["latitude"], b["longitude"])
        for a, b in itertools.pairwise(rows)
    )
    source = "simulated" if any(row["is_simulated"] for row in rows) else "gps"
    return Decimal(str(round(total, 2))), source


def complete_trip(
    db: Session,
    organisation_id: uuid.UUID,
    trip_id: uuid.UUID,
    actor_id: uuid.UUID,
    arrived_at: datetime | None,
    distance: Decimal | None,
) -> Trip:
    trip = _locked(db, organisation_id, trip_id)
    _ensure_allowed(trip, TripStatus.COMPLETED)
    now = utcnow()
    arrived = arrived_at or now
    if arrived > now + CLOCK_SKEW:
        raise ApiError(422, "time_in_future", "The arrival time can't be in the future.")
    assert trip.actual_departure_at is not None  # noqa: S101  (a database constraint guarantees it)
    assert trip.vehicle_id is not None  # noqa: S101
    if arrived < trip.actual_departure_at:
        raise ApiError(422, "arrival_before_departure", "The arrival must be after the departure.")
    trip.actual_arrival_at = arrived
    _set_status(trip, TripStatus.COMPLETED)
    if distance is not None:
        trip.distance_km = distance
        trip.distance_source = "manual"
    else:
        measured = gps_distance(
            db, organisation_id, trip.vehicle_id, trip.actual_departure_at, arrived
        )
        if measured:
            trip.distance_km, trip.distance_source = measured
    _release_driver(db, trip)
    db.add(trip)
    _record(db, trip, actor_id, "trip.completed")
    _commit(db)
    return trip


def cancel_trip(
    db: Session, organisation_id: uuid.UUID, trip_id: uuid.UUID, actor_id: uuid.UUID
) -> Trip:
    trip = _locked(db, organisation_id, trip_id)
    was_underway = trip.status == TripStatus.IN_PROGRESS
    _ensure_allowed(trip, TripStatus.CANCELLED)
    _set_status(trip, TripStatus.CANCELLED)
    if was_underway:
        _release_driver(db, trip)
    db.add(trip)
    _record(db, trip, actor_id, "trip.cancelled")
    _commit(db)
    return trip


def events(db: Session, organisation_id: uuid.UUID, trip_id: uuid.UUID) -> list[Any]:
    return list(
        db.exec(
            select(AuditLog.action, AuditLog.occurred_at, User.full_name)
            .join(User, col(User.id) == AuditLog.actor_user_id, isouter=True)
            .where(
                AuditLog.organisation_id == organisation_id,
                AuditLog.entity_type == "trip",
                AuditLog.entity_id == trip_id,
            )
            .order_by(col(AuditLog.occurred_at))
        ).all()
    )


def route(db: Session, organisation_id: uuid.UUID, trip: Trip) -> list[Any]:
    if trip.actual_departure_at is None or trip.vehicle_id is None:
        return []
    return position_history(
        db,
        organisation_id,
        trip.vehicle_id,
        trip.actual_departure_at,
        (trip.actual_arrival_at or utcnow()) + ROUTE_END_MARGIN,
        ROUTE_POINT_LIMIT,
    )


def options(db: Session, organisation_id: uuid.UUID) -> tuple[list[Vehicle], list[Driver]]:
    vehicles = db.exec(
        select(Vehicle)
        .where(
            Vehicle.organisation_id == organisation_id,
            col(Vehicle.archived_at).is_(None),
            col(Vehicle.status).not_in([VehicleStatus.MAINTENANCE, VehicleStatus.OUT_OF_SERVICE]),
        )
        .order_by(col(Vehicle.registration_number))
        .limit(OPTION_LIMIT)
    ).all()
    drivers = db.exec(
        select(Driver)
        .where(
            Driver.organisation_id == organisation_id,
            col(Driver.archived_at).is_(None),
            Driver.status == DriverStatus.ACTIVE,
        )
        .order_by(col(Driver.last_name), col(Driver.first_name))
        .limit(OPTION_LIMIT)
    ).all()
    return list(vehicles), list(drivers)
