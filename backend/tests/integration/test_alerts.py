from collections.abc import Callable
from datetime import timedelta
from typing import Any

import pytest
from fastapi import FastAPI
from sqlalchemy import Engine
from sqlmodel import Session

from app.models.base import utcnow
from app.services import alerts as alert_service
from app.services.telemetry import simulate_tick
from tests.integration.conftest import API, Member
from tests.integration.test_drivers import created as new_driver
from tests.integration.test_tracking import device, new_key, position, send, simulated, vehicle

pytestmark = pytest.mark.integration

FENCES = f"{API}/geofences"
ALERTS = f"{API}/alerts"
# A square of roughly 2 km around (0, 0), and points inside and outside of it.
SQUARE = [[-0.01, -0.01], [-0.01, 0.01], [0.01, 0.01], [0.01, -0.01]]
INSIDE: dict[str, Any] = {"latitude": 0.0, "longitude": 0.0}
OUTSIDE: dict[str, Any] = {"latitude": 1.0, "longitude": 1.0}


def polygon(member: Member, name: str = "Depot", **extra: Any) -> dict[str, Any]:
    response = member.client.post(
        FENCES,
        json={"name": name, "kind": "polygon", "boundary": SQUARE} | extra,
        headers=member.csrf,
    )
    assert response.status_code == 201, response.text
    result: dict[str, Any] = response.json()
    return result


def tracked(member: Member) -> tuple[str, str]:
    car = vehicle(member)
    assert device(member, car).status_code == 201
    return car, new_key(member)


def active(member: Member, **params: Any) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = member.client.get(ALERTS, params=params).json()["items"]
    return result


def events(member: Member, fence: dict[str, Any]) -> list[str]:
    items = member.client.get(f"{FENCES}/{fence['id']}/events").json()["items"]
    return [item["event_type"] for item in reversed(items)]


def limit(member: Member, kph: int | None) -> None:
    response = member.client.patch(
        f"{ALERTS}/settings", json={"speed_limit_kph": kph}, headers=member.csrf
    )
    assert response.status_code == 200, response.text


@pytest.fixture
def owner(new_owner: Callable[[], Member]) -> Member:
    return new_owner()


# Geofence shapes


def test_a_circle_covers_points_within_its_radius(owner: Member) -> None:
    car, key = tracked(owner)
    send(owner, key, position(minutes_ago=3, **OUTSIDE))
    response = owner.client.post(
        FENCES,
        json={
            "name": "Yard",
            "kind": "circle",
            "center_latitude": 0,
            "center_longitude": 0,
            "radius_m": 1000,
        },
        headers=owner.csrf,
    )
    assert response.status_code == 201, response.text
    fence = response.json()
    assert len(fence["boundary"]) > 8
    # About 0.8 km from the centre: inside. About 1.3 km: outside.
    send(owner, key, position(minutes_ago=2, latitude=0.007, longitude=0.0))
    assert events(owner, fence) == ["entry"]
    send(owner, key, position(minutes_ago=1, latitude=0.012, longitude=0.0))
    assert events(owner, fence) == ["entry", "exit"]
    assert car


@pytest.mark.parametrize(
    "body",
    [
        {"name": "x", "kind": "circle", "center_latitude": 0, "center_longitude": 0},
        {"name": "x", "kind": "circle", "center_latitude": 0, "center_longitude": 0, "radius_m": 1},
        {
            "name": "x",
            "kind": "circle",
            "center_latitude": 95,
            "center_longitude": 0,
            "radius_m": 99,
        },
        {"name": "x", "kind": "polygon"},
        {"name": "x", "kind": "polygon", "boundary": [[0, 0], [1, 1]]},
        {"name": "x", "kind": "polygon", "boundary": [[0, 0], [0, 200], [1, 1]]},
        {"name": " ", "kind": "polygon", "boundary": SQUARE},
    ],
)
def test_bad_shapes_are_rejected(owner: Member, body: dict[str, Any]) -> None:
    assert owner.client.post(FENCES, json=body, headers=owner.csrf).status_code == 422


def test_a_self_crossing_or_empty_boundary_is_rejected(owner: Member) -> None:
    for boundary in ([[0, 0], [1, 1], [0, 1], [1, 0]], [[0, 0], [0, 0], [0, 0]]):
        response = owner.client.post(
            FENCES, json={"name": "x", "kind": "polygon", "boundary": boundary}, headers=owner.csrf
        )
        assert response.json()["error"]["code"] == "invalid_boundary"


