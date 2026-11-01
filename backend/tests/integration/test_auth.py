import re
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from redis import Redis
from sqlmodel import Session, col, select

from app.models import AuditLog, AuthSession, PasswordResetToken, RefreshToken, User
from app.models.base import utcnow
from app.services.email import OutgoingEmail
from tests.integration.conftest import ORIGIN

pytestmark = pytest.mark.integration

PASSWORD = "correct-horse-battery"
NEW_PASSWORD = "a-brand-new-long-password"
AUTH = "/api/v1/auth"
TOKEN_IN_LINK = re.compile(r"token=([\w-]+)")


def unique_email() -> str:
    return f"{uuid.uuid4().hex}@example.com"


def token_from(email: OutgoingEmail) -> str:
    match = TOKEN_IN_LINK.search(email.body)
    assert match is not None
    return match[1]


def register(client: TestClient, email: str, password: str = PASSWORD) -> Any:
    return client.post(
        f"{AUTH}/register", json={"email": email, "password": password, "full_name": "Ada"}
    )


def verified_user(client: TestClient, outbox: list[OutgoingEmail]) -> str:
    email = unique_email()
    assert register(client, email).status_code == 202
    assert client.post(
        f"{AUTH}/verify-email", json={"token": token_from(outbox[-1]), "password": PASSWORD}
    ).is_success
    return email


def login(client: TestClient, email: str, password: str = PASSWORD) -> Any:
    return client.post(f"{AUTH}/login", json={"email": email, "password": password})


def signed_in(client: TestClient, outbox: list[OutgoingEmail]) -> tuple[str, dict[str, str]]:
    email = verified_user(client, outbox)
    response = login(client, email)
    assert response.status_code == 200
    return email, {"X-CSRF-Token": response.json()["csrf_token"]}


def audit_actions(db: Session, email: str) -> list[str]:
    user = db.exec(select(User).where(User.email == email)).one()
    return list(db.exec(select(AuditLog.action).where(AuditLog.actor_user_id == user.id)).all())


# Registration and verification


def test_register_stores_only_a_hash_and_sends_verification(
    client: TestClient, db: Session, outbox: list[OutgoingEmail]
) -> None:
    email = unique_email()
    response = register(client, email.upper())
    assert response.status_code == 202
    user = db.exec(select(User).where(User.email == email)).one()
    assert user.password_hash.startswith("$argon2id$")
    assert PASSWORD not in user.password_hash
    assert user.email_verified_at is None
    assert outbox[-1].to == email
    assert "verify-email?token=" in outbox[-1].body


def test_registering_a_taken_address_looks_the_same_to_the_caller(
    client: TestClient, outbox: list[OutgoingEmail]
) -> None:
    email = verified_user(client, outbox)
    new = register(client, unique_email())
    taken = register(client, email, password="a-different-password")
    assert (taken.status_code, taken.json()) == (new.status_code, new.json())
    assert outbox[-1].to == email
    assert "already has an account" in outbox[-1].body
    assert login(client, email, "a-different-password").status_code == 401


@pytest.mark.parametrize(
    ("payload", "field"),
    [
        ({"email": "not-an-email", "password": PASSWORD, "full_name": "A"}, "email"),
        ({"email": "a@example.com", "password": "short", "full_name": "A"}, "password"),
        ({"email": "a@example.com", "password": "x" * 129, "full_name": "A"}, "password"),
        ({"email": "a@example.com", "password": PASSWORD, "full_name": ""}, "full_name"),
    ],
)
def test_register_validates_input(client: TestClient, payload: dict[str, str], field: str) -> None:
    response = client.post(f"{AUTH}/register", json=payload)
    assert response.status_code == 422
    assert field in response.json()["error"]["fields"][0]["field"]


def test_validation_errors_never_echo_the_submitted_password(client: TestClient) -> None:
    response = client.post(
        f"{AUTH}/register",
        json={"email": "a@example.com", "password": "shortsecret", "full_name": "A"},
    )
    assert response.status_code == 422
    assert "shortsecret" not in response.text


def test_register_rejects_unknown_fields(client: TestClient) -> None:
    response = client.post(
        f"{AUTH}/register",
        json={
            "email": unique_email(),
            "password": PASSWORD,
            "full_name": "A",
            "is_platform_admin": True,
        },
    )
    assert response.status_code == 422


