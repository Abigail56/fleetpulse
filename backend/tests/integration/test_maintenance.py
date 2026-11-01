from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from typing import Any

import pytest
from sqlalchemy import Engine
from sqlmodel import Session

from app.models.base import utcnow
from app.services import alerts as alert_service
from tests.integration.conftest import API, Member
from tests.integration.test_tracking import vehicle
from tests.integration.test_trips import ready as ready_trip

pytestmark = pytest.mark.integration

ROOT = f"{API}/maintenance"
SCHEDULES = f"{ROOT}/schedules"
ORDERS = f"{ROOT}/work-orders"


def day(offset: int = 0) -> str:
    return str(utcnow().date() + timedelta(days=offset))


def odometer(member: Member, car: str, km: float) -> None:
    response = member.client.patch(
        f"{API}/vehicles/{car}", json={"odometer_km": str(km)}, headers=member.csrf
    )
    assert response.status_code == 200, response.text


def schedule(member: Member, car: str, **extra: Any) -> dict[str, Any]:
    response = member.client.post(
        SCHEDULES,
        json={"vehicle_id": car, "name": "Oil change", "interval_days": 90} | extra,
        headers=member.csrf,
    )
    assert response.status_code == 201, response.text
    result: dict[str, Any] = response.json()
    return result


def order(member: Member, car: str, **extra: Any) -> dict[str, Any]:
    response = member.client.post(
        ORDERS,
        json={"vehicle_id": car, "work_type": "corrective", "title": "Replace brake pads"} | extra,
        headers=member.csrf,
    )
    assert response.status_code == 201, response.text
    result: dict[str, Any] = response.json()
    return result


def act(member: Member, item: dict[str, Any], step: str, **body: Any) -> Any:
    return member.client.post(f"{ORDERS}/{item['id']}/{step}", json=body, headers=member.csrf)


def fetch_vehicle(member: Member, car: str) -> dict[str, Any]:
    result: dict[str, Any] = member.client.get(f"{API}/vehicles/{car}").json()
    return result


@pytest.fixture
def owner(new_owner: Callable[[], Member]) -> Member:
    return new_owner()


@pytest.fixture
def car(owner: Member) -> str:
    return vehicle(owner)


# When things come due


@pytest.mark.parametrize(
    ("days_ago", "state"),
    [(0, "ok"), (75, "ok"), (76, "due_soon"), (90, "due_soon"), (91, "overdue")],
)
def test_time_based_schedule(owner: Member, car: str, days_ago: int, state: str) -> None:
    item = schedule(owner, car, last_service_on=day(-days_ago))
    assert item["state"] == state
    assert item["next_due_on"] == day(90 - days_ago)
    assert item["next_due_km"] is None


@pytest.mark.parametrize(
    ("km", "state"), [(10000, "ok"), (14499, "ok"), (14500, "due_soon"), (15000, "overdue")]
)
def test_distance_based_schedule(owner: Member, car: str, km: int, state: str) -> None:
    odometer(owner, car, km)
    item = schedule(owner, car, interval_days=None, interval_km="5000", last_service_km="10000")
    assert item["state"] == state
    assert float(item["next_due_km"]) == 15000
    assert item["next_due_on"] is None


def test_whichever_comes_first_decides(owner: Member, car: str) -> None:
    odometer(owner, car, 15000)
    item = schedule(owner, car, interval_km="5000", last_service_km="10000")
    assert item["state"] == "overdue"  # by distance, while the date is months away


def test_last_service_defaults_to_today_and_the_current_reading(owner: Member, car: str) -> None:
    odometer(owner, car, 4321)
    item = schedule(owner, car, interval_km="1000")
    assert item["last_service_on"] == day()
    assert float(item["last_service_km"]) == 4321
    assert fetch_vehicle(owner, car)["odometer_recorded_at"] is not None


@pytest.mark.parametrize(
    "body",
    [
        {"interval_days": None},
        {"interval_days": 0},
        {"interval_days": None, "interval_km": "0"},
        {"name": " "},
    ],
)
def test_bad_schedules_are_rejected(owner: Member, car: str, body: dict[str, Any]) -> None:
    payload = {"vehicle_id": car, "name": "x", "interval_days": 30} | body
    assert owner.client.post(SCHEDULES, json=payload, headers=owner.csrf).status_code == 422


def test_a_last_service_in_the_future_is_rejected(owner: Member, car: str) -> None:
    response = owner.client.post(
        SCHEDULES,
        json={"vehicle_id": car, "name": "x", "interval_days": 30, "last_service_on": day(5)},
        headers=owner.csrf,
    )
    assert response.json()["error"]["code"] == "date_in_future"


