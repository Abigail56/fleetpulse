import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import CheckConstraint, ForeignKeyConstraint, Index, PrimaryKeyConstraint, func
from sqlmodel import Field, SQLModel

from app.models.base import (
    TIMESTAMPTZ,
    TOKEN_HASH_LENGTH,
    TenantOwned,
    UUIDPrimaryKey,
    enum_type,
    geography_point,
    utcnow,
)
from app.models.enums import GpsSignalStatus


class LocationFields(TenantOwned, SQLModel):
    vehicle_id: uuid.UUID
    device_id: uuid.UUID | None = Field(default=None)
    recorded_at: datetime = Field(sa_type=TIMESTAMPTZ, nullable=False)
    received_at: datetime = Field(
        default_factory=utcnow,
        sa_type=TIMESTAMPTZ,
        nullable=False,
        sa_column_kwargs={"server_default": func.now()},
    )
    location: Any = Field(sa_type=geography_point(), nullable=False)
    # Optional because not every provider reports them; missing is never stored as zero.
    speed_kph: Decimal | None = Field(default=None, max_digits=6, decimal_places=2)
    heading_degrees: Decimal | None = Field(default=None, max_digits=5, decimal_places=2)
    ignition_on: bool | None = Field(default=None)
    signal_status: GpsSignalStatus = Field(
        default=GpsSignalStatus.UNKNOWN, sa_type=enum_type(GpsSignalStatus, "signal_status")
    )
    is_simulated: bool = Field(default=False)


class VehicleLocation(LocationFields, table=True):
    """Telemetry history, range-partitioned by month on recorded_at.

    The primary key doubles as the idempotency key, so a provider resending a position cannot
    create a duplicate. See docs/adr/0002-database-architecture.md for partition management.
    """

    __tablename__ = "vehicle_locations"
    __table_args__ = (
        PrimaryKeyConstraint("organisation_id", "vehicle_id", "recorded_at"),
        ForeignKeyConstraint(
            ["organisation_id", "vehicle_id"], ["vehicles.organisation_id", "vehicles.id"]
        ),
        ForeignKeyConstraint(
            ["organisation_id", "device_id"],
            ["tracking_devices.organisation_id", "tracking_devices.id"],
        ),
        Index("ix_vehicle_locations_location", "location", postgresql_using="gist"),
        CheckConstraint("speed_kph IS NULL OR speed_kph >= 0", name="speed_non_negative"),
        CheckConstraint(
            "heading_degrees IS NULL OR (heading_degrees >= 0 AND heading_degrees < 360)",
            name="heading_range",
        ),
        {"postgresql_partition_by": "RANGE (recorded_at)"},
    )


class VehicleLatestLocation(LocationFields, table=True):
    """One row per vehicle, kept current during ingestion, so the map avoids scanning history."""

    __tablename__ = "vehicle_latest_locations"
    __table_args__ = (
        PrimaryKeyConstraint("vehicle_id"),
        ForeignKeyConstraint(
            ["organisation_id", "vehicle_id"], ["vehicles.organisation_id", "vehicles.id"]
        ),
        ForeignKeyConstraint(
            ["organisation_id", "device_id"],
            ["tracking_devices.organisation_id", "tracking_devices.id"],
        ),
        Index("ix_vehicle_latest_locations_organisation_id", "organisation_id"),
        Index("ix_vehicle_latest_locations_location", "location", postgresql_using="gist"),
    )


class GpsIntegration(UUIDPrimaryKey, TenantOwned, table=True):
    """An organisation's connection to a tracking feed. Only a hash of its key is stored."""

    __tablename__ = "gps_integrations"

    name: str = Field(max_length=100)
    provider: str = Field(max_length=64)
    key_hash: str = Field(max_length=TOKEN_HASH_LENGTH, unique=True)
    key_prefix: str = Field(max_length=16)
    created_by_user_id: uuid.UUID = Field(foreign_key="users.id")
    created_at: datetime = Field(default_factory=utcnow, sa_type=TIMESTAMPTZ, nullable=False)
    last_used_at: datetime | None = Field(default=None, sa_type=TIMESTAMPTZ)
    revoked_at: datetime | None = Field(default=None, sa_type=TIMESTAMPTZ)
