import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import CheckConstraint, ForeignKeyConstraint, Index, UniqueConstraint, text
from sqlmodel import Field

from app.models.base import TIMESTAMPTZ, TenantOwned, Timestamps, UUIDPrimaryKey, enum_type
from app.models.enums import VehicleStatus, WorkOrderStatus, WorkOrderType


class MaintenanceSchedule(UUIDPrimaryKey, TenantOwned, Timestamps, table=True):
    """Recurring preventive work. Comes due by date, by odometer, or whichever is first."""

    __tablename__ = "maintenance_schedules"
    __table_args__ = (
        UniqueConstraint("organisation_id", "id"),
        ForeignKeyConstraint(
            ["organisation_id", "vehicle_id"], ["vehicles.organisation_id", "vehicles.id"]
        ),
        Index("ix_maintenance_schedules_vehicle_id", "vehicle_id"),
        CheckConstraint(
            "interval_days IS NOT NULL OR interval_km IS NOT NULL", name="has_an_interval"
        ),
        CheckConstraint("interval_days IS NULL OR interval_days > 0", name="days_positive"),
        CheckConstraint("interval_km IS NULL OR interval_km > 0", name="km_positive"),
        CheckConstraint("warn_days >= 0 AND warn_km >= 0", name="warnings_not_negative"),
    )

    vehicle_id: uuid.UUID
    name: str = Field(max_length=120)
    interval_days: int | None = Field(default=None)
    interval_km: Decimal | None = Field(default=None, max_digits=10, decimal_places=1)
    warn_days: int = Field(default=14)
    warn_km: Decimal = Field(default=Decimal("500"), max_digits=10, decimal_places=1)
    last_service_on: date
    last_service_km: Decimal = Field(max_digits=12, decimal_places=1)
    notes: str | None = Field(default=None, max_length=2000)
    created_by_user_id: uuid.UUID | None = Field(default=None, foreign_key="users.id")
    archived_at: datetime | None = Field(default=None, sa_type=TIMESTAMPTZ)


class WorkOrder(UUIDPrimaryKey, TenantOwned, Timestamps, table=True):
    """A piece of work on a vehicle. Completed ones are its service history."""

    __tablename__ = "work_orders"
    __table_args__ = (
        UniqueConstraint("organisation_id", "id"),
        ForeignKeyConstraint(
            ["organisation_id", "vehicle_id"], ["vehicles.organisation_id", "vehicles.id"]
        ),
        ForeignKeyConstraint(
            ["organisation_id", "schedule_id"],
            ["maintenance_schedules.organisation_id", "maintenance_schedules.id"],
        ),
        Index("ix_work_orders_organisation_id_status", "organisation_id", "status"),
        Index("ix_work_orders_vehicle_id_completed_on", "vehicle_id", "completed_on"),
        # One piece of unfinished work per schedule, so a reminder can't be booked twice.
        Index(
            "uq_work_orders_schedule_id_unfinished",
            "schedule_id",
            unique=True,
            postgresql_where=text("status IN ('open', 'in_progress')"),
        ),
        CheckConstraint(
            "status <> 'completed' OR completed_on IS NOT NULL", name="completed_has_date"
        ),
        CheckConstraint("labour_cost IS NULL OR labour_cost >= 0", name="labour_cost_not_negative"),
        CheckConstraint("parts_cost IS NULL OR parts_cost >= 0", name="parts_cost_not_negative"),
        CheckConstraint("currency ~ '^[A-Z]{3}$'", name="currency_iso4217"),
    )

    vehicle_id: uuid.UUID
    schedule_id: uuid.UUID | None = Field(default=None)
    work_type: WorkOrderType = Field(sa_type=enum_type(WorkOrderType, "work_type"))
    status: WorkOrderStatus = Field(
        default=WorkOrderStatus.OPEN, sa_type=enum_type(WorkOrderStatus, "status")
    )
    title: str = Field(max_length=160)
    description: str | None = Field(default=None, max_length=4000)
    scheduled_for: date | None = Field(default=None)
    provider_name: str | None = Field(default=None, max_length=160)
    provider_phone: str | None = Field(default=None, max_length=32)
    provider_email: str | None = Field(default=None, max_length=320)
    started_at: datetime | None = Field(default=None, sa_type=TIMESTAMPTZ)
    # What the vehicle's status was before this work took it off the road.
    took_off_road: bool = Field(default=False)
    status_before: VehicleStatus | None = Field(
        default=None, sa_type=enum_type(VehicleStatus, "status_before")
    )
    completed_on: date | None = Field(default=None)
    odometer_km: Decimal | None = Field(default=None, max_digits=12, decimal_places=1)
    # Null means not recorded, which isn't the same as free.
    labour_cost: Decimal | None = Field(default=None, max_digits=12, decimal_places=2)
    parts_cost: Decimal | None = Field(default=None, max_digits=12, decimal_places=2)
    currency: str = Field(max_length=3)
    completion_notes: str | None = Field(default=None, max_length=4000)
    created_by_user_id: uuid.UUID | None = Field(default=None, foreign_key="users.id")
