import smtplib
from collections.abc import Callable
from datetime import timedelta
from typing import Any

import pytest
from fastapi import FastAPI
from sqlalchemy import Engine, text
from sqlmodel import Session

from app.core.config import Settings
from app.models.base import utcnow
from app.services import notifications as service
from tests.integration.conftest import API, Member
from tests.integration.test_compliance import defect
from tests.integration.test_tracking import vehicle

pytestmark = pytest.mark.integration

NOTES = f"{API}/notifications"
RULES = f"{API}/automation/rules"
RUNS = f"{API}/automation/runs"


class Mailbox:
    def __init__(self) -> None:
        self.sent: list[tuple[str, str, str]] = []
        self.failures = 0

    def __call__(self, to: str, subject: str, body: str) -> None:
        if self.failures > 0:
            self.failures -= 1
            raise smtplib.SMTPException("down")
        self.sent.append((to, subject, body))


@pytest.fixture
def mailbox() -> Mailbox:
    return Mailbox()


@pytest.fixture
def run(app: FastAPI, app_engine: Engine, mailbox: Mailbox) -> Callable[[], None]:
    settings: Settings = app.state.settings

    def go() -> None:
        with Session(app_engine) as db:
            service.dispatch(db, settings, mailbox)

    return go


@pytest.fixture
def owner(new_owner: Callable[[], Member]) -> Member:
    return new_owner()


@pytest.fixture
def car(owner: Member) -> str:
    return vehicle(owner)


def make_due(migrated_engine: Engine, table: str) -> None:
    """Retries wait on the clock. This moves them along without sleeping."""
    with migrated_engine.begin() as connection:
        column = "next_attempt_at" if table == "automation_runs" else "next_email_at"
        statement = (
            f"UPDATE {table} SET {column} = now() - interval '1 second' WHERE {column} IS NOT NULL"  # noqa: S608
        )
        connection.execute(text(statement))


def items(member: Member, **params: Any) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = member.client.get(NOTES, params=params).json()["items"]
    return result


def rule(member: Member, **extra: Any) -> dict[str, Any]:
    response = member.client.post(
        RULES,
        json={
            "name": "Tell managers",
            "alert_types": ["defect_reported"],
            "actions": [{"type": "notify", "roles": ["fleet_manager"]}],
        }
        | extra,
        headers=member.csrf,
    )
    assert response.status_code == 201, response.text
    result: dict[str, Any] = response.json()
    return result


def runs(member: Member, **params: Any) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = member.client.get(RUNS, params=params).json()["items"]
    return result


def set_pref(member: Member, alert_type: str, in_app: bool, email_mode: str) -> None:
    response = member.client.patch(
        f"{NOTES}/preferences",
        json={
            "preferences": [{"alert_type": alert_type, "in_app": in_app, "email_mode": email_mode}]
        },
        headers=member.csrf,
    )
    assert response.status_code == 200, response.text


# Telling people


def test_an_alert_reaches_those_who_can_see_alerts_and_no_one_else(
    owner: Member, car: str, invite: Callable[..., Member], run: Callable[[], None]
) -> None:
    viewer = invite(owner, "read_only")
    driver = invite(owner, "driver")
    defect(owner, car, severity="major", title="Bald tyres")
    assert items(owner) == []  # nothing until the job runs
    run()
    assert [row["title"] for row in items(owner)] == ["KCA 123A: Bald tyres"]
    assert len(items(viewer)) == 1
    assert items(driver) == []


def test_running_twice_tells_no_one_twice(
    owner: Member, car: str, run: Callable[[], None], mailbox: Mailbox
) -> None:
    defect(owner, car, severity="critical")
    run()
    run()
    assert len(items(owner)) == 1
    assert len(mailbox.sent) == 1


