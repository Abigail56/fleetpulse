from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from kombu.exceptions import OperationalError

from app.api.deps import get_strict_email_queue
from app.services.email import OutgoingEmail

pytestmark = pytest.mark.integration

URL = "/api/v1/contact"
VALID: dict[str, Any] = {
    "name": "Ada Obi",
    "email": "ada@example.com",
    "company": "Swift Logistics",
    "fleet_size": "11-50",
    "message": "We run 30 vans and want to know more.",
}


@pytest.fixture
def inbox(app: FastAPI) -> list[OutgoingEmail]:
    sent: list[OutgoingEmail] = []
    app.state.settings = app.state.settings.model_copy(
        update={"contact_inbox_email": "inbox@example.com", "contact_messages_per_hour_per_ip": 3}
    )
    app.dependency_overrides[get_strict_email_queue] = lambda: sent.append
    return sent


def test_message_is_delivered_to_the_configured_inbox(
    client: TestClient, inbox: list[OutgoingEmail]
) -> None:
    assert client.post(URL, json=VALID).status_code == 202
    assert inbox[0].to == "inbox@example.com"
    assert "ada@example.com" in inbox[0].body
    assert VALID["message"] in inbox[0].body


def test_bot_filling_the_hidden_field_sees_success_but_nothing_is_sent(
    client: TestClient, inbox: list[OutgoingEmail]
) -> None:
    assert client.post(URL, json=VALID | {"website": "spam.example"}).status_code == 202
    assert inbox == []


@pytest.mark.parametrize(
    "overrides",
    [
        {"email": "nope"},
        {"message": "short"},
        {"message": "x" * 4001},
        {"name": "Ada\nBcc: everyone@example.com"},
        {"fleet_size": "huge"},
        {"is_admin": True},
    ],
)
def test_invalid_input_is_rejected(
    client: TestClient, inbox: list[OutgoingEmail], overrides: dict[str, Any]
) -> None:
    assert client.post(URL, json=VALID | overrides).status_code == 422
    assert inbox == []


def test_messages_are_rate_limited(client: TestClient, inbox: list[OutgoingEmail]) -> None:
    statuses = [client.post(URL, json=VALID).status_code for _ in range(4)]
    assert statuses == [202, 202, 202, 429]


def test_untrusted_origin_is_rejected(client: TestClient, inbox: list[OutgoingEmail]) -> None:
    response = client.post(URL, json=VALID, headers={"Origin": "https://evil.example.com"})
    assert response.status_code == 403
    assert inbox == []


def test_failure_to_queue_is_reported_not_hidden(app: FastAPI, client: TestClient) -> None:
    def broken_queue(_email: OutgoingEmail) -> None:
        raise OperationalError("broker down")

    app.state.settings = app.state.settings.model_copy(
        update={"contact_inbox_email": "inbox@example.com"}
    )
    app.dependency_overrides[get_strict_email_queue] = lambda: broken_queue
    response = client.post(URL, json=VALID)
    assert response.status_code == 503
    assert "broker" not in response.text


def test_missing_inbox_configuration_is_reported(app: FastAPI, client: TestClient) -> None:
    app.state.settings = app.state.settings.model_copy(update={"contact_inbox_email": None})
    assert client.post(URL, json=VALID).status_code == 503
