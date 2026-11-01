import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    CheckConstraint,
    Column,
    Computed,
    ForeignKeyConstraint,
    Index,
    String,
    UniqueConstraint,
    text,
)
from sqlmodel import Field

from app.models.base import TIMESTAMPTZ, TenantOwned, Timestamps, UUIDPrimaryKey, enum_type
from app.models.enums import (
    FuelType,
    OwnershipType,
    TrackingDeviceStatus,
    VehicleStatus,
    VehicleType,
)


class Vehicle(UUIDPrimaryKey, TenantOwned, Timestamps, table=True):
    __tablename__ = "vehicles"
    __table_args__ = (
        UniqueConstraint("organisation_id", "id"),
        # Archiving frees a registration, so a vehicle that is sold and later re-acquired can
        # be added again. "AB-123 CD" and "ab123cd" count as the same registration.
        Index(
            "uq_vehicles_organisation_id_registration_active",
            "organisation_id",
            "registration_number_normalized",
            unique=True,
            postgresql_where=text("archived_at IS NULL"),
        ),
        Index(
            "uq_vehicles_organisation_id_vin_active",
            "organisation_id",
            "vin",
            unique=True,
            postgresql_where=text("vin IS NOT NULL AND archived_at IS NULL"),
        ),
        Index("ix_vehicles_organisation_id_status", "organisation_id", "status"),
        CheckConstraint("odometer_km >= 0", name="odometer_non_negative"),
        CheckConstraint("year BETWEEN 1900 AND 2100", name="year_range"),
    )

    registration_number: str = Field(max_length=32)
    registration_number_normalized: str | None = Field(
        default=None,
        sa_column=Column(
            String(32),
            Computed(
                "upper(regexp_replace(registration_number, '[^a-zA-Z0-9]', '', 'g'))",
                persisted=True,
            ),
            nullable=False,
        ),
    )
    make: str = Field(max_length=100)
    model: str = Field(max_length=100)
    year: int | None = Field(default=None)
    vehicle_type: VehicleType = Field(sa_type=enum_type(VehicleType, "vehicle_type"))
    vin: str | None = Field(default=None, max_length=32)
    fuel_type: FuelType = Field(sa_type=enum_type(FuelType, "fuel_type"))
    # Stored in km; Organisation.distance_unit controls display.
    odometer_km: Decimal = Field(default=Decimal("0"), max_digits=12, decimal_places=1)
    # It's typed in rather than measured, so distance-based reminders show how old it is.
    odometer_recorded_at: datetime | None = Field(default=None, sa_type=TIMESTAMPTZ)
    ownership_type: OwnershipType = Field(
        default=OwnershipType.OWNED, sa_type=enum_type(OwnershipType, "ownership_type")
    )
    owner_name: str | None = Field(default=None, max_length=200)
    status: VehicleStatus = Field(
        default=VehicleStatus.IDLE, sa_type=enum_type(VehicleStatus, "status")
    )
    archived_at: datetime | None = Field(default=None, sa_type=TIMESTAMPTZ)


class TrackingDevice(UUIDPrimaryKey, TenantOwned, Timestamps, table=True):
    __tablename__ = "tracking_devices"
    __table_args__ = (
        UniqueConstraint("organisation_id", "id"),
        # Per organisation: if it were global, one customer could block another by registering
        # their device ID first. Ingestion keys belong to one organisation, so this is enough.
        UniqueConstraint("organisation_id", "provider", "external_device_id"),
        ForeignKeyConstraint(
            ["organisation_id", "vehicle_id"], ["vehicles.organisation_id", "vehicles.id"]
        ),
        Index(
            "uq_tracking_devices_vehicle_id_active",
            "vehicle_id",
            unique=True,
            postgresql_where=text("vehicle_id IS NOT NULL AND status = 'active'"),
        ),
    )

    vehicle_id: uuid.UUID | None = Field(default=None)
    provider: str = Field(max_length=64)
    external_device_id: str = Field(max_length=128)
    status: TrackingDeviceStatus = Field(
        default=TrackingDeviceStatus.ACTIVE, sa_type=enum_type(TrackingDeviceStatus, "status")
    )
    # Simulated devices are labelled at the source so their data can never pass as real.
    is_simulated: bool = Field(default=False)
    last_seen_at: datetime | None = Field(default=None, sa_type=TIMESTAMPTZ)
    # Positions recorded before this belonged to the previous vehicle, so they're refused.
    reassigned_at: datetime | None = Field(default=None, sa_type=TIMESTAMPTZ)
