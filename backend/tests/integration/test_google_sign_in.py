import uuid
from typing import Any
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.v1.google import STATE_COOKIE, get_google_exchange
from app.models import AuditLog, User, UserIdentity
from app.services.email import OutgoingEmail
from app.services.google import GoogleClaims, GoogleSignInError
from tests.integration.conftest import API
from tests.integration.test_auth import (
    AUTH,
    PASSWORD,
    login,
    register,
    token_from,
    unique_email,
    verified_user,
)

pytestmark = pytest.mark.integration

FRONTEND = "http://localhost:3210"
START = f"{AUTH}/google/start"
CALLBACK = f"{AUTH}/google/callback"


@pytest.fixture
def google(app: FastAPI) -> dict[str, Any]:
    """Stands in for Google's token endpoint; ID token checks have their own unit tests."""
    app.state.settings = app.state.settings.model_copy(
        update={"google_client_id": "client-id", "google_client_secret": "client-secret"}
    )
    person: dict[str, Any] = {"subject": uuid.uuid4().hex, "email": unique_email(), "name": "Ada"}

    def exchange(_settings: Any, _code: str, _verifier: str, _nonce: str) -> GoogleClaims:
        if person.get("fail"):
            raise GoogleSignInError("refused")
        return GoogleClaims(person["subject"], person["email"], person["name"])

    app.dependency_overrides[get_google_exchange] = lambda: exchange
    return person


def client_for(app: FastAPI) -> TestClient:
    return TestClient(app, follow_redirects=False)


def start(client: TestClient, **params: Any) -> str:
    response = client.get(START, params=params)
    assert response.status_code == 303
    return parse_qs(urlparse(response.headers["location"]).query)["state"][0]


def finish(client: TestClient, state: str) -> Any:
    return client.get(CALLBACK, params={"state": state, "code": "auth-code"})


def sign_in(client: TestClient, **params: Any) -> Any:
    return finish(client, start(client, **params))


def test_providers_reports_whether_google_is_available(client: TestClient, app: FastAPI) -> None:
    assert client.get(f"{AUTH}/providers").json() == {"google": False}
    app.state.settings = app.state.settings.model_copy(
        update={"google_client_id": "id", "google_client_secret": "secret"}
    )
    assert client.get(f"{AUTH}/providers").json() == {"google": True}


def test_start_without_credentials_returns_to_login(app: FastAPI) -> None:
    response = client_for(app).get(START)
    assert response.status_code == 303
    assert response.headers["location"] == f"{FRONTEND}/login?error=google_unavailable"


def test_first_sign_in_creates_a_verified_account_and_session(
    app: FastAPI, google: dict[str, Any], db: Session
) -> None:
    client = client_for(app)
    response = sign_in(client)
    assert response.status_code == 303
    assert response.headers["location"] == f"{FRONTEND}/dashboard"
    assert client.get(f"{AUTH}/me").json()["user"]["email"] == google["email"]
    user = db.exec(select(User).where(User.email == google["email"])).one()
    assert user.email_verified_at is not None
    assert user.password_hash.startswith("$argon2id$")
    actions = set(db.exec(select(AuditLog.action).where(AuditLog.actor_user_id == user.id)).all())
    assert {"auth.registered", "auth.identity_linked", "auth.login"} <= actions


def test_new_accounts_random_password_is_unusable_but_can_be_reset(
    app: FastAPI, google: dict[str, Any], outbox: list[OutgoingEmail]
) -> None:
    sign_in(client_for(app))
    other = TestClient(app)
    assert login(other, google["email"], PASSWORD).status_code == 401
    other.post(f"{AUTH}/forgot-password", json={"email": google["email"]})
    reset = other.post(
        f"{AUTH}/reset-password",
        json={"token": token_from(outbox[-1]), "new_password": "a-brand-new-long-password"},
    )
    assert reset.status_code == 200
    assert login(other, google["email"], "a-brand-new-long-password").status_code == 200


def test_returning_user_gets_the_same_account_even_if_their_email_changed(
    app: FastAPI, google: dict[str, Any], db: Session
) -> None:
    sign_in(client_for(app))
    first_email = google["email"]
    google["email"] = unique_email()
    client = client_for(app)
    assert sign_in(client).headers["location"] == f"{FRONTEND}/dashboard"
    assert client.get(f"{AUTH}/me").json()["user"]["email"] == first_email
    assert db.exec(select(User).where(User.email == google["email"])).first() is None


def test_existing_verified_account_is_linked_and_the_owner_is_told(
    app: FastAPI, google: dict[str, Any], outbox: list[OutgoingEmail]
) -> None:
    password_client = TestClient(app)
    email = verified_user(password_client, outbox)
    google["email"] = email.upper()
    client = client_for(app)
    assert sign_in(client).headers["location"] == f"{FRONTEND}/dashboard"
    assert client.get(f"{AUTH}/me").json()["user"]["email"] == email
    assert outbox[-1].to == email
    assert "Google sign-in was added" in outbox[-1].subject
    assert login(password_client, email).status_code == 200


