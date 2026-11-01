import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Index
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field

from app.models.base import TIMESTAMPTZ, UUIDPrimaryKey, utcnow


class AuditLog(UUIDPrimaryKey, table=True):
    """Append-only: a database trigger rejects UPDATE, DELETE and TRUNCATE.

    organisation_id and actor_user_id are deliberately not foreign keys, so a record outlives
    whatever it refers to. details must never hold passwords, raw tokens or unneeded personal data.
    """

    __tablename__ = "audit_logs"
    __table_args__ = (
        Index("ix_audit_logs_organisation_id_occurred_at", "organisation_id", "occurred_at"),
        Index("ix_audit_logs_actor_user_id_occurred_at", "actor_user_id", "occurred_at"),
        Index("ix_audit_logs_entity", "entity_type", "entity_id"),
    )

    organisation_id: uuid.UUID | None = Field(default=None)
    actor_user_id: uuid.UUID | None = Field(default=None)
    action: str = Field(max_length=100)
    entity_type: str | None = Field(default=None, max_length=64)
    entity_id: str | None = Field(default=None, max_length=64)
    details: dict[str, Any] = Field(default_factory=dict, sa_type=JSONB)
    request_id: str | None = Field(default=None, max_length=64)
    occurred_at: datetime = Field(default_factory=utcnow, sa_type=TIMESTAMPTZ, nullable=False)
