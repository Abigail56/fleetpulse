import uuid
from typing import Any

from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlmodel import Session

from app.core.config import Settings
from app.core.errors import ApiError
from app.integrations.storage import ObjectStorage, StorageUnavailable
from app.services.billing import provider_for
from app.services.health import check_database, check_redis
from app.services.job_health import job_states

# Every query goes through a function that re-checks admin status in the database, so a bug in
# these routes still can't read across organisations for anyone else.


def _rows(db: Session, statement: str, **values: Any) -> list[Any]:
    return list(db.execute(text(statement), values).mappings().all())


def list_organisations(
    db: Session, search: str, page: int, page_size: int
) -> tuple[list[Any], int]:
    rows = _rows(
        db,
        "SELECT * FROM admin_organisations(:search, :limit, :offset)",
        search=search,
        limit=page_size,
        offset=(page - 1) * page_size,
    )
    return rows, rows[0]["total"] if rows else 0


def list_users(db: Session, search: str, page: int, page_size: int) -> tuple[list[Any], int]:
    rows = _rows(
        db,
        "SELECT * FROM admin_users(:search, :limit, :offset)",
        search=search,
        limit=page_size,
        offset=(page - 1) * page_size,
    )
    return rows, rows[0]["total"] if rows else 0


def list_audit(
    db: Session, action: str, organisation_id: uuid.UUID | None, page: int, page_size: int
) -> tuple[list[Any], int]:
    rows = _rows(
        db,
        "SELECT * FROM admin_audit(:action, :organisation, :limit, :offset)",
        action=action,
        organisation=organisation_id,
        limit=page_size,
        offset=(page - 1) * page_size,
    )
    return rows, rows[0]["total"] if rows else 0


def _translate(exc: DBAPIError) -> ApiError:
    message = str(exc.orig)
    if "own_account" in message:
        return ApiError(409, "own_account", "You can't change your own account here.")
    if "not_found" in message:
        return ApiError(404, "not_found", "That wasn't found.")
    return ApiError(404, "not_found", "Not found.")


def set_organisation_status(
    db: Session, organisation_id: uuid.UUID, status: str, reason: str
) -> None:
    try:
        db.execute(
            text("SELECT admin_set_organisation_status(:id, :status, :reason)"),
            {"id": organisation_id, "status": status, "reason": reason},
        )
    except DBAPIError as exc:
        db.rollback()
        raise _translate(exc) from exc
    db.commit()


def set_user_active(db: Session, user_id: uuid.UUID, active: bool, reason: str) -> None:
    try:
        db.execute(
            text("SELECT admin_set_user_active(:id, :active, :reason)"),
            {"id": user_id, "active": active, "reason": reason},
        )
    except DBAPIError as exc:
        db.rollback()
        raise _translate(exc) from exc
    db.commit()


def _storage_state(settings: Settings) -> str:
    try:
        storage = ObjectStorage(settings)
    except StorageUnavailable:
        return "not_configured"
    try:
        storage.check()
    except StorageUnavailable:
        return "unavailable"
    return "ok"


def system(db: Session, settings: Settings) -> dict[str, Any]:
    counts = _rows(db, "SELECT * FROM admin_system_counts()")[0]
    return {
        "services": [
            {"name": "Database", "state": check_database()},
            {"name": "Redis", "state": check_redis()},
            {"name": "File storage", "state": _storage_state(settings)},
        ],
        "jobs": job_states(settings),
        "integrations": [
            {
                "name": "Email",
                "state": "configured" if settings.smtp_host else "not_configured",
                "detail": settings.smtp_host or "No mail server is set.",
            },
            {
                "name": "Google sign-in",
                "state": "configured" if settings.google_enabled else "not_configured",
                "detail": "Client ID and secret are set."
                if settings.google_enabled
                else "The button stays hidden until this is set.",
            },
            {
                "name": "Online payment",
                "state": "configured" if provider_for(settings) else "not_configured",
                "detail": "Paystack key is set."
                if provider_for(settings)
                else "Nothing can be bought until this is set.",
            },
            {
                "name": "GPS feeds",
                "state": "configured" if counts["active_gps_feeds"] else "not_configured",
                "detail": f"{counts['active_gps_feeds']} active feed keys in all organisations.",
            },
        ],
        "counts": counts,
    }
