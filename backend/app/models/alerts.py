import uuid
from datetime import datetime
from typing import Any

from geoalchemy2 import Geography
from sqlalchemy import CheckConstraint, ForeignKeyConstraint, Index, UniqueConstraint, text
from sqlmodel import Field

from app.models.base import TIMESTAMPTZ, TenantOwned, Timestamps, UUIDPrimaryKey, enum_type, utcnow
from app.models.enums import AlertSeverity, AlertType, GeofenceEventType, GeofenceKind


class Geofence(UUIDPrimaryKey, TenantOwned, Timestamps, table=True):
    __tablename__ = "geofences"
    __table_args__ = (
        UniqueConstraint("organisation_id", "id"),
        Index(
            "uq_geofences_organisation_id_name_active",
            "organisation_id",
            "name",
            unique=True,
            postgresql_where=text("archived_at IS NULL"),
        ),
        Index("ix_geofences_area", "area", postgresql_using="gist"),
        CheckConstraint(
            "kind <> 'circle' OR (center_latitude IS NOT NULL AND center_longitude IS NOT NULL "
            "AND radius_m IS NOT NULL)",
            name="circle_has_centre_and_radius",
        ),
    )

    name: str = Field(max_length=100)
    kind: GeofenceKind = Field(sa_type=enum_type(GeofenceKind, "kind"))
    # Circles are stored as polygons too, so one query covers both kinds.
    area: Any = Field(
        sa_type=Geography(geometry_type="POLYGON", srid=4326, spatial_index=False), nullable=False
    )
    center_latitude: float | None = Field(default=None)
    center_longitude: float | None = Field(default=None)
    radius_m: float | None = Field(default=None)
    is_restricted: bool = Field(default=False)
    alert_on_entry: bool = Field(default=True)
    alert_on_exit: bool = Field(default=False)
    created_by_user_id: uuid.UUID | None = Field(default=None, foreign_key="users.id")
    archived_at: datetime | None = Field(default=None, sa_type=TIMESTAMPTZ)


class GeofenceOccupancy(UUIDPrimaryKey, TenantOwned, table=True):
    """A vehicle currently inside a geofence. Having no row means it's outside."""

    __tablename__ = "geofence_occupancies"
    __table_args__ = (
        UniqueConstraint("organisation_id", "geofence_id", "vehicle_id"),
        ForeignKeyConstraint(
            ["organisation_id", "geofence_id"], ["geofences.organisation_id", "geofences.id"]
        ),
        ForeignKeyConstraint(
            ["organisation_id", "vehicle_id"], ["vehicles.organisation_id", "vehicles.id"]
        ),
    )

    geofence_id: uuid.UUID
    vehicle_id: uuid.UUID
    entered_at: datetime = Field(sa_type=TIMESTAMPTZ, nullable=False)


class GeofenceEvent(UUIDPrimaryKey, TenantOwned, table=True):
    __tablename__ = "geofence_events"
    __table_args__ = (
        ForeignKeyConstraint(
            ["organisation_id", "geofence_id"], ["geofences.organisation_id", "geofences.id"]
        ),
        ForeignKeyConstraint(
            ["organisation_id", "vehicle_id"], ["vehicles.organisation_id", "vehicles.id"]
        ),
        Index("ix_geofence_events_geofence_id_occurred_at", "geofence_id", "occurred_at"),
        Index("ix_geofence_events_vehicle_id_occurred_at", "vehicle_id", "occurred_at"),
    )

    geofence_id: uuid.UUID
    vehicle_id: uuid.UUID
    event_type: GeofenceEventType = Field(sa_type=enum_type(GeofenceEventType, "event_type"))
    occurred_at: datetime = Field(sa_type=TIMESTAMPTZ, nullable=False)
    latitude: float
    longitude: float
    is_simulated: bool = Field(default=False)


class Alert(UUIDPrimaryKey, TenantOwned, table=True):
    __tablename__ = "alerts"
    __table_args__ = (
        UniqueConstraint("organisation_id", "id"),
        Index(
            "ix_alerts_awaiting_notification",
            "organisation_id",
            "created_at",
            postgresql_where=text("notified_at IS NULL"),
        ),
        ForeignKeyConstraint(
            ["organisation_id", "vehicle_id"], ["vehicles.organisation_id", "vehicles.id"]
        ),
        ForeignKeyConstraint(
            ["organisation_id", "driver_id"], ["drivers.organisation_id", "drivers.id"]
        ),
        ForeignKeyConstraint(
            ["organisation_id", "geofence_id"], ["geofences.organisation_id", "geofences.id"]
        ),
        # A condition that's still going on raises one alert, not one per position.
        Index(
            "uq_alerts_organisation_id_dedupe_key_unresolved",
            "organisation_id",
            "dedupe_key",
            unique=True,
            postgresql_where=text("resolved_at IS NULL AND dedupe_key IS NOT NULL"),
        ),
        Index("ix_alerts_organisation_id_occurred_at", "organisation_id", "occurred_at"),
        Index(
            "ix_alerts_organisation_id_unresolved",
            "organisation_id",
            "alert_type",
            postgresql_where=text("resolved_at IS NULL"),
        ),
    )

    alert_type: AlertType = Field(sa_type=enum_type(AlertType, "alert_type"))
    severity: AlertSeverity = Field(sa_type=enum_type(AlertSeverity, "severity"))
    title: str = Field(max_length=255)
    message: str = Field(max_length=1000)
    occurred_at: datetime = Field(sa_type=TIMESTAMPTZ, nullable=False)
    vehicle_id: uuid.UUID | None = Field(default=None)
    driver_id: uuid.UUID | None = Field(default=None)
    geofence_id: uuid.UUID | None = Field(default=None)
    is_simulated: bool = Field(default=False)
    dedupe_key: str | None = Field(default=None, max_length=128)
    acknowledged_at: datetime | None = Field(default=None, sa_type=TIMESTAMPTZ)
    acknowledged_by_user_id: uuid.UUID | None = Field(default=None, foreign_key="users.id")
    resolved_at: datetime | None = Field(default=None, sa_type=TIMESTAMPTZ)
    # Null until people have been told and rules have been matched.
    notified_at: datetime | None = Field(default=None, sa_type=TIMESTAMPTZ)
    created_at: datetime = Field(default_factory=utcnow, sa_type=TIMESTAMPTZ, nullable=False)


class AlertSettings(UUIDPrimaryKey, TenantOwned, Timestamps, table=True):
    __tablename__ = "alert_settings"
    __table_args__ = (
        UniqueConstraint("organisation_id"),
        CheckConstraint("speed_limit_kph IS NULL OR speed_limit_kph > 0", name="speed_positive"),
        CheckConstraint("offline_minutes > 0", name="offline_positive"),
    )

    # Null turns speed alerts off. There's no default limit, because no one number is right.
    speed_limit_kph: int | None = Field(default=None)
    offline_alerts_enabled: bool = Field(default=True)
    offline_minutes: int = Field(default=60)
    licence_alerts_enabled: bool = Field(default=True)
    maintenance_alerts_enabled: bool = Field(default=True)
    document_alerts_enabled: bool = Field(default=True)
