import time
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Annotated

from fastapi import APIRouter, Cookie, Header, Request, Response, status

from app.api.cookies import REFRESH_COOKIE, clear_auth_cookies, set_auth_cookies
from app.api.deps import (
    CsrfProtectedAuth,
    CurrentAuth,
    DbDep,
    EmailQueueDep,
    RedisDep,
    SettingsDep,
    client_ip,
)
from app.core import rate_limit
from app.core.config import Settings
from app.core.security import csrf_token_for
from app.models import AuthSession, User
from app.schemas.auth import (
    AuthResponse,
    ChangePasswordRequest,
    EmailRequest,
    LoginRequest,
    MessageResponse,
    RegisterRequest,
    ResetPasswordRequest,
    SessionResponse,
    UserResponse,
    VerifyEmailRequest,
)
from app.services import auth as auth_service

router = APIRouter(prefix="/auth", tags=["auth"])

HOUR_SECONDS = 3600
CHECK_YOUR_EMAIL = "If that address can receive this, an email is on its way. Check your inbox."


def limit_by_ip(redis: RedisDep, settings: Settings, request: Request, action: str) -> None:
    rate_limit.enforce_limit(
        redis,
        rate_limit.hashed_key(f"{action}:ip", client_ip(request)),
        settings.auth_requests_per_hour_per_ip,
        HOUR_SECONDS,
    )


def limit_emails_to_address(redis: RedisDep, settings: Settings, action: str, email: str) -> None:
    """Stops this API being used to flood someone's inbox."""
    rate_limit.enforce_limit(
        redis,
        rate_limit.hashed_key(f"{action}:email", email),
        settings.auth_emails_per_hour_per_address,
        HOUR_SECONDS,
    )


@contextmanager
def minimum_duration(settings: Settings) -> Iterator[None]:
    """Hides timing differences between accounts that exist and ones that don't."""
    started = time.monotonic()
    try:
        yield
    finally:
        remaining = settings.auth_min_response_ms / 1000 - (time.monotonic() - started)
        if remaining > 0:
            time.sleep(remaining)


def auth_response(settings: Settings, user: User, auth_session: AuthSession) -> AuthResponse:
    return AuthResponse(
        user=UserResponse(
            id=user.id,
            email=user.email,
            full_name=user.full_name,
            is_platform_admin=user.is_platform_admin,
        ),
        csrf_token=csrf_token_for(settings, auth_session.id),
    )


@router.post("/register", status_code=status.HTTP_202_ACCEPTED)
def register(
    body: RegisterRequest,
    request: Request,
    db: DbDep,
    redis: RedisDep,
    settings: SettingsDep,
    queue: EmailQueueDep,
) -> MessageResponse:
    limit_by_ip(redis, settings, request, "register")
    limit_emails_to_address(redis, settings, "register", body.email)
    with minimum_duration(settings):
        auth_service.register(db, settings, queue, body.email, body.password, body.full_name)
    return MessageResponse(message=CHECK_YOUR_EMAIL)


@router.post("/verify-email")
def verify_email(
    body: VerifyEmailRequest, request: Request, db: DbDep, redis: RedisDep, settings: SettingsDep
) -> MessageResponse:
    limit_by_ip(redis, settings, request, "verify")
    rate_limit.enforce_limit(
        redis,
        rate_limit.hashed_key("verify:token", body.token),
        settings.login_max_failures_per_email_ip,
        settings.login_failure_window_seconds,
    )
    auth_service.verify_email(db, body.token, body.password)
    return MessageResponse(message="Your email address is verified. You can now sign in.")


@router.post("/resend-verification", status_code=status.HTTP_202_ACCEPTED)
def resend_verification(
    body: EmailRequest,
    request: Request,
    db: DbDep,
    redis: RedisDep,
    settings: SettingsDep,
    queue: EmailQueueDep,
) -> MessageResponse:
    limit_by_ip(redis, settings, request, "resend")
    limit_emails_to_address(redis, settings, "resend", body.email)
    with minimum_duration(settings):
        auth_service.resend_verification(db, settings, queue, body.email)
    return MessageResponse(message=CHECK_YOUR_EMAIL)


