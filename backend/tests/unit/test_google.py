import base64
import hashlib
import time
from typing import Any
from urllib.parse import parse_qs, urlparse

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from app.core.config import Settings
from app.services.google import (
    GoogleSignInError,
    authorization_url,
    new_sign_in_request,
    verify_id_token,
)

BASE: dict[str, Any] = {
    "_env_file": None,
    "environment": "test",
    "database_url": "postgresql+psycopg://user:pass@localhost:5432/db",
    "redis_url": "redis://:unit-test@localhost:6379/0",
    "jwt_secret": "x" * 64,
    "google_client_id": "client-id",
    "google_client_secret": "client-secret",
}
SETTINGS = Settings(**BASE)
KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
OTHER_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)


def token(key: Any = KEY, algorithm: str = "RS256", **overrides: Any) -> str:
    now = int(time.time())
    claims: dict[str, Any] = {
        "sub": "google-subject",
        "email": "ada@example.com",
        "email_verified": True,
        "name": "Ada Obi",
        "iss": "https://accounts.google.com",
        "aud": "client-id",
        "nonce": "right-nonce",
        "iat": now,
        "exp": now + 300,
    }
    merged = {name: value for name, value in (claims | overrides).items() if value is not None}
    return jwt.encode(merged, key, algorithm=algorithm)


def verify(id_token: str, nonce: str = "right-nonce") -> Any:
    return verify_id_token(SETTINGS, id_token, nonce, lambda _token: KEY.public_key())


def test_a_valid_token_gives_the_persons_details() -> None:
    claims = verify(token())
    assert (claims.subject, claims.email, claims.name) == (
        "google-subject",
        "ada@example.com",
        "Ada Obi",
    )


@pytest.mark.parametrize(
    "bad_token",
    [
        pytest.param(token(key=OTHER_KEY), id="signed by someone else"),
        pytest.param(token(aud="another-app"), id="issued to another app"),
        pytest.param(token(iss="https://evil.example.com"), id="wrong issuer"),
        pytest.param(token(exp=int(time.time()) - 60), id="expired"),
        pytest.param(token(email_verified=False), id="email not verified"),
        pytest.param(token(email_verified="true"), id="verified flag not boolean"),
        pytest.param(token(email_verified=None), id="verified flag missing"),
        pytest.param(token(nonce="another-nonce"), id="replayed from another attempt"),
        pytest.param(token(nonce=None), id="no nonce"),
        pytest.param(token(sub=None), id="no subject"),
        pytest.param(token(email=None), id="no email"),
        pytest.param(token(key="x" * 64, algorithm="HS256"), id="symmetric algorithm"),
        pytest.param("garbage", id="not a token"),
    ],
)
def test_bad_tokens_are_refused(bad_token: str) -> None:
    with pytest.raises(GoogleSignInError):
        verify(bad_token)


def test_authorization_url_uses_pkce_state_and_nonce() -> None:
    request = new_sign_in_request()
    full = authorization_url(SETTINGS, request)
    url = urlparse(full)
    query = {name: values[0] for name, values in parse_qs(url.query).items()}
    assert url.netloc == "accounts.google.com"
    assert query["client_id"] == "client-id"
    assert query["redirect_uri"] == "http://localhost:8010/api/v1/auth/google/callback"
    assert query["state"] == request.state
    assert query["nonce"] == request.nonce
    assert query["code_challenge_method"] == "S256"
    digest = hashlib.sha256(request.code_verifier.encode()).digest()
    assert query["code_challenge"] == base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
    assert request.code_verifier not in full
    assert "client-secret" not in full


def test_each_attempt_has_fresh_secrets() -> None:
    first, second = new_sign_in_request(), new_sign_in_request()
    assert first.state != second.state
    assert first.nonce != second.nonce
    assert first.code_verifier != second.code_verifier


def test_google_is_off_unless_both_credentials_are_set() -> None:
    assert SETTINGS.google_enabled
    assert not Settings(**(BASE | {"google_client_secret": None})).google_enabled
    assert not Settings(**(BASE | {"google_client_id": None})).google_enabled
