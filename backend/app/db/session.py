import uuid
from collections.abc import Iterator
from functools import lru_cache

from sqlalchemy import Connection, Engine, event, text
from sqlalchemy.orm import SessionTransaction
from sqlmodel import Session, create_engine

from app.core.config import get_settings

CONNECT_TIMEOUT_SECONDS = 3


@lru_cache
def get_engine() -> Engine:
    return create_engine(
        str(get_settings().database_url),
        pool_pre_ping=True,
        connect_args={"connect_timeout": CONNECT_TIMEOUT_SECONDS},
    )


ORGANISATION_SETTING = "app.current_organisation_id"
USER_SETTING = "app.current_user_id"


def _apply_context(connection: Connection, values: dict[str, str]) -> None:
    for name, value in values.items():
        # is_local=true: it ends with the transaction, so it can't leak to the pool's next user.
        connection.execute(
            text("SELECT set_config(:name, :value, true)"), {"name": name, "value": value}
        )


def set_db_context(
    db: Session, *, organisation_id: uuid.UUID | None = None, user_id: uuid.UUID | None = None
) -> None:
    """Sets who row-level security sees. Kept across commits, for this session only."""
    context: dict[str, str] = db.info.setdefault("rls_context", {})
    changes = {}
    if organisation_id is not None:
        changes[ORGANISATION_SETTING] = str(organisation_id)
    if user_id is not None:
        changes[USER_SETTING] = str(user_id)
    context.update(changes)
    if db.in_transaction():
        _apply_context(db.connection(), changes)


@event.listens_for(Session, "after_begin")
def _restore_context(db: Session, _transaction: SessionTransaction, connection: Connection) -> None:
    context = db.info.get("rls_context")
    if context:
        _apply_context(connection, context)


def get_session() -> Iterator[Session]:
    with Session(get_engine()) as session:
        yield session