def test_preregistered_password_cannot_be_activated_by_the_real_owner(
    client: TestClient, outbox: list[OutgoingEmail]
) -> None:
    """Account pre-hijacking: an attacker registers first with a password they know."""
    attacker_password = "attackers-known-password"
    victim = unique_email()
    register(client, victim, password=attacker_password)
    attacker_link = token_from(outbox[-1])

    # The owner clicks the link they received. Without the attacker's password, nothing happens.
    attempt = client.post(
        f"{AUTH}/verify-email", json={"token": attacker_link, "password": PASSWORD}
    )
    assert attempt.status_code == 400
    assert login(client, victim, attacker_password).status_code == 403

    # Registering later doesn't send a working link either.
    register(client, victim)
    assert "verify-email" not in outbox[-1].body
    assert "forgot-password" in outbox[-1].body

    # A reset replaces the attacker's password for good.
    client.post(f"{AUTH}/forgot-password", json={"email": victim})
    reset = client.post(
        f"{AUTH}/reset-password",
        json={"token": token_from(outbox[-1]), "new_password": NEW_PASSWORD},
    )
    assert reset.status_code == 200
    assert login(client, victim, attacker_password).status_code == 401
    assert login(client, victim, NEW_PASSWORD).status_code == 200


def test_mistyped_password_does_not_use_up_the_verification_link(
    client: TestClient, outbox: list[OutgoingEmail]
) -> None:
    register(client, unique_email())
    token = token_from(outbox[-1])
    wrong = {"token": token, "password": "not-what-was-chosen"}
    assert client.post(f"{AUTH}/verify-email", json=wrong).status_code == 400
    right = {"token": token, "password": PASSWORD}
    assert client.post(f"{AUTH}/verify-email", json=right).status_code == 200


@pytest.mark.parametrize(
    ("password", "email", "code"),
    [
        ("password12345", None, "weak_password"),
        ("aaaaaaaaaaaaaa", None, "weak_password"),
        ("my-jonathan-secret-99", "jonathan@example.com", "weak_password"),
    ],
)
def test_weak_passwords_are_rejected(
    client: TestClient, password: str, email: str | None, code: str
) -> None:
    response = register(client, email or unique_email(), password=password)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == code


def test_display_names_cannot_inject_lines_into_emails(client: TestClient) -> None:
    response = client.post(
        f"{AUTH}/register",
        json={"email": unique_email(), "password": PASSWORD, "full_name": "Ada\nClick here"},
    )
    assert response.status_code == 422


def test_verification_link_works_only_once(client: TestClient, outbox: list[OutgoingEmail]) -> None:
    register(client, unique_email())
    token = token_from(outbox[-1])
    assert (
        client.post(f"{AUTH}/verify-email", json={"token": token, "password": PASSWORD}).status_code
        == 200
    )
    assert (
        client.post(f"{AUTH}/verify-email", json={"token": token, "password": PASSWORD}).status_code
        == 400
    )


def test_a_newer_verification_email_cancels_the_older_link(
    client: TestClient, outbox: list[OutgoingEmail]
) -> None:
    email = unique_email()
    register(client, email)
    first = token_from(outbox[-1])
    assert client.post(f"{AUTH}/resend-verification", json={"email": email}).status_code == 202
    second = token_from(outbox[-1])
    assert (
        client.post(f"{AUTH}/verify-email", json={"token": first, "password": PASSWORD}).status_code
        == 400
    )
    assert (
        client.post(
            f"{AUTH}/verify-email", json={"token": second, "password": PASSWORD}
        ).status_code
        == 200
    )


def test_resend_for_unknown_address_looks_the_same(
    client: TestClient, outbox: list[OutgoingEmail]
) -> None:
    email = unique_email()
    register(client, email)
    known = client.post(f"{AUTH}/resend-verification", json={"email": email})
    sent = len(outbox)
    unknown = client.post(f"{AUTH}/resend-verification", json={"email": unique_email()})
    assert (unknown.status_code, unknown.json()) == (known.status_code, known.json())
    assert len(outbox) == sent


# Login


def test_login_requires_verified_email_and_correct_password(
    client: TestClient, outbox: list[OutgoingEmail]
) -> None:
    email = unique_email()
    register(client, email)
    assert login(client, email, "wrong-password").status_code == 401
    unverified = login(client, email)
    assert unverified.status_code == 403
    assert unverified.json()["error"]["code"] == "email_not_verified"
    assert "fleetpulse_access" not in unverified.cookies


