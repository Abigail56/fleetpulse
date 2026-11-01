import uuid
from datetime import timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query

from app.api.deps import (
    CsrfProtectedAuth,
    CurrentAuth,
    DbDep,
    RedisDep,
    SettingsDep,
)
from app.core.errors import ApiError
from app.core.rate_limit import enforce_limit, hashed_key
from app.core.security import verify_password
from app.schemas.admin import (
    AdminAction,
    AdminAuditEntry,
    AdminAuditList,
    AdminOrganisation,
    AdminOrganisationList,
    AdminSessionState,
    AdminSystem,
    AdminUser,
    AdminUserList,
    AdminVerify,
)
from app.services import admin as service
from app.services.audit import record_audit

router = APIRouter(prefix="/admin", tags=["admin"])

VERIFIED_SECONDS = int(timedelta(minutes=30).total_seconds())
VERIFY_ATTEMPTS = 5
VERIFY_WINDOW_SECONDS = 900


def _hidden() -> ApiError:
    # The same as a route that doesn't exist, so this area isn't advertised.
    return ApiError(404, "not_found", "Not found.")


def _verified_key(session_id: uuid.UUID) -> str:
    return hashed_key("admin_verified", str(session_id))


def _admin(auth: CurrentAuth) -> CurrentAuth:
    if not auth.user.is_platform_admin:
        raise _hidden()
    return auth


def _verified_admin(auth: CurrentAuth, redis: RedisDep) -> CurrentAuth:
    _admin(auth)
    if not redis.exists(_verified_key(auth.session.id)):
        raise ApiError(403, "admin_verification_required", "Please confirm your password.")
    return auth


def _verified_admin_write(auth: CsrfProtectedAuth, redis: RedisDep) -> CsrfProtectedAuth:
    return _verified_admin(auth, redis)


AdminDep = Annotated[Any, Depends(_verified_admin)]
AdminWriteDep = Annotated[Any, Depends(_verified_admin_write)]
Search = Annotated[str, Query(max_length=100)]
Page = Annotated[int, Query(ge=1)]
PageSize = Annotated[int, Query(ge=1, le=100)]


@router.get("/session")
def admin_session(auth: CurrentAuth, redis: RedisDep) -> AdminSessionState:
    _admin(auth)
    return AdminSessionState(verified=bool(redis.exists(_verified_key(auth.session.id))))


@router.post("/verify")
def verify(
    body: AdminVerify, auth: CsrfProtectedAuth, db: DbDep, redis: RedisDep
) -> AdminSessionState:
    """A second check, so a stolen session alone doesn't open the whole platform."""
    _admin(auth)
    enforce_limit(
        redis,
        hashed_key("admin_verify", str(auth.user.id)),
        VERIFY_ATTEMPTS,
        VERIFY_WINDOW_SECONDS,
    )
    if not verify_password(auth.user.password_hash, body.password.get_secret_value()):
        record_audit(db, "admin.verify_failed", actor_user_id=auth.user.id)
        db.commit()
        raise ApiError(403, "wrong_password", "That password isn't right.")
    redis.set(_verified_key(auth.session.id), "1", ex=VERIFIED_SECONDS)
    record_audit(db, "admin.verified", actor_user_id=auth.user.id)
    db.commit()
    return AdminSessionState(verified=True)


@router.get("/organisations")
def organisations(
    _: AdminDep, db: DbDep, search: Search = "", page: Page = 1, page_size: PageSize = 25
) -> AdminOrganisationList:
    rows, total = service.list_organisations(db, search, page, page_size)
    return AdminOrganisationList(
        items=[AdminOrganisation.model_validate(dict(row)) for row in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post("/organisations/{organisation_id}/suspend")
def suspend_organisation(
    organisation_id: uuid.UUID, body: AdminAction, _: AdminWriteDep, db: DbDep
) -> None:
    service.set_organisation_status(db, organisation_id, "suspended", body.reason)


@router.post("/organisations/{organisation_id}/reactivate")
def reactivate_organisation(
    organisation_id: uuid.UUID, body: AdminAction, _: AdminWriteDep, db: DbDep
) -> None:
    service.set_organisation_status(db, organisation_id, "active", body.reason)


@router.get("/users")
def users(
    _: AdminDep, db: DbDep, search: Search = "", page: Page = 1, page_size: PageSize = 25
) -> AdminUserList:
    rows, total = service.list_users(db, search, page, page_size)
    return AdminUserList(
        items=[AdminUser.model_validate(dict(row)) for row in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post("/users/{user_id}/deactivate")
def deactivate_user(user_id: uuid.UUID, body: AdminAction, _: AdminWriteDep, db: DbDep) -> None:
    service.set_user_active(db, user_id, False, body.reason)


@router.post("/users/{user_id}/reactivate")
def reactivate_user(user_id: uuid.UUID, body: AdminAction, _: AdminWriteDep, db: DbDep) -> None:
    service.set_user_active(db, user_id, True, body.reason)


@router.get("/audit")
def audit(
    _: AdminDep,
    db: DbDep,
    action: Annotated[str, Query(max_length=100)] = "",
    organisation_id: uuid.UUID | None = None,
    page: Page = 1,
    page_size: PageSize = 50,
) -> AdminAuditList:
    rows, total = service.list_audit(db, action, organisation_id, page, page_size)
    return AdminAuditList(
        items=[AdminAuditEntry.model_validate(dict(row)) for row in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/system")
def system(_: AdminDep, db: DbDep, settings: SettingsDep) -> AdminSystem:
    return AdminSystem.model_validate(service.system(db, settings))
