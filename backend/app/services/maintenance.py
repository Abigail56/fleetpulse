import uuid
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import case
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, col, func, or_, select, update

from app.core.errors import ApiError
from app.models import Alert, Defect, MaintenanceSchedule, Trip, Vehicle, WorkOrder
from app.models.base import utcnow
from app.models.enums import DefectStatus, TripStatus, VehicleStatus, WorkOrderStatus
from app.services.audit import record_audit

UNFINISHED = (WorkOrderStatus.OPEN, WorkOrderStatus.IN_PROGRESS)
OPTION_LIMIT = 5000
# The person may be a day ahead of the organisation's time zone.
DATE_GRACE = timedelta(days=1)
RECENT_COST_DAYS = 30


@dataclass
class DueState:
    next_due_on: date | None
    next_due_km: Decimal | None
    state: str


def due_state(schedule: MaintenanceSchedule, odometer_km: Decimal, today: date) -> DueState:
    """Whichever of the date and the odometer comes first decides."""
    next_on = (
        schedule.last_service_on + timedelta(days=schedule.interval_days)
        if schedule.interval_days
        else None
    )
    next_km = schedule.last_service_km + schedule.interval_km if schedule.interval_km else None
    if (next_on and today > next_on) or (next_km is not None and odometer_km >= next_km):
        state = "overdue"
    elif (next_on and today >= next_on - timedelta(days=schedule.warn_days)) or (
        next_km is not None and odometer_km >= next_km - schedule.warn_km
    ):
        state = "due_soon"
    else:
        state = "ok"
    return DueState(next_on, next_km, state)


def _schedule_missing() -> ApiError:
    return ApiError(404, "not_found", "Schedule not found.")


def _work_order_missing() -> ApiError:
    return ApiError(404, "not_found", "Work order not found.")


def _escape_like(term: str) -> str:
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _active_vehicle(
    db: Session, organisation_id: uuid.UUID, vehicle_id: uuid.UUID, lock: bool = False
) -> Vehicle:
    query = select(Vehicle).where(
        Vehicle.id == vehicle_id,
        Vehicle.organisation_id == organisation_id,
        col(Vehicle.archived_at).is_(None),
    )
    vehicle = db.exec(query.with_for_update() if lock else query).first()
    if vehicle is None:
        raise ApiError(404, "vehicle_not_found", "That vehicle wasn't found.")
    return vehicle


def _record(
    db: Session,
    organisation_id: uuid.UUID,
    actor_id: uuid.UUID,
    action: str,
    entity_type: str,
    entity_id: uuid.UUID,
    **details: Any,
) -> None:
    # Names only: notes and provider details can be personal.
    record_audit(
        db,
        action,
        actor_user_id=actor_id,
        organisation_id=organisation_id,
        entity_type=entity_type,
        entity_id=entity_id,
        details=details or None,
    )


# Schedules


def _open_orders(db: Session, organisation_id: uuid.UUID) -> dict[uuid.UUID, uuid.UUID]:
    rows = db.exec(
        select(WorkOrder.schedule_id, WorkOrder.id).where(
            WorkOrder.organisation_id == organisation_id,
            col(WorkOrder.schedule_id).is_not(None),
            col(WorkOrder.status).in_(UNFINISHED),
        )
    ).all()
    return {schedule: order for schedule, order in rows if schedule}


def list_schedules(
    db: Session,
    organisation_id: uuid.UUID,
    today: date,
    *,
    vehicle_id: uuid.UUID | None,
    state: str | None,
    archived: bool,
) -> list[tuple[MaintenanceSchedule, Vehicle, DueState, uuid.UUID | None]]:
    """Most urgent first. Being due depends on today and the odometer, so it isn't a column."""
    query = (
        select(MaintenanceSchedule, Vehicle)
        .join(
            Vehicle,
            (col(Vehicle.id) == MaintenanceSchedule.vehicle_id)
            & (col(Vehicle.organisation_id) == MaintenanceSchedule.organisation_id),
        )
        .where(MaintenanceSchedule.organisation_id == organisation_id)
    )
    if archived:
        query = query.where(col(MaintenanceSchedule.archived_at).is_not(None))
    else:
        query = query.where(
            col(MaintenanceSchedule.archived_at).is_(None), col(Vehicle.archived_at).is_(None)
        )
    if vehicle_id:
        query = query.where(MaintenanceSchedule.vehicle_id == vehicle_id)
    open_orders = _open_orders(db, organisation_id)
    rows = []
    for schedule, vehicle in db.exec(query).all():
        due = due_state(schedule, vehicle.odometer_km, today)
        if state is None or due.state == state:
            rows.append((schedule, vehicle, due, open_orders.get(schedule.id)))
    order = {"overdue": 0, "due_soon": 1, "ok": 2}
    rows.sort(key=lambda row: (order[row[2].state], row[1].registration_number, row[0].name))
    return rows