def test_wrong_password_and_unknown_user_get_the_same_response(
    client: TestClient, outbox: list[OutgoingEmail]
) -> None:
    email = verified_user(client, outbox)
    wrong = login(client, email, "wrong-password")
    unknown = login(client, unique_email(), "wrong-password")
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json()


def test_login_sets_http_only_cookies_scoped_correctly(
    client: TestClient, outbox: list[OutgoingEmail]
) -> None:
    response = login(client, verified_user(client, outbox))
    cookies = response.headers.get_list("set-cookie")
    access = next(cookie for cookie in cookies if cookie.startswith("fleetpulse_access="))
    refresh = next(cookie for cookie in cookies if cookie.startswith("fleetpulse_refresh="))
    for cookie in (access, refresh):
        assert "HttpOnly" in cookie
        assert "SameSite=lax" in cookie
    assert "Path=/;" in access
    assert "Path=/api/v1/auth" in refresh
    assert "fleetpulse_access" not in response.text
    assert "access_token" not in response.json()


def test_repeated_failures_lock_login_even_with_the_right_password(
    client: TestClient, outbox: list[OutgoingEmail]
) -> None:
    email = verified_user(client, outbox)
    for _ in range(3):
        assert login(client, email, "wrong-password").status_code == 401
    locked = login(client, email)
    assert locked.status_code == 429
    assert "Retry-After" in locked.headers


def test_failures_from_one_address_do_not_lock_out_the_real_user_elsewhere(
    app: FastAPI, outbox: list[OutgoingEmail]
) -> None:
    attacker = TestClient(app, client=("203.0.113.1", 50000))
    owner = TestClient(app, client=("198.51.100.1", 50000))
    email = verified_user(owner, outbox)
    for _ in range(3):
        assert login(attacker, email, "wrong-password").status_code == 401
    assert login(attacker, email).status_code == 429
    assert login(owner, email).status_code == 200


def test_distributed_guessing_hits_the_per_email_ceiling(
    app: FastAPI, outbox: list[OutgoingEmail]
) -> None:
    app.state.settings = app.state.settings.model_copy(update={"login_max_failures_per_email": 4})
    owner = TestClient(app, client=("198.51.100.1", 50000))
    email = verified_user(owner, outbox)
    for number in range(4):
        guesser = TestClient(app, client=(f"203.0.113.{number}", 50000))
        assert login(guesser, email, "wrong-password").status_code == 401
    assert login(TestClient(app, client=("203.0.113.99", 50000)), email).status_code == 429


def test_enumerable_endpoints_take_at_least_the_minimum_time(
    app: FastAPI, client: TestClient
) -> None:
    app.state.settings = app.state.settings.model_copy(update={"auth_min_response_ms": 200})
    started = time.monotonic()
    client.post(f"{AUTH}/forgot-password", json={"email": unique_email()})
    assert time.monotonic() - started >= 0.2


def test_responses_carry_security_headers(client: TestClient) -> None:
    headers = client.get("/api/v1/health").headers
    assert headers["X-Content-Type-Options"] == "nosniff"
    assert headers["X-Frame-Options"] == "DENY"
    assert headers["Referrer-Policy"] == "no-referrer"
    assert headers["Cache-Control"] == "no-store"


def test_successful_login_clears_the_failure_count(
    client: TestClient, outbox: list[OutgoingEmail]
) -> None:
    email = verified_user(client, outbox)
    for _ in range(2):
        login(client, email, "wrong-password")
    assert login(client, email).status_code == 200
    for _ in range(2):
        assert login(client, email, "wrong-password").status_code == 401
    assert login(client, email).status_code == 200


def test_login_fails_closed_when_redis_is_down(
    app: FastAPI, client: TestClient, outbox: list[OutgoingEmail]
) -> None:
    email = verified_user(client, outbox)
    app.state.redis = Redis.from_url("redis://127.0.0.1:1/0", socket_connect_timeout=1)
    assert login(client, email).status_code == 503


def test_inactive_user_cannot_sign_in(
    client: TestClient, db: Session, outbox: list[OutgoingEmail]
) -> None:
    email = verified_user(client, outbox)
    user = db.exec(select(User).where(User.email == email)).one()
    user.is_active = False
    db.commit()
    assert login(client, email).status_code == 401


