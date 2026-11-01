from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from typing import Any

import pytest

from app.models.base import utcnow
from tests.integration.conftest import API, Member
from tests.integration.test_drivers import created as new_driver
from tests.integration.test_drivers import vehicle as new_vehicle
from tests.integration.test_tracking import device, new_key, position, send

pytestmark = pytest.mark.integration

URL = f"{API}/trips"


def when(hours: float = 0) -> str:
    return (utcnow() + timedelta(hours=hours)).isoformat()


def post(member: Member, path: str, body: dict[str, Any] | None = None) -> Any:
    return member.client.post(f"{URL}{path}", json=body or {}, headers=member.csrf)


def create(member: Member, **overrides: Any) -> dict[str, Any]:
    response = post(
        member, "", {"origin_name": "Nairobi", "destination_name": "Mombasa"} | overrides
    )
    assert response.status_code == 201, response.text
    result: dict[str, Any] = response.json()
    return result


def ready(member: Member, tag: str = "1") -> dict[str, Any]:
    car = new_vehicle(member, f"KCA {tag}")
    driver = new_driver(member, licence_number=f"DL-{tag}00")
    return create(
        member,
        vehicle_id=car["id"],
        driver_id=driver["id"],
        planned_departure_at=when(1),
        estimated_arrival_at=when(9),
    )


def advance(member: Member, trip: dict[str, Any], *steps: str) -> dict[str, Any]:
    for step in steps:
        response = post(member, f"/{trip['id']}/{step}")
        assert response.status_code == 200, response.text
    result: dict[str, Any] = response.json()
    return result


def link(owner: Member, driver_id: str, member: Member) -> None:
    members = owner.client.get(f"{API}/organisation/members").json()
    user_id = next(item["user_id"] for item in members if item["email"] == member.email)
    response = owner.client.post(
        f"{API}/drivers/{driver_id}/account", json={"user_id": user_id}, headers=owner.csrf
    )
    assert response.status_code == 200, response.text


def test_the_full_lifecycle(new_owner: Callable[[], Member]) -> None:
    owner = new_owner()
    trip = ready(owner)
    assert trip["status"] == "draft"
    assert trip["vehicle_registration"] == "KCA 1"
    assert trip["driver_name"] == "Tunde Adeyemi"
    assert advance(owner, trip, "plan")["status"] == "planned"
    assert advance(owner, trip, "dispatch")["status"] == "dispatched"
    started = advance(owner, trip, "start")
    assert started["status"] == "in_progress"
    assert started["actual_departure_at"] is not None
    driver = owner.client.get(f"{API}/drivers/{trip['driver_id']}").json()
    assert driver["availability"] == "on_trip"
    finished = advance(owner, trip, "complete")
    assert finished["status"] == "completed"
    assert finished["actual_arrival_at"] is not None
    driver = owner.client.get(f"{API}/drivers/{trip['driver_id']}").json()
    assert driver["availability"] == "available"
    events = owner.client.get(f"{URL}/{trip['id']}/events").json()
    assert [item["action"] for item in events] == [
        "trip.created",
        "trip.planned",
        "trip.dispatched",
        "trip.started",
        "trip.completed",
    ]
    assert events[0]["actor_name"]


@pytest.mark.parametrize(
    ("done", "step"),
    [
        ((), "dispatch"),
        ((), "start"),
        ((), "complete"),
        (("plan",), "start"),
        (("plan",), "plan"),
        (("plan", "dispatch"), "complete"),
        (("plan", "dispatch", "start"), "dispatch"),
        (("plan", "dispatch", "start", "complete"), "cancel"),
        (("cancel",), "plan"),
    ],
)
def test_steps_cant_be_skipped_or_repeated(
    new_owner: Callable[[], Member], done: tuple[str, ...], step: str
) -> None:
    owner = new_owner()
    trip = ready(owner)
    for item in done:
        advance(owner, trip, item)
    response = post(owner, f"/{trip['id']}/{step}")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "invalid_transition"


def test_a_trip_needs_a_time_to_be_planned_and_people_to_be_dispatched(
    new_owner: Callable[[], Member],
) -> None:
    owner = new_owner()
    bare = create(owner)
    assert post(owner, f"/{bare['id']}/plan").json()["error"]["code"] == "missing_departure"
    timed = create(owner, planned_departure_at=when(1))
    advance(owner, timed, "plan")
    assert post(owner, f"/{timed['id']}/dispatch").json()["error"]["code"] == "not_assigned"


