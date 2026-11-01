import uuid
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest
from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import SecretStr
from redis import Redis
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session

from app.api.deps import get_email_queue
from app.app_factory import create_app
from app.core.config import get_settings
from app.db.provision_app_role import provision_app_role
from app.db.session import get_session
from app.models import Driver, Organisation, TrackingDevice, User, Vehicle
from app.models.enums import FuelType, VehicleType
from app.services.email import OutgoingEmail

BACKEND_DIR = Path(__file__).resolve().parents[2]
ORIGIN = "http://localhost:3210"
API = "/api/v1"
NEW_ORG = {"name": "Swift Logistics", "country_code": "KE", "default_currency": "KES"}


def alembic_config(url: str) -> Config:
    config = Config(BACKEND_DIR / "alembic.ini")
    config.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    config.attributes["database_url"] = url
    config.attributes["configure_logger"] = False
    return config


@contextmanager
def scratch_database(name: str) -> Iterator[str]:
    """A throwaway database beside the configured one. The dev database is never touched."""
    settings = get_settings()
    base_url = make_url(str(settings.migration_database_url or settings.database_url))
    admin = create_engine(base_url, isolation_level="AUTOCOMMIT")
    with admin.connect() as connection:
        connection.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        connection.execute(text(f'CREATE DATABASE "{name}"'))
    try:
        yield base_url.set(database=name).render_as_string(hide_password=False)
    finally:
        with admin.connect() as connection:
            connection.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        admin.dispose()


@pytest.fixture(scope="session")
def test_database_url() -> Iterator[str]:
    with scratch_database("fleetpulse_test") as url:
        command.upgrade(alembic_config(url), "head")
        yield url


@pytest.fixture(scope="session")
def migrated_engine(test_database_url: str) -> Iterator[Engine]:
    """Connects as the owner, for arranging test data and inspecting results."""
    engine = create_engine(test_database_url)
    yield engine
    engine.dispose()


@pytest.fixture(scope="session")
def app_engine(test_database_url: str) -> Iterator[Engine]:
    """Connects as the restricted role, exactly as the running app does."""
    app_url = make_url(str(get_settings().database_url)).set(database="fleetpulse_test")
    rendered = app_url.render_as_string(hide_password=False)
    provision_app_role(test_database_url, rendered)
    engine = create_engine(rendered)
    yield engine
    engine.dispose()


@pytest.fixture
def session(migrated_engine: Engine) -> Iterator[Session]:
    """Each test runs in a transaction that is rolled back, including any DDL."""
    with migrated_engine.connect() as connection:
        transaction = connection.begin()
        with Session(bind=connection, join_transaction_mode="create_savepoint") as db:
            yield db
        transaction.rollback()


@pytest.fixture
def assert_rejected(session: Session) -> Callable[..., None]:
    def check(*rows: Any, constraint: str) -> None:
        with pytest.raises(IntegrityError, match=constraint), session.begin_nested():
            session.add_all(rows)
            session.flush()

    return check


@pytest.fixture
def make_org(session: Session) -> Callable[[], Organisation]:
    def factory() -> Organisation:
        org = Organisation(
            name="Org",
            slug=f"org-{uuid.uuid4().hex[:12]}",
            country_code="KE",
            default_currency="KES",
        )
        session.add(org)
        session.flush()
        return org

    return factory


@pytest.fixture
def make_vehicle(session: Session) -> Callable[..., Vehicle]:
    def factory(org: Organisation, registration: str | None = None) -> Vehicle:
        vehicle = Vehicle(
            organisation_id=org.id,
            registration_number=registration or uuid.uuid4().hex[:10],
            make="Toyota",
            model="Hilux",
            vehicle_type=VehicleType.PICKUP,
            fuel_type=FuelType.DIESEL,
        )
        session.add(vehicle)
        session.flush()
        return vehicle

    return factory


