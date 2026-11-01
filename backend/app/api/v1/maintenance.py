import uuid
from datetime import date, datetime
from typing import Annotated, Any
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import DbDep, TenantContext, require_permission
from app.core.permissions import Permission
from app.models.enums import WorkOrderStatus, WorkOrderType
from app.schemas.maintenance import (
    CostTotal,
    MaintenanceSummary,
    ScheduleCreate,
    ScheduleList,
    ScheduleResponse,
    ScheduleState,
    ScheduleUpdate,
    VehicleOption,
    WorkOrderComplete,
    WorkOrderCreate,
    WorkOrderList,
    WorkOrderResponse,
    WorkOrderStart,
    WorkOrderUpdate,
)
from app.services import maintenance as service

router = APIRouter(prefix="/maintenance", tags=["maintenance"])

CanView = Annotated[TenantContext, Depends(require_permission(Permission.MAINTENANCE_VIEW))]
CanManage = Annotated[TenantContext, Depends(require_permission(Permission.MAINTENANCE_MANAGE))]


def _today(tenant: TenantContext) -> date:
    return datetime.now(ZoneInfo(tenant.organisation.timezone)).date()


def _schedule_response(row: Any) -> ScheduleResponse:
    schedule, vehicle, due, open_order = row
    return ScheduleResponse(
        id=schedule.id,
        vehicle_id=schedule.vehicle_id,
        vehicle_registration=vehicle.registration_number,
        vehicle_odometer_km=vehicle.odometer_km,
        odometer_recorded_at=vehicle.odometer_recorded_at,
        name=schedule.name,
        interval_days=schedule.interval_days,
        interval_km=schedule.interval_km,
        warn_days=schedule.warn_days,
        warn_km=schedule.warn_km,
        last_service_on=schedule.last_service_on,
        last_service_km=schedule.last_service_km,
        next_due_on=due.next_due_on,
        next_due_km=due.next_due_km,
        state=due.state,
        open_work_order_id=open_order,
        notes=schedule.notes,
        archived_at=schedule.archived_at,
    )


def _order_response(row: Any) -> WorkOrderResponse:
    order, registration = row
    costs = [cost for cost in (order.labour_cost, order.parts_cost) if cost is not None]
    return WorkOrderResponse(
        id=order.id,
        vehicle_id=order.vehicle_id,
        vehicle_registration=registration,
        schedule_id=order.schedule_id,
        work_type=order.work_type,
        status=order.status,
        title=order.title,
        description=order.description,
        scheduled_for=order.scheduled_for,
        provider_name=order.provider_name,
        provider_phone=order.provider_phone,
        provider_email=order.provider_email,
        started_at=order.started_at,
        took_off_road=order.took_off_road,
        completed_on=order.completed_on,
        odometer_km=order.odometer_km,
        labour_cost=order.labour_cost,
        parts_cost=order.parts_cost,
        total_cost=sum(costs) if costs else None,
        currency=order.currency,
        completion_notes=order.completion_notes,
        created_at=order.created_at,
    )


@router.get("/summary")
def maintenance_summary(tenant: CanView, db: DbDep) -> MaintenanceSummary:
    overdue, due_soon, unstarted, underway, costs = service.summary(
        db, tenant.organisation.id, _today(tenant)
    )
    return MaintenanceSummary(
        overdue=overdue,
        due_soon=due_soon,
        open_work_orders=unstarted,
        in_progress_work_orders=underway,
        recent_costs=[CostTotal(currency=code, amount=amount) for code, amount in costs],
    )


@router.get("/vehicle-options")
def vehicle_options(tenant: CanManage, db: DbDep) -> list[VehicleOption]:
    return [
        VehicleOption(
            id=item.id,
            registration_number=item.registration_number,
            make=item.make,
            model=item.model,
            odometer_km=item.odometer_km,
        )
        for item in service.vehicle_options(db, tenant.organisation.id)
    ]


@router.get("/schedules")
def list_schedules(
    tenant: CanView,
    db: DbDep,
    vehicle_id: uuid.UUID | None = None,
    state: ScheduleState | None = None,
    archived: bool = False,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 25,
) -> ScheduleList:
    rows = service.list_schedules(
        db,
        tenant.organisation.id,
        _today(tenant),
        vehicle_id=vehicle_id,
        state=state,
        archived=archived,
    )
    start = (page - 1) * page_size
    return ScheduleList(
        items=[_schedule_response(row) for row in rows[start : start + page_size]],
        total=len(rows),
        page=page,
        page_size=page_size,
    )