def test_names_are_unique_until_archived(owner: Member) -> None:
    fence = polygon(owner)
    again = owner.client.post(
        FENCES, json={"name": "Depot", "kind": "polygon", "boundary": SQUARE}, headers=owner.csrf
    )
    assert again.json()["error"]["code"] == "duplicate_name"
    owner.client.post(f"{FENCES}/{fence['id']}/archive", headers=owner.csrf)
    assert owner.client.get(FENCES).json() == []
    assert len(owner.client.get(FENCES, params={"archived": True}).json()) == 1
    polygon(owner)


# Entry and exit


def test_entry_and_exit_are_recorded_and_alerted(owner: Member) -> None:
    _, key = tracked(owner)
    fence = polygon(owner, alert_on_exit=True)
    send(owner, key, position(minutes_ago=4, **OUTSIDE))
    assert events(owner, fence) == []
    send(owner, key, position(minutes_ago=3, **INSIDE))
    send(owner, key, position(minutes_ago=2, **INSIDE))
    assert events(owner, fence) == ["entry"]
    assert owner.client.get(f"{FENCES}/{fence['id']}").json()["vehicles_inside"] == 1
    send(owner, key, position(minutes_ago=1, **OUTSIDE))
    assert events(owner, fence) == ["entry", "exit"]
    assert owner.client.get(f"{FENCES}/{fence['id']}").json()["vehicles_inside"] == 0
    titles = [item["title"] for item in active(owner)]
    assert titles == ["KCA 123A left Depot", "KCA 123A entered Depot"]


def test_several_crossings_in_one_batch_are_kept_in_time_order(owner: Member) -> None:
    _, key = tracked(owner)
    fence = polygon(owner)
    send(owner, key, position(minutes_ago=9, **OUTSIDE))
    send(
        owner,
        key,
        position(minutes_ago=2, **OUTSIDE),
        position(minutes_ago=5, **INSIDE),
        position(minutes_ago=1, **INSIDE),
        position(minutes_ago=7, **OUTSIDE),
    )
    assert events(owner, fence) == ["entry", "exit", "entry"]


def test_a_first_ever_position_inside_is_not_an_entry(owner: Member) -> None:
    _, key = tracked(owner)
    fence = polygon(owner)
    send(owner, key, position(minutes_ago=2, **INSIDE))
    assert events(owner, fence) == []
    assert owner.client.get(f"{FENCES}/{fence['id']}").json()["vehicles_inside"] == 1
    send(owner, key, position(minutes_ago=1, **OUTSIDE))
    assert events(owner, fence) == ["exit"]


def test_drawing_a_fence_around_a_vehicle_is_not_an_entry(owner: Member) -> None:
    _, key = tracked(owner)
    send(owner, key, position(minutes_ago=3, **INSIDE))
    fence = polygon(owner)
    assert fence["vehicles_inside"] == 1
    send(owner, key, position(minutes_ago=2, **INSIDE))
    assert events(owner, fence) == []
    # Nor does moving the boundary create one.
    moved = owner.client.patch(
        f"{FENCES}/{fence['id']}",
        json={"boundary": [[0.5, 0.5], [0.5, 0.6], [0.6, 0.6]]},
        headers=owner.csrf,
    )
    assert moved.json()["vehicles_inside"] == 0
    assert events(owner, fence) == []


def test_a_late_delivery_doesnt_change_where_a_vehicle_is(owner: Member) -> None:
    _, key = tracked(owner)
    fence = polygon(owner)
    send(owner, key, position(minutes_ago=30, **OUTSIDE))
    send(owner, key, position(minutes_ago=1, **OUTSIDE))
    send(owner, key, position(minutes_ago=10, **INSIDE))
    assert events(owner, fence) == []


def test_duplicate_deliveries_create_nothing_new(owner: Member) -> None:
    _, key = tracked(owner)
    fence = polygon(owner)
    send(owner, key, position(minutes_ago=3, **OUTSIDE))
    entering = position(minutes_ago=2, **INSIDE)
    send(owner, key, entering)
    send(owner, key, entering)
    assert events(owner, fence) == ["entry"]
    assert len(active(owner)) == 1


def test_a_restricted_area_is_always_critical(owner: Member) -> None:
    _, key = tracked(owner)
    polygon(owner, name="Quarry", is_restricted=True, alert_on_entry=False)
    send(owner, key, position(minutes_ago=2, **OUTSIDE))
    send(owner, key, position(minutes_ago=1, **INSIDE))
    alert = active(owner)[0]
    assert alert["severity"] == "critical"
    assert alert["alert_type"] == "geofence_entry"
    assert "restricted area" in alert["message"]