def test_unavailable_vehicles_and_drivers_cant_be_dispatched(
    new_owner: Callable[[], Member],
) -> None:
    owner = new_owner()
    trip = ready(owner)
    advance(owner, trip, "plan")
    owner.client.patch(
        f"{API}/vehicles/{trip['vehicle_id']}", json={"status": "maintenance"}, headers=owner.csrf
    )
    assert post(owner, f"/{trip['id']}/dispatch").json()["error"]["code"] == "vehicle_unavailable"
    owner.client.patch(
        f"{API}/vehicles/{trip['vehicle_id']}", json={"status": "active"}, headers=owner.csrf
    )
    owner.client.patch(
        f"{API}/drivers/{trip['driver_id']}", json={"status": "suspended"}, headers=owner.csrf
    )
    assert post(owner, f"/{trip['id']}/dispatch").json()["error"]["code"] == "driver_unavailable"


def test_an_expired_licence_blocks_dispatch_and_departure(new_owner: Callable[[], Member]) -> None:
    owner = new_owner()
    trip = ready(owner)
    advance(owner, trip, "plan", "dispatch")
    yesterday = (utcnow() - timedelta(days=2)).date().isoformat()
    owner.client.patch(
        f"{API}/drivers/{trip['driver_id']}",
        json={"licence_expires_on": yesterday},
        headers=owner.csrf,
    )
    assert post(owner, f"/{trip['id']}/start").json()["error"]["code"] == "licence_expired"


def test_a_vehicle_or_driver_cant_be_on_two_trips_at_once(new_owner: Callable[[], Member]) -> None:
    owner = new_owner()
    first = ready(owner)
    second = create(
        owner,
        vehicle_id=first["vehicle_id"],
        driver_id=first["driver_id"],
        planned_departure_at=when(2),
    )
    advance(owner, first, "plan", "dispatch")
    advance(owner, second, "plan", "dispatch")
    with ThreadPoolExecutor(2) as pool:
        results = list(
            pool.map(lambda item: post(owner, f"/{item['id']}/start").status_code, [first, second])
        )
    assert sorted(results) == [200, 409]


def test_edits_are_limited_once_a_trip_is_dispatched(new_owner: Callable[[], Member]) -> None:
    owner = new_owner()
    trip = ready(owner)

    def edit(body: dict[str, str]) -> Any:
        return owner.client.patch(f"{URL}/{trip['id']}", json=body, headers=owner.csrf)

    assert edit({"destination_name": "Kisumu"}).json()["destination_name"] == "Kisumu"
    advance(owner, trip, "plan", "dispatch")
    assert edit({"destination_name": "Nakuru"}).json()["error"]["code"] == "trip_underway"
    assert edit({"dispatch_notes": "Use the bypass"}).json()["dispatch_notes"] == "Use the bypass"
    advance(owner, trip, "cancel")
    assert edit({"dispatch_notes": "x"}).json()["error"]["code"] == "trip_closed"


def test_times_must_make_sense(new_owner: Callable[[], Member]) -> None:
    owner = new_owner()
    response = post(
        owner,
        "",
        {
            "origin_name": "A",
            "destination_name": "B",
            "planned_departure_at": when(5),
            "estimated_arrival_at": when(1),
        },
    )
    assert response.json()["error"]["code"] == "arrival_before_departure"
    trip = ready(owner)
    advance(owner, trip, "plan", "dispatch")
    future = post(owner, f"/{trip['id']}/start", {"actual_departure_at": when(2)})
    assert future.json()["error"]["code"] == "time_in_future"
    post(owner, f"/{trip['id']}/start", {"actual_departure_at": when(-3)})
    early = post(owner, f"/{trip['id']}/complete", {"actual_arrival_at": when(-5)})
    assert early.json()["error"]["code"] == "arrival_before_departure"


def test_naive_times_and_blank_places_are_rejected(new_owner: Callable[[], Member]) -> None:
    owner = new_owner()
    assert post(owner, "", {"origin_name": " ", "destination_name": "B"}).status_code == 422
    assert (
        post(
            owner,
            "",
            {
                "origin_name": "A",
                "destination_name": "B",
                "planned_departure_at": "2030-01-01T10:00:00",
            },
        ).status_code
        == 422
    )