def test_removing_every_interval_is_refused(owner: Member, car: str) -> None:
    item = schedule(owner, car)
    response = owner.client.patch(
        f"{SCHEDULES}/{item['id']}", json={"interval_days": None}, headers=owner.csrf
    )
    assert response.json()["error"]["code"] == "no_interval"


def test_most_urgent_comes_first_and_state_can_be_filtered(owner: Member, car: str) -> None:
    schedule(owner, car, name="Fine")
    schedule(owner, car, name="Late", last_service_on=day(-200))
    rows = owner.client.get(SCHEDULES).json()["items"]
    assert [row["name"] for row in rows] == ["Late", "Fine"]
    assert owner.client.get(SCHEDULES, params={"state": "overdue"}).json()["total"] == 1


# Work order lifecycle


def test_the_full_lifecycle_takes_the_vehicle_off_the_road_and_back(
    owner: Member, car: str
) -> None:
    item = order(
        owner,
        car,
        provider_name="Nairobi Motors",
        provider_phone="+254 712 345678",
        provider_email="service@example.com",
        scheduled_for=day(3),
    )
    assert item["status"] == "open"
    assert item["currency"] == "KES" or len(item["currency"]) == 3
    assert fetch_vehicle(owner, car)["status"] == "idle"

    started = act(owner, item, "start").json()
    assert started["status"] == "in_progress"
    assert fetch_vehicle(owner, car)["status"] == "maintenance"

    done = act(
        owner, item, "complete", labour_cost="1500.50", parts_cost="2000", odometer_km="1200"
    )
    assert done.status_code == 200, done.text
    body = done.json()
    assert body["status"] == "completed"
    assert body["completed_on"] == day()
    assert float(body["total_cost"]) == 3500.50
    assert body["provider_name"] == "Nairobi Motors"
    after = fetch_vehicle(owner, car)
    assert after["status"] == "idle"
    assert float(after["odometer_km"]) == 1200


def test_work_can_be_done_without_taking_the_vehicle_off_the_road(owner: Member, car: str) -> None:
    item = order(owner, car)
    assert act(owner, item, "start", take_off_road=False).status_code == 200
    assert fetch_vehicle(owner, car)["status"] == "idle"


def test_a_vehicle_stays_off_the_road_until_all_its_work_is_done(owner: Member, car: str) -> None:
    owner.client.patch(f"{API}/vehicles/{car}", json={"status": "active"}, headers=owner.csrf)
    first, second = order(owner, car), order(owner, car, title="Second job")
    act(owner, first, "start")
    act(owner, second, "start")
    act(owner, first, "complete")
    assert fetch_vehicle(owner, car)["status"] == "maintenance"
    act(owner, second, "complete")
    # Back to what it was before any of the work began.
    assert fetch_vehicle(owner, car)["status"] == "active"


def test_a_manual_status_change_during_work_is_respected(owner: Member, car: str) -> None:
    item = order(owner, car)
    act(owner, item, "start")
    owner.client.patch(
        f"{API}/vehicles/{car}", json={"status": "out_of_service"}, headers=owner.csrf
    )
    act(owner, item, "complete")
    assert fetch_vehicle(owner, car)["status"] == "out_of_service"


def test_cancelling_also_returns_the_vehicle(owner: Member, car: str) -> None:
    item = order(owner, car)
    act(owner, item, "start")
    assert act(owner, item, "cancel").json()["status"] == "cancelled"
    assert fetch_vehicle(owner, car)["status"] == "idle"


@pytest.mark.parametrize(
    ("done", "step"),
    [
        ((), "complete"),
        (("start",), "start"),
        (("start", "complete"), "start"),
        (("start", "complete"), "cancel"),
        (("cancel",), "start"),
        (("cancel",), "cancel"),
    ],
)
def test_steps_cant_be_skipped_or_repeated(
    owner: Member, car: str, done: tuple[str, ...], step: str
) -> None:
    item = order(owner, car)
    for action in done:
        assert act(owner, item, action).status_code == 200
    response = act(owner, item, step)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "invalid_transition"


def test_finished_work_cant_be_edited(owner: Member, car: str) -> None:
    item = order(owner, car)
    url = f"{ORDERS}/{item['id']}"
    changed = owner.client.patch(url, json={"title": "New"}, headers=owner.csrf)
    assert changed.json()["title"] == "New"
    act(owner, item, "cancel")
    closed = owner.client.patch(url, json={"title": "Newer"}, headers=owner.csrf)
    assert closed.json()["error"]["code"] == "work_order_closed"