def test_attackers_preset_password_stops_working_when_the_owner_uses_google(
    app: FastAPI, google: dict[str, Any], outbox: list[OutgoingEmail]
) -> None:
    """Account pre-hijacking through an unverified registration of the victim's address."""
    plain = TestClient(app)
    victim = unique_email()
    register(plain, victim, password="attackers-known-password")
    attacker_link = token_from(outbox[-1])

    google["email"] = victim
    assert sign_in(client_for(app)).headers["location"] == f"{FRONTEND}/dashboard"

    assert login(plain, victim, "attackers-known-password").status_code == 401
    verifying = plain.post(
        f"{AUTH}/verify-email",
        json={"token": attacker_link, "password": "attackers-known-password"},
    )
    assert verifying.status_code == 400


def test_callback_needs_the_cookie_from_the_same_browser(
    app: FastAPI, google: dict[str, Any]
) -> None:
    """Login CSRF: an attacker's callback link must not sign a victim in."""
    state = start(client_for(app))
    victim = client_for(app)
    response = finish(victim, state)
    assert response.headers["location"] == f"{FRONTEND}/login?error=google_failed"
    assert victim.get(f"{AUTH}/me").status_code == 401


def test_a_callback_works_only_once(app: FastAPI, google: dict[str, Any]) -> None:
    client = client_for(app)
    state = start(client)
    assert finish(client, state).headers["location"] == f"{FRONTEND}/dashboard"
    client.cookies.set(STATE_COOKIE, state, path="/api/v1/auth/google")
    assert finish(client, state).headers["location"] == f"{FRONTEND}/login?error=google_failed"


def test_tampered_state_is_refused(app: FastAPI, google: dict[str, Any]) -> None:
    client = client_for(app)
    start(client)
    response = finish(client, "made-up-state")
    assert response.headers["location"] == f"{FRONTEND}/login?error=google_failed"


def test_cancelling_at_google_returns_with_a_clear_reason(
    app: FastAPI, google: dict[str, Any]
) -> None:
    client = client_for(app)
    state = start(client)
    response = client.get(CALLBACK, params={"state": state, "error": "access_denied"})
    assert response.headers["location"] == f"{FRONTEND}/login?error=google_cancelled"


def test_a_failed_exchange_creates_nothing(
    app: FastAPI, google: dict[str, Any], db: Session
) -> None:
    google["fail"] = True
    client = client_for(app)
    assert sign_in(client).headers["location"] == f"{FRONTEND}/login?error=google_failed"
    assert db.exec(select(User).where(User.email == google["email"])).first() is None
    assert client.get(f"{AUTH}/me").status_code == 401


def test_a_deactivated_account_cannot_get_in_through_google(
    app: FastAPI, google: dict[str, Any], db: Session
) -> None:
    sign_in(client_for(app))
    user = db.exec(select(User).where(User.email == google["email"])).one()
    user.is_active = False
    db.commit()
    client = client_for(app)
    assert sign_in(client).headers["location"] == f"{FRONTEND}/login?error=google_failed"
    assert client.get(f"{AUTH}/me").status_code == 401


def test_a_google_subject_links_to_only_one_account(
    app: FastAPI, google: dict[str, Any], db: Session
) -> None:
    sign_in(client_for(app))
    sign_in(client_for(app))
    rows = db.exec(
        select(UserIdentity).where(UserIdentity.provider_subject == google["subject"])
    ).all()
    assert len(rows) == 1


@pytest.mark.parametrize(
    ("next_path", "expected"),
    [
        ("/organisation/members", "/organisation/members"),
        ("/accept-invitation?token=abc", "/accept-invitation?token=abc"),
        ("https://evil.example.com", "/dashboard"),
        ("//evil.example.com", "/dashboard"),
        ("/\\evil.example.com", "/dashboard"),
        ("evil", "/dashboard"),
    ],
)
def test_return_path_stays_on_this_site(
    app: FastAPI, google: dict[str, Any], next_path: str, expected: str
) -> None:
    response = sign_in(client_for(app), next=next_path)
    assert response.headers["location"] == f"{FRONTEND}{expected}"


def test_session_cookies_are_http_only_and_tokens_are_not_in_the_url(
    app: FastAPI, google: dict[str, Any]
) -> None:
    response = sign_in(client_for(app))
    cookies = response.headers.get_list("set-cookie")
    for name in ("fleetpulse_access=", "fleetpulse_refresh="):
        assert "HttpOnly" in next(cookie for cookie in cookies if cookie.startswith(name))
    assert "token" not in response.headers["location"]


def test_google_user_can_use_the_rest_of_the_app(app: FastAPI, google: dict[str, Any]) -> None:
    client = client_for(app)
    sign_in(client)
    csrf = {"X-CSRF-Token": client.get(f"{AUTH}/me").json()["csrf_token"]}
    created = client.post(
        f"{API}/organisations",
        json={"name": "Via Google", "country_code": "KE", "default_currency": "KES"},
        headers=csrf,
    )
    assert created.status_code == 201
