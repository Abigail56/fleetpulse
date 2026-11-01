from collections.abc import Callable
from dataclasses import dataclass
from typing import Annotated, cast

from fastapi import Cookie, Depends, Header, Request
from redis import Redis
from sqlmodel import Session, select

from app.api.cookies import ACCESS_COOKIE
from app.core.config import Settings
from app.core.errors import ApiError
from app.core.permissions import Permission, role_has_permission
from app.core.security import csrf_token_is_valid, decode_access_token
from app.db.session import get_session, set_db_context
from app.models import AuthSession, Organisation, OrganisationMembership, User
from app.models.base import utcnow
from app.models.enums import MembershipStatus, OrganisationStatus
from app.services.email import EmailQueue, queue_email, queue_email_or_raise

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def get_app_settings(request: Request) -> Settings:
    return cast(Settings, request.app.state.settings)


def get_redis(request: Request) -> Redis:
    return cast(Redis, request.app.state.redis)


def get_email_queue() -> EmailQueue:
    return queue_email


def get_strict_email_queue() -> EmailQueue:
    return queue_email_or_raise


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


SettingsDep = Annotated[Settings, Depends(get_app_settings)]
DbDep = Annotated[Session, Depends(get_session)]
RedisDep = Annotated[Redis, Depends(get_redis)]
EmailQueueDep = Annotated[EmailQueue, Depends(get_email_queue)]
StrictEmailQueueDep = Annotated[EmailQueue, Depends(get_strict_email_queue)]


def require_trusted_origin(request: Request, settings: SettingsDep) -> None:
    """Applied to the whole API. Browsers send Origin on every cross-site unsafe request."""
    if request.method in SAFE_METHODS:
        return
    origin = request.headers.get("origin")
    if origin is not None and origin not in settings.cors_origins:
        raise ApiError(403, "untrusted_origin", "This request was not allowed.")


@dataclass(frozen=True)
class AuthContext:
    user: User
    session: AuthSession


def get_auth_context(
    db: DbDep,
    settings: SettingsDep,
    access_token: Annotated[str | None, Cookie(alias=ACCESS_COOKIE)] = None,
) -> AuthContext:
    """Checks the database on every request, so a revoked session stops working immediately."""
    not_authenticated = ApiError(401, "not_authenticated", "Please sign in.")
    if access_token is None:
        raise not_authenticated
    claims = decode_access_token(settings, access_token)
    if claims is None:
        raise not_authenticated
    auth_session = db.get(AuthSession, claims.session_id)
    if (
        auth_session is None
        or auth_session.user_id != claims.user_id
        or auth_session.revoked_at is not None
        or auth_session.expires_at <= utcnow()
    ):
        raise not_authenticated
    user = db.get(User, claims.user_id)
    if user is None or not user.is_active:
        raise not_authenticated
    set_db_context(db, user_id=user.id)
    return AuthContext(user=user, session=auth_session)


CurrentAuth = Annotated[AuthContext, Depends(get_auth_context)]


def require_csrf(
    auth: CurrentAuth,
    settings: SettingsDep,
    csrf_token: Annotated[str | None, Header(alias="X-CSRF-Token")] = None,
) -> AuthContext:
    """Use on every state-changing route that a signed-in user's cookies authorise."""
    if not csrf_token_is_valid(settings, auth.session.id, csrf_token):
        raise ApiError(403, "invalid_csrf_token", "This request was not allowed.")
    return auth


CsrfProtectedAuth = Annotated[AuthContext, Depends(require_csrf)]


@dataclass(frozen=True)
class TenantContext:
    user: User
    session: AuthSession
    organisation: Organisation
    membership: OrganisationMembership


def resolve_tenant(db: Session, auth: AuthContext) -> TenantContext:
    """The session's chosen organisation, re-checked against the user's membership every time."""
    no_organisation = ApiError(403, "no_active_organisation", "Please choose an organisation.")
    organisation_id = auth.session.active_organisation_id
    if organisation_id is None:
        raise no_organisation
    set_db_context(db, organisation_id=organisation_id)
    membership = db.exec(
        select(OrganisationMembership).where(
            OrganisationMembership.organisation_id == organisation_id,
            OrganisationMembership.user_id == auth.user.id,
            OrganisationMembership.status == MembershipStatus.ACTIVE,
        )
    ).first()
    organisation = db.get(Organisation, organisation_id)
    if (
        membership is None
        or organisation is None
        or organisation.status != OrganisationStatus.ACTIVE
        or organisation.archived_at is not None
    ):
        raise no_organisation
    return TenantContext(
        user=auth.user, session=auth.session, organisation=organisation, membership=membership
    )


def get_tenant_context(
    request: Request,
    auth: CurrentAuth,
    db: DbDep,
    settings: SettingsDep,
    csrf_token: Annotated[str | None, Header(alias="X-CSRF-Token")] = None,
) -> TenantContext:
    """The only way a route gets an organisation: the session's choice, checked on every request.

    Membership is re-read each time, so removal or suspension takes effect immediately. CSRF is
    checked here for unsafe methods, so no organisation route can forget it.
    """
    if request.method not in SAFE_METHODS and not csrf_token_is_valid(
        settings, auth.session.id, csrf_token
    ):
        raise ApiError(403, "invalid_csrf_token", "This request was not allowed.")

    return resolve_tenant(db, auth)


def require_permission(permission: Permission) -> Callable[[TenantContext], TenantContext]:
    def check(tenant: Annotated[TenantContext, Depends(get_tenant_context)]) -> TenantContext:
        if not role_has_permission(tenant.membership.role, permission):
            raise ApiError(403, "forbidden", "You don't have permission to do that.")
        return tenant

    return check