def test_a_vehicle_on_a_trip_cant_be_taken_off_the_road(owner: Member) -> None:
    trip = ready_trip(owner)
    for step in ("plan", "dispatch", "start"):
        owner.client.post(f"{API}/trips/{trip['id']}/{step}", json={}, headers=owner.csrf)
    item = order(owner, trip["vehicle_id"])
    response = act(owner, item, "start")
    assert response.json()["error"]["code"] == "vehicle_on_trip"
    assert act(owner, item, "start", take_off_road=False).status_code == 200


def test_a_vehicle_in_the_workshop_cant_be_dispatched_or_archived(owner: Member) -> None:
    trip = ready_trip(owner)
    item = order(owner, trip["vehicle_id"])
    act(owner, item, "start")
    owner.client.post(f"{API}/trips/{trip['id']}/plan", json={}, headers=owner.csrf)
    dispatched = owner.client.post(
        f"{API}/trips/{trip['id']}/dispatch", json={}, headers=owner.csrf
    )
    assert dispatched.json()["error"]["code"] == "vehicle_unavailable"
    archived = owner.client.post(f"{API}/vehicles/{trip['vehicle_id']}/archive", headers=owner.csrf)
    assert archived.json()["error"]["code"] == "vehicle_in_workshop"


def test_completion_values_must_make_sense(owner: Member, car: str) -> None:
    item = order(owner, car)
    act(owner, item, "start")
    assert act(owner, item, "complete", completed_on=day(2)).json()["error"]["code"] == (
        "date_in_future"
    )
    assert act(owner, item, "complete", labour_cost="-1").status_code == 422
    assert act(owner, item, "complete", odometer_km="-1").status_code == 422


def test_unknown_costs_stay_unknown_rather_than_zero(owner: Member, car: str) -> None:
    item = order(owner, car)
    act(owner, item, "start")
    done = act(owner, item, "complete").json()
    assert done["labour_cost"] is None
    assert done["total_cost"] is None
    assert owner.client.get(f"{ROOT}/summary").json()["recent_costs"] == []


def test_free_work_is_different_from_unknown_cost(owner: Member, car: str) -> None:
    item = order(owner, car)
    act(owner, item, "start")
    assert float(act(owner, item, "complete", labour_cost="0").json()["total_cost"]) == 0


def test_an_old_reading_never_winds_the_odometer_back(owner: Member, car: str) -> None:
    odometer(owner, car, 5000)
    item = order(owner, car)
    act(owner, item, "start")
    done = act(owner, item, "complete", odometer_km="4000").json()
    assert float(done["odometer_km"]) == 4000
    assert float(fetch_vehicle(owner, car)["odometer_km"]) == 5000


@pytest.mark.parametrize(
    "extra",
    [
        {"title": " "},
        {"work_type": "other"},
        {"provider_email": "not-an-email"},
        {"provider_phone": "abc"},
    ],
)
def test_bad_work_orders_are_rejected(owner: Member, car: str, extra: dict[str, Any]) -> None:
    payload = {"vehicle_id": car, "work_type": "corrective", "title": "x"} | extra
    assert owner.client.post(ORDERS, json=payload, headers=owner.csrf).status_code == 422


# Schedules and work orders together


def test_completing_scheduled_work_resets_the_schedule(owner: Member, car: str) -> None:
    item = schedule(owner, car, last_service_on=day(-200))
    assert item["state"] == "overdue"
    work = order(owner, car, schedule_id=item["id"], work_type="preventive", title="Oil")
    assert owner.client.get(f"{SCHEDULES}/{item['id']}").json()["open_work_order_id"] == work["id"]
    act(owner, work, "start")
    act(owner, work, "complete")
    after = owner.client.get(f"{SCHEDULES}/{item['id']}").json()
    assert after["state"] == "ok"
    assert after["last_service_on"] == day()
    assert after["next_due_on"] == day(90)
    assert after["open_work_order_id"] is None


def test_distance_schedules_need_a_reading_to_complete(owner: Member, car: str) -> None:
    odometer(owner, car, 16000)
    item = schedule(owner, car, interval_days=None, interval_km="5000", last_service_km="10000")
    work = order(owner, car, schedule_id=item["id"], work_type="preventive")
    act(owner, work, "start")
    assert act(owner, work, "complete").json()["error"]["code"] == "odometer_required"
    assert act(owner, work, "complete", odometer_km="16100").status_code == 200
    after = owner.client.get(f"{SCHEDULES}/{item['id']}").json()
    assert float(after["next_due_km"]) == 21100
    assert after["state"] == "ok"


