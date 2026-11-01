import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import CheckConstraint, ForeignKeyConstraint, Index, text
from sqlmodel import Field

from app.models.base import (
    TIMESTAMPTZ,
    TenantOwned,
    Timestamps,
    UUIDPrimaryKey,
    enum_type,
    geography_point,
)
from app.models.enums import TripStatus


class Trip(UUIDPrimaryKey, TenantOwned, Timestamps, table=True):
    __tablename__ = "trips"
    __table_args__ = (
        ForeignKeyConstraint(
            ["organisation_id", "vehicle_id"], ["vehicles.organisation_id", "vehicles.id"]
        ),
        ForeignKeyConstraint(
            ["organisation_id", "driver_id"], ["drivers.organisation_id", "drivers.id"]
        ),
        Index("ix_trips_organisation_id_status", "organisation_id", "status"),
        Index("ix_trips_vehicle_id_planned_departure_at", "vehicle_id", "planned_departure_at"),
        Index("ix_trips_driver_id_planned_departure_at", "driver_id", "planned_departure_at"),
        Index(
            "uq_trips_vehicle_id_in_progress",
            "vehicle_id",
            unique=True,
            postgresql_where=text("status = 'in_progress'"),
        ),
        Index(
            "uq_trips_driver_id_in_progress",
            "driver_id",
            unique=True,
            postgresql_where=text("status = 'in_progress'"),
        ),
        # Allowed status transitions live in the service layer (Phase 12). These checks catch
        # states that are invalid regardless of how a row got there.
        CheckConstraint(
            "status NOT IN ('dispatched', 'in_progress', 'completed') "
            "OR (vehicle_id IS NOT NULL AND driver_id IS NOT NULL)",
            name="assigned_when_underway",
        ),
        CheckConstraint(
            "status NOT IN ('in_progress', 'completed') OR actual_departure_at IS NOT NULL",
            name="departed_when_underway",
        ),
        CheckConstraint(
            "status <> 'completed' OR actual_arrival_at IS NOT NULL",
            name="arrived_when_completed",
        ),
        CheckConstraint(
            "actual_arrival_at IS NULL OR actual_arrival_at >= actual_departure_at",
            name="arrival_after_departure",
        ),
        CheckConstraint(
            "estimated_arrival_at IS NULL OR estimated_arrival_at >= planned_departure_at",
            name="estimate_after_planned_departure",
        ),
        CheckConstraint("distance_km IS NULL OR distance_km >= 0", name="distance_non_negative"),
        CheckConstraint(
            "distance_source IS NULL OR distance_source IN ('gps', 'simulated', 'manual')",
            name="distance_source_known",
        ),
    )

    vehicle_id: uuid.UUID | None = Field(default=None)
    driver_id: uuid.UUID | None = Field(default=None)
    created_by_user_id: uuid.UUID | None = Field(default=None, foreign_key="users.id")
    status: TripStatus = Field(default=TripStatus.DRAFT, sa_type=enum_type(TripStatus, "status"))
    origin_name: str = Field(max_length=255)
    origin_location: Any = Field(default=None, sa_type=geography_point(), nullable=True)
    destination_name: str = Field(max_length=255)
    destination_location: Any = Field(default=None, sa_type=geography_point(), nullable=True)
    planned_departure_at: datetime | None = Field(default=None, sa_type=TIMESTAMPTZ)
    estimated_arrival_at: datetime | None = Field(default=None, sa_type=TIMESTAMPTZ)
    actual_departure_at: datetime | None = Field(default=None, sa_type=TIMESTAMPTZ)
    actual_arrival_at: datetime | None = Field(default=None, sa_type=TIMESTAMPTZ)
    distance_km: Decimal | None = Field(default=None, max_digits=10, decimal_places=2)
    # Where distance_km came from, so simulated or typed-in figures can't pass for measured ones.
    distance_source: str | None = Field(default=None, max_length=16)
    dispatch_notes: str | None = Field(default=None, max_length=4000)
