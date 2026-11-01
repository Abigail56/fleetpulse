import base64
import hashlib
import secrets
from collections.abc import Callable
from dataclasses import dataclass
from functools import lru_cache
from typing import Any
from urllib.parse import urlencode

import httpx
import jwt
import structlog

from app.core.config import Settings

AUTHORIZATION_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"  # noqa: S105  (a URL, not a secret)
JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs"
ISSUERS = ["https://accounts.google.com", "accounts.google.com"]
REQUEST_TIMEOUT_SECONDS = 10

logger = structlog.get_logger(__name__)


class GoogleSignInError(Exception):
    """Details stay in the logs. The person is only told that sign-in didn't work."""


@dataclass(frozen=True)
class GoogleClaims:
    subject: str
    email: str
    name: str


@dataclass(frozen=True)
class SignInRequest:
    state: str
    nonce: str
    code_verifier: str


def new_sign_in_request() -> SignInRequest:
    return SignInRequest(
        state=secrets.token_urlsafe(32),
        nonce=secrets.token_urlsafe(32),
        code_verifier=secrets.token_urlsafe(64),
    )


def authorization_url(settings: Settings, request: SignInRequest) -> str:
    digest = hashlib.sha256(request.code_verifier.encode()).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
    query = urlencode(
        {
            "client_id": settings.google_client_id,
            "redirect_uri": settings.google_redirect_uri,
            "response_type": "code",
            "scope": "openid email profile",
            "state": request.state,
            "nonce": request.nonce,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "prompt": "select_account",
        }
    )
    return f"{AUTHORIZATION_URL}?{query}"


def verify_id_token(
    settings: Settings, id_token: str, nonce: str, signing_key_for: Callable[[str], Any]
) -> GoogleClaims:
    try:
        claims = jwt.decode(
            id_token,
            signing_key_for(id_token),
            algorithms=["RS256"],
            audience=settings.google_client_id,
            issuer=ISSUERS,
            options={"require": ["sub", "email", "exp", "iat", "iss", "aud", "nonce"]},
        )
    except jwt.PyJWTError as exc:
        raise GoogleSignInError(f"invalid id token: {type(exc).__name__}") from exc
    if not secrets.compare_digest(str(claims["nonce"]), nonce):
        raise GoogleSignInError("nonce mismatch")
    # Google can't vouch for an unverified address, and accounts are matched on it.
    if claims.get("email_verified") is not True:
        raise GoogleSignInError("email not verified by Google")
    return GoogleClaims(
        subject=str(claims["sub"]), email=str(claims["email"]), name=str(claims.get("name") or "")
    )


@lru_cache
def _jwks_client() -> jwt.PyJWKClient:
    return jwt.PyJWKClient(JWKS_URL, timeout=REQUEST_TIMEOUT_SECONDS)


def _google_signing_key(id_token: str) -> Any:
    return _jwks_client().get_signing_key_from_jwt(id_token).key


def exchange_code(settings: Settings, code: str, code_verifier: str, nonce: str) -> GoogleClaims:
    if settings.google_client_secret is None:
        raise GoogleSignInError("not configured")
    try:
        response = httpx.post(
            TOKEN_URL,
            data={
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret.get_secret_value(),
                "code": code,
                "code_verifier": code_verifier,
                "grant_type": "authorization_code",
                "redirect_uri": settings.google_redirect_uri,
            },
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        id_token = response.json()["id_token"]
    except (httpx.HTTPError, KeyError, ValueError) as exc:
        raise GoogleSignInError(f"token exchange failed: {type(exc).__name__}") from exc
    return verify_id_token(settings, id_token, nonce, _google_signing_key)


GoogleExchange = Callable[[Settings, str, str, str], GoogleClaims]
