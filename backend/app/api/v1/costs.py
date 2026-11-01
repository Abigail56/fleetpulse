import uuid
from datetime import date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Annotated, Any
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import DbDep, TenantContext, require_permission
from app.core.errors import ApiError
from app.core.permissions import Permission, role_has_permission
from app.models.enums import ExpenseCategory, ExpenseStatus
from app.schemas.costs import (
    CategoryTotal,
    Consumption,
    CostLine,
    CostOptions,
    CostOptionVehicle,
    CostSummary,
    CurrencyCostPerKm,
    ExpenseCreate,
    ExpenseList,
    ExpenseResponse,
    ExpenseReview,
    ExpenseUpdate,
    FileResponse,
    FuelCreate,
    FuelList,
    FuelResponse,
    FuelUpdate,
    VehicleCosts,
)
from app.services import costs as service
from app.services.vehicles import get_vehicle

router = APIRouter(prefix="/costs", tags=["costs"])

CanSubmit = Annotated[TenantContext, Depends(require_permission(Permission.COSTS_SUBMIT))]
CanViewAll = Annotated[TenantContext, Depends(require_permission(Permission.COSTS_VIEW))]
CanApprove = Annotated[TenantContext, Depends(require_permission(Permission.COSTS_APPROVE))]
DEFAULT_PERIOD_DAYS = 30
MAX_PERIOD_DAYS = 3660


def _sees_all(tenant: TenantContext) -> bool:
    return role_has_permission(tenant.membership.role, Permission.COSTS_VIEW)


def _only_user(tenant: TenantContext) -> uuid.UUID | None:
    return None if _sees_all(tenant) else tenant.user.id


def _today(tenant: TenantContext) -> date:
    return datetime.now(ZoneInfo(tenant.organisation.timezone)).date()


def _period(tenant: TenantContext, start: date | None, end: date | None) -> tuple[date, date]:
    finish = end or _today(tenant)
    begin = start or finish - timedelta(days=DEFAULT_PERIOD_DAYS)
    if begin > finish or (finish - begin).days > MAX_PERIOD_DAYS:
        raise ApiError(422, "invalid_period", "Choose a start date before the end date.")
    return begin, finish


def _file(stored: Any) -> FileResponse | None:
    if stored is None:
        return None
    return FileResponse(
        id=stored.id,
        filename=stored.filename,
        content_type=stored.content_type,
        size_bytes=stored.size_bytes,
    )


def _fuel_response(row: Any) -> FuelResponse:
    entry, registration, stored = row
    return FuelResponse(
        id=entry.id,
        vehicle_id=entry.vehicle_id,
        vehicle_registration=registration,
        filled_at=entry.filled_at,
        quantity=entry.quantity,
        unit=entry.unit,
        unit_price=entry.unit_price,
        total_cost=entry.total_cost,
        currency=entry.currency,
        odometer_km=entry.odometer_km,
        is_full_tank=entry.is_full_tank,
        station_name=entry.station_name,
        notes=entry.notes,
        receipt=_file(stored),
        created_by_user_id=entry.created_by_user_id,
        voided_at=entry.voided_at,
    )


def _expense_response(row: Any) -> ExpenseResponse:
    expense, registration, stored = row
    return ExpenseResponse(
        id=expense.id,
        vehicle_id=expense.vehicle_id,
        vehicle_registration=registration,
        category=expense.category,
        amount=expense.amount,
        currency=expense.currency,
        incurred_on=expense.incurred_on,
        vendor=expense.vendor,
        description=expense.description,
        receipt=_file(stored),
        status=expense.status,
        submitted_by_user_id=expense.submitted_by_user_id,
        reviewed_at=expense.reviewed_at,
        review_note=expense.review_note,
        voided_at=expense.voided_at,
    )


@router.get("/options")
def cost_options(tenant: CanSubmit, db: DbDep) -> CostOptions:
    vehicles = service.options(db, tenant.organisation.id, tenant.user.id, _sees_all(tenant))
    return CostOptions(
        vehicles=[
            CostOptionVehicle(
                id=item.id,
                registration_number=item.registration_number,
                make=item.make,
                model=item.model,
            )
            for item in vehicles
        ],
        default_currency=tenant.organisation.default_currency,
    )


