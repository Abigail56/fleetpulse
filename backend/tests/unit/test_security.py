import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
import pytest
from pydantic import ValidationError

from app.core.config import Settings
from app.core.security import (
    create_access_token,
    csrf_token_for,
    csrf_token_is_valid,
    decode_access_token,
    hash_password,
    hash_token,
    new_opaque_token,
    verify_password,
)

SECRET = "unit-test-secret-" + "x" * 64
BASE: dict[str, Any] = {
    "_env_file": None,
    "environment": "test",
    "database_url": "postgresql+psycopg://user:pass@localhost:5432/db",
    "redis_url": "redis://:unit-test@localhost:6379/0",
    "jwt_secret": SECRET,
}
SETTINGS = Settings(**BASE)
USER_ID = uuid.uuid4()
SESSION_ID = uuid.uuid4()


def claims(**overrides: Any) -> dict[str, Any]:
    now = datetime.now(UTC)
    values: dict[str, Any] = {
        "sub": str(USER_ID),
        "sid": str(SESSION_ID),
        "jti": "jti",
        "iat": now,
        "exp": now + timedelta(minutes=5),
        "iss": SETTINGS.jwt_issuer,
        "aud": SETTINGS.jwt_audience,
    }
    return {key: value for key, value in (values | overrides).items() if value is not None}


def sign(payload: dict[str, Any], key: str = SECRET, algorithm: str = "HS256") -> str:
    return jwt.encode(payload, key, algorithm=algorithm)


def test_password_hash_is_argon2id_and_verifies() -> None:
    hashed = hash_password("correct horse battery")
    assert hashed.startswith("$argon2id$")
    assert "correct horse" not in hashed
    assert verify_password(hashed, "correct horse battery")
    assert not verify_password(hashed, "wrong password")


def test_verify_password_rejects_a_malformed_hash() -> None:
    assert not verify_password("not-a-hash", "anything")


def test_opaque_tokens_are_unique_and_hash_to_sha256_hex() -> None:
    first, second = new_opaque_token(), new_opaque_token()
    assert first != second
    assert len(hash_token(first)) == 64
    assert first not in hash_token(first)


def test_valid_access_token_round_trips() -> None:
    decoded = decode_access_token(SETTINGS, create_access_token(SETTINGS, USER_ID, SESSION_ID))
    assert decoded is not None
    assert (decoded.user_id, decoded.session_id) == (USER_ID, SESSION_ID)


@pytest.mark.parametrize(
    "token",
    [
        pytest.param(sign(claims(), key="y" * 81), id="wrong signature"),
        pytest.param(sign(claims(exp=datetime.now(UTC) - timedelta(seconds=1))), id="expired"),
        pytest.param(sign(claims(iss="someone-else")), id="wrong issuer"),
        pytest.param(sign(claims(aud="another-api")), id="wrong audience"),
        pytest.param(sign(claims(), algorithm="HS512"), id="disallowed algorithm"),
        pytest.param(sign(claims(sid=None)), id="missing session claim"),
        pytest.param(sign(claims(exp=None)), id="missing expiry"),
        pytest.param(sign(claims(sub="not-a-uuid")), id="malformed subject"),
        pytest.param(jwt.encode(claims(), key="", algorithm="none"), id="unsigned alg none"),
        pytest.param("garbage", id="not a token"),
    ],
)
def test_invalid_access_tokens_are_rejected(token: str) -> None:
    assert decode_access_token(SETTINGS, token) is None


def test_csrf_token_is_bound_to_its_session() -> None:
    token = csrf_token_for(SETTINGS, SESSION_ID)
    assert csrf_token_is_valid(SETTINGS, SESSION_ID, token)
    assert not csrf_token_is_valid(SETTINGS, uuid.uuid4(), token)
    assert not csrf_token_is_valid(SETTINGS, SESSION_ID, None)


def test_non_ascii_csrf_header_is_rejected_without_error() -> None:
    assert not csrf_token_is_valid(SETTINGS, SESSION_ID, "tökén")


def test_short_jwt_secret_is_rejected() -> None:
    with pytest.raises(ValidationError, match="jwt_secret"):
        Settings(**(BASE | {"jwt_secret": "too-short"}))


def test_cookies_are_secure_in_staging_and_production_only() -> None:
    production: dict[str, Any] = {
        "environment": "production",
        "frontend_base_url": "https://app.example.com",
        "smtp_host": "smtp.example.com",
        "smtp_starttls": True,
        "contact_inbox_email": "inbox@example.com",
        "storage_endpoint_url": "https://s3.example.com",
        "storage_bucket": "files",
        "storage_access_key": "key",
        "storage_secret_key": "secret",
    }
    assert Settings(**(BASE | production)).cookie_secure
    assert Settings(**(BASE | {"environment": "staging"})).cookie_secure
    assert not SETTINGS.cookie_secure


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"frontend_base_url": "http://app.example.com"}, "frontend_base_url"),
        ({"redis_url": "redis://localhost:6379/0"}, "redis_url"),
        ({"smtp_host": None}, "smtp_host"),
        ({"contact_inbox_email": None}, "contact_inbox_email"),
        ({"gps_simulator_enabled": True}, "simulator"),
        ({"smtp_starttls": False}, "smtp_starttls"),
    ],
)
def test_production_requires_safe_settings(overrides: dict[str, Any], message: str) -> None:
    production: dict[str, Any] = {
        "environment": "production",
        "frontend_base_url": "https://app.example.com",
        "smtp_host": "smtp.example.com",
        "smtp_starttls": True,
        "contact_inbox_email": "inbox@example.com",
        "storage_endpoint_url": "https://s3.example.com",
        "storage_bucket": "files",
        "storage_access_key": "key",
        "storage_secret_key": "secret",
    }
    with pytest.raises(ValidationError, match=message):
        Settings(**(BASE | production | overrides))
