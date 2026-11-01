import uuid
from datetime import datetime
from typing import Annotated
from zoneinfo import available_timezones

from pydantic import AfterValidator, BaseModel, EmailStr, Field

from app.models.enums import DistanceUnit, MembershipStatus, OrganisationRole
from app.schemas.auth import DisplayName, RequestModel


def validate_timezone(value: str) -> str:
    if value not in available_timezones():
        raise ValueError("must be an IANA time zone, such as Africa/Lagos")
    return value


CountryCode = Annotated[str, Field(pattern=r"^[A-Z]{2}$")]
CurrencyCode = Annotated[str, Field(pattern=r"^[A-Z]{3}$")]
Timezone = Annotated[str, AfterValidator(validate_timezone)]


class OrganisationCreate(RequestModel):
    name: DisplayName
    country_code: CountryCode
    default_currency: CurrencyCode
    timezone: Timezone = "UTC"
    distance_unit: DistanceUnit = DistanceUnit.KILOMETRES


class OrganisationUpdate(RequestModel):
    name: DisplayName | None = None
    country_code: CountryCode | None = None
    default_currency: CurrencyCode | None = None
    timezone: Timezone | None = None
    distance_unit: DistanceUnit | None = None


class OrganisationResponse(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    country_code: str
    default_currency: str
    timezone: str
    distance_unit: DistanceUnit


class MyOrganisationResponse(BaseModel):
    organisation: OrganisationResponse
    role: OrganisationRole
    is_active: bool


class CurrentMembershipResponse(BaseModel):
    organisation: OrganisationResponse
    role: OrganisationRole
    permissions: list[str]


class MemberResponse(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    email: str
    full_name: str
    role: OrganisationRole
    status: MembershipStatus


class MemberUpdate(RequestModel):
    role: OrganisationRole | None = None
    status: MembershipStatus | None = None


class InvitationCreate(RequestModel):
    email: EmailStr
    role: OrganisationRole


class InvitationResponse(BaseModel):
    id: uuid.UUID
    email: str
    role: OrganisationRole
    created_at: datetime
    expires_at: datetime


class InvitationAccept(RequestModel):
    token: str = Field(min_length=1, max_length=256)