def get_schedule_row(
    db: Session, organisation_id: uuid.UUID, schedule_id: uuid.UUID, today: date
) -> tuple[MaintenanceSchedule, Vehicle, DueState, uuid.UUID | None]:
    row = db.exec(
        select(MaintenanceSchedule, Vehicle)
        .join(
            Vehicle,
            (col(Vehicle.id) == MaintenanceSchedule.vehicle_id)
            & (col(Vehicle.organisation_id) == MaintenanceSchedule.organisation_id),
        )
        .where(
            MaintenanceSchedule.id == schedule_id,
            MaintenanceSchedule.organisation_id == organisation_id,
        )
    ).first()
    if row is None:
        raise _schedule_missing()
    schedule, vehicle = row
    return (
        schedule,
        vehicle,
        due_state(schedule, vehicle.odometer_km, today),
        _open_orders(db, organisation_id).get(schedule.id),
    )


def create_schedule(
    db: Session,
    organisation_id: uuid.UUID,
    actor_id: uuid.UUID,
    today: date,
    values: dict[str, Any],
) -> MaintenanceSchedule:
    vehicle = _active_vehicle(db, organisation_id, values["vehicle_id"])
    last_on = values.get("last_service_on") or today
    if last_on > today + DATE_GRACE:
        raise ApiError(422, "date_in_future", "The last service can't be in the future.")
    last_km = values.get("last_service_km")
    schedule = MaintenanceSchedule(
        organisation_id=organisation_id,
        created_by_user_id=actor_id,
        **{
            **values,
            "last_service_on": last_on,
            "last_service_km": vehicle.odometer_km if last_km is None else last_km,
        },
    )
    db.add(schedule)
    db.flush()
    _record(db, organisation_id, actor_id, "maintenance_schedule.created", "schedule", schedule.id)
    db.commit()
    return schedule


def update_schedule(
    db: Session,
    organisation_id: uuid.UUID,
    schedule_id: uuid.UUID,
    actor_id: uuid.UUID,
    today: date,
    changes: dict[str, Any],
) -> MaintenanceSchedule:
    schedule = db.exec(
        select(MaintenanceSchedule)
        .where(
            MaintenanceSchedule.id == schedule_id,
            MaintenanceSchedule.organisation_id == organisation_id,
        )
        .with_for_update()
    ).first()
    if schedule is None:
        raise _schedule_missing()
    if schedule.archived_at is not None:
        raise ApiError(409, "schedule_archived", "An archived schedule can't be changed.")
    for field in ("name", "warn_days", "warn_km", "last_service_on", "last_service_km"):
        if field in changes and changes[field] is None:
            raise ApiError(422, "missing_value", "That value is required.")
    if changes.get("last_service_on") and changes["last_service_on"] > today + DATE_GRACE:
        raise ApiError(422, "date_in_future", "The last service can't be in the future.")
    days = changes.get("interval_days", schedule.interval_days)
    km = changes.get("interval_km", schedule.interval_km)
    if days is None and km is None:
        raise ApiError(422, "no_interval", "Set an interval in days, kilometres or both.")
    for field, value in changes.items():
        setattr(schedule, field, value)
    schedule.updated_at = utcnow()
    db.add(schedule)
    _record(
        db,
        organisation_id,
        actor_id,
        "maintenance_schedule.updated",
        "schedule",
        schedule.id,
        fields=sorted(changes),
    )
    db.commit()
    return schedule


def archive_schedule(
    db: Session, organisation_id: uuid.UUID, schedule_id: uuid.UUID, actor_id: uuid.UUID
) -> MaintenanceSchedule:
    schedule = db.exec(
        select(MaintenanceSchedule).where(
            MaintenanceSchedule.id == schedule_id,
            MaintenanceSchedule.organisation_id == organisation_id,
        )
    ).first()
    if schedule is None:
        raise _schedule_missing()
    if schedule.archived_at is None:
        schedule.archived_at = utcnow()
        db.add(schedule)
        _record(
            db, organisation_id, actor_id, "maintenance_schedule.archived", "schedule", schedule.id
        )
        db.commit()
    return schedule


