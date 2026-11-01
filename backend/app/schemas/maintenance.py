import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal, Self

from pydantic import BaseModel, EmailStr, Field, StringConstraints, model_validator

from app.models.enums import WorkOrderStatus, WorkOrderType
from app.schemas.auth import RequestModel
from app.schemas.drivers import Phone

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)]
LongText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=4000)]
Kilometres = Annotated[Decimal, Field(ge=0, le=99999999, decimal_places=1)]
IntervalKm = Annotated[Decimal, Field(gt=0, le=9999999, decimal_places=1)]
IntervalDays = Annotated[int, Field(gt=0, le=3650)]
Money = Annotated[Decimal, Field(ge=0, le=9999999999, decimal_places=2)]
ScheduleState = Literal["ok", "due_soon", "overdue"]


class ScheduleCreate(RequestModel):
    vehicle_id: uuid.UUID
    name: Name
    interval_days: IntervalDays | None = None
    interval_km: IntervalKm | None = None
    warn_days: Annotated[int, Field(ge=0, le=365)] = 14
    warn_km: Annotated[Decimal, Field(ge=0, le=999999, decimal_places=1)] = Decimal("500")
    # When it was last done. Default to today and the vehicle's current reading.
    last_service_on: date | None = None
    last_service_km: Kilometres | None = None
    notes: Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)] | None = None

    @model_validator(mode="after")
    def has_an_interval(self) -> Self:
        if self.interval_days is None and self.interval_km is None:
            raise ValueError("set an interval in days, kilometres or both")
        return self


class ScheduleUpdate(RequestModel):
    name: Name | None = None
    interval_days: IntervalDays | None = None
    interval_km: IntervalKm | None = None
    warn_days: Annotated[int, Field(ge=0, le=365)] | None = None
    warn_km: Annotated[Decimal, Field(ge=0, le=999999, decimal_places=1)] | None = None
    last_service_on: date | None = None
    last_service_km: Kilometres | None = None
    notes: Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)] | None = None


class ScheduleResponse(BaseModel):
    id: uuid.UUID
    vehicle_id: uuid.UUID
    vehicle_registration: str
    vehicle_odometer_km: Decimal
    odometer_recorded_at: datetime | None
    name: str
    interval_days: int | None
    interval_km: Decimal | None
    warn_days: int
    warn_km: Decimal
    last_service_on: date
    last_service_km: Decimal
    next_due_on: date | None
    next_due_km: Decimal | None
    state: ScheduleState
    open_work_order_id: uuid.UUID | None
    notes: str | None
    archived_at: datetime | None


class ScheduleList(BaseModel):
    items: list[ScheduleResponse]
    total: int
    page: int
    page_size: int


class WorkOrderCreate(RequestModel):
    vehicle_id: uuid.UUID
    schedule_id: uuid.UUID | None = None
    work_type: WorkOrderType
    title: Title
    description: LongText | None = None
    scheduled_for: date | None = None
    provider_name: Title | None = None
    provider_phone: Phone | None = None
    provider_email: EmailStr | None = None


class WorkOrderUpdate(RequestModel):
    title: Title | None = None
    description: LongText | None = None
    scheduled_for: date | None = None
    provider_name: Title | None = None
    provider_phone: Phone | None = None
    provider_email: EmailStr | None = None


class WorkOrderStart(RequestModel):
    take_off_road: bool = True


class WorkOrderComplete(RequestModel):
    completed_on: date | None = None
    odometer_km: Kilometres | None = None
    labour_cost: Money | None = None
    parts_cost: Money | None = None
    completion_notes: LongText | None = None


class WorkOrderResponse(BaseModel):
    id: uuid.UUID
    vehicle_id: uuid.UUID
    vehicle_registration: str
    schedule_id: uuid.UUID | None
    work_type: WorkOrderType
    status: WorkOrderStatus
    title: str
    description: str | None
    scheduled_for: date | None
    provider_name: str | None
    provider_phone: str | None
    provider_email: str | None
    started_at: datetime | None
    took_off_road: bool
    completed_on: date | None
    odometer_km: Decimal | None
    labour_cost: Decimal | None
    parts_cost: Decimal | None
    total_cost: Decimal | None
    currency: str
    completion_notes: str | None
    created_at: datetime


class WorkOrderList(BaseModel):
    items: list[WorkOrderResponse]
    total: int
    page: int
    page_size: int


class CostTotal(BaseModel):
    currency: str
    amount: Decimal


class MaintenanceSummary(BaseModel):
    overdue: int
    due_soon: int
    open_work_orders: int
    in_progress_work_orders: int
    # Completed in the last 30 days. Work with no recorded cost adds nothing here.
    recent_costs: list[CostTotal]


class VehicleOption(BaseModel):
    id: uuid.UUID
    registration_number: str
    make: str
    model: str
    odometer_km: Decimal