def test_backdated_work_doesnt_move_a_schedule_backwards(owner: Member, car: str) -> None:
    item = schedule(owner, car, last_service_on=day(-10))
    work = order(owner, car, schedule_id=item["id"], work_type="preventive")
    act(owner, work, "start")
    act(owner, work, "complete", completed_on=day(-30))
    assert owner.client.get(f"{SCHEDULES}/{item['id']}").json()["last_service_on"] == day(-10)


def test_cancelling_scheduled_work_leaves_it_due(owner: Member, car: str) -> None:
    item = schedule(owner, car, last_service_on=day(-200))
    work = order(owner, car, schedule_id=item["id"], work_type="preventive")
    act(owner, work, "cancel")
    after = owner.client.get(f"{SCHEDULES}/{item['id']}").json()
    assert after["state"] == "overdue"
    order(owner, car, schedule_id=item["id"], work_type="preventive")


def test_a_schedule_can_only_be_booked_once_at_a_time(owner: Member, car: str) -> None:
    item = schedule(owner, car)
    payload = {
        "vehicle_id": car,
        "schedule_id": item["id"],
        "work_type": "preventive",
        "title": "Oil",
    }

    def create(_: int) -> Any:
        response = owner.client.post(ORDERS, json=payload, headers=owner.csrf)
        return response

    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(create, [0, 1]))
    assert sorted(result.status_code for result in results) == [201, 409]
    refused = next(result for result in results if result.status_code == 409)
    assert refused.json()["error"]["code"] == "work_order_exists"


def test_a_schedule_must_match_the_vehicle(owner: Member, car: str) -> None:
    other = vehicle(owner, "KDB 456B")
    item = schedule(owner, car)
    response = owner.client.post(
        ORDERS,
        json={
            "vehicle_id": other,
            "schedule_id": item["id"],
            "work_type": "preventive",
            "title": "x",
        },
        headers=owner.csrf,
    )
    assert response.json()["error"]["code"] == "schedule_mismatch"


def test_archived_schedules_leave_the_list_and_stop_alerting(
    owner: Member, car: str, app_engine: Engine
) -> None:
    item = schedule(owner, car, last_service_on=day(-200))
    run_sweep(app_engine)
    assert len(alerts(owner)) == 1
    owner.client.post(f"{SCHEDULES}/{item['id']}/archive", headers=owner.csrf)
    assert owner.client.get(SCHEDULES).json()["total"] == 0
    assert owner.client.get(SCHEDULES, params={"archived": True}).json()["total"] == 1
    run_sweep(app_engine)
    assert alerts(owner) == []
    changed = owner.client.patch(
        f"{SCHEDULES}/{item['id']}", json={"name": "x"}, headers=owner.csrf
    )
    assert changed.json()["error"]["code"] == "schedule_archived"


# Reminders


def run_sweep(app_engine: Engine) -> None:
    with Session(app_engine) as db:
        alert_service.sweep(db)


def alerts(member: Member) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = member.client.get(
        f"{API}/alerts", params={"alert_type": "maintenance_due"}
    ).json()["items"]
    return result


def test_reminders_escalate_and_end_when_the_work_is_done(
    owner: Member, car: str, app_engine: Engine
) -> None:
    item = schedule(owner, car, last_service_on=day(-80))
    run_sweep(app_engine)
    run_sweep(app_engine)
    first = alerts(owner)
    assert [row["severity"] for row in first] == ["warning"]
    assert "due soon" in first[0]["title"]

    owner.client.patch(
        f"{SCHEDULES}/{item['id']}", json={"last_service_on": day(-100)}, headers=owner.csrf
    )
    run_sweep(app_engine)
    second = alerts(owner)
    assert [row["severity"] for row in second] == ["critical"]
    assert "overdue" in second[0]["title"]

    work = order(owner, car, schedule_id=item["id"], work_type="preventive")
    act(owner, work, "start")
    act(owner, work, "complete")
    run_sweep(app_engine)
    assert alerts(owner) == []


def test_distance_reminders_follow_the_odometer(
    owner: Member, car: str, app_engine: Engine
) -> None:
    schedule(owner, car, interval_days=None, interval_km="5000", last_service_km="0")
    run_sweep(app_engine)
    assert alerts(owner) == []
    odometer(owner, car, 4800)
    run_sweep(app_engine)
    assert [row["severity"] for row in alerts(owner)] == ["warning"]


