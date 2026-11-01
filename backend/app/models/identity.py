import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, Index, UniqueConstraint, text
from sqlmodel import Field, SQLModel

from app.models.base import TIMESTAMPTZ, TOKEN_HASH_LENGTH, Timestamps, UUIDPrimaryKey, utcnow


class User(UUIDPrimaryKey, Timestamps, table=True):
    __tablename__ = "users"
    __table_args__ = (CheckConstraint("email = lower(email)", name="email_lowercase"),)

    email: str = Field(max_length=320, unique=True)
    password_hash: str = Field(max_length=255)
    full_name: str = Field(max_length=200)
    is_active: bool = Field(default=True)
    # Internal FleetPulse staff only. Never derived from an organisation role.
    is_platform_admin: bool = Field(default=False)
    email_verified_at: datetime | None = Field(default=None, sa_type=TIMESTAMPTZ)
    password_changed_at: datetime | None = Field(default=None, sa_type=TIMESTAMPTZ)
    last_login_at: datetime | None = Field(default=None, sa_type=TIMESTAMPTZ)


class AuthSession(UUIDPrimaryKey, table=True):
    """One signed-in device. All refresh tokens of a session form one rotation family."""

    __tablename__ = "sessions"
    __table_args__ = (Index("ix_sessions_user_id_expires_at", "user_id", "expires_at"),)

    user_id: uuid.UUID = Field(foreign_key="users.id", ondelete="CASCADE")
    active_organisation_id: uuid.UUID | None = Field(
        default=None, foreign_key="organisations.id", ondelete="SET NULL"
    )
    user_agent: str | None = Field(default=None, max_length=512)
    created_at: datetime = Field(default_factory=utcnow, sa_type=TIMESTAMPTZ, nullable=False)
    last_active_at: datetime = Field(default_factory=utcnow, sa_type=TIMESTAMPTZ, nullable=False)
    expires_at: datetime = Field(sa_type=TIMESTAMPTZ, nullable=False)
    revoked_at: datetime | None = Field(default=None, sa_type=TIMESTAMPTZ)
    revoked_reason: str | None = Field(default=None, max_length=64)


class RefreshToken(UUIDPrimaryKey, table=True):
    """Only the hash is stored. Presenting a consumed token signals reuse of a stolen token."""

    __tablename__ = "refresh_tokens"
    __table_args__ = (
        # At most one usable token per session, so concurrent rotations cannot both succeed.
        Index(
            "uq_refresh_tokens_session_id_unconsumed",
            "session_id",
            unique=True,
            postgresql_where=text("consumed_at IS NULL"),
        ),
    )

    session_id: uuid.UUID = Field(foreign_key="sessions.id", ondelete="CASCADE")
    token_hash: str = Field(max_length=TOKEN_HASH_LENGTH, unique=True)
    created_at: datetime = Field(default_factory=utcnow, sa_type=TIMESTAMPTZ, nullable=False)
    expires_at: datetime = Field(sa_type=TIMESTAMPTZ, nullable=False)
    consumed_at: datetime | None = Field(default=None, sa_type=TIMESTAMPTZ)


class OneTimeToken(UUIDPrimaryKey, SQLModel):
    user_id: uuid.UUID = Field(foreign_key="users.id", ondelete="CASCADE", index=True)
    token_hash: str = Field(max_length=TOKEN_HASH_LENGTH, unique=True)
    created_at: datetime = Field(default_factory=utcnow, sa_type=TIMESTAMPTZ, nullable=False)
    expires_at: datetime = Field(sa_type=TIMESTAMPTZ, nullable=False)
    consumed_at: datetime | None = Field(default=None, sa_type=TIMESTAMPTZ)


class EmailVerificationToken(OneTimeToken, table=True):
    __tablename__ = "email_verification_tokens"


class PasswordResetToken(OneTimeToken, table=True):
    __tablename__ = "password_reset_tokens"


class UserIdentity(UUIDPrimaryKey, table=True):
    """Links a user to an outside sign-in, identified by the provider's subject, not the email."""

    __tablename__ = "user_identities"
    __table_args__ = (
        UniqueConstraint("provider", "provider_subject"),
        UniqueConstraint("user_id", "provider"),
    )

    user_id: uuid.UUID = Field(foreign_key="users.id", ondelete="CASCADE")
    provider: str = Field(max_length=32)
    provider_subject: str = Field(max_length=255)
    created_at: datetime = Field(default_factory=utcnow, sa_type=TIMESTAMPTZ, nullable=False)