def test_critical_alerts_email_by_default_and_others_dont(
    owner: Member, car: str, run: Callable[[], None], mailbox: Mailbox
) -> None:
    defect(owner, car, severity="major", title="Major one")
    run()
    assert mailbox.sent == []
    assert items(owner)[0]["email_status"] == "not_requested"
    defect(owner, car, severity="critical", title="Critical one")
    run()
    to, subject, body = mailbox.sent[0]
    assert to == owner.email
    assert subject == "FleetPulse alert: KCA 123A: Critical one"
    assert "/alerts" in body
    assert items(owner)[0]["email_status"] == "sent"


@pytest.mark.parametrize(
    ("mode", "severity", "expected"),
    [("off", "critical", 0), ("all", "major", 1), ("critical", "major", 0)],
)
def test_email_preferences_are_followed(
    owner: Member,
    car: str,
    run: Callable[[], None],
    mailbox: Mailbox,
    mode: str,
    severity: str,
    expected: int,
) -> None:
    set_pref(owner, "defect_reported", True, mode)
    defect(owner, car, severity=severity)
    run()
    assert len(mailbox.sent) == expected


def test_turning_in_app_off_hides_it_but_can_still_email(
    owner: Member, car: str, run: Callable[[], None], mailbox: Mailbox
) -> None:
    set_pref(owner, "defect_reported", False, "all")
    defect(owner, car, severity="major")
    run()
    assert items(owner) == []
    assert owner.client.get(f"{NOTES}/unread-count").json()["unread"] == 0
    assert len(mailbox.sent) == 1


def test_preferences_list_every_type_with_defaults_and_belong_to_one_person(
    owner: Member, invite: Callable[..., Member]
) -> None:
    viewer = invite(owner, "read_only")
    set_pref(owner, "speeding", False, "off")
    mine = {row["alert_type"]: row for row in owner.client.get(f"{NOTES}/preferences").json()}
    assert mine["speeding"] == {"alert_type": "speeding", "in_app": False, "email_mode": "off"}
    assert mine["defect_reported"]["email_mode"] == "critical"
    theirs = {row["alert_type"]: row for row in viewer.client.get(f"{NOTES}/preferences").json()}
    assert theirs["speeding"]["in_app"] is True


def test_an_alert_already_over_disturbs_no_one(
    owner: Member, car: str, run: Callable[[], None], mailbox: Mailbox
) -> None:
    item = defect(owner, car, severity="critical")
    owner.client.post(f"{API}/compliance/defects/{item['id']}/resolve", json={}, headers=owner.csrf)
    run()
    assert items(owner) == []
    assert mailbox.sent == []


def test_someone_removed_stops_being_told(
    owner: Member, car: str, invite: Callable[..., Member], run: Callable[[], None]
) -> None:
    viewer = invite(owner, "read_only")
    members = owner.client.get(f"{API}/organisation/members").json()
    target = next(row["id"] for row in members if row["email"] == viewer.email)
    owner.client.delete(f"{API}/organisation/members/{target}", headers=owner.csrf)
    defect(owner, car, severity="major")
    run()
    assert len(items(owner)) == 1
    assert viewer.client.get(NOTES).status_code in (401, 403)


# Reliable email


def test_a_failed_email_retries_and_then_arrives(
    owner: Member,
    car: str,
    run: Callable[[], None],
    mailbox: Mailbox,
    migrated_engine: Engine,
) -> None:
    mailbox.failures = 2
    defect(owner, car, severity="critical")
    run()
    assert items(owner)[0]["email_status"] == "pending"
    # It isn't due yet, so the mail server isn't hammered.
    run()
    assert mailbox.failures == 1
    make_due(migrated_engine, "notifications")
    run()
    make_due(migrated_engine, "notifications")
    run()
    assert items(owner)[0]["email_status"] == "sent"
    assert len(mailbox.sent) == 1


def test_it_eventually_gives_up_and_says_so(
    owner: Member,
    car: str,
    run: Callable[[], None],
    mailbox: Mailbox,
    migrated_engine: Engine,
) -> None:
    mailbox.failures = 99
    defect(owner, car, severity="critical")
    for _ in range(service.MAX_EMAIL_ATTEMPTS):
        run()
        make_due(migrated_engine, "notifications")
    assert items(owner)[0]["email_status"] == "failed"
    remaining = mailbox.failures
    run()
    assert mailbox.failures == remaining
    # The in-app notification is unaffected.
    assert owner.client.get(f"{NOTES}/unread-count").json()["unread"] == 1


