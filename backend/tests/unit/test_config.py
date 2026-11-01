from typing import Any

import pytest
from pydantic import ValidationError

from app.core.config import Settings

BASE: dict[str, Any] = {
    "_env_file": None,
    "database_url": "postgresql+psycopg://user:pass@localhost:5432/db",
    "redis_url": "redis://:unit-test@localhost:6379/0",
    "jwt_secret": "unit-test-secret-" + "x" * 32,
    "frontend_base_url": "https://app.example.com",
    "smtp_host": "smtp.example.com",
    "smtp_starttls": True,
    "contact_inbox_email": "inbox@example.com",
    "storage_endpoint_url": "https://s3.example.com",
    "storage_bucket": "files",
    "storage_access_key": "key",
    "storage_secret_key": "secret",
}


def test_wildcard_cors_origin_is_rejected_in_every_environment() -> None:
    with pytest.raises(ValidationError, match="wildcards"):
        Settings(**BASE, environment="development", cors_origins=["*"])


def test_partial_wildcard_cors_origin_is_rejected() -> None:
    with pytest.raises(ValidationError, match="wildcards"):
        Settings(**BASE, environment="development", cors_origins=["https://*.example.com"])


def test_production_rejects_plain_http_cors_origin() -> None:
    with pytest.raises(ValidationError, match="https"):
        Settings(**BASE, environment="production", cors_origins=["http://app.example.com"])


def test_production_accepts_https_cors_origin() -> None:
    settings = Settings(**BASE, environment="production", cors_origins=["https://app.example.com"])
    assert settings.is_production


def test_missing_database_url_fails_instead_of_using_a_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("FLEETPULSE_DATABASE_URL", raising=False)
    with pytest.raises(ValidationError, match="database_url"):
        Settings(
            _env_file=None, redis_url="redis://:unit-test@localhost:6379/0", jwt_secret="x" * 32
        )


@pytest.mark.parametrize(
    ("change", "message"),
    [
        ({"storage_bucket": None}, "file storage"),
        ({"storage_secret_key": ""}, "file storage"),
        ({"smtp_starttls": False}, "smtp_starttls"),
        ({"smtp_host": None}, "smtp_host"),
        ({"contact_inbox_email": None}, "contact_inbox_email"),
        ({"gps_simulator_enabled": True}, "simulator"),
        ({"redis_url": "redis://localhost:6379/0"}, "password"),
        ({"frontend_base_url": "http://app.example.com"}, "https"),
        ({"billing_enforced": True}, "way for customers to pay"),
    ],
)
def test_production_refuses_to_start_with_an_unsafe_setup(
    change: dict[str, Any], message: str
) -> None:
    with pytest.raises(ValidationError, match=message):
        Settings(
            **(BASE | change),
            environment="production",
            cors_origins=["https://app.example.com"],
        )
