import uuid
from datetime import datetime
from typing import Annotated, Literal, Self

from pydantic import BaseModel, Field, StringConstraints, model_validator

from app.models.enums import AlertSeverity, AlertType, GeofenceEventType, GeofenceKind
from app.schemas.auth import RequestModel

GeofenceName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)
]
Latitude = Annotated[float, Field(ge=-90, le=90)]
Longitude = Annotated[float, Field(ge=-180, le=180)]
Radius = Annotated[float, Field(ge=10, le=500_000)]
Boundary = Annotated[list[tuple[Latitude, Longitude]], Field(min_length=3, max_length=200)]
AlertState = Literal["active", "unacknowledged", "resolved", "all"]


class GeofenceCreate(RequestModel):
    name: GeofenceName
    kind: GeofenceKind
    center_latitude: Latitude | None = None
    center_longitude: Longitude | None = None
    radius_m: Radius | None = None
    boundary: Boundary | None = None
    is_restricted: bool = False
    alert_on_entry: bool = True
    alert_on_exit: bool = False

    @model_validator(mode="after")
    def shape_matches_kind(self) -> Self:
        if self.kind == GeofenceKind.CIRCLE:
            if None in (self.center_latitude, self.center_longitude, self.radius_m):
                raise ValueError("a circle needs a centre and a radius")
        elif self.boundary is None:
            raise ValueError("a polygon needs a boundary")
        return self


class GeofenceUpdate(RequestModel):
    name: GeofenceName | None = None
    kind: GeofenceKind | None = None
    center_latitude: Latitude | None = None
    center_longitude: Longitude | None = None
    radius_m: Radius | None = None
    boundary: Boundary | None = None
    is_restricted: bool | None = None
    alert_on_entry: bool | None = None
    alert_on_exit: bool | None = None


class GeofenceResponse(BaseModel):
    id: uuid.UUID
    name: str
    kind: GeofenceKind
    boundary: list[list[float]]
    center_latitude: float | None
    center_longitude: float | None
    radius_m: float | None
    is_restricted: bool
    alert_on_entry: bool
    alert_on_exit: bool
    vehicles_inside: int
    archived_at: datetime | None
    created_at: datetime


class GeofenceEventResponse(BaseModel):
    id: uuid.UUID
    vehicle_id: uuid.UUID
    vehicle_registration: str
    event_type: GeofenceEventType
    occurred_at: datetime
    latitude: float
    longitude: float
    is_simulated: bool


class GeofenceEventList(BaseModel):
    items: list[GeofenceEventResponse]
    total: int
    page: int
    page_size: int


class AlertResponse(BaseModel):
    id: uuid.UUID
    alert_type: AlertType
    severity: AlertSeverity
    title: str
    message: str
    occurred_at: datetime
    vehicle_id: uuid.UUID | None
    vehicle_registration: str | None
    driver_id: uuid.UUID | None
    geofence_id: uuid.UUID | None
    is_simulated: bool
    acknowledged_at: datetime | None
    resolved_at: datetime | None


class AlertList(BaseModel):
    items: list[AlertResponse]
    total: int
    page: int
    page_size: int


class AlertSummary(BaseModel):
    unacknowledged: int
    critical: int


class AlertSettingsResponse(BaseModel):
    speed_limit_kph: int | None
    offline_alerts_enabled: bool
    offline_minutes: int
    licence_alerts_enabled: bool
    maintenance_alerts_enabled: bool
    document_alerts_enabled: bool


class AlertSettingsUpdate(RequestModel):
    speed_limit_kph: Annotated[int, Field(ge=1, le=400)] | None = None
    offline_alerts_enabled: bool | None = None
    offline_minutes: Annotated[int, Field(ge=5, le=43200)] | None = None
    licence_alerts_enabled: bool | None = None
    maintenance_alerts_enabled: bool | None = None
    document_alerts_enabled: bool | None = None
