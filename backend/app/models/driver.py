import uuid
from datetime import date, datetime

from sqlalchemy import CheckConstraint, ForeignKeyConstraint, Index, UniqueConstraint, text
from sqlmodel import Field

from app.models.base import TIMESTAMPTZ, TenantOwned, Timestamps, UUIDPrimaryKey, enum_type, utcnow
from app.models.enums import DriverAvailability, DriverStatus


class Driver(UUIDPrimaryKey, TenantOwned, Timestamps, table=True):
    __tablename__ = "drivers"
    __table_args__ = (
        UniqueConstraint("organisation_id", "id"),
        Index(
            "uq_drivers_organisation_id_licence_active",
            "organisation_id",
            "licence_number",
            unique=True,
            postgresql_where=text("archived_at IS NULL"),
        ),
        Index("ix_drivers_organisation_id_status", "organisation_id", "status"),
        Index(
            "ix_drivers_organisation_id_licence_expires_on", "organisation_id", "licence_expires_on"
        ),
        # A login is optional: many drivers never use the app.
        Index(
            "uq_drivers_organisation_id_user_id",
            "organisation_id",
            "user_id",
            unique=True,
            postgresql_where=text("user_id IS NOT NULL"),
        ),
    )

    user_id: uuid.UUID | None = Field(default=None, foreign_key="users.id")
    first_name: str = Field(max_length=100)
    last_name: str = Field(max_length=100)
    phone: str | None = Field(default=None, max_length=32)
    email: str | None = Field(default=None, max_length=320)
    licence_number: str = Field(max_length=64)
    licence_class: str | None = Field(default=None, max_length=32)
    licence_country_code: str | None = Field(default=None, max_length=2)
    licence_expires_on: date | None = Field(default=None)
    status: DriverStatus = Field(
        default=DriverStatus.ACTIVE, sa_type=enum_type(DriverStatus, "status")
    )
    availability: DriverAvailability = Field(
        default=DriverAvailability.AVAILABLE,
        sa_type=enum_type(DriverAvailability, "availability"),
    )
    archived_at: datetime | None = Field(default=None, sa_type=TIMESTAMPTZ)


class VehicleAssignment(UUIDPrimaryKey, TenantOwned, table=True):
    """Assignment history. The current driver of a vehicle is the row with ended_at IS NULL."""

    __tablename__ = "vehicle_assignments"
    __table_args__ = (
        ForeignKeyConstraint(
            ["organisation_id", "vehicle_id"], ["vehicles.organisation_id", "vehicles.id"]
        ),
        ForeignKeyConstraint(
            ["organisation_id", "driver_id"], ["drivers.organisation_id", "drivers.id"]
        ),
        Index(
            "uq_vehicle_assignments_vehicle_id_current",
            "vehicle_id",
            unique=True,
            postgresql_where=text("ended_at IS NULL"),
        ),
        Index(
            "uq_vehicle_assignments_driver_id_current",
            "driver_id",
            unique=True,
            postgresql_where=text("ended_at IS NULL"),
        ),
        Index("ix_vehicle_assignments_vehicle_id_started_at", "vehicle_id", "started_at"),
        Index("ix_vehicle_assignments_driver_id_started_at", "driver_id", "started_at"),
        CheckConstraint("ended_at IS NULL OR ended_at > started_at", name="ended_after_started"),
    )

    vehicle_id: uuid.UUID
    driver_id: uuid.UUID
    started_at: datetime = Field(default_factory=utcnow, sa_type=TIMESTAMPTZ, nullable=False)
    ended_at: datetime | None = Field(default=None, sa_type=TIMESTAMPTZ)
