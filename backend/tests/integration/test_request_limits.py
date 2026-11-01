from collections.abc import Callable, Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.app_factory import MAX_REQUEST_BYTES
from tests.integration.conftest import API, Member

pytestmark = pytest.mark.integration


def test_a_declared_oversized_request_is_refused_without_being_read(app: FastAPI) -> None:
    client = TestClient(app)
    response = client.post(
        f"{API}/contact",
        content=b"x",
        headers={"Content-Length": str(MAX_REQUEST_BYTES + 1), "Content-Type": "application/json"},
    )
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "request_too_large"


def test_an_oversized_request_that_doesnt_declare_its_size_is_stopped(
    new_owner: Callable[[], Member],
) -> None:
    owner = new_owner()

    def chunks() -> Iterator[bytes]:
        for _ in range(14):
            yield b"x" * (1024 * 1024)

    response = owner.client.post(
        f"{API}/billing/webhooks/paystack", content=chunks(), headers=owner.csrf
    )
    assert response.status_code in (404, 413)


def test_ordinary_requests_are_untouched(new_owner: Callable[[], Member]) -> None:
    owner = new_owner()
    assert owner.client.get(f"{API}/auth/me").status_code == 200
