import re
import uuid
from datetime import date, datetime
from typing import Annotated, Literal, Self

from pydantic import AfterValidator, BaseModel, EmailStr, Field, model_validator

from app.models.enums import DriverAvailability, DriverStatus
from app.schemas.auth import DisplayName, RequestModel


def validate_licence(value: str) -> str:
    value = value.strip().upper()
    if not re.fullmatch(r"[A-Z0-9][A-Z0-9 /-]{2,63}", value):
        raise ValueError("must be 3 to 64 letters, numbers, spaces, hyphens or slashes")
    return value


def validate_phone(value: str) -> str:
    value = value.strip()
    if not re.fullmatch(r"\+?[0-9][0-9 ()-]{5,30}", value):
        raise ValueError("must be a phone number, such as +254 712 345678")
    return value


Name = Annotated[DisplayName, Field(max_length=100)]
LicenceNumber = Annotated[str, Field(max_length=64), AfterValidator(validate_licence)]
LicenceClass = Annotated[DisplayName, Field(max_length=32)]
Phone = Annotated[str, Field(max_length=32), AfterValidator(validate_phone)]
CountryCode = Annotated[str, Field(pattern=r"^[A-Z]{2}$")]


class DriverCreate(RequestModel):
    first_name: Name
    last_name: Name
    phone: Phone | None = None
    email: EmailStr | None = None
    licence_number: LicenceNumber
    licence_class: LicenceClass | None = None
    licence_country_code: CountryCode | None = None
    licence_expires_on: date | None = None
    status: DriverStatus = DriverStatus.ACTIVE
    availability: DriverAvailability = DriverAvailability.AVAILABLE


REQUIRED_ON_UPDATE = ("first_name", "last_name", "licence_number", "status", "availability")


class DriverUpdate(RequestModel):
    expected_updated_at: datetime | None = None
    first_name: Name | None = None
    last_name: Name | None = None
    phone: Phone | None = None
    email: EmailStr | None = None
    licence_number: LicenceNumber | None = None
    licence_class: LicenceClass | None = None
    licence_country_code: CountryCode | None = None
    licence_expires_on: date | None = None
    status: DriverStatus | None = None
    availability: DriverAvailability | None = None

    @model_validator(mode="after")
    def required_fields_cannot_be_cleared(self) -> Self:
        for field in REQUIRED_ON_UPDATE:
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} cannot be empty")
        return self


class CurrentVehicle(BaseModel):
    id: uuid.UUID
    registration_number: str


class DriverAccountRequest(RequestModel):
    # The member who signs in as this driver, or null to remove the link.
    user_id: uuid.UUID | None


class DriverResponse(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID | None
    first_name: str
    last_name: str
    # Null or masked for roles without drivers.view_sensitive; see sensitive_visible.
    phone: str | None
    email: str | None
    licence_number: str
    sensitive_visible: bool
    licence_class: str | None
    licence_country_code: str | None
    licence_expires_on: date | None
    status: DriverStatus
    availability: DriverAvailability
    archived_at: datetime | None
    created_at: datetime
    updated_at: datetime
    current_vehicle: CurrentVehicle | None = None


class DriverListResponse(BaseModel):
    items: list[DriverResponse]
    total: int
    page: int
    page_size: int


class AssignmentRequest(RequestModel):
    vehicle_id: uuid.UUID


class AssignmentResponse(BaseModel):
    id: uuid.UUID
    vehicle_id: uuid.UUID
    registration_number: str
    started_at: datetime
    ended_at: datetime | None


DriverSort = Literal[
    "last_name",
    "-last_name",
    "licence_expires_on",
    "-licence_expires_on",
    "status",
    "-status",
    "availability",
    "-availability",
    "created_at",
    "-created_at",
]
LicenceFilter = Literal["expired", "expiring"]
