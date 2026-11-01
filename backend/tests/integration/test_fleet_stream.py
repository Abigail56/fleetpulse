from collections.abc import Callable
from datetime import timedelta
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.models.base import utcnow
from tests.integration.conftest import API, ORIGIN, Member
from tests.integration.test_tracking import (
    TRACK,
    device,
    new_key,
    position,
    send,
    vehicle,
)

pytestmark = pytest.mark.integration

STREAM = "/api/v1/tracking/stream"
HEADERS = {"Origin": ORIGIN}


@pytest.fixture
def tracked(new_owner: Callable[[], Member]) -> tuple[Member, str, str]:
    owner = new_owner()
    car = vehicle(owner)
    assert device(owner, car).status_code == 201
    return owner, car, new_key(owner)


def assert_refused(client: TestClient, code: int, headers: dict[str, str] | None = None) -> None:
    with (
        pytest.raises(WebSocketDisconnect) as refused,
        client.websocket_connect(STREAM, headers=HEADERS if headers is None else headers),
    ):
        pass
    assert refused.value.code == code


def test_a_new_position_arrives_on_the_stream(tracked: tuple[Member, str, str]) -> None:
    owner, car, key = tracked
    with owner.client.websocket_connect(STREAM, headers=HEADERS) as socket:
        assert socket.receive_json() == {"type": "ready"}
        send(owner, key, position(speed_kph=42.5, ignition_on=True))
        message = socket.receive_json()
    assert message["type"] == "positions"
    item = message["positions"][0]
    assert item["vehicle_id"] == car
    assert float(item["speed_kph"]) == 42.5
    assert item["is_simulated"] is False
    assert item["latitude"] == pytest.approx(6.5244)


def test_only_each_vehicles_newest_position_is_sent(tracked: tuple[Member, str, str]) -> None:
    owner, _car, key = tracked
    with owner.client.websocket_connect(STREAM, headers=HEADERS) as socket:
        socket.receive_json()
        send(owner, key, position(minutes_ago=5, speed_kph=1), position(minutes_ago=1, speed_kph=2))
        message = socket.receive_json()
    assert [float(item["speed_kph"]) for item in message["positions"]] == [2]


def test_nothing_is_sent_for_a_duplicate(tracked: tuple[Member, str, str]) -> None:
    owner, _car, key = tracked
    first = position(minutes_ago=2, speed_kph=1)
    send(owner, key, first)
    with owner.client.websocket_connect(STREAM, headers=HEADERS) as socket:
        socket.receive_json()
        send(owner, key, first)
        send(owner, key, position(speed_kph=7))
        assert float(socket.receive_json()["positions"][0]["speed_kph"]) == 7


def test_another_organisations_positions_never_arrive(
    tracked: tuple[Member, str, str], new_owner: Callable[[], Member]
) -> None:
    owner, _car, key = tracked
    other = new_owner()
    other_car = vehicle(other)
    device(other, other_car, external="THEIRS")
    other_key = new_key(other)
    with owner.client.websocket_connect(STREAM, headers=HEADERS) as socket:
        socket.receive_json()
        send(other, other_key, position("THEIRS", speed_kph=99))
        send(owner, key, position(speed_kph=1))
        message = socket.receive_json()
    assert float(message["positions"][0]["speed_kph"]) == 1


# Who can connect


def test_no_session_is_refused(app: FastAPI) -> None:
    assert_refused(TestClient(app), 4401)


def test_a_forged_session_cookie_is_refused(app: FastAPI) -> None:
    client = TestClient(app)
    client.cookies.set("fleetpulse_access", "forged")
    assert_refused(client, 4401)


def test_another_website_cannot_open_the_stream_with_a_visitors_cookies(
    tracked: tuple[Member, str, str],
) -> None:
    """Cross-site WebSocket hijacking: browsers send cookies, and CORS doesn't apply."""
    owner, _car, _key = tracked
    assert_refused(owner.client, 4403, {"Origin": "https://evil.example.com"})
    assert_refused(owner.client, 4403, {"Origin": "null"})
    assert_refused(owner.client, 4403, {})


def test_a_role_without_vehicle_access_is_refused(
    tracked: tuple[Member, str, str], invite: Callable[..., Member]
) -> None:
    owner, _car, _key = tracked
    assert_refused(invite(owner, "driver").client, 4403)
    with invite(owner, "read_only").client.websocket_connect(STREAM, headers=HEADERS) as socket:
        assert socket.receive_json() == {"type": "ready"}


# Access ends while connected


def wait_for_close(socket: Any) -> int:
    while True:
        message = socket.receive()
        if message["type"] == "websocket.close":
            return int(message["code"])