def test_events_are_kept_even_when_alerts_are_off(owner: Member) -> None:
    _, key = tracked(owner)
    fence = polygon(owner, alert_on_entry=False)
    send(owner, key, position(minutes_ago=2, **OUTSIDE))
    send(owner, key, position(minutes_ago=1, **INSIDE))
    assert events(owner, fence) == ["entry"]
    assert active(owner) == []


def test_archived_fences_stop_producing_events_but_keep_their_history(owner: Member) -> None:
    _, key = tracked(owner)
    fence = polygon(owner)
    send(owner, key, position(minutes_ago=3, **OUTSIDE))
    send(owner, key, position(minutes_ago=2, **INSIDE))
    owner.client.post(f"{FENCES}/{fence['id']}/archive", headers=owner.csrf)
    send(owner, key, position(minutes_ago=1, **OUTSIDE))
    assert events(owner, fence) == ["entry"]
    changed = owner.client.patch(f"{FENCES}/{fence['id']}", json={"name": "x"}, headers=owner.csrf)
    assert changed.json()["error"]["code"] == "geofence_archived"


# Speed


def test_one_high_reading_isnt_enough_for_a_speed_alert(owner: Member) -> None:
    _, key = tracked(owner)
    limit(owner, 80)
    send(owner, key, position(minutes_ago=3, speed_kph=50))
    send(owner, key, position(minutes_ago=2, speed_kph=150))
    assert active(owner) == []


def test_two_readings_in_a_row_raise_one_alert_until_it_ends(owner: Member) -> None:
    _, key = tracked(owner)
    limit(owner, 80)
    send(owner, key, position(minutes_ago=4, speed_kph=100))
    send(owner, key, position(minutes_ago=3, speed_kph=110))
    send(owner, key, position(minutes_ago=2, speed_kph=120))
    alerts = active(owner)
    assert [item["alert_type"] for item in alerts] == ["speeding"]
    assert alerts[0]["severity"] == "warning"
    send(owner, key, position(minutes_ago=1, speed_kph=60))
    assert active(owner) == []
    assert len(active(owner, state="resolved")) == 1


def test_a_weak_signal_or_missing_speed_never_counts(owner: Member) -> None:
    _, key = tracked(owner)
    limit(owner, 80)
    send(owner, key, position(minutes_ago=4, speed_kph=100, signal_status="weak"))
    send(owner, key, position(minutes_ago=3, speed_kph=100, signal_status="weak"))
    send(owner, key, position(minutes_ago=2))
    send(owner, key, position(minutes_ago=1))
    assert active(owner) == []


def test_readings_far_apart_dont_confirm_each_other(owner: Member) -> None:
    _, key = tracked(owner)
    limit(owner, 80)
    send(owner, key, position(minutes_ago=30, speed_kph=100))
    send(owner, key, position(minutes_ago=1, speed_kph=100))
    assert active(owner) == []


def test_no_limit_means_no_speed_alerts(owner: Member) -> None:
    _, key = tracked(owner)
    send(owner, key, position(minutes_ago=2, speed_kph=300))
    send(owner, key, position(minutes_ago=1, speed_kph=300))
    assert active(owner) == []


def test_old_data_doesnt_look_like_a_current_problem(owner: Member) -> None:
    _, key = tracked(owner)
    limit(owner, 80)
    send(owner, key, position(minutes_ago=200, speed_kph=120))
    send(owner, key, position(minutes_ago=199, speed_kph=120))
    assert active(owner) == []


def test_turning_the_limit_off_closes_its_alerts(owner: Member) -> None:
    _, key = tracked(owner)
    limit(owner, 80)
    send(owner, key, position(minutes_ago=2, speed_kph=100))
    send(owner, key, position(minutes_ago=1, speed_kph=100))
    assert len(active(owner)) == 1
    limit(owner, None)
    assert active(owner) == []


# Unusual movement


def test_moving_with_the_ignition_off_is_flagged(owner: Member) -> None:
    _, key = tracked(owner)
    send(owner, key, position(minutes_ago=3, ignition_on=False, **INSIDE))
    send(owner, key, position(minutes_ago=2, ignition_on=False, latitude=0.02, longitude=0.0))
    alert = active(owner)[0]
    assert alert["alert_type"] == "unusual_movement"
    assert alert["severity"] == "critical"
    send(owner, key, position(minutes_ago=1, ignition_on=True, latitude=0.02, longitude=0.0))
    assert active(owner) == []


