from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.app_factory import create_app
from app.core.config import Settings
from app.services.health import check_dependencies

ALLOWED_ORIGIN = "http://localhost:3210"


def make_settings(**overrides: Any) -> Settings:
    values: dict[str, Any] = {
        "_env_file": None,
        "environment": "test",
        "database_url": "postgresql+psycopg://user:pass@localhost:5432/db",
        "redis_url": "redis://:unit-test@localhost:6379/0",
        "cors_origins": [ALLOWED_ORIGIN],
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
    return Settings(**(values | overrides))


@pytest.fixture
def app() -> FastAPI:
    return create_app(make_settings())


def test_liveness_needs_no_dependencies(app: FastAPI) -> None:
    response = TestClient(app).get("/api/v1/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_readiness_ok_when_all_dependencies_are_up(app: FastAPI) -> None:
    app.dependency_overrides[check_dependencies] = lambda: {"database": "ok", "redis": "ok"}
    response = TestClient(app).get("/api/v1/health/ready")
    assert response.status_code == 200
    assert response.json()["status"] == "ready"


def test_readiness_returns_503_when_a_dependency_is_down(app: FastAPI) -> None:
    app.dependency_overrides[check_dependencies] = lambda: {
        "database": "unavailable",
        "redis": "ok",
    }
    response = TestClient(app).get("/api/v1/health/ready")
    assert response.status_code == 503
    assert response.json() == {
        "status": "not_ready",
        "checks": {"database": "unavailable", "redis": "ok"},
    }


def test_responses_carry_a_server_generated_request_id(app: FastAPI) -> None:
    response = TestClient(app).get("/api/v1/health", headers={"X-Request-ID": "forged"})
    assert response.headers["X-Request-ID"] != "forged"


def test_cors_allows_only_the_configured_origin(app: FastAPI) -> None:
    client = TestClient(app)
    allowed = client.get("/api/v1/health", headers={"Origin": ALLOWED_ORIGIN})
    denied = client.get("/api/v1/health", headers={"Origin": "https://evil.example.com"})
    assert allowed.headers["access-control-allow-origin"] == ALLOWED_ORIGIN
    assert allowed.headers["access-control-allow-credentials"] == "true"
    assert "access-control-allow-origin" not in denied.headers


def test_api_docs_are_hidden_in_production() -> None:
    settings = make_settings(environment="production", cors_origins=[])
    client = TestClient(create_app(settings))
    assert client.get("/docs").status_code == 404
    assert client.get("/openapi.json").status_code == 404