@pytest.fixture
def quick_recheck(app: FastAPI) -> None:
    app.state.settings = app.state.settings.model_copy(update={"gps_stream_recheck_seconds": 0.2})


def test_signing_out_ends_the_stream(quick_recheck: None, tracked: tuple[Member, str, str]) -> None:
    owner, _car, _key = tracked
    with owner.client.websocket_connect(STREAM, headers=HEADERS) as socket:
        socket.receive_json()
        owner.client.post(f"{API}/auth/logout", headers=owner.csrf)
        assert wait_for_close(socket) == 4401


def test_removal_from_the_organisation_ends_the_stream(
    quick_recheck: None, tracked: tuple[Member, str, str], invite: Callable[..., Member]
) -> None:
    owner, _car, _key = tracked
    member = invite(owner, "read_only")
    members = owner.client.get(f"{API}/organisation/members").json()
    target = next(item["id"] for item in members if item["email"] == member.email)
    with member.client.websocket_connect(STREAM, headers=HEADERS) as socket:
        socket.receive_json()
        owner.client.delete(f"{API}/organisation/members/{target}", headers=owner.csrf)
        assert wait_for_close(socket) == 4403


def test_a_role_change_that_removes_access_ends_the_stream(
    quick_recheck: None, tracked: tuple[Member, str, str], invite: Callable[..., Member]
) -> None:
    owner, _car, _key = tracked
    member = invite(owner, "read_only")
    members = owner.client.get(f"{API}/organisation/members").json()
    target = next(item["id"] for item in members if item["email"] == member.email)
    with member.client.websocket_connect(STREAM, headers=HEADERS) as socket:
        socket.receive_json()
        owner.client.patch(
            f"{API}/organisation/members/{target}", json={"role": "driver"}, headers=owner.csrf
        )
        assert wait_for_close(socket) == 4403


# Fleet overview


def test_fleet_lists_every_vehicle_and_marks_those_that_never_reported(
    tracked: tuple[Member, str, str],
) -> None:
    owner, _car, key = tracked
    vehicle(owner, "NEVER1")
    send(owner, key, position(speed_kph=30, ignition_on=True))
    fleet = {
        item["registration_number"]: item for item in owner.client.get(f"{TRACK}/fleet").json()
    }
    assert fleet["KCA 123A"]["latitude"] == pytest.approx(6.5244)
    assert float(fleet["KCA 123A"]["speed_kph"]) == 30
    never = fleet["NEVER1"]
    assert never["latitude"] is None
    assert never["recorded_at"] is None
    assert never["speed_kph"] is None


def test_archived_vehicles_leave_the_fleet_view(tracked: tuple[Member, str, str]) -> None:
    owner, car, _key = tracked
    owner.client.post(f"{API}/vehicles/{car}/archive", headers=owner.csrf)
    assert owner.client.get(f"{TRACK}/fleet").json() == []


def test_fleet_shows_drivers_only_to_roles_that_can_view_them(
    new_owner: Callable[[], Member], invite: Callable[..., Member]
) -> None:
    owner = new_owner()
    car = vehicle(owner)
    driver = owner.client.post(
        f"{API}/drivers",
        json={"first_name": "Tunde", "last_name": "Adeyemi", "licence_number": "DL-1"},
        headers=owner.csrf,
    ).json()
    owner.client.post(
        f"{API}/drivers/{driver['id']}/assign", json={"vehicle_id": car}, headers=owner.csrf
    )
    assert owner.client.get(f"{TRACK}/fleet").json()[0]["driver_name"] == "Tunde Adeyemi"
    assert invite(owner, "read_only").client.get(f"{TRACK}/fleet").json()[0]["driver_name"]


def test_fleet_never_includes_another_organisation(
    tracked: tuple[Member, str, str], new_owner: Callable[[], Member]
) -> None:
    assert new_owner().client.get(f"{TRACK}/fleet").json() == []


def test_history_returns_the_newest_positions_when_limited(
    tracked: tuple[Member, str, str],
) -> None:
    owner, car, key = tracked
    send(owner, key, *[position(minutes_ago=i, speed_kph=i) for i in range(5)])
    params: dict[str, str | int] = {
        "start": (utcnow() - timedelta(hours=1)).isoformat(),
        "end": (utcnow() + timedelta(minutes=1)).isoformat(),
        "limit": 2,
    }
    rows = owner.client.get(f"{TRACK}/vehicles/{car}/history", params=params).json()
    assert [float(row["speed_kph"]) for row in rows] == [1, 0]