def test_gps_drift_while_parked_isnt_unusual(owner: Member) -> None:
    _, key = tracked(owner)
    send(owner, key, position(minutes_ago=2, ignition_on=False, **INSIDE))
    send(owner, key, position(minutes_ago=1, ignition_on=False, latitude=0.0005, longitude=0.0))
    assert active(owner) == []


def test_unknown_ignition_is_never_treated_as_off(owner: Member) -> None:
    _, key = tracked(owner)
    send(owner, key, position(minutes_ago=2, **INSIDE))
    send(owner, key, position(minutes_ago=1, speed_kph=60, latitude=0.5, longitude=0.0))
    assert active(owner) == []


# The scheduled sweep


def run_sweep(app_engine: Engine) -> None:
    with Session(app_engine) as db:
        alert_service.sweep(db)


def test_a_silent_vehicle_raises_one_alert_and_reporting_ends_it(
    owner: Member, app_engine: Engine
) -> None:
    _, key = tracked(owner)
    send(owner, key, position(minutes_ago=90))
    run_sweep(app_engine)
    run_sweep(app_engine)
    alerts = active(owner)
    assert [item["alert_type"] for item in alerts] == ["vehicle_offline"]
    send(owner, key, position(minutes_ago=0))
    assert active(owner) == []


def test_recent_parked_or_serviced_vehicles_arent_offline(
    owner: Member, app_engine: Engine
) -> None:
    car, key = tracked(owner)
    send(owner, key, position(minutes_ago=5))
    run_sweep(app_engine)
    assert active(owner) == []
    send(owner, key, position(minutes_ago=1, ignition_on=False))
    other = vehicle(owner, "KDB 456B")
    device(owner, other, external="D2")
    send(owner, key, position("D2", minutes_ago=90))
    owner.client.patch(
        f"{API}/vehicles/{other}", json={"status": "maintenance"}, headers=owner.csrf
    )
    run_sweep(app_engine)
    assert active(owner) == []
    assert car


def test_a_parked_vehicle_going_quiet_isnt_offline(owner: Member, app_engine: Engine) -> None:
    _, key = tracked(owner)
    send(owner, key, position(minutes_ago=300, ignition_on=False))
    run_sweep(app_engine)
    assert active(owner) == []


def test_offline_alerts_can_be_turned_off(owner: Member, app_engine: Engine) -> None:
    _, key = tracked(owner)
    send(owner, key, position(minutes_ago=90))
    run_sweep(app_engine)
    assert len(active(owner)) == 1
    owner.client.patch(
        f"{ALERTS}/settings", json={"offline_alerts_enabled": False}, headers=owner.csrf
    )
    assert active(owner) == []
    run_sweep(app_engine)
    assert active(owner) == []


def test_licence_alerts_follow_the_expiry_date(owner: Member, app_engine: Engine) -> None:
    today = utcnow().date()
    driver = new_driver(
        owner, licence_number="DL-100", licence_expires_on=str(today + timedelta(days=10))
    )
    new_driver(owner, licence_number="DL-200", licence_expires_on=str(today + timedelta(days=90)))
    run_sweep(app_engine)
    run_sweep(app_engine)
    alerts = active(owner)
    assert [(item["alert_type"], item["severity"]) for item in alerts] == [
        ("licence_expiry", "warning")
    ]
    assert "expires soon" in alerts[0]["title"]

    url = f"{API}/drivers/{driver['id']}"
    expired = str(today - timedelta(days=5))
    owner.client.patch(url, json={"licence_expires_on": expired}, headers=owner.csrf)
    run_sweep(app_engine)
    alerts = active(owner)
    assert [item["severity"] for item in alerts] == ["critical"]

    renewed = str(today + timedelta(days=400))
    owner.client.patch(url, json={"licence_expires_on": renewed}, headers=owner.csrf)
    run_sweep(app_engine)
    assert active(owner) == []


# Acknowledging


def entered(owner: Member) -> dict[str, Any]:
    _, key = tracked(owner)
    polygon(owner)
    send(owner, key, position(minutes_ago=2, **OUTSIDE))
    send(owner, key, position(minutes_ago=1, **INSIDE))
    return active(owner)[0]


def test_acknowledging_a_moment_closes_it_and_stays_in_history(owner: Member) -> None:
    alert = entered(owner)
    assert owner.client.get(f"{ALERTS}/summary").json()["unacknowledged"] == 1
    done = owner.client.post(f"{ALERTS}/{alert['id']}/acknowledge", headers=owner.csrf).json()
    assert done["acknowledged_at"] is not None
    assert done["resolved_at"] is not None
    assert active(owner) == []
    assert owner.client.get(f"{ALERTS}/summary").json()["unacknowledged"] == 0
    assert len(active(owner, state="all")) == 1