# Work orders


def _work_order_rows(organisation_id: uuid.UUID) -> Any:
    return (
        select(WorkOrder, Vehicle.registration_number)
        .join(
            Vehicle,
            (col(Vehicle.id) == WorkOrder.vehicle_id)
            & (col(Vehicle.organisation_id) == WorkOrder.organisation_id),
        )
        .where(WorkOrder.organisation_id == organisation_id)
    )


def list_work_orders(
    db: Session,
    organisation_id: uuid.UUID,
    *,
    statuses: list[WorkOrderStatus],
    work_type: str | None,
    vehicle_id: uuid.UUID | None,
    search: str | None,
    page: int,
    page_size: int,
) -> tuple[list[Any], int]:
    query = _work_order_rows(organisation_id)
    if statuses:
        query = query.where(col(WorkOrder.status).in_(statuses))
    if work_type:
        query = query.where(WorkOrder.work_type == work_type)
    if vehicle_id:
        query = query.where(WorkOrder.vehicle_id == vehicle_id)
    if search:
        pattern = f"%{_escape_like(search.strip())}%"
        fields = (WorkOrder.title, WorkOrder.provider_name, Vehicle.registration_number)
        query = query.where(or_(*[col(field).ilike(pattern, escape="\\") for field in fields]))
    total = db.exec(select(func.count()).select_from(query.subquery())).one()
    # Unfinished first, then the most recent.
    unfinished_first = case((col(WorkOrder.status).in_(UNFINISHED), 0), else_=1)
    rows = db.exec(
        query.order_by(
            unfinished_first,
            col(WorkOrder.completed_on).desc().nulls_last(),
            col(WorkOrder.created_at).desc(),
        )
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return list(rows), total


def get_work_order_row(db: Session, organisation_id: uuid.UUID, order_id: uuid.UUID) -> Any:
    row = db.exec(_work_order_rows(organisation_id).where(WorkOrder.id == order_id)).first()
    if row is None:
        raise _work_order_missing()
    return row


def _locked_order(db: Session, organisation_id: uuid.UUID, order_id: uuid.UUID) -> WorkOrder:
    order = db.exec(
        select(WorkOrder)
        .where(WorkOrder.id == order_id, WorkOrder.organisation_id == organisation_id)
        .with_for_update()
    ).first()
    if order is None:
        raise _work_order_missing()
    return order


def create_work_order(
    db: Session,
    organisation_id: uuid.UUID,
    actor_id: uuid.UUID,
    currency: str,
    values: dict[str, Any],
) -> WorkOrder:
    _active_vehicle(db, organisation_id, values["vehicle_id"])
    if values.get("schedule_id"):
        schedule = db.exec(
            select(MaintenanceSchedule).where(
                MaintenanceSchedule.id == values["schedule_id"],
                MaintenanceSchedule.organisation_id == organisation_id,
                col(MaintenanceSchedule.archived_at).is_(None),
            )
        ).first()
        if schedule is None:
            raise _schedule_missing()
        if schedule.vehicle_id != values["vehicle_id"]:
            raise ApiError(409, "schedule_mismatch", "That schedule is for a different vehicle.")
    order = WorkOrder(
        organisation_id=organisation_id,
        created_by_user_id=actor_id,
        currency=currency,
        **values,
    )
    db.add(order)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        if "uq_work_orders_schedule_id_unfinished" in str(exc.orig):
            raise ApiError(
                409, "work_order_exists", "This schedule already has an unfinished work order."
            ) from exc
        raise
    _record(db, organisation_id, actor_id, "work_order.created", "work_order", order.id)
    db.commit()
    return order


def update_work_order(
    db: Session,
    organisation_id: uuid.UUID,
    order_id: uuid.UUID,
    actor_id: uuid.UUID,
    changes: dict[str, Any],
) -> WorkOrder:
    order = _locked_order(db, organisation_id, order_id)
    if order.status not in UNFINISHED:
        raise ApiError(409, "work_order_closed", "A finished work order can't be changed.")
    if "title" in changes and changes["title"] is None:
        raise ApiError(422, "missing_value", "A title is required.")
    for field, value in changes.items():
        setattr(order, field, value)
    order.updated_at = utcnow()
    db.add(order)
    _record(
        db,
        organisation_id,
        actor_id,
        "work_order.updated",
        "work_order",
        order.id,
        fields=sorted(changes),
    )
    db.commit()
    return order


def _wrong_state(order: WorkOrder, action: str) -> ApiError:
    state = order.status.value.replace("_", " ")
    return ApiError(409, "invalid_transition", f"A work order that is {state} can't be {action}.")


def start_work_order(
    db: Session,
    organisation_id: uuid.UUID,
    order_id: uuid.UUID,
    actor_id: uuid.UUID,
    take_off_road: bool,
) -> WorkOrder:
    order = _locked_order(db, organisation_id, order_id)
    if order.status != WorkOrderStatus.OPEN:
        raise _wrong_state(order, "started")
    if take_off_road:
        vehicle = _active_vehicle(db, organisation_id, order.vehicle_id, lock=True)
        on_trip = db.exec(
            select(Trip.id).where(
                Trip.organisation_id == organisation_id,
                Trip.vehicle_id == order.vehicle_id,
                Trip.status == TripStatus.IN_PROGRESS,
            )
        ).first()
        if on_trip is not None:
            raise ApiError(409, "vehicle_on_trip", "This vehicle is on a trip that's in progress.")
        order.took_off_road = True
        if vehicle.status != VehicleStatus.MAINTENANCE:
            order.status_before = vehicle.status
            vehicle.status = VehicleStatus.MAINTENANCE
            db.add(vehicle)
    order.status = WorkOrderStatus.IN_PROGRESS
    order.started_at = utcnow()
    order.updated_at = utcnow()
    db.add(order)
    _record(db, organisation_id, actor_id, "work_order.started", "work_order", order.id)
    db.commit()
    return order


def _return_to_road(db: Session, order: WorkOrder) -> None:
    """Back to how it was, unless other work still has it, or someone has since changed it."""
    if not order.took_off_road:
        return
    vehicle = _active_vehicle(db, order.organisation_id, order.vehicle_id, lock=True)
    other = db.exec(
        select(WorkOrder)
        .where(
            WorkOrder.organisation_id == order.organisation_id,
            WorkOrder.vehicle_id == order.vehicle_id,
            WorkOrder.id != order.id,
            WorkOrder.status == WorkOrderStatus.IN_PROGRESS,
            col(WorkOrder.took_off_road).is_(True),
        )
        .with_for_update()
    ).first()
    if other is not None:
        other.status_before = other.status_before or order.status_before
        db.add(other)
        return
    if vehicle.status == VehicleStatus.MAINTENANCE:
        vehicle.status = order.status_before or VehicleStatus.ACTIVE
        db.add(vehicle)


def _linked_defects(db: Session, order: WorkOrder) -> list[Defect]:
    return list(
        db.exec(
            select(Defect).where(
                Defect.organisation_id == order.organisation_id,
                Defect.work_order_id == order.id,
                Defect.status == DefectStatus.OPEN,
            )
        ).all()
    )


def complete_work_order(
    db: Session,
    organisation_id: uuid.UUID,
    order_id: uuid.UUID,
    actor_id: uuid.UUID,
    today: date,
    values: dict[str, Any],
) -> WorkOrder:
    order = _locked_order(db, organisation_id, order_id)
    if order.status != WorkOrderStatus.IN_PROGRESS:
        raise _wrong_state(order, "completed")
    completed_on = values.get("completed_on") or today
    if completed_on > today + DATE_GRACE:
        raise ApiError(422, "date_in_future", "The completion date can't be in the future.")
    odometer = values.get("odometer_km")
    schedule = None
    if order.schedule_id:
        schedule = db.exec(
            select(MaintenanceSchedule)
            .where(
                MaintenanceSchedule.id == order.schedule_id,
                MaintenanceSchedule.organisation_id == organisation_id,
            )
            .with_for_update()
        ).first()
    # Assuming a reading here would quietly move the next service to the wrong distance.
    if schedule is not None and schedule.interval_km is not None and odometer is None:
        raise ApiError(
            422,
            "odometer_required",
            "This schedule goes by distance, so enter the odometer reading.",
        )
    order.status = WorkOrderStatus.COMPLETED
    order.completed_on = completed_on
    order.odometer_km = odometer
    order.labour_cost = values.get("labour_cost")
    order.parts_cost = values.get("parts_cost")
    order.completion_notes = values.get("completion_notes")
    order.updated_at = utcnow()
    db.add(order)
    _return_to_road(db, order)
    if odometer is not None:
        vehicle = _active_vehicle(db, organisation_id, order.vehicle_id, lock=True)
        # An older reading is history, and never winds the odometer back.
        if odometer > vehicle.odometer_km:
            vehicle.odometer_km = odometer
            vehicle.odometer_recorded_at = utcnow()
            db.add(vehicle)
    if schedule is not None and completed_on >= schedule.last_service_on:
        schedule.last_service_on = completed_on
        if odometer is not None:
            schedule.last_service_km = odometer
        schedule.updated_at = utcnow()
        db.add(schedule)
    for defect in _linked_defects(db, order):
        defect.status = DefectStatus.RESOLVED
        defect.resolved_at = utcnow()
        defect.resolved_by_user_id = actor_id
        defect.resolution_note = f"Fixed by work order: {order.title}"[:2000]
        defect.updated_at = utcnow()
        db.add(defect)
        db.execute(
            update(Alert)
            .where(
                col(Alert.organisation_id) == organisation_id,
                col(Alert.dedupe_key) == f"defect:{defect.id}",
                col(Alert.resolved_at).is_(None),
            )
            .values(resolved_at=utcnow())
        )
    _record(db, organisation_id, actor_id, "work_order.completed", "work_order", order.id)
    db.commit()
    return order


def cancel_work_order(
    db: Session, organisation_id: uuid.UUID, order_id: uuid.UUID, actor_id: uuid.UUID
) -> WorkOrder:
    order = _locked_order(db, organisation_id, order_id)
    if order.status not in UNFINISHED:
        raise _wrong_state(order, "cancelled")
    order.status = WorkOrderStatus.CANCELLED
    order.updated_at = utcnow()
    db.add(order)
    _return_to_road(db, order)
    # Cancelled work fixed nothing, so its defects stay open and can be booked again.
    for defect in _linked_defects(db, order):
        defect.work_order_id = None
        defect.updated_at = utcnow()
        db.add(defect)
    _record(db, organisation_id, actor_id, "work_order.cancelled", "work_order", order.id)
    db.commit()
    return order


def summary(
    db: Session, organisation_id: uuid.UUID, today: date
) -> tuple[int, int, int, int, list[tuple[str, Decimal]]]:
    rows = list_schedules(db, organisation_id, today, vehicle_id=None, state=None, archived=False)
    overdue = sum(1 for row in rows if row[2].state == "overdue")
    due_soon = sum(1 for row in rows if row[2].state == "due_soon")
    counts = dict(
        db.exec(
            select(WorkOrder.status, func.count())
            .where(
                WorkOrder.organisation_id == organisation_id,
                col(WorkOrder.status).in_(UNFINISHED),
            )
            .group_by(col(WorkOrder.status))
        ).all()
    )
    costs = db.exec(
        select(
            WorkOrder.currency,
            func.sum(
                func.coalesce(WorkOrder.labour_cost, 0) + func.coalesce(WorkOrder.parts_cost, 0)
            ),
        )
        .where(
            WorkOrder.organisation_id == organisation_id,
            WorkOrder.status == WorkOrderStatus.COMPLETED,
            col(WorkOrder.completed_on) >= today - timedelta(days=RECENT_COST_DAYS),
            or_(col(WorkOrder.labour_cost).is_not(None), col(WorkOrder.parts_cost).is_not(None)),
        )
        .group_by(col(WorkOrder.currency))
        .order_by(col(WorkOrder.currency))
    ).all()
    return (
        overdue,
        due_soon,
        counts.get(WorkOrderStatus.OPEN, 0),
        counts.get(WorkOrderStatus.IN_PROGRESS, 0),
        [(currency, amount) for currency, amount in costs],
    )


def vehicle_options(db: Session, organisation_id: uuid.UUID) -> list[Vehicle]:
    return list(
        db.exec(
            select(Vehicle)
            .where(Vehicle.organisation_id == organisation_id, col(Vehicle.archived_at).is_(None))
            .order_by(col(Vehicle.registration_number))
            .limit(OPTION_LIMIT)
        ).all()
    )


def in_progress_order(
    db: Session, organisation_id: uuid.UUID, vehicle_id: uuid.UUID
) -> uuid.UUID | None:
    return db.exec(
        select(WorkOrder.id).where(
            WorkOrder.organisation_id == organisation_id,
            WorkOrder.vehicle_id == vehicle_id,
            WorkOrder.status == WorkOrderStatus.IN_PROGRESS,
        )
    ).first()
