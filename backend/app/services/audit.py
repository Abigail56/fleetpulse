import uuid
from typing import Any

import structlog
from sqlmodel import Session

from app.models import AuditLog


def record_audit(
    db: Session,
    action: str,
    *,
    actor_user_id: uuid.UUID | None = None,
    organisation_id: uuid.UUID | None = None,
    entity_type: str | None = None,
    entity_id: uuid.UUID | None = None,
    details: dict[str, Any] | None = None,
) -> None:
    """Adds to the caller's transaction. `details` must never hold passwords or raw tokens."""
    db.add(
        AuditLog(
            action=action,
            actor_user_id=actor_user_id,
            organisation_id=organisation_id,
            entity_type=entity_type,
            entity_id=str(entity_id) if entity_id else None,
            details=details or {},
            request_id=structlog.contextvars.get_contextvars().get("request_id"),
        )
    )