def test_an_acknowledged_condition_stays_active_without_alerting_again(owner: Member) -> None:
    _, key = tracked(owner)
    limit(owner, 80)
    send(owner, key, position(minutes_ago=3, speed_kph=100))
    send(owner, key, position(minutes_ago=2, speed_kph=100))
    alert = active(owner)[0]
    owner.client.post(f"{ALERTS}/{alert['id']}/acknowledge", headers=owner.csrf)
    send(owner, key, position(minutes_ago=1, speed_kph=100))
    assert len(active(owner)) == 1
    assert active(owner, state="unacknowledged") == []
    owner.client.post(f"{ALERTS}/{alert['id']}/resolve", headers=owner.csrf)
    assert active(owner) == []


def test_acknowledging_twice_keeps_the_first_time(owner: Member) -> None:
    alert = entered(owner)
    url = f"{ALERTS}/{alert['id']}/acknowledge"
    first = owner.client.post(url, headers=owner.csrf).json()
    second = owner.client.post(url, headers=owner.csrf).json()
    assert first["acknowledged_at"] == second["acknowledged_at"]


def test_filters(owner: Member) -> None:
    entered(owner)
    assert len(active(owner, alert_type="geofence_entry")) == 1
    assert active(owner, alert_type="speeding") == []
    assert active(owner, severity="critical") == []


# Who can see and do what


def test_nothing_crosses_organisations(owner: Member, new_owner: Callable[[], Member]) -> None:
    alert = entered(owner)
    fence = owner.client.get(FENCES).json()[0]
    other = new_owner()
    assert other.client.get(FENCES).json() == []
    assert other.client.get(f"{FENCES}/{fence['id']}").status_code == 404
    assert other.client.get(f"{FENCES}/{fence['id']}/events").status_code == 404
    assert (
        other.client.post(f"{FENCES}/{fence['id']}/archive", headers=other.csrf).status_code == 404
    )
    assert active(other, state="all") == []
    assert (
        other.client.post(f"{ALERTS}/{alert['id']}/acknowledge", headers=other.csrf).status_code
        == 404
    )
    # One organisation's position never trips another's geofence.
    other_car = vehicle(other)
    device(other, other_car, external="THEIRS")
    other_key = new_key(other)
    send(other, other_key, position("THEIRS", minutes_ago=2, **OUTSIDE))
    send(other, other_key, position("THEIRS", minutes_ago=1, **INSIDE))
    assert len(active(owner, state="all")) == 1


@pytest.mark.parametrize(
    ("role", "view", "acknowledge", "configure"),
    [
        ("read_only", 200, 403, 403),
        ("finance_manager", 200, 403, 403),
        ("dispatcher", 200, 200, 403),
        ("fleet_manager", 200, 200, 200),
        ("driver", 403, 403, 403),
    ],
)
def test_roles(
    owner: Member,
    invite: Callable[..., Member],
    role: str,
    view: int,
    acknowledge: int,
    configure: int,
) -> None:
    alert = entered(owner)
    member = invite(owner, role)
    assert member.client.get(ALERTS).status_code == view
    assert member.client.get(FENCES).status_code == view
    url = f"{ALERTS}/{alert['id']}/acknowledge"
    assert member.client.post(url, headers=member.csrf).status_code == acknowledge
    body = {"name": "New", "kind": "polygon", "boundary": SQUARE}
    created = member.client.post(FENCES, json=body, headers=member.csrf)
    assert created.status_code == (201 if configure == 200 else configure)
    settings = member.client.patch(f"{ALERTS}/settings", json={}, headers=member.csrf)
    assert settings.status_code == configure


def test_simulated_positions_produce_labelled_alerts(
    app: FastAPI, new_owner: Callable[[], Member], app_engine: Engine
) -> None:
    settings = app.state.settings.model_copy(update={"gps_simulator_enabled": True})
    app.state.settings = settings
    owner = new_owner()
    assert simulated(owner, vehicle(owner)).status_code == 201
    start = owner.client.get(f"{API}/tracking/fleet").json()[0]
    lat, lng = start["latitude"], start["longitude"]
    # Tiny, around where it starts, so its first step takes it out.
    size = 0.0001
    corners = [[lat - size, lng - size], [lat - size, lng + size], [lat + size, lng + size]]
    polygon(owner, name="Sim area", boundary=corners, alert_on_exit=True)
    with Session(app_engine) as db:
        assert simulate_tick(db, settings) >= 1
    alerts = active(owner)
    assert alerts
    assert all(item["is_simulated"] for item in alerts)
