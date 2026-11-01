import uuid
from datetime import date, timedelta
from typing import Any

from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, col, func, or_, select

from app.core.errors import ApiError
from app.models import Driver, OrganisationMembership, Trip, Vehicle, VehicleAssignment
from app.models.base import utcnow
from app.models.enums import DriverStatus, TripStatus
from app.services.audit import record_audit
from app.services.dashboard import LICENCE_WARNING_DAYS

# Personal data is deliberately left out of audit details; only field names are recorded.
TRACKED_VALUES = ("status", "availability")
MASK_VISIBLE_CHARACTERS = 4


def _not_found() -> ApiError:
    return ApiError(404, "not_found", "Driver not found.")


def _escape_like(term: str) -> str:
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def mask_licence(licence_number: str) -> str:
    return "•" * 4 + licence_number[-MASK_VISIBLE_CHARACTERS:]


def _commit_or_conflict(db: Session) -> None:
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        message = str(exc.orig)
        if "licence_active" in message:
            raise ApiError(
                409, "duplicate_licence", "Another driver already has this licence number."
            ) from exc
        if "uq_drivers_organisation_id_user_id" in message:
            raise ApiError(
                409, "account_already_linked", "That member is already linked to another driver."
            ) from exc
        if "vehicle_assignments_vehicle_id_current" in message:
            raise ApiError(
                409, "vehicle_already_assigned", "That vehicle already has a driver."
            ) from exc
        if "vehicle_assignments_driver_id_current" in message:
            raise ApiError(
                409, "driver_already_assigned", "This driver is already assigned to a vehicle."
            ) from exc
        raise