def test_a_line_break_cant_add_email_headers(
    owner: Member, car: str, run: Callable[[], None], mailbox: Mailbox, migrated_engine: Engine
) -> None:
    item = defect(owner, car, severity="critical")
    with migrated_engine.begin() as connection:
        connection.execute(
            text("UPDATE alerts SET notified_at = NULL, title = :t WHERE dedupe_key = :k"),
            {"t": "x\r\nBcc: evil@example.com", "k": f"defect:{item['id']}"},
        )
    run()
    assert "\n" not in mailbox.sent[0][1]
    assert "\r" not in mailbox.sent[0][1]


# Reading


def test_read_state_is_personal(
    owner: Member, car: str, invite: Callable[..., Member], run: Callable[[], None]
) -> None:
    viewer = invite(owner, "read_only")
    defect(owner, car, severity="major", title="One")
    defect(owner, car, severity="major", title="Two")
    run()
    assert owner.client.get(f"{NOTES}/unread-count").json()["unread"] == 2
    first = items(owner)[0]
    owner.client.post(f"{NOTES}/{first['id']}/read", headers=owner.csrf)
    assert owner.client.get(f"{NOTES}/unread-count").json()["unread"] == 1
    assert len(items(owner, unread=True)) == 1
    assert viewer.client.get(f"{NOTES}/unread-count").json()["unread"] == 2
    # Nor can anyone mark another person's.
    assert viewer.client.post(f"{NOTES}/{first['id']}/read", headers=viewer.csrf).status_code == 404
    owner.client.post(f"{NOTES}/read-all", headers=owner.csrf)
    assert owner.client.get(f"{NOTES}/unread-count").json()["unread"] == 0
    assert viewer.client.get(f"{NOTES}/unread-count").json()["unread"] == 2


def test_nothing_crosses_organisations(
    owner: Member, car: str, new_owner: Callable[[], Member], run: Callable[[], None]
) -> None:
    defect(owner, car, severity="critical")
    created = rule(owner)
    run()
    other = new_owner()
    assert items(other) == []
    assert other.client.get(RULES).json() == []
    assert other.client.get(f"{RULES}/{created['id']}").status_code == 404
    assert runs(other) == []
    note = items(owner)[0]
    assert other.client.post(f"{NOTES}/{note['id']}/read", headers=other.csrf).status_code == 404
    response = other.client.post(
        RULES,
        json={
            "name": "x",
            "alert_types": ["speeding"],
            "vehicle_id": car,
            "actions": [{"type": "create_work_order"}],
        },
        headers=other.csrf,
    )
    assert response.json()["error"]["code"] == "vehicle_not_found"


# Automation


def test_a_rule_notifies_a_role_with_an_email(
    owner: Member,
    car: str,
    invite: Callable[..., Member],
    run: Callable[[], None],
    mailbox: Mailbox,
) -> None:
    manager = invite(owner, "fleet_manager")
    set_pref(manager, "defect_reported", False, "off")
    rule(owner, actions=[{"type": "notify", "roles": ["fleet_manager"], "email": True}])
    defect(owner, car, severity="minor", title="Not this one")
    defect(owner, car, severity="major", title="Major")
    run()
    assert len(items(manager)) == 1
    assert [row[0] for row in mailbox.sent] == [manager.email]
    history = runs(owner)
    assert history[0]["status"] == "succeeded"
    assert history[0]["rule_name"] == "Tell managers"
    assert history[0]["outcome"] == "Notified 1 person"