def test_maintenance_alerts_can_be_turned_off(owner: Member, car: str, app_engine: Engine) -> None:
    schedule(owner, car, last_service_on=day(-200))
    run_sweep(app_engine)
    assert len(alerts(owner)) == 1
    owner.client.patch(
        f"{API}/alerts/settings", json={"maintenance_alerts_enabled": False}, headers=owner.csrf
    )
    run_sweep(app_engine)
    assert alerts(owner) == []


# Listing and summary


def test_history_search_and_filters(owner: Member, car: str) -> None:
    other = vehicle(owner, "KDB 456B")
    done = order(owner, car, title="Brakes", provider_name="Nairobi Motors")
    act(owner, done, "start")
    act(owner, done, "complete")
    order(owner, other, title="Tyres_100%", work_type="preventive")
    assert owner.client.get(ORDERS).json()["items"][0]["title"].startswith("Tyres")
    assert owner.client.get(ORDERS, params={"status": "completed"}).json()["total"] == 1
    assert owner.client.get(ORDERS, params={"vehicle_id": car}).json()["total"] == 1
    assert owner.client.get(ORDERS, params={"work_type": "preventive"}).json()["total"] == 1
    assert owner.client.get(ORDERS, params={"search": "nairobi"}).json()["total"] == 1
    assert owner.client.get(ORDERS, params={"search": "KDB"}).json()["total"] == 1
    assert owner.client.get(ORDERS, params={"search": "%"}).json()["total"] == 1


def test_summary_counts(owner: Member, car: str) -> None:
    schedule(owner, car, name="Late", last_service_on=day(-200))
    schedule(owner, car, name="Soon", last_service_on=day(-80))
    order(owner, car, title="Waiting")
    started = order(owner, car, title="Started")
    act(owner, started, "start")
    done = order(owner, car, title="Done")
    act(owner, done, "start")
    act(owner, done, "complete", parts_cost="250.25")
    old = order(owner, car, title="Old")
    act(owner, old, "start")
    act(owner, old, "complete", parts_cost="999", completed_on=day(-40))
    result = owner.client.get(f"{ROOT}/summary").json()
    assert (result["overdue"], result["due_soon"]) == (1, 1)
    assert (result["open_work_orders"], result["in_progress_work_orders"]) == (1, 1)
    assert [float(item["amount"]) for item in result["recent_costs"]] == [250.25]


# Who can see and do what


def test_nothing_crosses_organisations(
    owner: Member, car: str, new_owner: Callable[[], Member]
) -> None:
    item = schedule(owner, car)
    work = order(owner, car)
    other = new_owner()
    assert other.client.get(SCHEDULES).json()["total"] == 0
    assert other.client.get(ORDERS).json()["total"] == 0
    assert other.client.get(f"{SCHEDULES}/{item['id']}").status_code == 404
    assert other.client.get(f"{ORDERS}/{work['id']}").status_code == 404
    assert act(other, work, "start").status_code == 404
    response = other.client.post(
        ORDERS,
        json={"vehicle_id": car, "work_type": "corrective", "title": "x"},
        headers=other.csrf,
    )
    assert response.json()["error"]["code"] == "vehicle_not_found"
    response = other.client.post(
        SCHEDULES, json={"vehicle_id": car, "name": "x", "interval_days": 9}, headers=other.csrf
    )
    assert response.json()["error"]["code"] == "vehicle_not_found"


@pytest.mark.parametrize(
    ("role", "view", "manage"),
    [
        ("maintenance_manager", 200, 201),
        ("fleet_manager", 200, 201),
        ("dispatcher", 200, 403),
        ("finance_manager", 200, 403),
        ("read_only", 200, 403),
        ("driver", 403, 403),
    ],
)
def test_roles(
    owner: Member, car: str, invite: Callable[..., Member], role: str, view: int, manage: int
) -> None:
    member = invite(owner, role)
    assert member.client.get(ORDERS).status_code == view
    assert member.client.get(SCHEDULES).status_code == view
    assert member.client.get(f"{ROOT}/summary").status_code == view
    payload = {"vehicle_id": car, "work_type": "corrective", "title": "x"}
    assert member.client.post(ORDERS, json=payload, headers=member.csrf).status_code == manage
    allowed = 200 if manage == 201 else 403
    assert member.client.get(f"{ROOT}/vehicle-options").status_code == allowed
