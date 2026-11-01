from typing import Any, cast
from unittest.mock import MagicMock

import pytest

from app.core.config import Settings
from app.integrations.smtp import send_via_smtp

BASE: dict[str, Any] = {
    "_env_file": None,
    "environment": "test",
    "database_url": "postgresql+psycopg://user:pass@localhost:5432/db",
    "redis_url": "redis://localhost:6379/0",
    "jwt_secret": "x" * 64,
    "email_from": "FleetPulse <no-reply@example.com>",
}


@pytest.fixture
def server(monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    smtp_class = MagicMock()
    monkeypatch.setattr("smtplib.SMTP", smtp_class)
    return cast(MagicMock, smtp_class.return_value.__enter__.return_value)


def test_uses_starttls_before_sending_credentials(server: MagicMock) -> None:
    settings = Settings(
        **BASE,
        smtp_host="smtp.example.com",
        smtp_starttls=True,
        smtp_username="user",
        smtp_password="pass",
    )
    send_via_smtp(settings, "a@example.com", "Subject", "Body")
    calls = [call[0] for call in server.method_calls]
    assert calls == ["starttls", "login", "send_message"]
    message = server.send_message.call_args.args[0]
    assert message["To"] == "a@example.com"
    assert message["Subject"] == "Subject"


def test_sends_without_login_when_no_credentials_are_set(server: MagicMock) -> None:
    send_via_smtp(Settings(**BASE, smtp_host="localhost"), "a@example.com", "S", "B")
    assert [call[0] for call in server.method_calls] == ["send_message"]


def test_missing_smtp_host_raises_instead_of_dropping_the_email() -> None:
    with pytest.raises(RuntimeError, match="smtp_host"):
        send_via_smtp(Settings(**BASE), "a@example.com", "S", "B")