def test_a_rule_creates_one_work_order(owner: Member, car: str, run: Callable[[], None]) -> None:
    rule(
        owner,
        name="Book it",
        min_severity="critical",
        actions=[{"type": "create_work_order", "title": "Check the fault"}],
    )
    defect(owner, car, severity="major", title="Below the bar")
    defect(owner, car, severity="critical", title="Above the bar")
    run()
    run()
    orders = owner.client.get(f"{API}/maintenance/work-orders").json()
    assert orders["total"] == 1
    assert orders["items"][0]["title"] == "Check the fault"
    assert orders["items"][0]["vehicle_id"] == car
    assert runs(owner)[0]["outcome"] == "Created a work order"


def test_conditions_can_limit_a_rule_to_one_vehicle(
    owner: Member, car: str, run: Callable[[], None]
) -> None:
    other = vehicle(owner, "KDB 456B")
    rule(owner, vehicle_id=car)
    defect(owner, other, severity="major")
    run()
    assert runs(owner) == []
    defect(owner, car, severity="major")
    run()
    assert len(runs(owner)) == 1


def test_a_disabled_rule_does_nothing_and_can_be_enabled_again(
    owner: Member, car: str, run: Callable[[], None]
) -> None:
    created = rule(owner, is_enabled=False)
    defect(owner, car, severity="major")
    run()
    assert runs(owner) == []
    owner.client.patch(f"{RULES}/{created['id']}", json={"is_enabled": True}, headers=owner.csrf)
    defect(owner, car, severity="major", title="Second")
    run()
    assert len(runs(owner)) == 1


