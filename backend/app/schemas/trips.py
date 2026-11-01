import uuid
from datetime import datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import AwareDatetime, BaseModel, Field, StringConstraints

from app.models.enums import TripStatus
from app.schemas.auth import RequestModel

Place = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]
Notes = Annotated[str, StringConstraints(strip_whitespace=True, max_length=4000)]
DistanceSource = Literal["gps", "simulated", "manual"]


class TripCreate(RequestModel):
    origin_name: Place
    destination_name: Place
    vehicle_id: uuid.UUID | None = None
    driver_id: uuid.UUID | None = None
    planned_departure_at: AwareDatetime | None = None
    estimated_arrival_at: AwareDatetime | None = None
    dispatch_notes: Notes | None = None


class TripUpdate(RequestModel):
    origin_name: Place | None = None
    destination_name: Place | None = None
    vehicle_id: uuid.UUID | None = None
    driver_id: uuid.UUID | None = None
    planned_departure_at: AwareDatetime | None = None
    estimated_arrival_at: AwareDatetime | None = None
    dispatch_notes: Notes | None = None


class TripStart(RequestModel):
    # Defaults to now. Can be earlier, for a departure recorded after the fact.
    actual_departure_at: AwareDatetime | None = None


class TripComplete(RequestModel):
    actual_arrival_at: AwareDatetime | None = None
    # If left out, it's worked out from the vehicle's GPS positions during the trip.
    distance_km: Annotated[Decimal, Field(ge=0, le=99999999, decimal_places=2)] | None = None


class TripResponse(BaseModel):
    id: uuid.UUID
    status: TripStatus
    origin_name: str
    destination_name: str
    vehicle_id: uuid.UUID | None
    vehicle_registration: str | None
    driver_id: uuid.UUID | None
    driver_name: str | None
    planned_departure_at: datetime | None
    estimated_arrival_at: datetime | None
    actual_departure_at: datetime | None
    actual_arrival_at: datetime | None
    distance_km: Decimal | None
    distance_source: DistanceSource | None
    dispatch_notes: str | None
    created_at: datetime
    updated_at: datetime


class TripListResponse(BaseModel):
    items: list[TripResponse]
    total: int
    page: int
    page_size: int


class TripEvent(BaseModel):
    action: str
    occurred_at: datetime
    actor_name: str | None


class RoutePoint(BaseModel):
    recorded_at: datetime
    latitude: float
    longitude: float


class TripRoute(BaseModel):
    points: list[RoutePoint]
    is_simulated: bool
    is_limited: bool


class TripVehicleOption(BaseModel):
    id: uuid.UUID
    registration_number: str
    make: str
    model: str


class TripDriverOption(BaseModel):
    id: uuid.UUID
    name: str


class TripOptions(BaseModel):
    vehicles: list[TripVehicleOption]
    drivers: list[TripDriverOption]