def test_me_requires_a_session_and_never_returns_the_hash(
    client: TestClient, outbox: list[OutgoingEmail]
) -> None:
    assert client.get(f"{AUTH}/me").status_code == 401
    email, _ = signed_in(client, outbox)
    response = client.get(f"{AUTH}/me")
    assert response.status_code == 200
    assert response.json()["user"]["email"] == email
    assert "password" not in response.text
    assert "argon2" not in response.text


def test_deactivating_a_user_ends_access_immediately(
    client: TestClient, db: Session, outbox: list[OutgoingEmail]
) -> None:
    email, _ = signed_in(client, outbox)
    user = db.exec(select(User).where(User.email == email)).one()
    user.is_active = False
    db.commit()
    assert client.get(f"{AUTH}/me").status_code == 401


# Refresh rotation


def refresh_cookie(client: TestClient) -> str:
    value = client.cookies.get("fleetpulse_refresh")
    assert value is not None
    return value


def post_refresh(client: TestClient, token: str) -> Any:
    client.cookies.delete("fleetpulse_refresh", path="/api/v1/auth")
    client.cookies.set("fleetpulse_refresh", token, path="/api/v1/auth")
    return client.post(f"{AUTH}/refresh")


def test_refresh_rotates_the_token_and_stores_only_hashes(
    client: TestClient, db: Session, outbox: list[OutgoingEmail]
) -> None:
    signed_in(client, outbox)
    old = refresh_cookie(client)
    response = client.post(f"{AUTH}/refresh")
    assert response.status_code == 200
    new = refresh_cookie(client)
    assert new != old
    assert client.get(f"{AUTH}/me").status_code == 200
    stored = db.exec(select(RefreshToken.token_hash)).all()
    assert old not in stored
    assert new not in stored


def test_refresh_without_a_cookie_is_rejected(client: TestClient) -> None:
    assert client.post(f"{AUTH}/refresh").status_code == 401


def test_replaying_a_token_within_the_grace_window_does_not_end_the_session(
    client: TestClient, outbox: list[OutgoingEmail]
) -> None:
    signed_in(client, outbox)
    old = refresh_cookie(client)
    assert client.post(f"{AUTH}/refresh").status_code == 200
    new = refresh_cookie(client)
    assert post_refresh(client, old).status_code == 409
    assert post_refresh(client, new).status_code == 200


def test_simultaneous_refreshes_rotate_only_once(app: FastAPI, outbox: list[OutgoingEmail]) -> None:
    signed_in_client = TestClient(app)
    signed_in(signed_in_client, outbox)
    token = refresh_cookie(signed_in_client)

    def attempt(_: int) -> int:
        tab = TestClient(app)
        tab.cookies.set("fleetpulse_refresh", token, path="/api/v1/auth")
        return tab.post(f"{AUTH}/refresh").status_code

    with ThreadPoolExecutor(max_workers=4) as pool:
        statuses = sorted(pool.map(attempt, range(4)))
    assert statuses == [200, 409, 409, 409]


def test_replaying_an_old_token_revokes_the_whole_session(
    client: TestClient, db: Session, outbox: list[OutgoingEmail]
) -> None:
    email, _ = signed_in(client, outbox)
    stolen = refresh_cookie(client)
    assert client.post(f"{AUTH}/refresh").status_code == 200
    current = refresh_cookie(client)

    consumed = db.exec(select(RefreshToken).where(col(RefreshToken.consumed_at).is_not(None))).all()
    for token in consumed:
        token.consumed_at = utcnow() - timedelta(minutes=5)
    db.commit()

    reuse = post_refresh(client, stolen)
    assert reuse.status_code == 401
    assert "fleetpulse_refresh=" in reuse.headers.get("set-cookie", "")
    assert post_refresh(client, current).status_code == 401
    assert "auth.refresh_reuse_detected" in audit_actions(db, email)


def test_expired_refresh_token_is_rejected(
    client: TestClient, db: Session, outbox: list[OutgoingEmail]
) -> None:
    signed_in(client, outbox)
    for token in db.exec(select(RefreshToken).where(col(RefreshToken.consumed_at).is_(None))):
        token.expires_at = utcnow() - timedelta(seconds=1)
    db.commit()
    assert client.post(f"{AUTH}/refresh").status_code == 401


