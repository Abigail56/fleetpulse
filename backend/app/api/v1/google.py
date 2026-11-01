import hashlib
import json
import re
from typing import Annotated, Any

import structlog
from fastapi import APIRouter, Cookie, Depends, Header, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from redis.exceptions import RedisError

from app.api.cookies import set_auth_cookies
from app.api.deps import DbDep, EmailQueueDep, RedisDep, SettingsDep, client_ip
from app.core import rate_limit
from app.core.config import Settings
from app.core.errors import ApiError
from app.services import auth as auth_service
from app.services import google as google_service
from app.services.google import GoogleExchange, GoogleSignInError

router = APIRouter(prefix="/auth", tags=["auth"])

STATE_COOKIE = "fleetpulse_oauth_state"
STATE_COOKIE_PATH = "/api/v1/auth/google"
STATE_LIFETIME_SECONDS = 600
HOUR_SECONDS = 3600
DEFAULT_NEXT = "/dashboard"
SAFE_NEXT = re.compile(r"^/(?![/\\])[^\s\\]*$")

logger = structlog.get_logger(__name__)


class ProvidersResponse(BaseModel):
    google: bool


def get_google_exchange() -> GoogleExchange:
    return google_service.exchange_code


def _state_key(state: str) -> str:
    return f"oauth:google:{hashlib.sha256(state.encode()).hexdigest()}"


def _to_login(settings: Settings, error: str) -> RedirectResponse:
    response = RedirectResponse(f"{settings.frontend_base_url}/login?error={error}", 303)
    response.delete_cookie(STATE_COOKIE, path=STATE_COOKIE_PATH)
    return response


@router.get("/providers")
def sign_in_providers(settings: SettingsDep) -> ProvidersResponse:
    return ProvidersResponse(google=settings.google_enabled)


@router.get("/google/start")
def google_start(
    request: Request, redis: RedisDep, settings: SettingsDep, next: str = DEFAULT_NEXT
) -> RedirectResponse:
    if not settings.google_enabled:
        return _to_login(settings, "google_unavailable")
    # Only ever a path on this site, so a crafted link can't send someone elsewhere afterwards.
    safe_next = next if SAFE_NEXT.match(next) else DEFAULT_NEXT
    try:
        rate_limit.enforce_limit(
            redis,
            rate_limit.hashed_key("google_start:ip", client_ip(request)),
            settings.auth_requests_per_hour_per_ip,
            HOUR_SECONDS,
        )
        sign_in = google_service.new_sign_in_request()
        redis.set(
            _state_key(sign_in.state),
            json.dumps(
                {"nonce": sign_in.nonce, "verifier": sign_in.code_verifier, "next": safe_next}
            ),
            ex=STATE_LIFETIME_SECONDS,
        )
    except (ApiError, RedisError) as exc:
        logger.error("google_start_failed", error_type=type(exc).__name__)
        return _to_login(settings, "google_failed")

    response = RedirectResponse(google_service.authorization_url(settings, sign_in), 303)
    # Ties the attempt to this browser, so nobody can sign a victim in to the attacker's account.
    response.set_cookie(
        STATE_COOKIE,
        sign_in.state,
        max_age=STATE_LIFETIME_SECONDS,
        path=STATE_COOKIE_PATH,
        secure=settings.cookie_secure,
        httponly=True,
        samesite="lax",
    )
    return response


@router.get("/google/callback")
def google_callback(
    db: DbDep,
    redis: RedisDep,
    settings: SettingsDep,
    queue: EmailQueueDep,
    exchange: Annotated[GoogleExchange, Depends(get_google_exchange)],
    state: str | None = None,
    code: str | None = None,
    error: str | None = None,
    state_cookie: Annotated[str | None, Cookie(alias=STATE_COOKIE)] = None,
    user_agent: Annotated[str | None, Header()] = None,
) -> RedirectResponse:
    if error is not None:
        return _to_login(settings, "google_cancelled")
    if not settings.google_enabled or not state or not code or state != state_cookie:
        logger.warning("google_callback_rejected", reason="state")
        return _to_login(settings, "google_failed")
    try:
        # Taken and deleted in one step, so a callback can only be used once.
        stored = redis.getdel(_state_key(state))
    except RedisError as exc:
        logger.error("google_state_unavailable", error_type=type(exc).__name__)
        return _to_login(settings, "google_failed")
    if stored is None:
        logger.warning("google_callback_rejected", reason="unknown_state")
        return _to_login(settings, "google_failed")
    attempt: dict[str, Any] = json.loads(str(stored, "utf-8"))  # type: ignore[arg-type]

    try:
        claims = exchange(settings, code, attempt["verifier"], attempt["nonce"])
        tokens = auth_service.sign_in_with_google(
            db, settings, queue, claims.subject, claims.email, claims.name, user_agent
        )
    except GoogleSignInError as exc:
        logger.warning("google_sign_in_failed", reason=str(exc))
        return _to_login(settings, "google_failed")
    except ApiError as exc:
        logger.warning("google_sign_in_refused", code=exc.code)
        return _to_login(settings, "google_failed")

    response = RedirectResponse(f"{settings.frontend_base_url}{attempt['next']}", 303)
    response.delete_cookie(STATE_COOKIE, path=STATE_COOKIE_PATH)
    set_auth_cookies(response, settings, tokens)
    return response