@pytest.fixture
def make_driver(session: Session) -> Callable[[Organisation], Driver]:
    def factory(org: Organisation) -> Driver:
        driver = Driver(
            organisation_id=org.id,
            first_name="Test",
            last_name="Driver",
            licence_number=uuid.uuid4().hex[:12],
        )
        session.add(driver)
        session.flush()
        return driver

    return factory


@pytest.fixture
def make_device(session: Session) -> Callable[[Organisation], TrackingDevice]:
    def factory(org: Organisation) -> TrackingDevice:
        device = TrackingDevice(
            organisation_id=org.id, provider="test", external_device_id=uuid.uuid4().hex
        )
        session.add(device)
        session.flush()
        return device

    return factory


@pytest.fixture
def make_user(session: Session) -> Callable[[], User]:
    def factory() -> User:
        user = User(
            email=f"{uuid.uuid4().hex}@example.com",
            password_hash="not-a-real-hash",
            full_name="Test User",
        )
        session.add(user)
        session.flush()
        return user

    return factory


@pytest.fixture
def outbox() -> list[OutgoingEmail]:
    return []


@pytest.fixture
def app(app_engine: Engine, outbox: list[OutgoingEmail]) -> Iterator[FastAPI]:
    settings = get_settings().model_copy(
        update={
            "environment": "test",
            "storage_endpoint_url": "http://localhost:9010",
            "storage_public_url": "http://localhost:9010",
            "storage_bucket": "fleetpulse-test",
            "storage_access_key": "fleetpulse-local",
            "storage_secret_key": SecretStr("fleetpulse-local-secret"),
            "redis_url": "redis://localhost:6390/15",  # a separate, disposable Redis database
            "cors_origins": [ORIGIN],
            "login_max_failures_per_email_ip": 3,
            "auth_min_response_ms": 0,
            "gps_simulator_enabled": False,
            "organisations_per_hour_per_user": 100,
            "auth_emails_per_hour_per_address": 3,
            "auth_requests_per_hour_per_ip": 100,
        }
    )
    application = create_app(settings)
    redis = Redis.from_url(str(settings.redis_url))
    application.state.redis = redis
    redis.flushdb()

    def override_session() -> Iterator[Session]:
        with Session(app_engine) as db:
            yield db

    application.dependency_overrides[get_session] = override_session
    application.dependency_overrides[get_email_queue] = lambda: outbox.append
    yield application
    redis.flushdb()


@pytest.fixture
def client(app: FastAPI) -> TestClient:
    return TestClient(app)


@pytest.fixture
def db(migrated_engine: Engine) -> Iterator[Session]:
    with Session(migrated_engine) as session:
        yield session


@dataclass
class Member:
    client: TestClient
    csrf: dict[str, str]
    email: str
    organisation_id: str


@pytest.fixture
def new_owner(app: FastAPI, outbox: list[OutgoingEmail]) -> Callable[[], Member]:
    from tests.integration.test_auth import signed_in

    def factory() -> Member:
        client = TestClient(app)
        email, csrf = signed_in(client, outbox)
        response = client.post(f"{API}/organisations", json=NEW_ORG, headers=csrf)
        assert response.status_code == 201, response.text
        return Member(client, csrf, email, response.json()["id"])

    return factory


@pytest.fixture
def invite(app: FastAPI, outbox: list[OutgoingEmail]) -> Callable[..., Member]:
    """Adds a new verified person to the owner's organisation with the given role."""
    from tests.integration.test_auth import signed_in, token_from

    def factory(owner: Member, role: str) -> Member:
        client = TestClient(app)
        email, csrf = signed_in(client, outbox)
        created = owner.client.post(
            f"{API}/organisation/invitations",
            json={"email": email, "role": role},
            headers=owner.csrf,
        )
        assert created.status_code == 201, created.text
        accepted = client.post(
            f"{API}/invitations/accept", json={"token": token_from(outbox[-1])}, headers=csrf
        )
        assert accepted.status_code == 200, accepted.text
        return Member(client, csrf, email, owner.organisation_id)

    return factory
