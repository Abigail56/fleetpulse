import uuid
from collections import defaultdict
from datetime import UTC, date, datetime, time, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from sqlmodel import Session, col, func, select

from app.core.errors import ApiError
from app.models import (
    Expense,
    FuelTransaction,
    StoredFile,
    Vehicle,
    VehicleAssignment,
    WorkOrder,
)
from app.models.base import utcnow
from app.models.driver import Driver
from app.models.enums import ExpenseStatus, FilePurpose, OrganisationRole, WorkOrderStatus
from app.services.audit import record_audit

CENTS = Decimal("0.01")
RATE = Decimal("0.0001")
OPTION_LIMIT = 5000
CLOCK_SKEW = timedelta(minutes=5)
# The person may be a day ahead of the organisation's time zone.
DATE_GRACE = timedelta(days=1)


def _record(
    db: Session,
    organisation_id: uuid.UUID,
    actor_id: uuid.UUID,
    action: str,
    entity_type: str,
    entity_id: uuid.UUID,
    **details: Any,
) -> None:
    record_audit(
        db,
        action,
        actor_user_id=actor_id,
        organisation_id=organisation_id,
        entity_type=entity_type,
        entity_id=entity_id,
        details=details or None,
    )


def assigned_vehicle(
    db: Session, organisation_id: uuid.UUID, user_id: uuid.UUID
) -> uuid.UUID | None:
    return db.exec(
        select(VehicleAssignment.vehicle_id)
        .join(
            Driver,
            (col(Driver.id) == VehicleAssignment.driver_id)
            & (col(Driver.organisation_id) == VehicleAssignment.organisation_id),
        )
        .where(
            VehicleAssignment.organisation_id == organisation_id,
            Driver.user_id == user_id,
            col(VehicleAssignment.ended_at).is_(None),
        )
    ).first()


def _usable_vehicle(
    db: Session,
    organisation_id: uuid.UUID,
    vehicle_id: uuid.UUID,
    user_id: uuid.UUID,
    can_view_all: bool,
) -> Vehicle:
    vehicle = db.exec(
        select(Vehicle).where(
            Vehicle.id == vehicle_id,
            Vehicle.organisation_id == organisation_id,
            col(Vehicle.archived_at).is_(None),
        )
    ).first()
    missing = ApiError(404, "vehicle_not_found", "That vehicle wasn't found.")
    if vehicle is None:
        raise missing
    # Drivers record costs only for the vehicle they're assigned to.
    if not can_view_all and assigned_vehicle(db, organisation_id, user_id) != vehicle_id:
        raise missing
    return vehicle


def _check_receipt(
    db: Session,
    organisation_id: uuid.UUID,
    file_id: uuid.UUID | None,
    user_id: uuid.UUID,
    can_view_all: bool,
) -> None:
    if file_id is None:
        return
    stored = db.exec(
        select(StoredFile).where(
            StoredFile.id == file_id,
            StoredFile.organisation_id == organisation_id,
            StoredFile.purpose == FilePurpose.RECEIPT,
        )
    ).first()
    if stored is None or (not can_view_all and stored.uploaded_by_user_id != user_id):
        raise ApiError(404, "file_not_found", "That receipt wasn't found.")


def options(
    db: Session, organisation_id: uuid.UUID, user_id: uuid.UUID, can_view_all: bool
) -> list[Vehicle]:
    query = (
        select(Vehicle)
        .where(Vehicle.organisation_id == organisation_id, col(Vehicle.archived_at).is_(None))
        .order_by(col(Vehicle.registration_number))
        .limit(OPTION_LIMIT)
    )
    if not can_view_all:
        vehicle_id = assigned_vehicle(db, organisation_id, user_id)
        if vehicle_id is None:
            return []
        query = query.where(Vehicle.id == vehicle_id)
    return list(db.exec(query).all())


def _total(quantity: Decimal, unit_price: Decimal) -> Decimal:
    return (quantity * unit_price).quantize(CENTS, rounding=ROUND_HALF_UP)


def _raise_odometer(vehicle: Vehicle, reading: Decimal | None) -> None:
    if reading is not None and reading > vehicle.odometer_km:
        vehicle.odometer_km = reading
        vehicle.odometer_recorded_at = utcnow()


