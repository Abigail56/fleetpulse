import uuid
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any

from geoalchemy2 import Geography
from sqlalchemy import DateTime, Enum, func
from sqlmodel import Field, SQLModel

SQLModel.metadata.naming_convention = {
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_N_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}

# Typed Any because SQLModel's Field(sa_type=...) annotation only admits classes.
TIMESTAMPTZ: Any = DateTime(timezone=True)

TOKEN_HASH_LENGTH = 64  # hex-encoded SHA-256


def utcnow() -> datetime:
    return datetime.now(UTC)


def geography_point() -> Any:
    """A new instance per column: GeoAlchemy keeps a nullable flag on the type object."""
    return Geography(geometry_type="POINT", srid=4326, spatial_index=False)


def enum_type(enum_cls: type[StrEnum], name: str) -> Any:
    """A VARCHAR with a CHECK constraint: adding a value later is a simple migration."""
    return Enum(
        enum_cls,
        name=name,
        native_enum=False,
        create_constraint=True,
        length=32,
        values_callable=lambda members: [member.value for member in members],
    )


class UUIDPrimaryKey(SQLModel):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)


class Timestamps(SQLModel):
    created_at: datetime = Field(
        default_factory=utcnow,
        sa_type=TIMESTAMPTZ,
        nullable=False,
        sa_column_kwargs={"server_default": func.now()},
    )
    updated_at: datetime = Field(
        default_factory=utcnow,
        sa_type=TIMESTAMPTZ,
        nullable=False,
        sa_column_kwargs={"server_default": func.now(), "onupdate": func.now()},
    )


class TenantOwned(SQLModel):
    """Every row belongs to exactly one organisation.

    Tables referencing a tenant-owned table must use a composite foreign key that includes
    organisation_id, so the database rejects cross-tenant links. tests/unit/test_models.py
    enforces this for every table.
    """

    organisation_id: uuid.UUID = Field(foreign_key="organisations.id", nullable=False)
