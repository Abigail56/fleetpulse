import uuid
from typing import Any

from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, col, func, or_, select

from app.core.errors import ApiError
from app.models import Driver, Trip, Vehicle, VehicleAssignment, WorkOrder
from app.models.base import utcnow
from app.models.enums import TripStatus, VehicleStatus, VehicleType, WorkOrderStatus
from app.services.audit import record_audit

# Their values aren't sensitive and their history matters; other changes record field names only.
TRACKED_VALUES = ("odometer_km", "status", "registration_number")


def _not_found() -> ApiError:
    return ApiError(404, "not_found", "Vehicle not found.")


def _conflict_from(exc: IntegrityError) -> ApiError:
    message = str(exc.orig)
    if "registration_active" in message:
        return ApiError(
            409, "duplicate_registration", "Another vehicle already has this registration."
        )
    if "vin_active" in message:
        return ApiError(409, "duplicate_vin", "Another vehicle already has this VIN.")
    raise exc


def _escape_like(term: str) -> str:
    """Stops % and _ in a search box acting as wildcards."""
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def list_vehicles(
    db: Session,
    organisation_id: uuid.UUID,
    *,
    search: str | None,
    status: VehicleStatus | None,
    vehicle_type: VehicleType | None,
    archived: bool,
    sort: str,
    page: int,
    page_size: int,
) -> tuple[list[Vehicle], int]:
    conditions: list[Any] = [
        Vehicle.organisation_id == organisation_id,
        col(Vehicle.archived_at).is_not(None) if archived else col(Vehicle.archived_at).is_(None),
    ]
    if search:
        pattern = f"%{_escape_like(search.strip())}%"
        conditions.append(
            or_(
                col(Vehicle.registration_number).ilike(pattern, escape="\\"),
                col(Vehicle.make).ilike(pattern, escape="\\"),
                col(Vehicle.model).ilike(pattern, escape="\\"),
                col(Vehicle.vin).ilike(pattern, escape="\\"),
            )
        )
    if status:
        conditions.append(Vehicle.status == status)
    if vehicle_type:
        conditions.append(Vehicle.vehicle_type == vehicle_type)

    total = db.exec(select(func.count()).select_from(Vehicle).where(*conditions)).one()
    column = col(getattr(Vehicle, sort.removeprefix("-")))
    order = column.desc() if sort.startswith("-") else column.asc()
    # The ID makes paging stable when many vehicles share a sort value.
    rows = db.exec(
        select(Vehicle)
        .where(*conditions)
        .order_by(order.nulls_last(), col(Vehicle.id))
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return list(rows), total


def get_vehicle(db: Session, organisation_id: uuid.UUID, vehicle_id: uuid.UUID) -> Vehicle:
    vehicle = db.exec(
        select(Vehicle).where(Vehicle.id == vehicle_id, Vehicle.organisation_id == organisation_id)
    ).first()
    if vehicle is None:
        raise _not_found()
    return vehicle


def current_driver(db: Session, organisation_id: uuid.UUID, vehicle_id: uuid.UUID) -> Driver | None:
    return db.exec(
        select(Driver)
        .join(VehicleAssignment, col(VehicleAssignment.driver_id) == col(Driver.id))
        .where(
            VehicleAssignment.organisation_id == organisation_id,
            VehicleAssignment.vehicle_id == vehicle_id,
            col(VehicleAssignment.ended_at).is_(None),
        )
    ).first()


def create_vehicle(
    db: Session, organisation_id: uuid.UUID, actor_id: uuid.UUID, values: dict[str, Any]
) -> Vehicle:
    vehicle = Vehicle(organisation_id=organisation_id, **values, odometer_recorded_at=utcnow())
    db.add(vehicle)
    record_audit(
        db,
        "vehicle.created",
        actor_user_id=actor_id,
        organisation_id=organisation_id,
        entity_type="vehicle",
        entity_id=vehicle.id,
        details={"registration_number": vehicle.registration_number},
    )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise _conflict_from(exc) from exc
    db.refresh(vehicle)
    return vehicle


def update_vehicle(
    db: Session,
    organisation_id: uuid.UUID,
    actor_id: uuid.UUID,
    vehicle_id: uuid.UUID,
    changes: dict[str, Any],
) -> Vehicle:
    expected_updated_at = changes.pop("expected_updated_at", None)
    vehicle = db.exec(
        select(Vehicle)
        .where(Vehicle.id == vehicle_id, Vehicle.organisation_id == organisation_id)
        .with_for_update()
    ).first()
    if vehicle is None:
        raise _not_found()
    if vehicle.archived_at is not None:
        raise ApiError(409, "vehicle_archived", "Restore this vehicle before changing it.")
    if expected_updated_at is not None and vehicle.updated_at != expected_updated_at:
        raise ApiError(
            409,
            "stale_update",
            "Someone else has changed this vehicle. Reload it and make your change again.",
        )

    changed = {field: value for field, value in changes.items() if getattr(vehicle, field) != value}
    tracked = {
        field: {"from": str(getattr(vehicle, field)), "to": str(changed[field])}
        for field in TRACKED_VALUES
        if field in changed
    }
    if not changed:
        return vehicle
    for field, value in changed.items():
        setattr(vehicle, field, value)
    if "odometer_km" in changed:
        vehicle.odometer_recorded_at = utcnow()
    record_audit(
        db,
        "vehicle.updated",
        actor_user_id=actor_id,
        organisation_id=organisation_id,
        entity_type="vehicle",
        entity_id=vehicle.id,
        details={"fields": sorted(changed), "changes": tracked},
    )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise _conflict_from(exc) from exc
    db.refresh(vehicle)
    return vehicle


def archive_vehicle(
    db: Session, organisation_id: uuid.UUID, actor_id: uuid.UUID, vehicle_id: uuid.UUID
) -> Vehicle:
    vehicle = db.exec(
        select(Vehicle)
        .where(Vehicle.id == vehicle_id, Vehicle.organisation_id == organisation_id)
        .with_for_update()
    ).first()
    if vehicle is None:
        raise _not_found()
    if vehicle.archived_at is not None:
        return vehicle

    work_underway = db.exec(
        select(WorkOrder.id).where(
            WorkOrder.organisation_id == organisation_id,
            WorkOrder.vehicle_id == vehicle_id,
            WorkOrder.status == WorkOrderStatus.IN_PROGRESS,
        )
    ).first()
    if work_underway is not None:
        raise ApiError(409, "vehicle_in_workshop", "This vehicle has a work order in progress.")

    trip_underway = db.exec(
        select(Trip.id).where(
            Trip.organisation_id == organisation_id,
            Trip.vehicle_id == vehicle_id,
            Trip.status == TripStatus.IN_PROGRESS,
        )
    ).first()
    if trip_underway is not None:
        raise ApiError(409, "vehicle_on_trip", "This vehicle is on a trip that's in progress.")

    now = utcnow()
    vehicle.archived_at = now
    assignments = db.exec(
        select(VehicleAssignment).where(
            VehicleAssignment.organisation_id == organisation_id,
            VehicleAssignment.vehicle_id == vehicle_id,
            col(VehicleAssignment.ended_at).is_(None),
        )
    ).all()
    for assignment in assignments:
        assignment.ended_at = now
    record_audit(
        db,
        "vehicle.archived",
        actor_user_id=actor_id,
        organisation_id=organisation_id,
        entity_type="vehicle",
        entity_id=vehicle.id,
        details={"assignments_ended": len(assignments)},
    )
    db.commit()
    db.refresh(vehicle)
    return vehicle


def restore_vehicle(
    db: Session, organisation_id: uuid.UUID, actor_id: uuid.UUID, vehicle_id: uuid.UUID
) -> Vehicle:
    vehicle = get_vehicle(db, organisation_id, vehicle_id)
    if vehicle.archived_at is None:
        return vehicle
    vehicle.archived_at = None
    record_audit(
        db,
        "vehicle.restored",
        actor_user_id=actor_id,
        organisation_id=organisation_id,
        entity_type="vehicle",
        entity_id=vehicle.id,
    )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise _conflict_from(exc) from exc
    db.refresh(vehicle)
    return vehicle
