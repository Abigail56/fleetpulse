import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, Index, UniqueConstraint, text
from sqlmodel import Field

from app.models.base import (
    TIMESTAMPTZ,
    TOKEN_HASH_LENGTH,
    TenantOwned,
    Timestamps,
    UUIDPrimaryKey,
    enum_type,
    utcnow,
)
from app.models.enums import DistanceUnit, MembershipStatus, OrganisationRole, OrganisationStatus


class Organisation(UUIDPrimaryKey, Timestamps, table=True):
    __tablename__ = "organisations"
    __table_args__ = (
        CheckConstraint("default_currency ~ '^[A-Z]{3}$'", name="default_currency_iso4217"),
        CheckConstraint("country_code ~ '^[A-Z]{2}$'", name="country_code_iso3166"),
        CheckConstraint("slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'", name="slug_format"),
    )

    name: str = Field(max_length=200)
    slug: str = Field(max_length=100, unique=True)
    # Deliberately no default country or currency: customers operate in any country.
    country_code: str = Field(max_length=2)
    default_currency: str = Field(max_length=3)
    timezone: str = Field(default="UTC", max_length=64)
    distance_unit: DistanceUnit = Field(
        default=DistanceUnit.KILOMETRES, sa_type=enum_type(DistanceUnit, "distance_unit")
    )
    status: OrganisationStatus = Field(
        default=OrganisationStatus.ACTIVE, sa_type=enum_type(OrganisationStatus, "status")
    )
    archived_at: datetime | None = Field(default=None, sa_type=TIMESTAMPTZ)


class OrganisationMembership(UUIDPrimaryKey, Timestamps, table=True):
    __tablename__ = "organisation_memberships"
    __table_args__ = (UniqueConstraint("organisation_id", "user_id"),)

    organisation_id: uuid.UUID = Field(foreign_key="organisations.id")
    user_id: uuid.UUID = Field(foreign_key="users.id", index=True)
    role: OrganisationRole = Field(sa_type=enum_type(OrganisationRole, "role"))
    status: MembershipStatus = Field(
        default=MembershipStatus.ACTIVE, sa_type=enum_type(MembershipStatus, "status")
    )


class OrganisationInvitation(UUIDPrimaryKey, TenantOwned, table=True):
    """Holds a pending invite. No user row exists until the person registers for themselves."""

    __tablename__ = "organisation_invitations"
    __table_args__ = (
        CheckConstraint("email = lower(email)", name="email_lowercase"),
        Index(
            "uq_organisation_invitations_organisation_id_email_pending",
            "organisation_id",
            "email",
            unique=True,
            postgresql_where=text("accepted_at IS NULL AND revoked_at IS NULL"),
        ),
    )

    email: str = Field(max_length=320)
    role: OrganisationRole = Field(sa_type=enum_type(OrganisationRole, "role"))
    token_hash: str = Field(max_length=TOKEN_HASH_LENGTH, unique=True)
    invited_by_user_id: uuid.UUID = Field(foreign_key="users.id")
    created_at: datetime = Field(default_factory=utcnow, sa_type=TIMESTAMPTZ, nullable=False)
    expires_at: datetime = Field(sa_type=TIMESTAMPTZ, nullable=False)
    accepted_at: datetime | None = Field(default=None, sa_type=TIMESTAMPTZ)
    revoked_at: datetime | None = Field(default=None, sa_type=TIMESTAMPTZ)