@router.post("/schedules", status_code=status.HTTP_201_CREATED)
def create_schedule(body: ScheduleCreate, tenant: CanManage, db: DbDep) -> ScheduleResponse:
    today = _today(tenant)
    schedule = service.create_schedule(
        db, tenant.organisation.id, tenant.user.id, today, body.model_dump()
    )
    return _schedule_response(
        service.get_schedule_row(db, tenant.organisation.id, schedule.id, today)
    )


@router.get("/schedules/{schedule_id}")
def get_schedule(schedule_id: uuid.UUID, tenant: CanView, db: DbDep) -> ScheduleResponse:
    return _schedule_response(
        service.get_schedule_row(db, tenant.organisation.id, schedule_id, _today(tenant))
    )


@router.patch("/schedules/{schedule_id}")
def update_schedule(
    schedule_id: uuid.UUID, body: ScheduleUpdate, tenant: CanManage, db: DbDep
) -> ScheduleResponse:
    today = _today(tenant)
    service.update_schedule(
        db,
        tenant.organisation.id,
        schedule_id,
        tenant.user.id,
        today,
        body.model_dump(exclude_unset=True),
    )
    return _schedule_response(
        service.get_schedule_row(db, tenant.organisation.id, schedule_id, today)
    )


@router.post("/schedules/{schedule_id}/archive")
def archive_schedule(schedule_id: uuid.UUID, tenant: CanManage, db: DbDep) -> ScheduleResponse:
    service.archive_schedule(db, tenant.organisation.id, schedule_id, tenant.user.id)
    return _schedule_response(
        service.get_schedule_row(db, tenant.organisation.id, schedule_id, _today(tenant))
    )


@router.get("/work-orders")
def list_work_orders(
    tenant: CanView,
    db: DbDep,
    order_status: Annotated[list[WorkOrderStatus] | None, Query(alias="status")] = None,
    work_type: WorkOrderType | None = None,
    vehicle_id: uuid.UUID | None = None,
    search: Annotated[str | None, Query(max_length=100)] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 25,
) -> WorkOrderList:
    rows, total = service.list_work_orders(
        db,
        tenant.organisation.id,
        statuses=order_status or [],
        work_type=work_type,
        vehicle_id=vehicle_id,
        search=search,
        page=page,
        page_size=page_size,
    )
    return WorkOrderList(
        items=[_order_response(row) for row in rows], total=total, page=page, page_size=page_size
    )


@router.post("/work-orders", status_code=status.HTTP_201_CREATED)
def create_work_order(body: WorkOrderCreate, tenant: CanManage, db: DbDep) -> WorkOrderResponse:
    organisation = tenant.organisation
    order = service.create_work_order(
        db, organisation.id, tenant.user.id, organisation.default_currency, body.model_dump()
    )
    return _order_response(service.get_work_order_row(db, organisation.id, order.id))


@router.get("/work-orders/{order_id}")
def get_work_order(order_id: uuid.UUID, tenant: CanView, db: DbDep) -> WorkOrderResponse:
    return _order_response(service.get_work_order_row(db, tenant.organisation.id, order_id))


@router.patch("/work-orders/{order_id}")
def update_work_order(
    order_id: uuid.UUID, body: WorkOrderUpdate, tenant: CanManage, db: DbDep
) -> WorkOrderResponse:
    organisation_id = tenant.organisation.id
    service.update_work_order(
        db, organisation_id, order_id, tenant.user.id, body.model_dump(exclude_unset=True)
    )
    return _order_response(service.get_work_order_row(db, organisation_id, order_id))


@router.post("/work-orders/{order_id}/start")
def start_work_order(
    order_id: uuid.UUID, body: WorkOrderStart, tenant: CanManage, db: DbDep
) -> WorkOrderResponse:
    organisation_id = tenant.organisation.id
    service.start_work_order(db, organisation_id, order_id, tenant.user.id, body.take_off_road)
    return _order_response(service.get_work_order_row(db, organisation_id, order_id))


@router.post("/work-orders/{order_id}/complete")
def complete_work_order(
    order_id: uuid.UUID, body: WorkOrderComplete, tenant: CanManage, db: DbDep
) -> WorkOrderResponse:
    organisation_id = tenant.organisation.id
    service.complete_work_order(
        db, organisation_id, order_id, tenant.user.id, _today(tenant), body.model_dump()
    )
    return _order_response(service.get_work_order_row(db, organisation_id, order_id))


@router.post("/work-orders/{order_id}/cancel")
def cancel_work_order(order_id: uuid.UUID, tenant: CanManage, db: DbDep) -> WorkOrderResponse:
    organisation_id = tenant.organisation.id
    service.cancel_work_order(db, organisation_id, order_id, tenant.user.id)
    return _order_response(service.get_work_order_row(db, organisation_id, order_id))
