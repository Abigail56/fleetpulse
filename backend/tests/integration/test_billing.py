import hashlib
import hmac
import json
from collections.abc import Callable
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from pydantic import SecretStr
from sqlalchemy import Engine, text

from app.integrations.payments.paystack import PaystackProvider
from app.models.base import utcnow
from app.models.enums import BillingPlan
from app.services import billing as service
from tests.integration.conftest import API, Member
from tests.integration.test_tracking import vehicle

pytestmark = pytest.mark.integration

ROOT = f"{API}/billing"
WEBHOOK = f"{ROOT}/webhooks/paystack"
KEY = "sk_test_not_a_real_key"


class FakePaystack:
    """Stands in for Paystack's server. No real payment system is involved in these tests."""

    def __init__(self) -> None:
        self.requests: list[dict[str, Any]] = []
        self.fail = False

    def __call__(self, request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == f"Bearer {KEY}"
        self.requests.append(json.loads(request.content))
        if self.fail:
            return httpx.Response(500, json={"status": False})
        return httpx.Response(
            200, json={"data": {"authorization_url": "https://checkout.example.com/abc"}}
        )


@pytest.fixture
def paystack(app: FastAPI, monkeypatch: pytest.MonkeyPatch) -> FakePaystack:
    fake = FakePaystack()
    app.state.settings = app.state.settings.model_copy(
        update={"paystack_secret_key": SecretStr(KEY)}
    )
    client = httpx.Client(transport=httpx.MockTransport(fake), base_url="https://api.example.com")
    monkeypatch.setattr(service, "provider_for", lambda _settings: PaystackProvider(KEY, client))
    return fake


@pytest.fixture
def owner(new_owner: Callable[[], Member]) -> Member:
    return new_owner()


def checkout(member: Member, plan: str = "starter") -> dict[str, Any]:
    response = member.client.post(f"{ROOT}/checkout", json={"plan": plan}, headers=member.csrf)
    assert response.status_code == 200, response.text
    result: dict[str, Any] = response.json()
    return result


def event(
    reference: str, amount: int, kind: str = "charge.success", currency: str = "USD"
) -> bytes:
    return json.dumps(
        {"event": kind, "data": {"reference": reference, "amount": amount, "currency": currency}}
    ).encode()


def deliver(client: Any, body: bytes, key: str = KEY) -> Any:
    signature = hmac.new(key.encode(), body, hashlib.sha512).hexdigest()
    return client.post(WEBHOOK, content=body, headers={"x-paystack-signature": signature})


def status_of(member: Member) -> dict[str, Any]:
    result: dict[str, Any] = member.client.get(f"{ROOT}/status").json()
    return result


# Before anything is configured


def test_with_no_provider_nothing_can_be_bought_and_nothing_is_limited(
    owner: Member, app: FastAPI
) -> None:
    current = status_of(owner)
    assert current["payments_enabled"] is False
    assert current["enforced"] is False
    refused = owner.client.post(f"{ROOT}/checkout", json={"plan": "starter"}, headers=owner.csrf)
    assert refused.json()["error"]["code"] == "payments_not_configured"
    assert owner.client.post(WEBHOOK, content=b"{}").status_code == 404
    for index in range(3):
        vehicle(owner, f"KCA {index}")


def test_an_empty_key_counts_as_no_key(app: FastAPI) -> None:
    settings = app.state.settings.model_copy(update={"paystack_secret_key": SecretStr("")})
    assert service.provider_for(settings) is None


# Starting a payment


def test_checkout_charges_for_the_vehicles_in_use(owner: Member, paystack: FakePaystack) -> None:
    vehicle(owner, "KCA 1")
    vehicle(owner, "KCA 2")
    result = checkout(owner)
    assert result["checkout_url"] == "https://checkout.example.com/abc"
    assert float(result["amount"]) == 18
    assert result["vehicles"] == 2
    sent = paystack.requests[0]
    assert sent["amount"] == 1800  # in the smallest unit
    assert sent["currency"] == "USD"
    assert sent["email"] == owner.email
    assert sent["reference"] == result["reference"]
    assert result["reference"] in sent["callback_url"]


def test_starting_a_payment_grants_nothing(owner: Member, paystack: FakePaystack) -> None:
    checkout(owner)
    current = status_of(owner)
    assert current["state"] == "trial"
    assert current["paid_until"] is None


def test_a_new_fleet_pays_for_at_least_one_vehicle(owner: Member, paystack: FakePaystack) -> None:
    assert checkout(owner, "growth")["vehicles"] == 1


def test_a_provider_failure_is_a_clear_error(owner: Member, paystack: FakePaystack) -> None:
    paystack.fail = True
    response = owner.client.post(f"{ROOT}/checkout", json={"plan": "starter"}, headers=owner.csrf)
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "payment_unavailable"
    assert KEY not in response.text


def test_enterprise_cant_be_bought_online(owner: Member, paystack: FakePaystack) -> None:
    response = owner.client.post(
        f"{ROOT}/checkout", json={"plan": "enterprise"}, headers=owner.csrf
    )
    assert response.status_code == 422


# The webhook is the only proof of payment


def test_a_signed_webhook_activates_the_subscription(
    owner: Member, paystack: FakePaystack, app: FastAPI
) -> None:
    started = checkout(owner, "growth")
    response = deliver(owner.client, event(started["reference"], 1500))
    assert response.status_code == 200, response.text
    assert response.json()["outcome"] == "processed"
    current = status_of(owner)
    assert current["state"] == "active"
    assert current["plan"] == "growth"
    assert current["max_vehicles"] == 250
    assert current["vehicles_paid_for"] == 1
    payments = owner.client.get(f"{ROOT}/payments").json()
    assert payments[0]["status"] == "paid"
    assert payments[0]["paid_at"] is not None


@pytest.mark.parametrize(
    "headers",
    [
        {},
        {"x-paystack-signature": ""},
        {"x-paystack-signature": "0" * 128},
    ],
)
def test_an_unsigned_or_forged_webhook_changes_nothing(
    owner: Member, paystack: FakePaystack, headers: dict[str, str]
) -> None:
    started = checkout(owner)
    response = owner.client.post(WEBHOOK, content=event(started["reference"], 900), headers=headers)
    assert response.status_code == 401
    assert status_of(owner)["state"] == "trial"


def test_a_webhook_signed_with_the_wrong_key_changes_nothing(
    owner: Member, paystack: FakePaystack
) -> None:
    started = checkout(owner)
    response = deliver(owner.client, event(started["reference"], 900), key="sk_attacker")
    assert response.status_code == 401
    assert status_of(owner)["state"] == "trial"


def test_a_tampered_body_fails_the_signature(owner: Member, paystack: FakePaystack) -> None:
    started = checkout(owner)
    body = event(started["reference"], 900)
    signature = hmac.new(KEY.encode(), body, hashlib.sha512).hexdigest()
    response = owner.client.post(
        WEBHOOK,
        content=body.replace(b"900", b"100"),
        headers={"x-paystack-signature": signature},
    )
    assert response.status_code == 401


def test_a_repeated_webhook_only_counts_once(owner: Member, paystack: FakePaystack) -> None:
    started = checkout(owner)
    body = event(started["reference"], 900)
    assert deliver(owner.client, body).json()["outcome"] == "processed"
    first = status_of(owner)["paid_until"]
    assert deliver(owner.client, body).json()["outcome"] == "duplicate"
    assert status_of(owner)["paid_until"] == first


@pytest.mark.parametrize(("amount", "currency"), [(100, "USD"), (900, "NGN"), (1000000, "USD")])
def test_the_wrong_amount_or_currency_grants_nothing(
    owner: Member, paystack: FakePaystack, amount: int, currency: str
) -> None:
    started = checkout(owner)
    deliver(owner.client, event(started["reference"], amount, currency=currency))
    assert status_of(owner)["state"] == "trial"
    assert owner.client.get(f"{ROOT}/payments").json()[0]["status"] == "mismatched"


def test_a_failed_charge_grants_nothing(owner: Member, paystack: FakePaystack) -> None:
    started = checkout(owner)
    deliver(owner.client, event(started["reference"], 900, "charge.failed"))
    assert status_of(owner)["state"] == "trial"
    assert owner.client.get(f"{ROOT}/payments").json()[0]["status"] == "failed"


def test_a_late_failure_doesnt_undo_a_success(owner: Member, paystack: FakePaystack) -> None:
    started = checkout(owner)
    deliver(owner.client, event(started["reference"], 900))
    deliver(owner.client, event(started["reference"], 900, "charge.failed"))
    assert owner.client.get(f"{ROOT}/payments").json()[0]["status"] == "paid"


def test_someone_elses_or_unknown_events_are_acknowledged_and_ignored(
    owner: Member, paystack: FakePaystack
) -> None:
    assert deliver(owner.client, event("not-ours", 900)).json()["outcome"] == "ignored"
    other = json.dumps({"event": "invoice.create", "data": {}}).encode()
    assert deliver(owner.client, other).json()["outcome"] == "ignored"


def test_a_signed_but_malformed_webhook_is_refused(owner: Member, paystack: FakePaystack) -> None:
    bad = json.dumps({"event": "charge.success", "data": {"amount": "x"}}).encode()
    assert deliver(owner.client, bad).status_code == 422
    assert deliver(owner.client, b"not json").status_code == 422


def test_a_webhook_only_touches_the_organisation_that_paid(
    owner: Member, new_owner: Callable[[], Member], paystack: FakePaystack
) -> None:
    other = new_owner()
    started = checkout(owner)
    deliver(owner.client, event(started["reference"], 900))
    assert status_of(other)["state"] == "trial"
    assert other.client.get(f"{ROOT}/payments").json() == []


def test_paying_early_adds_to_what_is_left(
    owner: Member, paystack: FakePaystack, migrated_engine: Engine
) -> None:
    first = checkout(owner)
    deliver(owner.client, event(first["reference"], 900))
    until = status_of(owner)["paid_until"]
    second = checkout(owner)
    deliver(owner.client, event(second["reference"], 900))
    later = status_of(owner)["paid_until"]
    gained = datetime.fromisoformat(later) - datetime.fromisoformat(until)
    assert gained == timedelta(days=service.PERIOD_DAYS)


# Limits


@pytest.fixture
def enforced(app: FastAPI) -> None:
    app.state.settings = app.state.settings.model_copy(update={"billing_enforced": True})


def set_times(
    engine: Engine,
    organisation_id: str,
    *,
    created_days_ago: int | None = None,
    paid_days_ago: int | None = None,
) -> None:
    with engine.begin() as connection:
        if created_days_ago is not None:
            connection.execute(
                text("UPDATE organisations SET created_at = :at WHERE id = :id"),
                {"at": utcnow() - timedelta(days=created_days_ago), "id": organisation_id},
            )
        if paid_days_ago is not None:
            connection.execute(
                text("UPDATE subscriptions SET paid_until = :at WHERE organisation_id = :id"),
                {"at": utcnow() - timedelta(days=paid_days_ago), "id": organisation_id},
            )


def add_vehicle(member: Member, registration: str) -> Any:
    return member.client.post(
        f"{API}/vehicles",
        json={
            "registration_number": registration,
            "make": "Isuzu",
            "model": "NPR",
            "vehicle_type": "truck",
            "fuel_type": "diesel",
        },
        headers=member.csrf,
    )


def test_a_trial_lasts_two_weeks_then_stops_new_vehicles_but_keeps_data(
    owner: Member, enforced: None, migrated_engine: Engine
) -> None:
    car = vehicle(owner)
    assert status_of(owner)["state"] == "trial"
    assert add_vehicle(owner, "KCA 2").status_code == 201
    set_times(migrated_engine, owner.organisation_id, created_days_ago=service.TRIAL_DAYS + 1)
    assert status_of(owner)["state"] == "expired"
    refused = add_vehicle(owner, "KCA 3")
    assert refused.status_code == 402
    assert refused.json()["error"]["code"] == "plan_limit"
    # Nothing is taken away.
    assert owner.client.get(f"{API}/vehicles/{car}").status_code == 200
    assert owner.client.get(f"{API}/vehicles").json()["total"] == 2


def test_vehicle_and_member_limits_apply_only_when_enforced(
    owner: Member, app: FastAPI, migrated_engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(service, "TRIAL_PLAN", service.Plan("Tiny", Decimal(1), 1, 1))
    vehicle(owner)
    assert add_vehicle(owner, "KCA 2").status_code == 201
    invited = {"email": "new@example.com", "role": "read_only"}
    url = f"{API}/organisation/invitations"
    assert owner.client.post(url, json=invited, headers=owner.csrf).status_code == 201

    app.state.settings = app.state.settings.model_copy(update={"billing_enforced": True})
    refused = add_vehicle(owner, "KCA 3")
    assert refused.json()["error"]["code"] == "plan_limit"
    second = {"email": "other@example.com", "role": "read_only"}
    assert owner.client.post(url, json=second, headers=owner.csrf).status_code == 402


def test_restoring_counts_against_the_limit(
    owner: Member, enforced: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(service, "TRIAL_PLAN", service.Plan("Tiny", Decimal(1), 1, 1))
    car = vehicle(owner)
    owner.client.post(f"{API}/vehicles/{car}/archive", headers=owner.csrf)
    vehicle(owner, "KCA 2")
    refused = owner.client.post(f"{API}/vehicles/{car}/restore", headers=owner.csrf)
    assert refused.status_code == 402


def test_a_lapsed_subscription_has_a_week_of_grace_then_expires(
    owner: Member, paystack: FakePaystack, enforced: None, migrated_engine: Engine
) -> None:
    started = checkout(owner)
    deliver(owner.client, event(started["reference"], 900))
    set_times(migrated_engine, owner.organisation_id, paid_days_ago=1)
    assert status_of(owner)["state"] == "grace"
    assert add_vehicle(owner, "KCA 2").status_code == 201
    set_times(migrated_engine, owner.organisation_id, paid_days_ago=service.GRACE_DAYS + 1)
    assert status_of(owner)["state"] == "expired"
    assert add_vehicle(owner, "KCA 3").status_code == 402


def test_paying_after_expiry_restores_service(
    owner: Member, paystack: FakePaystack, enforced: None, migrated_engine: Engine
) -> None:
    first = checkout(owner)
    deliver(owner.client, event(first["reference"], 900))
    set_times(migrated_engine, owner.organisation_id, paid_days_ago=30)
    assert status_of(owner)["state"] == "expired"
    second = checkout(owner)
    deliver(owner.client, event(second["reference"], 900))
    assert status_of(owner)["state"] == "active"
    assert add_vehicle(owner, "KCA 2").status_code == 201


def test_a_plan_too_small_for_the_fleet_is_refused(
    owner: Member, paystack: FakePaystack, monkeypatch: pytest.MonkeyPatch
) -> None:
    vehicle(owner, "KCA 1")
    vehicle(owner, "KCA 2")
    monkeypatch.setitem(service.PLANS, BillingPlan.STARTER, service.Plan("Tiny", Decimal(1), 1, 1))
    response = owner.client.post(f"{ROOT}/checkout", json={"plan": "starter"}, headers=owner.csrf)
    assert response.json()["error"]["code"] == "too_many_vehicles"


# Who can see and do what


@pytest.mark.parametrize(
    ("role", "status"),
    [
        ("administrator", 200),
        ("fleet_manager", 403),
        ("finance_manager", 403),
        ("dispatcher", 403),
        ("read_only", 403),
        ("driver", 403),
    ],
)
def test_billing_is_for_owners_and_administrators(
    owner: Member, invite: Callable[..., Member], role: str, status: int
) -> None:
    member = invite(owner, role)
    assert member.client.get(f"{ROOT}/status").status_code == status
    assert member.client.get(f"{ROOT}/payments").status_code == status
    assert member.client.get(f"{ROOT}/plans").status_code == status


def test_checkout_needs_csrf(owner: Member, paystack: FakePaystack) -> None:
    response = owner.client.post(f"{ROOT}/checkout", json={"plan": "starter"})
    assert response.status_code in (401, 403)
    assert paystack.requests == []