@router.get("/fuel")
def list_fuel(
    tenant: CanSubmit,
    db: DbDep,
    vehicle_id: uuid.UUID | None = None,
    voided: bool = False,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 25,
) -> FuelList:
    rows, total = service.list_fuel(
        db,
        tenant.organisation.id,
        only_user=_only_user(tenant),
        vehicle_id=vehicle_id,
        voided=voided,
        page=page,
        page_size=page_size,
    )
    return FuelList(
        items=[_fuel_response(row) for row in rows], total=total, page=page, page_size=page_size
    )


@router.post("/fuel", status_code=status.HTTP_201_CREATED)
def create_fuel(body: FuelCreate, tenant: CanSubmit, db: DbDep) -> FuelResponse:
    organisation_id = tenant.organisation.id
    entry = service.create_fuel(
        db, organisation_id, tenant.user.id, _sees_all(tenant), body.model_dump()
    )
    return _fuel_response(service.get_fuel_row(db, organisation_id, entry.id, None))


@router.get("/fuel/{fuel_id}")
def get_fuel(fuel_id: uuid.UUID, tenant: CanSubmit, db: DbDep) -> FuelResponse:
    return _fuel_response(
        service.get_fuel_row(db, tenant.organisation.id, fuel_id, _only_user(tenant))
    )


@router.patch("/fuel/{fuel_id}")
def update_fuel(fuel_id: uuid.UUID, body: FuelUpdate, tenant: CanSubmit, db: DbDep) -> FuelResponse:
    organisation_id = tenant.organisation.id
    service.update_fuel(
        db,
        organisation_id,
        fuel_id,
        tenant.user.id,
        _sees_all(tenant),
        _own_records_only(tenant),
        body.model_dump(exclude_unset=True),
    )
    return _fuel_response(service.get_fuel_row(db, organisation_id, fuel_id, None))


@router.post("/fuel/{fuel_id}/void")
def void_fuel(fuel_id: uuid.UUID, tenant: CanApprove, db: DbDep) -> FuelResponse:
    organisation_id = tenant.organisation.id
    service.void_fuel(db, organisation_id, fuel_id, tenant.user.id)
    return _fuel_response(service.get_fuel_row(db, organisation_id, fuel_id, None))


def _own_records_only(tenant: TenantContext) -> uuid.UUID | None:
    """Reviewers can correct anyone's records. Everyone else, only their own."""
    if role_has_permission(tenant.membership.role, Permission.COSTS_APPROVE):
        return None
    return tenant.user.id