@router.post("/login")
def login(
    body: LoginRequest,
    request: Request,
    response: Response,
    db: DbDep,
    redis: RedisDep,
    settings: SettingsDep,
    user_agent: Annotated[str | None, Header()] = None,
) -> AuthResponse:
    with minimum_duration(settings):
        user, tokens = auth_service.login(
            db, redis, settings, body.email, body.password, client_ip(request), user_agent
        )
    set_auth_cookies(response, settings, tokens)
    auth_session = db.get(AuthSession, tokens.session_id)
    assert auth_session is not None  # noqa: S101  (committed in this same request)
    return auth_response(settings, user, auth_session)


@router.post("/refresh")
def refresh(
    response: Response,
    db: DbDep,
    settings: SettingsDep,
    refresh_token: Annotated[str | None, Cookie(alias=REFRESH_COOKIE)] = None,
) -> AuthResponse:
    """No CSRF token: after a page reload the client has none until this succeeds.

    The origin check still applies, and a forged call only rotates the victim's own cookies
    without revealing anything to the attacker.
    """
    tokens = auth_service.refresh_session(db, settings, refresh_token)
    set_auth_cookies(response, settings, tokens)
    auth_session = db.get(AuthSession, tokens.session_id)
    assert auth_session is not None  # noqa: S101  (committed in this same request)
    user = db.get(User, auth_session.user_id)
    assert user is not None  # noqa: S101  (checked during rotation)
    return auth_response(settings, user, auth_session)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(auth: CsrfProtectedAuth, response: Response, db: DbDep, settings: SettingsDep) -> None:
    auth_service.logout(db, auth.session)
    clear_auth_cookies(response, settings)


@router.post("/logout-all", status_code=status.HTTP_204_NO_CONTENT)
def logout_all(
    auth: CsrfProtectedAuth, response: Response, db: DbDep, settings: SettingsDep
) -> None:
    auth_service.logout_all(db, auth.user.id)
    clear_auth_cookies(response, settings)


@router.get("/me")
def me(auth: CurrentAuth, settings: SettingsDep) -> AuthResponse:
    return auth_response(settings, auth.user, auth.session)


@router.get("/sessions")
def list_sessions(auth: CurrentAuth, db: DbDep) -> list[SessionResponse]:
    return [
        SessionResponse(
            id=item.id,
            user_agent=item.user_agent,
            created_at=item.created_at,
            last_active_at=item.last_active_at,
            expires_at=item.expires_at,
            is_current=item.id == auth.session.id,
        )
        for item in auth_service.list_sessions(db, auth.user.id)
    ]


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_session(
    session_id: uuid.UUID,
    auth: CsrfProtectedAuth,
    response: Response,
    db: DbDep,
    settings: SettingsDep,
) -> None:
    current_session_id = auth.session.id
    auth_service.revoke_session(db, auth.user.id, session_id)
    if session_id == current_session_id:
        clear_auth_cookies(response, settings)


@router.post("/forgot-password", status_code=status.HTTP_202_ACCEPTED)
def forgot_password(
    body: EmailRequest,
    request: Request,
    db: DbDep,
    redis: RedisDep,
    settings: SettingsDep,
    queue: EmailQueueDep,
) -> MessageResponse:
    limit_by_ip(redis, settings, request, "forgot")
    limit_emails_to_address(redis, settings, "forgot", body.email)
    with minimum_duration(settings):
        auth_service.forgot_password(db, settings, queue, body.email)
    return MessageResponse(message=CHECK_YOUR_EMAIL)


@router.post("/reset-password")
def reset_password(
    body: ResetPasswordRequest,
    request: Request,
    response: Response,
    db: DbDep,
    redis: RedisDep,
    settings: SettingsDep,
    queue: EmailQueueDep,
) -> MessageResponse:
    limit_by_ip(redis, settings, request, "reset")
    auth_service.reset_password(db, settings, queue, body.token, body.new_password)
    clear_auth_cookies(response, settings)
    return MessageResponse(message="Your password has been reset. You can now sign in.")


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(
    body: ChangePasswordRequest,
    auth: CsrfProtectedAuth,
    db: DbDep,
    redis: RedisDep,
    settings: SettingsDep,
    queue: EmailQueueDep,
) -> None:
    rate_limit.enforce_limit(
        redis,
        rate_limit.hashed_key("change_password:user", str(auth.user.id)),
        settings.login_max_failures_per_email_ip,
        settings.login_failure_window_seconds,
    )
    auth_service.change_password(
        db, settings, queue, auth.user, auth.session.id, body.current_password, body.new_password
    )