def test_session_cannot_be_extended_past_its_absolute_limit(
    client: TestClient, db: Session, outbox: list[OutgoingEmail]
) -> None:
    email, _ = signed_in(client, outbox)
    user = db.exec(select(User).where(User.email == email)).one()
    auth_session = db.exec(select(AuthSession).where(AuthSession.user_id == user.id)).one()
    auth_session.created_at = utcnow() - timedelta(days=89)
    db.commit()
    assert client.post(f"{AUTH}/refresh").status_code == 200
    db.refresh(auth_session)
    assert auth_session.expires_at <= auth_session.created_at + timedelta(days=90)


# Logout and sessions


def test_logout_revokes_the_session_immediately(
    client: TestClient, outbox: list[OutgoingEmail]
) -> None:
    _, csrf = signed_in(client, outbox)
    access = client.cookies.get("fleetpulse_access")
    assert client.post(f"{AUTH}/logout", headers=csrf).status_code == 204
    # The access token hasn't expired, but its session is gone.
    client.cookies.set("fleetpulse_access", access or "")
    assert client.get(f"{AUTH}/me").status_code == 401


def test_logout_all_ends_every_device(app: FastAPI, outbox: list[OutgoingEmail]) -> None:
    laptop, phone = TestClient(app), TestClient(app)
    email, csrf = signed_in(laptop, outbox)
    assert login(phone, email).status_code == 200
    assert laptop.post(f"{AUTH}/logout-all", headers=csrf).status_code == 204
    assert phone.get(f"{AUTH}/me").status_code == 401


def test_user_can_list_and_revoke_their_own_sessions(
    app: FastAPI, outbox: list[OutgoingEmail]
) -> None:
    laptop, phone = TestClient(app), TestClient(app)
    email, csrf = signed_in(laptop, outbox)
    login(phone, email)
    sessions = laptop.get(f"{AUTH}/sessions").json()
    assert len(sessions) == 2
    other = next(item for item in sessions if not item["is_current"])
    assert laptop.delete(f"{AUTH}/sessions/{other['id']}", headers=csrf).status_code == 204
    assert phone.get(f"{AUTH}/me").status_code == 401
    assert laptop.get(f"{AUTH}/me").status_code == 200
    assert len(laptop.get(f"{AUTH}/sessions").json()) == 1


def test_user_cannot_revoke_someone_elses_session(
    app: FastAPI, outbox: list[OutgoingEmail]
) -> None:
    attacker, victim = TestClient(app), TestClient(app)
    _, attacker_csrf = signed_in(attacker, outbox)
    signed_in(victim, outbox)
    victim_session = victim.get(f"{AUTH}/sessions").json()[0]["id"]
    response = attacker.delete(f"{AUTH}/sessions/{victim_session}", headers=attacker_csrf)
    assert response.status_code == 404
    assert victim.get(f"{AUTH}/me").status_code == 200


# CSRF and origin


@pytest.mark.parametrize(
    "header",
    [{}, {"X-CSRF-Token": "wrong"}],
    ids=["missing", "wrong"],
)
def test_state_changes_need_the_csrf_token(
    client: TestClient, outbox: list[OutgoingEmail], header: dict[str, str]
) -> None:
    signed_in(client, outbox)
    response = client.post(f"{AUTH}/logout", headers=header)
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "invalid_csrf_token"
    assert client.get(f"{AUTH}/me").status_code == 200


def test_another_sessions_csrf_token_is_rejected(app: FastAPI, outbox: list[OutgoingEmail]) -> None:
    first, second = TestClient(app), TestClient(app)
    _, first_csrf = signed_in(first, outbox)
    signed_in(second, outbox)
    assert second.post(f"{AUTH}/logout", headers=first_csrf).status_code == 403