# Distance


def test_distance_comes_from_gps_and_says_so(new_owner: Callable[[], Member]) -> None:
    owner = new_owner()
    trip = ready(owner)
    device(owner, trip["vehicle_id"])
    key = new_key(owner)
    advance(owner, trip, "plan", "dispatch")
    post(owner, f"/{trip['id']}/start", {"actual_departure_at": when(-1)})
    send(
        owner,
        key,
        position(minutes_ago=30, latitude=-1.0, longitude=36.0),
        position(minutes_ago=10, latitude=-1.1, longitude=36.0),
        # Before departure: must not count.
        position(minutes_ago=300, latitude=5.0, longitude=36.0),
    )
    finished = advance(owner, trip, "complete")
    assert finished["distance_source"] == "gps"
    assert float(finished["distance_km"]) == pytest.approx(11.1, abs=0.2)
    route = owner.client.get(f"{URL}/{trip['id']}/route").json()
    assert len(route["points"]) == 2
    assert route["is_simulated"] is False


def test_without_positions_distance_stays_unknown_rather_than_zero(
    new_owner: Callable[[], Member],
) -> None:
    owner = new_owner()
    trip = ready(owner)
    finished = advance(owner, trip, "plan", "dispatch", "start", "complete")
    assert finished["distance_km"] is None
    assert finished["distance_source"] is None


def test_a_typed_distance_is_labelled_as_typed(new_owner: Callable[[], Member]) -> None:
    owner = new_owner()
    trip = ready(owner)
    advance(owner, trip, "plan", "dispatch", "start")
    finished = post(owner, f"/{trip['id']}/complete", {"distance_km": "482.5"}).json()
    assert finished["distance_source"] == "manual"
    assert float(finished["distance_km"]) == 482.5
    other = ready(owner, "2")
    advance(owner, other, "plan", "dispatch", "start")
    assert post(owner, f"/{other['id']}/complete", {"distance_km": "-1"}).status_code == 422


# Who can see and do what


def test_trips_never_cross_organisations(new_owner: Callable[[], Member]) -> None:
    owner, other = new_owner(), new_owner()
    trip = ready(owner)
    assert other.client.get(URL).json()["total"] == 0
    assert other.client.get(f"{URL}/{trip['id']}").status_code == 404
    assert other.client.get(f"{URL}/{trip['id']}/events").status_code == 404
    assert other.client.get(f"{URL}/{trip['id']}/route").status_code == 404
    assert post(other, f"/{trip['id']}/plan").status_code == 404
    assert other.client.patch(f"{URL}/{trip['id']}", json={}, headers=other.csrf).status_code == 404
    # Nor can another organisation's vehicle or driver be attached.
    response = post(
        other, "", {"origin_name": "A", "destination_name": "B", "vehicle_id": trip["vehicle_id"]}
    )
    assert response.json()["error"]["code"] == "vehicle_not_found"
    response = post(
        other, "", {"origin_name": "A", "destination_name": "B", "driver_id": trip["driver_id"]}
    )
    assert response.json()["error"]["code"] == "driver_not_found"


def test_read_only_roles_see_trips_but_cant_change_them(
    new_owner: Callable[[], Member], invite: Callable[..., Member]
) -> None:
    owner = new_owner()
    trip = ready(owner)
    viewer = invite(owner, "read_only")
    assert viewer.client.get(URL).json()["total"] == 1
    assert post(viewer, "", {"origin_name": "A", "destination_name": "B"}).status_code == 403
    assert post(viewer, f"/{trip['id']}/plan").status_code == 403
    assert post(viewer, f"/{trip['id']}/start").status_code == 403
    assert post(viewer, f"/{trip['id']}/cancel").status_code == 403
    assert viewer.client.get(f"{URL}/options").status_code == 403


def test_dispatchers_can_run_trips(
    new_owner: Callable[[], Member], invite: Callable[..., Member]
) -> None:
    owner = new_owner()
    trip = ready(owner)
    dispatcher = invite(owner, "dispatcher")
    assert advance(dispatcher, trip, "plan", "dispatch", "start")["status"] == "in_progress"
    options = dispatcher.client.get(f"{URL}/options").json()
    assert [item["name"] for item in options["drivers"]] == ["Tunde Adeyemi"]


