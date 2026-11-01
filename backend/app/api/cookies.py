from starlette.responses import Response

from app.core.config import Settings
from app.services.auth import IssuedTokens

ACCESS_COOKIE = "fleetpulse_access"
REFRESH_COOKIE = "fleetpulse_refresh"
# The refresh token is sent only to auth endpoints, never with ordinary API requests.
REFRESH_COOKIE_PATH = "/api/v1/auth"


def set_auth_cookies(response: Response, settings: Settings, tokens: IssuedTokens) -> None:
    response.set_cookie(
        ACCESS_COOKIE,
        tokens.access_token,
        max_age=settings.access_token_minutes * 60,
        path="/",
        domain=settings.cookie_domain,
        secure=settings.cookie_secure,
        httponly=True,
        samesite=settings.cookie_samesite,
    )
    response.set_cookie(
        REFRESH_COOKIE,
        tokens.refresh_token,
        max_age=settings.refresh_token_days * 86400,
        path=REFRESH_COOKIE_PATH,
        domain=settings.cookie_domain,
        secure=settings.cookie_secure,
        httponly=True,
        samesite=settings.cookie_samesite,
    )


def clear_auth_cookies(response: Response, settings: Settings) -> None:
    for name, path in ((ACCESS_COOKIE, "/"), (REFRESH_COOKIE, REFRESH_COOKIE_PATH)):
        response.delete_cookie(
            name,
            path=path,
            domain=settings.cookie_domain,
            secure=settings.cookie_secure,
            httponly=True,
            samesite=settings.cookie_samesite,
        )
