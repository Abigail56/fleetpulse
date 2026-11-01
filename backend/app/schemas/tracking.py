import uuid
from datetime import datetime
from decimal import Decimal
from typing import Annotated, Self

from pydantic import BaseModel, Field, model_validator

from app.models.enums import GpsSignalStatus, TrackingDeviceStatus
from app.schemas.auth import DisplayName, RequestModel

Latitude = Annotated[float, Field(ge=-90, le=90, allow_inf_nan=False)]
Longitude = Annotated[float, Field(ge=-180, le=180, allow_inf_nan=False)]


class IntegrationCreate(RequestModel):
    name: Annotated[DisplayName, Field(max_length=100)]


class IntegrationResponse(BaseModel):
    id: uuid.UUID
    name: str
    provider: str
    key_prefix: str
    created_at: datetime
    last_used_at: datetime | None


class IntegrationCreated(IntegrationResponse):
    # Shown once. Only a hash is stored.
    key: str


class DeviceCreate(RequestModel):
    external_device_id: Annotated[str, Field(min_length=1, max_length=128)] | None = None
    vehicle_id: uuid.UUID | None = None
    simulated: bool = False
    start_latitude: Latitude | None = None
    start_longitude: Longitude | None = None

    @model_validator(mode="after")
    def check_kind(self) -> Self:
        if self.simulated:
            if self.vehicle_id is None:
                raise ValueError("a simulated device needs a vehicle")
            if self.start_latitude is None or self.start_longitude is None:
                raise ValueError("a simulated device needs a starting position")
        elif self.external_device_id is None:
            raise ValueError("external_device_id is required")
        return self


class DeviceUpdate(RequestModel):
    vehicle_id: uuid.UUID | None = None
    status: TrackingDeviceStatus | None = None

    @model_validator(mode="after")
    def status_cannot_be_cleared(self) -> Self:
        if "status" in self.model_fields_set and self.status is None:
            raise ValueError("status cannot be empty")
        return self


class DeviceResponse(BaseModel):
    id: uuid.UUID
    provider: str
    external_device_id: str
    vehicle_id: uuid.UUID | None
    registration_number: str | None
    status: TrackingDeviceStatus
    is_simulated: bool
    last_seen_at: datetime | None


class TrackingConfig(BaseModel):
    simulator_enabled: bool
    stale_minutes: int
    offline_minutes: int


class FleetVehicleResponse(BaseModel):
    id: uuid.UUID
    registration_number: str
    make: str
    model: str
    vehicle_status: str
    # All null for a vehicle that has never reported.
    recorded_at: datetime | None
    latitude: float | None
    longitude: float | None
    speed_kph: Decimal | None
    heading_degrees: Decimal | None
    ignition_on: bool | None
    signal_status: GpsSignalStatus | None
    is_simulated: bool
    # Null without an assignment, and for roles that can't view drivers.
    driver_name: str | None


class PositionResponse(BaseModel):
    vehicle_id: uuid.UUID
    recorded_at: datetime
    received_at: datetime
    latitude: float
    longitude: float
    speed_kph: Decimal | None
    heading_degrees: Decimal | None
    ignition_on: bool | None
    signal_status: GpsSignalStatus
    is_simulated: bool


class LatestPositionResponse(PositionResponse):
    is_stale: bool
    registration_number: str | None = None


class JourneyResponse(BaseModel):
    started_at: datetime
    ended_at: datetime
    distance_km: float
    points: int
    is_simulated: bool


class IngestResponse(BaseModel):
    accepted: int
    duplicates: int
    rejected: list[dict[str, int | str]]