def test_a_driver_sees_and_runs_only_their_own_trips(
    new_owner: Callable[[], Member], invite: Callable[..., Member]
) -> None:
    owner = new_owner()
    mine = ready(owner, "1")
    theirs = ready(owner, "2")
    driver = invite(owner, "driver")
    assert driver.client.get(URL).json()["total"] == 0  # not linked yet
    assert driver.client.get(f"{URL}/{mine['id']}").status_code == 404
    link(owner, mine["driver_id"], driver)

    listed = driver.client.get(URL).json()
    assert [item["id"] for item in listed["items"]] == [mine["id"]]
    assert driver.client.get(f"{URL}/{theirs['id']}").status_code == 404
    assert driver.client.get(f"{URL}/{theirs['id']}/route").status_code == 404
    assert driver.client.get(f"{URL}/{theirs['id']}/events").status_code == 404
    assert driver.client.get(URL, params={"driver_id": theirs["driver_id"]}).json()["total"] == 0

    assert post(driver, f"/{mine['id']}/plan").status_code == 403
    assert post(driver, f"/{mine['id']}/cancel").status_code == 403
    advance(owner, mine, "plan", "dispatch")
    advance(owner, theirs, "plan", "dispatch")
    assert post(driver, f"/{theirs['id']}/start").status_code == 404
    assert advance(driver, mine, "start", "complete")["status"] == "completed"


def test_a_member_links_to_one_driver_only_and_only_in_this_organisation(
    new_owner: Callable[[], Member], invite: Callable[..., Member]
) -> None:
    owner, other = new_owner(), new_owner()
    first = new_driver(owner, licence_number="DL-A00")
    second = new_driver(owner, licence_number="DL-B00")
    member = invite(owner, "driver")
    link(owner, first["id"], member)
    members = owner.client.get(f"{API}/organisation/members").json()
    user_id = next(item["user_id"] for item in members if item["email"] == member.email)
    again = owner.client.post(
        f"{API}/drivers/{second['id']}/account", json={"user_id": user_id}, headers=owner.csrf
    )
    assert again.json()["error"]["code"] == "account_already_linked"
    theirs = new_driver(other, licence_number="DL-C00")
    foreign = other.client.post(
        f"{API}/drivers/{theirs['id']}/account", json={"user_id": user_id}, headers=other.csrf
    )
    assert foreign.json()["error"]["code"] == "member_not_found"
    cleared = owner.client.post(
        f"{API}/drivers/{first['id']}/account", json={"user_id": None}, headers=owner.csrf
    )
    assert cleared.json()["user_id"] is None


# Listing


def test_search_filters_and_paging(new_owner: Callable[[], Member]) -> None:
    owner = new_owner()
    first = ready(owner, "1")
    create(owner, destination_name="Kisumu_100%")
    advance(owner, first, "plan")
    assert owner.client.get(URL).json()["total"] == 2
    assert owner.client.get(URL, params={"status": "planned"}).json()["total"] == 1
    both = owner.client.get(URL, params=[("status", "planned"), ("status", "draft")]).json()
    assert both["total"] == 2
    assert owner.client.get(URL, params={"search": "kca"}).json()["total"] == 1
    assert owner.client.get(URL, params={"search": "tunde"}).json()["total"] == 1
    assert owner.client.get(URL, params={"search": "kisumu"}).json()["total"] == 1
    # LIKE wildcards in a search are treated as ordinary characters.
    assert owner.client.get(URL, params={"search": "%"}).json()["total"] == 1
    assert owner.client.get(URL, params={"vehicle_id": first["vehicle_id"]}).json()["total"] == 1
    page = owner.client.get(URL, params={"page_size": 1, "page": 2}).json()
    assert len(page["items"]) == 1
    assert page["total"] == 2


def test_notes_are_not_copied_into_the_audit_log(new_owner: Callable[[], Member]) -> None:
    owner = new_owner()
    trip = ready(owner)
    owner.client.patch(
        f"{URL}/{trip['id']}", json={"dispatch_notes": "secret gate code"}, headers=owner.csrf
    )
    assert "secret" not in str(owner.client.get(f"{URL}/{trip['id']}/events").json())