def test_a_failing_rule_retries_keeps_others_going_and_records_the_failure(
    owner: Member,
    car: str,
    run: Callable[[], None],
    migrated_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from sqlalchemy.exc import OperationalError

    rule(owner, name="Broken", actions=[{"type": "create_work_order"}])
    rule(owner, name="Fine")

    def fail(*_args: Any, **_kwargs: Any) -> str:
        raise OperationalError("x", {}, Exception("secret detail"))

    monkeypatch.setattr(service, "_run_work_order", fail)
    defect(owner, car, severity="major")
    run()
    by_name = {row["rule_name"]: row for row in runs(owner)}
    assert by_name["Fine"]["status"] == "succeeded"
    assert by_name["Broken"]["status"] == "pending"
    assert by_name["Broken"]["attempts"] == 1

    # Not due yet.
    run()
    assert {row["rule_name"]: row for row in runs(owner)}["Broken"]["attempts"] == 1

    for _ in range(service.MAX_RUN_ATTEMPTS - 1):
        make_due(migrated_engine, "automation_runs")
        run()
    broken = {row["rule_name"]: row for row in runs(owner)}["Broken"]
    assert broken["status"] == "failed"
    assert broken["attempts"] == service.MAX_RUN_ATTEMPTS
    assert "secret" not in broken["outcome"]
    assert len(runs(owner, status="failed")) == 1


def test_a_failure_then_success_creates_one_work_order(
    owner: Member,
    car: str,
    run: Callable[[], None],
    migrated_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from sqlalchemy.exc import OperationalError

    real = service._run_work_order
    calls = {"count": 0}

    def flaky(*args: Any, **kwargs: Any) -> str | None:
        calls["count"] += 1
        if calls["count"] == 1:
            raise OperationalError("x", {}, Exception("down"))
        return real(*args, **kwargs)

    monkeypatch.setattr(service, "_run_work_order", flaky)
    rule(owner, name="Book", actions=[{"type": "create_work_order"}])
    defect(owner, car, severity="major")
    run()
    make_due(migrated_engine, "automation_runs")
    run()
    assert runs(owner)[0]["status"] == "succeeded"
    assert owner.client.get(f"{API}/maintenance/work-orders").json()["total"] == 1


def test_turning_a_rule_off_stops_a_pending_retry(
    owner: Member,
    car: str,
    run: Callable[[], None],
    migrated_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from sqlalchemy.exc import OperationalError

    def fail(*_args: Any, **_kwargs: Any) -> str:
        raise OperationalError("x", {}, Exception("down"))

    monkeypatch.setattr(service, "_run_work_order", fail)
    created = rule(owner, name="Book", actions=[{"type": "create_work_order"}])
    defect(owner, car, severity="major")
    run()
    owner.client.patch(f"{RULES}/{created['id']}", json={"is_enabled": False}, headers=owner.csrf)
    make_due(migrated_engine, "automation_runs")
    run()
    assert runs(owner)[0]["status"] == "skipped"


def test_an_archived_vehicle_is_skipped_not_failed(
    owner: Member, car: str, run: Callable[[], None], migrated_engine: Engine
) -> None:
    rule(owner, name="Book", actions=[{"type": "create_work_order"}])
    defect(owner, car, severity="major")
    owner.client.post(f"{API}/vehicles/{car}/archive", headers=owner.csrf)
    run()
    assert runs(owner)[0]["status"] == "skipped"
    assert "No active vehicle" in runs(owner)[0]["outcome"]


@pytest.mark.parametrize(
    "body",
    [
        {"alert_types": []},
        {"alert_types": ["not_a_type"]},
        {"actions": []},
        {"actions": [{"type": "run_code", "code": "import os"}]},
        {"actions": [{"type": "notify", "roles": []}]},
        {"actions": [{"type": "notify", "roles": ["emperor"]}]},
        {"name": " "},
        {"alert_types": ["licence_expiry"], "actions": [{"type": "create_work_order"}]},
    ],
)
def test_bad_rules_are_rejected(owner: Member, body: dict[str, Any]) -> None:
    payload = {
        "name": "x",
        "alert_types": ["speeding"],
        "actions": [{"type": "notify", "roles": ["owner"]}],
    } | body
    assert owner.client.post(RULES, json=payload, headers=owner.csrf).status_code == 422


def test_rules_cant_send_alerts_to_roles_that_cant_view_them(owner: Member) -> None:
    response = owner.client.post(
        RULES,
        json={
            "name": "x",
            "alert_types": ["speeding"],
            "actions": [{"type": "notify", "roles": ["driver"]}],
        },
        headers=owner.csrf,
    )
    assert response.json()["error"]["code"] == "role_cannot_view_alerts"


def test_names_are_unique_until_archived(owner: Member) -> None:
    created = rule(owner)
    again = owner.client.post(
        RULES,
        json={
            "name": "Tell managers",
            "alert_types": ["speeding"],
            "actions": [{"type": "notify", "roles": ["owner"]}],
        },
        headers=owner.csrf,
    )
    assert again.json()["error"]["code"] == "duplicate_name"
    owner.client.post(f"{RULES}/{created['id']}/archive", headers=owner.csrf)
    assert owner.client.get(RULES).json() == []
    rule(owner)


@pytest.mark.parametrize(
    ("role", "status"),
    [
        ("fleet_manager", 200),
        ("dispatcher", 403),
        ("maintenance_manager", 403),
        ("finance_manager", 403),
        ("read_only", 403),
        ("driver", 403),
    ],
)
def test_who_can_manage_rules(
    owner: Member, invite: Callable[..., Member], role: str, status: int
) -> None:
    member = invite(owner, role)
    assert member.client.get(RULES).status_code == status
    assert member.client.get(RUNS).status_code == status
    assert member.client.get(NOTES).status_code == 200


# Background housekeeping


def test_auth_cleanup_removes_only_what_has_long_expired(
    owner: Member, app_engine: Engine, migrated_engine: Engine
) -> None:
    with migrated_engine.begin() as connection:
        before = connection.execute(text("SELECT count(*) FROM sessions")).scalar_one()
        connection.execute(
            text(
                """
                UPDATE sessions SET expires_at = :old
                WHERE id = (SELECT id FROM sessions ORDER BY created_at LIMIT 1)
                """
            ),
            {"old": utcnow() - timedelta(days=60)},
        )
    with app_engine.begin() as connection:
        removed = connection.execute(text("SELECT cleanup_expired_auth()")).scalar_one()
    assert removed >= 1
    with migrated_engine.begin() as connection:
        after = connection.execute(text("SELECT count(*) FROM sessions")).scalar_one()
    assert after < before
    # A current session is unaffected.
    assert owner.client.get(f"{API}/auth/me").status_code == 200