def _fuel_rows(organisation_id: uuid.UUID) -> Any:
    return (
        select(FuelTransaction, Vehicle.registration_number, StoredFile)
        .join(
            Vehicle,
            (col(Vehicle.id) == FuelTransaction.vehicle_id)
            & (col(Vehicle.organisation_id) == FuelTransaction.organisation_id),
        )
        .join(
            StoredFile,
            (col(StoredFile.id) == FuelTransaction.receipt_file_id)
            & (col(StoredFile.organisation_id) == FuelTransaction.organisation_id),
            isouter=True,
        )
        .where(FuelTransaction.organisation_id == organisation_id)
    )


def list_fuel(
    db: Session,
    organisation_id: uuid.UUID,
    *,
    only_user: uuid.UUID | None,
    vehicle_id: uuid.UUID | None,
    voided: bool,
    page: int,
    page_size: int,
) -> tuple[list[Any], int]:
    query = _fuel_rows(organisation_id).where(
        col(FuelTransaction.voided_at).is_not(None)
        if voided
        else col(FuelTransaction.voided_at).is_(None)
    )
    if only_user:
        query = query.where(FuelTransaction.created_by_user_id == only_user)
    if vehicle_id:
        query = query.where(FuelTransaction.vehicle_id == vehicle_id)
    total = db.exec(select(func.count()).select_from(query.subquery())).one()
    rows = db.exec(
        query.order_by(col(FuelTransaction.filled_at).desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return list(rows), total


def get_fuel_row(
    db: Session, organisation_id: uuid.UUID, fuel_id: uuid.UUID, only_user: uuid.UUID | None
) -> Any:
    row = db.exec(_fuel_rows(organisation_id).where(FuelTransaction.id == fuel_id)).first()
    if row is None or (only_user and row[0].created_by_user_id != only_user):
        raise ApiError(404, "not_found", "Fuel record not found.")
    return row


def create_fuel(
    db: Session,
    organisation_id: uuid.UUID,
    actor_id: uuid.UUID,
    can_view_all: bool,
    values: dict[str, Any],
) -> FuelTransaction:
    vehicle = _usable_vehicle(db, organisation_id, values["vehicle_id"], actor_id, can_view_all)
    _check_receipt(db, organisation_id, values.get("receipt_file_id"), actor_id, can_view_all)
    if values["filled_at"] > utcnow() + CLOCK_SKEW:
        raise ApiError(422, "date_in_future", "The fill-up can't be in the future.")
    entry = FuelTransaction(
        organisation_id=organisation_id,
        created_by_user_id=actor_id,
        total_cost=_total(values["quantity"], values["unit_price"]),
        **values,
    )
    _raise_odometer(vehicle, entry.odometer_km)
    db.add_all([entry, vehicle])
    db.flush()
    _record(db, organisation_id, actor_id, "fuel.created", "fuel", entry.id)
    db.commit()
    return entry


def update_fuel(
    db: Session,
    organisation_id: uuid.UUID,
    fuel_id: uuid.UUID,
    actor_id: uuid.UUID,
    can_view_all: bool,
    only_user: uuid.UUID | None,
    changes: dict[str, Any],
) -> FuelTransaction:
    entry: FuelTransaction = get_fuel_row(db, organisation_id, fuel_id, only_user)[0]
    if entry.voided_at is not None:
        raise ApiError(409, "record_voided", "A voided record can't be changed.")
    for field in ("filled_at", "quantity", "unit", "unit_price", "currency", "is_full_tank"):
        if field in changes and changes[field] is None:
            raise ApiError(422, "missing_value", "That value is required.")
    if changes.get("filled_at") and changes["filled_at"] > utcnow() + CLOCK_SKEW:
        raise ApiError(422, "date_in_future", "The fill-up can't be in the future.")
    if changes.get("receipt_file_id"):
        _check_receipt(db, organisation_id, changes["receipt_file_id"], actor_id, can_view_all)
    for field, value in changes.items():
        setattr(entry, field, value)
    entry.total_cost = _total(entry.quantity, entry.unit_price)
    entry.updated_at = utcnow()
    if changes.get("odometer_km") is not None:
        vehicle = db.get(Vehicle, entry.vehicle_id)
        if vehicle is not None:
            _raise_odometer(vehicle, entry.odometer_km)
            db.add(vehicle)
    db.add(entry)
    _record(db, organisation_id, actor_id, "fuel.updated", "fuel", entry.id, fields=sorted(changes))
    db.commit()
    return entry


def void_fuel(
    db: Session, organisation_id: uuid.UUID, fuel_id: uuid.UUID, actor_id: uuid.UUID
) -> FuelTransaction:
    entry: FuelTransaction = get_fuel_row(db, organisation_id, fuel_id, None)[0]
    if entry.voided_at is None:
        entry.voided_at = utcnow()
        db.add(entry)
        _record(db, organisation_id, actor_id, "fuel.voided", "fuel", entry.id)
        db.commit()
    return entry


def _expense_rows(organisation_id: uuid.UUID) -> Any:
    return (
        select(Expense, Vehicle.registration_number, StoredFile)
        .join(
            Vehicle,
            (col(Vehicle.id) == Expense.vehicle_id)
            & (col(Vehicle.organisation_id) == Expense.organisation_id),
        )
        .join(
            StoredFile,
            (col(StoredFile.id) == Expense.receipt_file_id)
            & (col(StoredFile.organisation_id) == Expense.organisation_id),
            isouter=True,
        )
        .where(Expense.organisation_id == organisation_id)
    )


def list_expenses(
    db: Session,
    organisation_id: uuid.UUID,
    *,
    only_user: uuid.UUID | None,
    status: ExpenseStatus | None,
    category: str | None,
    vehicle_id: uuid.UUID | None,
    voided: bool,
    page: int,
    page_size: int,
) -> tuple[list[Any], int]:
    query = _expense_rows(organisation_id).where(
        col(Expense.voided_at).is_not(None) if voided else col(Expense.voided_at).is_(None)
    )
    if only_user:
        query = query.where(Expense.submitted_by_user_id == only_user)
    if status:
        query = query.where(Expense.status == status)
    if category:
        query = query.where(Expense.category == category)
    if vehicle_id:
        query = query.where(Expense.vehicle_id == vehicle_id)
    total = db.exec(select(func.count()).select_from(query.subquery())).one()
    rows = db.exec(
        query.order_by(col(Expense.incurred_on).desc(), col(Expense.created_at).desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return list(rows), total


def get_expense_row(
    db: Session, organisation_id: uuid.UUID, expense_id: uuid.UUID, only_user: uuid.UUID | None
) -> Any:
    row = db.exec(_expense_rows(organisation_id).where(Expense.id == expense_id)).first()
    if row is None or (only_user and row[0].submitted_by_user_id != only_user):
        raise ApiError(404, "not_found", "Expense not found.")
    return row


def create_expense(
    db: Session,
    organisation_id: uuid.UUID,
    actor_id: uuid.UUID,
    can_view_all: bool,
    today: date,
    values: dict[str, Any],
) -> Expense:
    _usable_vehicle(db, organisation_id, values["vehicle_id"], actor_id, can_view_all)
    _check_receipt(db, organisation_id, values.get("receipt_file_id"), actor_id, can_view_all)
    if values["incurred_on"] > today + DATE_GRACE:
        raise ApiError(422, "date_in_future", "The expense date can't be in the future.")
    expense = Expense(organisation_id=organisation_id, submitted_by_user_id=actor_id, **values)
    db.add(expense)
    db.flush()
    _record(db, organisation_id, actor_id, "expense.created", "expense", expense.id)
    db.commit()
    return expense


def update_expense(
    db: Session,
    organisation_id: uuid.UUID,
    expense_id: uuid.UUID,
    actor_id: uuid.UUID,
    can_view_all: bool,
    only_user: uuid.UUID | None,
    today: date,
    changes: dict[str, Any],
) -> Expense:
    expense: Expense = get_expense_row(db, organisation_id, expense_id, only_user)[0]
    if expense.voided_at is not None:
        raise ApiError(409, "record_voided", "A voided record can't be changed.")
    if expense.status == ExpenseStatus.APPROVED:
        raise ApiError(409, "expense_approved", "An approved expense can't be changed.")
    for field in ("category", "amount", "currency", "incurred_on"):
        if field in changes and changes[field] is None:
            raise ApiError(422, "missing_value", "That value is required.")
    if changes.get("incurred_on") and changes["incurred_on"] > today + DATE_GRACE:
        raise ApiError(422, "date_in_future", "The expense date can't be in the future.")
    if changes.get("receipt_file_id"):
        _check_receipt(db, organisation_id, changes["receipt_file_id"], actor_id, can_view_all)
    for field, value in changes.items():
        setattr(expense, field, value)
    # Changing a rejected expense sends it back for another look.
    if expense.status == ExpenseStatus.REJECTED:
        expense.status = ExpenseStatus.SUBMITTED
        expense.reviewed_at = None
        expense.reviewed_by_user_id = None
        expense.review_note = None
    expense.updated_at = utcnow()
    db.add(expense)
    _record(
        db,
        organisation_id,
        actor_id,
        "expense.updated",
        "expense",
        expense.id,
        fields=sorted(changes),
    )
    db.commit()
    return expense


def review_expense(
    db: Session,
    organisation_id: uuid.UUID,
    expense_id: uuid.UUID,
    actor_id: uuid.UUID,
    actor_role: OrganisationRole,
    target: ExpenseStatus,
    note: str | None,
) -> Expense:
    expense = db.exec(
        select(Expense)
        .where(Expense.id == expense_id, Expense.organisation_id == organisation_id)
        .with_for_update()
    ).first()
    if expense is None:
        raise ApiError(404, "not_found", "Expense not found.")
    if expense.voided_at is not None:
        raise ApiError(409, "record_voided", "A voided record can't be changed.")
    if expense.status != ExpenseStatus.SUBMITTED:
        raise ApiError(409, "already_reviewed", "This expense has already been reviewed.")
    # Someone else checks it, except for an owner, who may have nobody else to ask.
    if expense.submitted_by_user_id == actor_id and actor_role != OrganisationRole.OWNER:
        raise ApiError(403, "own_expense", "Someone else needs to review your own expense.")
    if target == ExpenseStatus.REJECTED and not note:
        raise ApiError(422, "note_required", "Say why this expense is being rejected.")
    expense.status = target
    expense.reviewed_by_user_id = actor_id
    expense.reviewed_at = utcnow()
    expense.review_note = note
    expense.updated_at = utcnow()
    db.add(expense)
    _record(db, organisation_id, actor_id, f"expense.{target.value}", "expense", expense.id)
    db.commit()
    return expense


def void_expense(
    db: Session, organisation_id: uuid.UUID, expense_id: uuid.UUID, actor_id: uuid.UUID
) -> Expense:
    expense: Expense = get_expense_row(db, organisation_id, expense_id, None)[0]
    if expense.voided_at is None:
        expense.voided_at = utcnow()
        db.add(expense)
        _record(db, organisation_id, actor_id, "expense.voided", "expense", expense.id)
        db.commit()
    return expense


# Totals


def _day_start(day: date) -> datetime:
    return datetime.combine(day, time.min, tzinfo=UTC)


def _period_costs(
    db: Session,
    organisation_id: uuid.UUID,
    start: date,
    end: date,
    vehicle_id: uuid.UUID | None,
) -> dict[str, dict[str, Decimal]]:
    """Approved expenses only: one still awaiting review isn't yet a cost."""
    fuel = (
        select(FuelTransaction.currency, func.sum(FuelTransaction.total_cost))
        .where(
            FuelTransaction.organisation_id == organisation_id,
            col(FuelTransaction.voided_at).is_(None),
            col(FuelTransaction.filled_at) >= _day_start(start),
            col(FuelTransaction.filled_at) < _day_start(end + timedelta(days=1)),
        )
        .group_by(col(FuelTransaction.currency))
    )
    expenses = (
        select(Expense.currency, func.sum(Expense.amount))
        .where(
            Expense.organisation_id == organisation_id,
            col(Expense.voided_at).is_(None),
            Expense.status == ExpenseStatus.APPROVED,
            col(Expense.incurred_on) >= start,
            col(Expense.incurred_on) <= end,
        )
        .group_by(col(Expense.currency))
    )
    work = (
        select(
            WorkOrder.currency,
            func.sum(
                func.coalesce(WorkOrder.labour_cost, 0) + func.coalesce(WorkOrder.parts_cost, 0)
            ),
        )
        .where(
            WorkOrder.organisation_id == organisation_id,
            WorkOrder.status == WorkOrderStatus.COMPLETED,
            col(WorkOrder.completed_on) >= start,
            col(WorkOrder.completed_on) <= end,
        )
        .group_by(col(WorkOrder.currency))
    )
    if vehicle_id:
        fuel = fuel.where(FuelTransaction.vehicle_id == vehicle_id)
        expenses = expenses.where(Expense.vehicle_id == vehicle_id)
        work = work.where(WorkOrder.vehicle_id == vehicle_id)
    totals: dict[str, dict[str, Decimal]] = defaultdict(
        lambda: {"fuel": Decimal(0), "maintenance": Decimal(0), "expenses": Decimal(0)}
    )
    for name, query in (("fuel", fuel), ("expenses", expenses), ("maintenance", work)):
        for currency, amount in db.exec(query).all():
            totals[currency][name] = amount or Decimal(0)
    return totals


def summary(
    db: Session, organisation_id: uuid.UUID, start: date, end: date, vehicle_id: uuid.UUID | None
) -> tuple[dict[str, dict[str, Decimal]], list[Any], int]:
    totals = _period_costs(db, organisation_id, start, end, vehicle_id)
    categories = (
        select(Expense.category, Expense.currency, func.sum(Expense.amount))
        .where(
            Expense.organisation_id == organisation_id,
            col(Expense.voided_at).is_(None),
            Expense.status == ExpenseStatus.APPROVED,
            col(Expense.incurred_on) >= start,
            col(Expense.incurred_on) <= end,
        )
        .group_by(col(Expense.category), col(Expense.currency))
        .order_by(col(Expense.currency), col(Expense.category))
    )
    awaiting = select(func.count()).where(
        Expense.organisation_id == organisation_id,
        col(Expense.voided_at).is_(None),
        Expense.status == ExpenseStatus.SUBMITTED,
    )
    if vehicle_id:
        categories = categories.where(Expense.vehicle_id == vehicle_id)
        awaiting = awaiting.where(Expense.vehicle_id == vehicle_id)
    return totals, list(db.exec(categories).all()), db.exec(awaiting).one()


def vehicle_costs(
    db: Session, organisation_id: uuid.UUID, vehicle_id: uuid.UUID, start: date, end: date
) -> tuple[Decimal | None, int, dict[str, dict[str, Decimal]], list[tuple[Any, Decimal, Decimal]]]:
    start_at, end_at = _day_start(start), _day_start(end + timedelta(days=1))
    fills = db.exec(
        select(FuelTransaction)
        .where(
            FuelTransaction.organisation_id == organisation_id,
            FuelTransaction.vehicle_id == vehicle_id,
            col(FuelTransaction.voided_at).is_(None),
            col(FuelTransaction.filled_at) >= start_at,
            col(FuelTransaction.filled_at) < end_at,
        )
        .order_by(col(FuelTransaction.filled_at))
    ).all()
    service_readings = db.exec(
        select(col(WorkOrder.odometer_km)).where(
            WorkOrder.organisation_id == organisation_id,
            WorkOrder.vehicle_id == vehicle_id,
            WorkOrder.status == WorkOrderStatus.COMPLETED,
            col(WorkOrder.odometer_km).is_not(None),
            col(WorkOrder.completed_on) >= start,
            col(WorkOrder.completed_on) <= end,
        )
    ).all()
    readings = [item.odometer_km for item in fills if item.odometer_km is not None]
    readings += [item for item in service_readings if item is not None]
    distance = None
    if len(readings) >= 2 and max(readings) > min(readings):
        distance = max(readings) - min(readings)
    return (
        distance,
        len(readings),
        _period_costs(db, organisation_id, start, end, vehicle_id),
        _consumption(fills),
    )


def _consumption(fills: Any) -> list[tuple[Any, Decimal, Decimal]]:
    """Measured from one full tank to the next: what went in afterwards is what was used."""
    used: dict[Any, Decimal] = defaultdict(Decimal)
    travelled: dict[Any, Decimal] = defaultdict(Decimal)
    last_full: Any = None
    pending = Decimal(0)
    for fill in fills:
        if last_full is not None:
            if fill.unit != last_full.unit:
                last_full, pending = None, Decimal(0)
            else:
                pending += fill.quantity
        if not fill.is_full_tank:
            continue
        if fill.odometer_km is None:
            # The chain is broken: the distance since the last full tank is unknown.
            last_full, pending = None, Decimal(0)
            continue
        if last_full is not None and fill.odometer_km > last_full.odometer_km:
            used[fill.unit] += pending
            travelled[fill.unit] += fill.odometer_km - last_full.odometer_km
        last_full, pending = fill, Decimal(0)
    return [
        (unit, (used[unit] / travelled[unit] * 100).quantize(RATE), travelled[unit])
        for unit in used
    ]