def test_requests_from_an_untrusted_origin_are_rejected(
    client: TestClient, outbox: list[OutgoingEmail]
) -> None:
    email = verified_user(client, outbox)
    response = client.post(
        f"{AUTH}/login",
        json={"email": email, "password": PASSWORD},
        headers={"Origin": "https://evil.example.com"},
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "untrusted_origin"
    trusted = client.post(
        f"{AUTH}/login", json={"email": email, "password": PASSWORD}, headers={"Origin": ORIGIN}
    )
    assert trusted.status_code == 200


# Password reset and change


def test_forgot_password_looks_the_same_for_known_and_unknown_addresses(
    client: TestClient, outbox: list[OutgoingEmail]
) -> None:
    email = verified_user(client, outbox)
    known = client.post(f"{AUTH}/forgot-password", json={"email": email})
    sent = len(outbox)
    unknown = client.post(f"{AUTH}/forgot-password", json={"email": unique_email()})
    assert (unknown.status_code, unknown.json()) == (known.status_code, known.json())
    assert len(outbox) == sent


def test_password_reset_changes_password_and_ends_all_sessions(
    app: FastAPI, db: Session, outbox: list[OutgoingEmail]
) -> None:
    client = TestClient(app)
    email, _ = signed_in(client, outbox)
    anonymous = TestClient(app)
    anonymous.post(f"{AUTH}/forgot-password", json={"email": email})
    token = token_from(outbox[-1])

    response = anonymous.post(
        f"{AUTH}/reset-password", json={"token": token, "new_password": NEW_PASSWORD}
    )
    assert response.status_code == 200
    assert client.get(f"{AUTH}/me").status_code == 401
    assert login(anonymous, email, PASSWORD).status_code == 401
    assert login(anonymous, email, NEW_PASSWORD).status_code == 200
    assert outbox[-1].subject == "Your FleetPulse password was changed"
    assert {"auth.password_reset_requested", "auth.password_reset"} <= set(audit_actions(db, email))


def test_reset_link_works_only_once_and_expires(
    client: TestClient, db: Session, outbox: list[OutgoingEmail]
) -> None:
    email = verified_user(client, outbox)
    client.post(f"{AUTH}/forgot-password", json={"email": email})
    token = token_from(outbox[-1])
    payload = {"token": token, "new_password": NEW_PASSWORD}
    assert client.post(f"{AUTH}/reset-password", json=payload).status_code == 200
    assert client.post(f"{AUTH}/reset-password", json=payload).status_code == 400

    client.post(f"{AUTH}/forgot-password", json={"email": email})
    expiring = token_from(outbox[-1])
    user = db.exec(select(User).where(User.email == email)).one()
    for row in db.exec(select(PasswordResetToken).where(PasswordResetToken.user_id == user.id)):
        row.expires_at = utcnow() - timedelta(seconds=1)
    db.commit()
    assert (
        client.post(
            f"{AUTH}/reset-password", json={"token": expiring, "new_password": NEW_PASSWORD}
        ).status_code
        == 400
    )


def test_reset_tokens_are_stored_only_as_hashes(
    client: TestClient, db: Session, outbox: list[OutgoingEmail]
) -> None:
    email = verified_user(client, outbox)
    client.post(f"{AUTH}/forgot-password", json={"email": email})
    assert token_from(outbox[-1]) not in db.exec(select(PasswordResetToken.token_hash)).all()


def test_change_password_needs_the_current_one_and_ends_other_sessions(
    app: FastAPI, db: Session, outbox: list[OutgoingEmail]
) -> None:
    laptop, phone = TestClient(app), TestClient(app)
    email, csrf = signed_in(laptop, outbox)
    login(phone, email)

    wrong = laptop.post(
        f"{AUTH}/change-password",
        json={"current_password": "wrong-password", "new_password": NEW_PASSWORD},
        headers=csrf,
    )
    assert wrong.status_code == 400
    assert phone.get(f"{AUTH}/me").status_code == 200

    changed = laptop.post(
        f"{AUTH}/change-password",
        json={"current_password": PASSWORD, "new_password": NEW_PASSWORD},
        headers=csrf,
    )
    assert changed.status_code == 204
    assert laptop.get(f"{AUTH}/me").status_code == 200
    assert phone.get(f"{AUTH}/me").status_code == 401
    assert "auth.password_changed" in audit_actions(db, email)


def test_emails_to_one_address_are_rate_limited(
    client: TestClient, outbox: list[OutgoingEmail]
) -> None:
    email = verified_user(client, outbox)
    statuses = [
        client.post(f"{AUTH}/forgot-password", json={"email": email}).status_code for _ in range(4)
    ]
    assert statuses == [202, 202, 202, 429]


# Audit


def test_audit_details_contain_no_secrets(
    client: TestClient, db: Session, outbox: list[OutgoingEmail]
) -> None:
    email, csrf = signed_in(client, outbox)
    client.post(f"{AUTH}/logout", headers=csrf)
    user = db.exec(select(User).where(User.email == email)).one()
    rows = db.exec(select(AuditLog).where(AuditLog.actor_user_id == user.id)).all()
    assert {"auth.registered", "auth.email_verified", "auth.login", "auth.logout"} <= {
        row.action for row in rows
    }
    serialized = str([row.details for row in rows])
    assert PASSWORD not in serialized
    assert "token" not in serialized