@router.get("/expenses")
def list_expenses(
    tenant: CanSubmit,
    db: DbDep,
    expense_status: Annotated[ExpenseStatus | None, Query(alias="status")] = None,
    category: ExpenseCategory | None = None,
    vehicle_id: uuid.UUID | None = None,
    voided: bool = False,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 25,
) -> ExpenseList:
    rows, total = service.list_expenses(
        db,
        tenant.organisation.id,
        only_user=_only_user(tenant),
        status=expense_status,
        category=category,
        vehicle_id=vehicle_id,
        voided=voided,
        page=page,
        page_size=page_size,
    )
    return ExpenseList(
        items=[_expense_response(row) for row in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post("/expenses", status_code=status.HTTP_201_CREATED)
def create_expense(body: ExpenseCreate, tenant: CanSubmit, db: DbDep) -> ExpenseResponse:
    organisation_id = tenant.organisation.id
    expense = service.create_expense(
        db, organisation_id, tenant.user.id, _sees_all(tenant), _today(tenant), body.model_dump()
    )
    return _expense_response(service.get_expense_row(db, organisation_id, expense.id, None))


@router.get("/expenses/{expense_id}")
def get_expense(expense_id: uuid.UUID, tenant: CanSubmit, db: DbDep) -> ExpenseResponse:
    return _expense_response(
        service.get_expense_row(db, tenant.organisation.id, expense_id, _only_user(tenant))
    )


@router.patch("/expenses/{expense_id}")
def update_expense(
    expense_id: uuid.UUID, body: ExpenseUpdate, tenant: CanSubmit, db: DbDep
) -> ExpenseResponse:
    organisation_id = tenant.organisation.id
    service.update_expense(
        db,
        organisation_id,
        expense_id,
        tenant.user.id,
        _sees_all(tenant),
        _own_records_only(tenant),
        _today(tenant),
        body.model_dump(exclude_unset=True),
    )
    return _expense_response(service.get_expense_row(db, organisation_id, expense_id, None))


@router.post("/expenses/{expense_id}/approve")
def approve_expense(
    expense_id: uuid.UUID, body: ExpenseReview, tenant: CanApprove, db: DbDep
) -> ExpenseResponse:
    organisation_id = tenant.organisation.id
    service.review_expense(
        db,
        organisation_id,
        expense_id,
        tenant.user.id,
        tenant.membership.role,
        ExpenseStatus.APPROVED,
        body.note,
    )
    return _expense_response(service.get_expense_row(db, organisation_id, expense_id, None))


@router.post("/expenses/{expense_id}/reject")
def reject_expense(
    expense_id: uuid.UUID, body: ExpenseReview, tenant: CanApprove, db: DbDep
) -> ExpenseResponse:
    organisation_id = tenant.organisation.id
    service.review_expense(
        db,
        organisation_id,
        expense_id,
        tenant.user.id,
        tenant.membership.role,
        ExpenseStatus.REJECTED,
        body.note,
    )
    return _expense_response(service.get_expense_row(db, organisation_id, expense_id, None))


@router.post("/expenses/{expense_id}/void")
def void_expense(expense_id: uuid.UUID, tenant: CanApprove, db: DbDep) -> ExpenseResponse:
    organisation_id = tenant.organisation.id
    service.void_expense(db, organisation_id, expense_id, tenant.user.id)
    return _expense_response(service.get_expense_row(db, organisation_id, expense_id, None))


def _lines(totals: dict[str, dict[str, Decimal]]) -> list[CostLine]:
    return [
        CostLine(
            currency=currency,
            fuel=parts["fuel"],
            maintenance=parts["maintenance"],
            expenses=parts["expenses"],
            total=sum(parts.values(), Decimal(0)),
        )
        for currency, parts in sorted(totals.items())
    ]


@router.get("/summary")
def cost_summary(
    tenant: CanViewAll,
    db: DbDep,
    start: date | None = None,
    end: date | None = None,
    vehicle_id: uuid.UUID | None = None,
) -> CostSummary:
    begin, finish = _period(tenant, start, end)
    totals, categories, awaiting = service.summary(
        db, tenant.organisation.id, begin, finish, vehicle_id
    )
    return CostSummary(
        start=begin,
        end=finish,
        totals=_lines(totals),
        expense_categories=[
            CategoryTotal(category=category, currency=currency, amount=amount)
            for category, currency, amount in categories
        ],
        awaiting_approval=awaiting,
    )


@router.get("/vehicles/{vehicle_id}")
def vehicle_costs(
    vehicle_id: uuid.UUID,
    tenant: CanViewAll,
    db: DbDep,
    start: date | None = None,
    end: date | None = None,
) -> VehicleCosts:
    begin, finish = _period(tenant, start, end)
    organisation_id = tenant.organisation.id
    # Past vehicles keep their history, so this includes archived ones.
    get_vehicle(db, organisation_id, vehicle_id)
    distance, readings, totals, consumption = service.vehicle_costs(
        db, organisation_id, vehicle_id, begin, finish
    )
    costs = []
    for line in _lines(totals):
        per_km = (
            (line.total / distance).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
            if distance
            else None
        )
        costs.append(
            CurrencyCostPerKm(currency=line.currency, total=line.total, cost_per_km=per_km)
        )
    return VehicleCosts(
        start=begin,
        end=finish,
        distance_km=distance,
        readings=readings,
        costs=costs,
        consumption=[
            Consumption(unit=unit, per_100_km=rate, distance_km=km)
            for unit, rate, km in consumption
        ],
    )