def list_drivers(
    db: Session,
    organisation_id: uuid.UUID,
    *,
    today: date,
    can_search_sensitive: bool,
    search: str | None,
    status: DriverStatus | None,
    availability: str | None,
    licence: str | None,
    archived: bool,
    sort: str,
    page: int,
    page_size: int,
) -> tuple[list[Driver], int]:
    conditions: list[Any] = [
        Driver.organisation_id == organisation_id,
        col(Driver.archived_at).is_not(None) if archived else col(Driver.archived_at).is_(None),
    ]
    if search:
        pattern = f"%{_escape_like(search.strip())}%"
        fields = [Driver.first_name, Driver.last_name]
        # Searching a hidden field would let someone work out its value letter by letter.
        if can_search_sensitive:
            fields += [Driver.licence_number, Driver.phone, Driver.email]  # type: ignore[list-item]
        conditions.append(or_(*[col(field).ilike(pattern, escape="\\") for field in fields]))
    if status:
        conditions.append(Driver.status == status)
    if availability:
        conditions.append(Driver.availability == availability)
    if licence == "expired":
        conditions.append(col(Driver.licence_expires_on) < today)
    if licence == "expiring":
        conditions.append(col(Driver.licence_expires_on) >= today)
        conditions.append(
            col(Driver.licence_expires_on) <= today + timedelta(days=LICENCE_WARNING_DAYS)
        )

    total = db.exec(select(func.count()).select_from(Driver).where(*conditions)).one()
    column = col(getattr(Driver, sort.removeprefix("-")))
    order = column.desc() if sort.startswith("-") else column.asc()
    rows = db.exec(
        select(Driver)
        .where(*conditions)
        .order_by(order.nulls_last(), col(Driver.first_name), col(Driver.id))
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return list(rows), total


def current_vehicles(
    db: Session, organisation_id: uuid.UUID, driver_ids: list[uuid.UUID]
) -> dict[uuid.UUID, tuple[uuid.UUID, str]]:
    if not driver_ids:
        return {}
    rows = db.exec(
        select(VehicleAssignment.driver_id, Vehicle.id, Vehicle.registration_number)
        .join(Vehicle, col(Vehicle.id) == col(VehicleAssignment.vehicle_id))
        .where(
            VehicleAssignment.organisation_id == organisation_id,
            col(VehicleAssignment.driver_id).in_(driver_ids),
            col(VehicleAssignment.ended_at).is_(None),
        )
    ).all()
    return {driver_id: (vehicle_id, registration) for driver_id, vehicle_id, registration in rows}


def link_account(
    db: Session,
    organisation_id: uuid.UUID,
    driver_id: uuid.UUID,
    actor_id: uuid.UUID,
    user_id: uuid.UUID | None,
) -> Driver:
    driver = get_driver(db, organisation_id, driver_id)
    if user_id is not None:
        member = db.exec(
            select(OrganisationMembership.id).where(
                OrganisationMembership.organisation_id == organisation_id,
                OrganisationMembership.user_id == user_id,
            )
        ).first()
        if member is None:
            raise ApiError(404, "member_not_found", "That member wasn't found.")
    driver.user_id = user_id
    driver.updated_at = utcnow()
    db.add(driver)
    record_audit(
        db,
        "driver.account_linked" if user_id else "driver.account_unlinked",
        actor_user_id=actor_id,
        organisation_id=organisation_id,
        entity_type="driver",
        entity_id=driver.id,
    )
    _commit_or_conflict(db)
    return driver


def get_driver(db: Session, organisation_id: uuid.UUID, driver_id: uuid.UUID) -> Driver:
    driver = db.exec(
        select(Driver).where(Driver.id == driver_id, Driver.organisation_id == organisation_id)
    ).first()
    if driver is None:
        raise _not_found()
    return driver


def _lock_driver(db: Session, organisation_id: uuid.UUID, driver_id: uuid.UUID) -> Driver:
    driver = db.exec(
        select(Driver)
        .where(Driver.id == driver_id, Driver.organisation_id == organisation_id)
        .with_for_update()
    ).first()
    if driver is None:
        raise _not_found()
    return driver


def create_driver(
    db: Session, organisation_id: uuid.UUID, actor_id: uuid.UUID, values: dict[str, Any]
) -> Driver:
    driver = Driver(organisation_id=organisation_id, **values)
    db.add(driver)
    record_audit(
        db,
        "driver.created",
        actor_user_id=actor_id,
        organisation_id=organisation_id,
        entity_type="driver",
        entity_id=driver.id,
    )
    _commit_or_conflict(db)
    db.refresh(driver)
    return driver


def update_driver(
    db: Session,
    organisation_id: uuid.UUID,
    actor_id: uuid.UUID,
    driver_id: uuid.UUID,
    changes: dict[str, Any],
) -> Driver:
    expected_updated_at = changes.pop("expected_updated_at", None)
    driver = _lock_driver(db, organisation_id, driver_id)
    if driver.archived_at is not None:
        raise ApiError(409, "driver_archived", "Restore this driver before changing them.")
    if expected_updated_at is not None and driver.updated_at != expected_updated_at:
        raise ApiError(
            409,
            "stale_update",
            "Someone else has changed this driver. Reload and make your change again.",
        )
    changed = {field: value for field, value in changes.items() if getattr(driver, field) != value}
    if not changed:
        return driver
    tracked = {
        field: {"from": str(getattr(driver, field)), "to": str(changed[field])}
        for field in TRACKED_VALUES
        if field in changed
    }
    for field, value in changed.items():
        setattr(driver, field, value)
    record_audit(
        db,
        "driver.updated",
        actor_user_id=actor_id,
        organisation_id=organisation_id,
        entity_type="driver",
        entity_id=driver.id,
        details={"fields": sorted(changed), "changes": tracked},
    )
    _commit_or_conflict(db)
    db.refresh(driver)
    return driver


def _end_current_assignments(db: Session, organisation_id: uuid.UUID, driver_id: uuid.UUID) -> int:
    assignments = db.exec(
        select(VehicleAssignment).where(
            VehicleAssignment.organisation_id == organisation_id,
            VehicleAssignment.driver_id == driver_id,
            col(VehicleAssignment.ended_at).is_(None),
        )
    ).all()
    now = utcnow()
    for assignment in assignments:
        assignment.ended_at = now
    return len(assignments)


def archive_driver(
    db: Session, organisation_id: uuid.UUID, actor_id: uuid.UUID, driver_id: uuid.UUID
) -> Driver:
    driver = _lock_driver(db, organisation_id, driver_id)
    if driver.archived_at is not None:
        return driver
    on_trip = db.exec(
        select(Trip.id).where(
            Trip.organisation_id == organisation_id,
            Trip.driver_id == driver_id,
            Trip.status == TripStatus.IN_PROGRESS,
        )
    ).first()
    if on_trip is not None:
        raise ApiError(409, "driver_on_trip", "This driver is on a trip that's in progress.")
    driver.archived_at = utcnow()
    ended = _end_current_assignments(db, organisation_id, driver_id)
    record_audit(
        db,
        "driver.archived",
        actor_user_id=actor_id,
        organisation_id=organisation_id,
        entity_type="driver",
        entity_id=driver.id,
        details={"assignments_ended": ended},
    )
    db.commit()
    db.refresh(driver)
    return driver


def restore_driver(
    db: Session, organisation_id: uuid.UUID, actor_id: uuid.UUID, driver_id: uuid.UUID
) -> Driver:
    driver = _lock_driver(db, organisation_id, driver_id)
    if driver.archived_at is None:
        return driver
    driver.archived_at = None
    record_audit(
        db,
        "driver.restored",
        actor_user_id=actor_id,
        organisation_id=organisation_id,
        entity_type="driver",
        entity_id=driver.id,
    )
    _commit_or_conflict(db)
    db.refresh(driver)
    return driver


def assign_vehicle(
    db: Session,
    organisation_id: uuid.UUID,
    actor_id: uuid.UUID,
    driver_id: uuid.UUID,
    vehicle_id: uuid.UUID,
) -> None:
    driver = _lock_driver(db, organisation_id, driver_id)
    if driver.archived_at is not None or driver.status != DriverStatus.ACTIVE:
        raise ApiError(409, "driver_not_active", "Only an active driver can be assigned.")
    vehicle = db.exec(
        select(Vehicle).where(Vehicle.id == vehicle_id, Vehicle.organisation_id == organisation_id)
    ).first()
    if vehicle is None:
        raise ApiError(404, "not_found", "Vehicle not found.")
    if vehicle.archived_at is not None:
        raise ApiError(409, "vehicle_archived", "An archived vehicle can't be assigned.")
    assignment = VehicleAssignment(
        organisation_id=organisation_id, vehicle_id=vehicle_id, driver_id=driver_id
    )
    db.add(assignment)
    record_audit(
        db,
        "driver.assigned",
        actor_user_id=actor_id,
        organisation_id=organisation_id,
        entity_type="driver",
        entity_id=driver_id,
        details={"vehicle_id": str(vehicle_id)},
    )
    _commit_or_conflict(db)


def unassign_vehicle(
    db: Session, organisation_id: uuid.UUID, actor_id: uuid.UUID, driver_id: uuid.UUID
) -> None:
    _lock_driver(db, organisation_id, driver_id)
    if _end_current_assignments(db, organisation_id, driver_id) == 0:
        raise ApiError(409, "not_assigned", "This driver isn't assigned to a vehicle.")
    record_audit(
        db,
        "driver.unassigned",
        actor_user_id=actor_id,
        organisation_id=organisation_id,
        entity_type="driver",
        entity_id=driver_id,
    )
    db.commit()


def assignment_history(
    db: Session, organisation_id: uuid.UUID, driver_id: uuid.UUID
) -> list[tuple[VehicleAssignment, str]]:
    get_driver(db, organisation_id, driver_id)
    rows = db.exec(
        select(VehicleAssignment, Vehicle.registration_number)
        .join(Vehicle, col(Vehicle.id) == col(VehicleAssignment.vehicle_id))
        .where(
            VehicleAssignment.organisation_id == organisation_id,
            VehicleAssignment.driver_id == driver_id,
        )
        .order_by(col(VehicleAssignment.started_at).desc())
        .limit(50)
    ).all()
    return [(row[0], row[1]) for row in rows]
