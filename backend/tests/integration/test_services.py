import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.app_factory import create_app
from app.core.config import get_settings
from app.db.session import get_engine
from app.services.health import check_database, check_redis

pytestmark = pytest.mark.integration


def test_postgis_is_installed() -> None:
    with get_engine().connect() as connection:
        version = connection.execute(text("SELECT PostGIS_Version()")).scalar_one()
    assert version.startswith("3.5")


def test_database_check_reports_ok() -> None:
    assert check_database() == "ok"


def test_redis_check_reports_ok() -> None:
    assert check_redis() == "ok"


def test_readiness_endpoint_against_real_services() -> None:
    response = TestClient(create_app(get_settings())).get("/api/v1/health/ready")
    assert response.status_code == 200
    assert response.json() == {
        "status": "ready",
        "checks": {"database": "ok", "redis": "ok"},
    }


def test_redis_check_reports_unavailable_for_an_unreachable_server(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = get_settings().model_copy(update={"redis_url": "redis://127.0.0.1:1/0"})
    monkeypatch.setattr("app.services.health.get_settings", lambda: settings)
    assert check_redis() == "unavailable"


def test_ping_task_runs() -> None:
    from app.worker.tasks import ping

    assert ping.apply().get(timeout=5) == "pong"
