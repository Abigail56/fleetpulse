import re
import uuid
from datetime import UTC, datetime
from decimal import Decimal
from typing import Annotated, Literal, Self

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, model_validator

from app.models.enums import FuelType, OwnershipType, VehicleStatus, VehicleType
from app.schemas.auth import DisplayName, RequestModel, reject_control_characters

MIN_YEAR = 1900


def validate_registration(value: str) -> str:
    value = reject_control_characters(value.strip())
    # Uniqueness compares letters and digits only, so a value with none would collide with others.
    if not re.search(r"[A-Za-z0-9]", value):
        raise ValueError("must contain letters or numbers")
    return value


def normalise_vin(value: str) -> str:
    value = value.strip().upper()
    if not re.fullmatch(r"[A-Z0-9]{5,32}", value):
        raise ValueError("must be 5 to 32 letters and numbers")
    return value


def validate_year(value: int) -> int:
    latest = datetime.now(UTC).year + 1  # next year's models are sold this year
    if not MIN_YEAR <= value <= latest:
        raise ValueError(f"must be between {MIN_YEAR} and {latest}")
    return value


Registration = Annotated[
    str, Field(min_length=1, max_length=32), AfterValidator(validate_registration)
]
Vin = Annotated[str, Field(max_length=32), AfterValidator(normalise_vin)]
Year = Annotated[int, AfterValidator(validate_year)]
Odometer = Annotated[Decimal, Field(ge=0, max_digits=12, decimal_places=1)]
ShortName = Annotated[DisplayName, Field(max_length=100)]


class VehicleCreate(RequestModel):
    registration_number: Registration
    make: ShortName
    model: ShortName
    year: Year | None = None
    vehicle_type: VehicleType
    vin: Vin | None = None
    fuel_type: FuelType
    odometer_km: Odometer = Decimal("0")
    ownership_type: OwnershipType = OwnershipType.OWNED
    owner_name: DisplayName | None = None
    status: VehicleStatus = VehicleStatus.IDLE


REQUIRED_ON_UPDATE = (
    "registration_number",
    "make",
    "model",
    "vehicle_type",
    "fuel_type",
    "odometer_km",
    "ownership_type",
    "status",
)


class VehicleUpdate(RequestModel):
    """Only the fields sent are changed. expected_updated_at refuses an edit based on old data."""

    expected_updated_at: datetime | None = None
    registration_number: Registration | None = None
    make: ShortName | None = None
    model: ShortName | None = None
    year: Year | None = None
    vehicle_type: VehicleType | None = None
    vin: Vin | None = None
    fuel_type: FuelType | None = None
    odometer_km: Odometer | None = None
    ownership_type: OwnershipType | None = None
    owner_name: DisplayName | None = None
    status: VehicleStatus | None = None

    @model_validator(mode="after")
    def required_fields_cannot_be_cleared(self) -> Self:
        for field in REQUIRED_ON_UPDATE:
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} cannot be empty")
        return self


class VehicleResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    registration_number: str
    make: str
    model: str
    year: int | None
    vehicle_type: VehicleType
    vin: str | None
    fuel_type: FuelType
    odometer_km: Decimal
    odometer_recorded_at: datetime | None
    ownership_type: OwnershipType
    owner_name: str | None
    status: VehicleStatus
    archived_at: datetime | None
    created_at: datetime
    updated_at: datetime


class AssignedDriver(BaseModel):
    id: uuid.UUID
    name: str


class VehicleDetailResponse(VehicleResponse):
    # Left out for roles that can't view drivers.
    current_driver: AssignedDriver | None = None


class VehicleListResponse(BaseModel):
    items: list[VehicleResponse]
    total: int
    page: int
    page_size: int


VehicleSort = Literal[
    "registration_number",
    "-registration_number",
    "make",
    "-make",
    "year",
    "-year",
    "odometer_km",
    "-odometer_km",
    "status",
    "-status",
    "created_at",
    "-created_at",
]
