from collections.abc import Callable
from datetime import timedelta
from typing import Any

import httpx
import pytest
from sqlalchemy import Engine
from sqlmodel import Session

from app.models.base import utcnow
from app.services import alerts as alert_service
from tests.integration.conftest import API, Member
from tests.integration.test_costs import PDF, driver_for, upload
from tests.integration.test_drivers import created as new_driver
from tests.integration.test_tracking import vehicle
from tests.integration.test_trips import link
from tests.integration.test_trips import ready as ready_trip

pytestmark = pytest.mark.integration

ROOT = f"{API}/compliance"
DOCUMENTS = f"{ROOT}/documents"
TEMPLATES = f"{ROOT}/templates"
INSPECTIONS = f"{ROOT}/inspections"
DEFECTS = f"{ROOT}/defects"
FILES = f"{API}/files"


def day(offset: int = 0) -> str:
    return str(utcnow().date() + timedelta(days=offset))


def document(member: Member, **body: Any) -> dict[str, Any]:
    response = member.client.post(
        DOCUMENTS,
        json={"document_type": "insurance", "title": "Insurance"} | body,
        headers=member.csrf,
    )
    assert response.status_code == 201, response.text
    result: dict[str, Any] = response.json()
    return result


def template(member: Member, name: str = "Pre-trip") -> dict[str, Any]:
    response = member.client.post(
        TEMPLATES,
        json={
            "name": name,
            "items": [{"label": "Brakes", "critical": True}, {"label": "Wipers"}],
        },
        headers=member.csrf,
    )
    assert response.status_code == 201, response.text
    result: dict[str, Any] = response.json()
    return result


def inspect(member: Member, car: str, sheet: dict[str, Any], **results: str) -> Any:
    """Each item passes unless named: Brakes="fail"."""
    answers = [
        {"item_id": item["id"], "result": results.get(item["label"], "pass")}
        for item in sheet["items"]
    ]
    return member.client.post(
        INSPECTIONS,
        json={"vehicle_id": car, "template_id": sheet["id"], "answers": answers},
        headers=member.csrf,
    )


def defect(member: Member, car: str, **body: Any) -> dict[str, Any]:
    response = member.client.post(
        DEFECTS,
        json={"vehicle_id": car, "title": "Cracked mirror", "severity": "minor"} | body,
        headers=member.csrf,
    )
    assert response.status_code == 201, response.text
    result: dict[str, Any] = response.json()
    return result


def upload_document(member: Member) -> Any:
    return upload(member, PDF, "policy.pdf", purpose="document")


def alerts(member: Member, alert_type: str) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = member.client.get(
        f"{API}/alerts", params={"alert_type": alert_type}
    ).json()["items"]
    return result


def run_sweep(app_engine: Engine) -> None:
    with Session(app_engine) as db:
        alert_service.sweep(db)


@pytest.fixture
def owner(new_owner: Callable[[], Member]) -> Member:
    return new_owner()


@pytest.fixture
def car(owner: Member) -> str:
    return vehicle(owner)


# Documents


@pytest.mark.parametrize(
    ("offset", "state"),
    [(-1, "expired"), (0, "expiring"), (30, "expiring"), (31, "valid")],
)
def test_expiry_state(owner: Member, car: str, offset: int, state: str) -> None:
    assert document(owner, vehicle_id=car, expires_on=day(offset))["state"] == state


def test_a_document_with_no_expiry_is_not_treated_as_valid_or_expired(
    owner: Member, car: str
) -> None:
    assert document(owner, vehicle_id=car)["state"] == "no_expiry"


def test_a_document_belongs_to_exactly_one_owner(owner: Member, car: str) -> None:
    driver = new_driver(owner)
    payload = {"document_type": "insurance", "title": "x"}
    assert owner.client.post(DOCUMENTS, json=payload, headers=owner.csrf).status_code == 422
    both = payload | {"vehicle_id": car, "driver_id": driver["id"]}
    assert owner.client.post(DOCUMENTS, json=both, headers=owner.csrf).status_code == 422


def test_expiry_must_follow_issue(owner: Member, car: str) -> None:
    response = owner.client.post(
        DOCUMENTS,
        json={
            "vehicle_id": car,
            "document_type": "insurance",
            "title": "x",
            "issued_on": day(5),
            "expires_on": day(1),
        },
        headers=owner.csrf,
    )
    assert response.json()["error"]["code"] == "expiry_before_issue"


def test_a_stored_document_reaches_only_those_allowed(
    owner: Member, car: str, invite: Callable[..., Member]
) -> None:
    stored = upload_document(owner).json()
    item = document(owner, vehicle_id=car, file_id=stored["id"])
    assert item["file"]["filename"] == "policy.pdf"
    link = owner.client.get(f"{FILES}/{stored['id']}/link").json()
    download = httpx.get(link["url"])
    assert download.status_code == 200
    assert download.content == PDF
    assert download.headers["content-disposition"].startswith("attachment")
    assert invite(owner, "read_only").client.get(f"{FILES}/{stored['id']}/link").status_code == 200
    assert invite(owner, "driver").client.get(f"{FILES}/{stored['id']}/link").status_code == 404


def test_driver_documents_are_sensitive(
    owner: Member, car: str, invite: Callable[..., Member]
) -> None:
    driver = new_driver(owner)
    stored = upload_document(owner).json()
    item = document(
        owner,
        driver_id=driver["id"],
        document_type="medical",
        title="Medical",
        file_id=stored["id"],
    )
    document(owner, vehicle_id=car, title="Vehicle one")
    url = f"{DOCUMENTS}/{item['id']}"

    viewer = invite(owner, "read_only")
    assert [row["title"] for row in viewer.client.get(DOCUMENTS).json()] == ["Vehicle one"]
    assert viewer.client.get(url).status_code == 404
    assert viewer.client.get(f"{FILES}/{stored['id']}/link").status_code == 404

    dispatcher = invite(owner, "dispatcher")
    assert dispatcher.client.get(url).status_code == 200
    assert dispatcher.client.get(f"{FILES}/{stored['id']}/link").status_code == 200

    # Managing vehicle paperwork doesn't include a person's medical record.
    manager = invite(owner, "maintenance_manager")
    assert manager.client.get(url).status_code == 404
    refused = manager.client.post(
        DOCUMENTS,
        json={"driver_id": driver["id"], "document_type": "licence", "title": "x"},
        headers=manager.csrf,
    )
    assert refused.status_code == 403


def test_a_driver_sees_their_own_documents_only(
    owner: Member, invite: Callable[..., Member]
) -> None:
    mine_driver = new_driver(owner, licence_number="DL-MINE")
    other_driver = new_driver(owner, licence_number="DL-OTHER")
    member = invite(owner, "driver")
    assert member.client.get(f"{ROOT}/my-documents").json() == []
    link(owner, mine_driver["id"], member)
    mine_file = upload_document(owner).json()
    other_file = upload_document(owner).json()
    document(
        owner,
        driver_id=mine_driver["id"],
        document_type="licence",
        title="Mine",
        file_id=mine_file["id"],
    )
    document(
        owner,
        driver_id=other_driver["id"],
        document_type="licence",
        title="Other",
        file_id=other_file["id"],
    )
    assert [row["title"] for row in member.client.get(f"{ROOT}/my-documents").json()] == ["Mine"]
    assert member.client.get(f"{FILES}/{mine_file['id']}/link").status_code == 200
    assert member.client.get(f"{FILES}/{other_file['id']}/link").status_code == 404
    assert member.client.get(DOCUMENTS).status_code == 403


def test_archiving_and_filters(owner: Member, car: str) -> None:
    item = document(owner, vehicle_id=car, expires_on=day(-1))
    document(owner, vehicle_id=car, title="Later", expires_on=day(100))
    assert len(owner.client.get(DOCUMENTS, params={"state": "expired"}).json()) == 1
    assert len(owner.client.get(DOCUMENTS, params={"vehicle_id": car}).json()) == 2
    owner.client.post(f"{DOCUMENTS}/{item['id']}/archive", headers=owner.csrf)
    assert len(owner.client.get(DOCUMENTS).json()) == 1
    assert len(owner.client.get(DOCUMENTS, params={"archived": True}).json()) == 1
    changed = owner.client.patch(
        f"{DOCUMENTS}/{item['id']}", json={"title": "x"}, headers=owner.csrf
    )
    assert changed.json()["error"]["code"] == "document_archived"


# Reminders


def test_reminders_escalate_and_end_on_renewal(owner: Member, car: str, app_engine: Engine) -> None:
    item = document(owner, vehicle_id=car, expires_on=day(10))
    run_sweep(app_engine)
    run_sweep(app_engine)
    first = alerts(owner, "document_expiry")
    assert [row["severity"] for row in first] == ["warning"]
    assert "expires soon" in first[0]["title"]
    url = f"{DOCUMENTS}/{item['id']}"
    owner.client.patch(url, json={"expires_on": day(-1)}, headers=owner.csrf)
    run_sweep(app_engine)
    assert [row["severity"] for row in alerts(owner, "document_expiry")] == ["critical"]
    owner.client.patch(url, json={"expires_on": day(400)}, headers=owner.csrf)
    run_sweep(app_engine)
    assert alerts(owner, "document_expiry") == []


def test_archived_documents_stop_reminding(owner: Member, car: str, app_engine: Engine) -> None:
    item = document(owner, vehicle_id=car, expires_on=day(-1))
    run_sweep(app_engine)
    assert len(alerts(owner, "document_expiry")) == 1
    owner.client.post(f"{DOCUMENTS}/{item['id']}/archive", headers=owner.csrf)
    run_sweep(app_engine)
    assert alerts(owner, "document_expiry") == []


def test_document_reminders_can_be_turned_off(owner: Member, car: str, app_engine: Engine) -> None:
    document(owner, vehicle_id=car, expires_on=day(-1))
    run_sweep(app_engine)
    owner.client.patch(
        f"{API}/alerts/settings", json={"document_alerts_enabled": False}, headers=owner.csrf
    )
    run_sweep(app_engine)
    assert alerts(owner, "document_expiry") == []


# Inspections


def test_passing_inspection_creates_no_defects(owner: Member, car: str) -> None:
    response = inspect(owner, car, template(owner))
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["outcome"] == "passed"
    assert [row["label"] for row in body["results"]] == ["Brakes", "Wipers"]
    assert body["performed_by_name"]
    assert owner.client.get(DEFECTS).json()["total"] == 0


def test_not_applicable_isnt_a_failure(owner: Member, car: str) -> None:
    assert (
        inspect(owner, car, template(owner), Wipers="not_applicable").json()["outcome"] == "passed"
    )


def test_a_failed_item_creates_a_defect_of_matching_severity(owner: Member, car: str) -> None:
    sheet = template(owner)
    assert inspect(owner, car, sheet, Wipers="fail").json()["outcome"] == "failed"
    assert owner.client.get(DEFECTS).json()["items"][0]["severity"] == "minor"
    assert alerts(owner, "defect_reported") == []
    inspect(owner, car, sheet, Brakes="fail")
    severities = {
        row["title"]: row["severity"] for row in owner.client.get(DEFECTS).json()["items"]
    }
    assert severities["Brakes"] == "critical"
    assert [row["severity"] for row in alerts(owner, "defect_reported")] == ["critical"]


def test_every_item_must_be_answered(owner: Member, car: str) -> None:
    sheet = template(owner)
    answers = [{"item_id": sheet["items"][0]["id"], "result": "pass"}]
    payload = {"vehicle_id": car, "template_id": sheet["id"], "answers": answers}
    response = owner.client.post(INSPECTIONS, json=payload, headers=owner.csrf)
    assert response.json()["error"]["code"] == "incomplete_inspection"
    assert owner.client.get(INSPECTIONS).json()["total"] == 0


def test_editing_a_template_doesnt_rewrite_past_inspections(owner: Member, car: str) -> None:
    sheet = template(owner)
    done = inspect(owner, car, sheet).json()
    owner.client.patch(
        f"{TEMPLATES}/{sheet['id']}",
        json={"name": "Renamed", "items": [{"label": "Lights"}]},
        headers=owner.csrf,
    )
    after = owner.client.get(f"{INSPECTIONS}/{done['id']}").json()
    assert after["template_name"] == "Pre-trip"
    assert [row["label"] for row in after["results"]] == ["Brakes", "Wipers"]


def test_template_rules(owner: Member, car: str) -> None:
    sheet = template(owner)
    assert (
        owner.client.post(
            TEMPLATES, json={"name": "Pre-trip", "items": [{"label": "x"}]}, headers=owner.csrf
        ).json()["error"]["code"]
        == "duplicate_name"
    )
    assert (
        owner.client.post(
            TEMPLATES, json={"name": "Empty", "items": []}, headers=owner.csrf
        ).status_code
        == 422
    )
    duplicate_items = {"name": "Dupes", "items": [{"label": "Oil"}, {"label": "OIL"}]}
    assert (
        owner.client.post(TEMPLATES, json=duplicate_items, headers=owner.csrf).json()["error"][
            "code"
        ]
        == "duplicate_item"
    )
    owner.client.post(f"{TEMPLATES}/{sheet['id']}/archive", headers=owner.csrf)
    assert inspect(owner, car, sheet).json()["error"]["code"] == "template_archived"
    template(owner)


def test_an_inspection_reading_updates_the_odometer(owner: Member, car: str) -> None:
    sheet = template(owner)
    answers = [{"item_id": item["id"], "result": "pass"} for item in sheet["items"]]
    owner.client.post(
        INSPECTIONS,
        json={
            "vehicle_id": car,
            "template_id": sheet["id"],
            "answers": answers,
            "odometer_km": "900",
        },
        headers=owner.csrf,
    )
    assert float(owner.client.get(f"{API}/vehicles/{car}").json()["odometer_km"]) == 900


# Defects


def test_a_critical_defect_blocks_dispatch_and_departure_until_fixed(owner: Member) -> None:
    trip = ready_trip(owner)
    car = trip["vehicle_id"]
    url = f"{API}/trips/{trip['id']}"
    owner.client.post(f"{url}/plan", json={}, headers=owner.csrf)
    item = defect(owner, car, severity="critical", title="No brakes")
    assert (
        owner.client.post(f"{url}/dispatch", json={}, headers=owner.csrf).json()["error"]["code"]
        == "vehicle_defect"
    )
    assert (
        owner.client.post(
            f"{DEFECTS}/{item['id']}/resolve", json={}, headers=owner.csrf
        ).status_code
        == 200
    )
    assert owner.client.post(f"{url}/dispatch", json={}, headers=owner.csrf).status_code == 200
    # Found after dispatch: it still can't leave.
    second = defect(owner, car, severity="critical", title="Tyre blown")
    assert (
        owner.client.post(f"{url}/start", json={}, headers=owner.csrf).json()["error"]["code"]
        == "vehicle_defect"
    )
    owner.client.post(f"{DEFECTS}/{second['id']}/resolve", json={}, headers=owner.csrf)
    assert owner.client.post(f"{url}/start", json={}, headers=owner.csrf).status_code == 200


def test_lesser_defects_dont_block_dispatch(owner: Member) -> None:
    trip = ready_trip(owner)
    defect(owner, trip["vehicle_id"], severity="major")
    url = f"{API}/trips/{trip['id']}"
    owner.client.post(f"{url}/plan", json={}, headers=owner.csrf)
    assert owner.client.post(f"{url}/dispatch", json={}, headers=owner.csrf).status_code == 200


def test_resolving_closes_its_alert(owner: Member, car: str) -> None:
    item = defect(owner, car, severity="major")
    assert [row["severity"] for row in alerts(owner, "defect_reported")] == ["warning"]
    done = owner.client.post(
        f"{DEFECTS}/{item['id']}/resolve", json={"note": "Replaced"}, headers=owner.csrf
    ).json()
    assert done["status"] == "resolved"
    assert done["resolution_note"] == "Replaced"
    assert alerts(owner, "defect_reported") == []
    again = owner.client.post(f"{DEFECTS}/{item['id']}/resolve", json={}, headers=owner.csrf)
    assert again.json()["error"]["code"] == "already_resolved"


def test_a_work_order_fixes_its_defect(owner: Member, car: str) -> None:
    item = defect(owner, car, severity="critical", title="No brakes")
    created = owner.client.post(f"{DEFECTS}/{item['id']}/work-order", headers=owner.csrf)
    assert created.status_code == 201, created.text
    order = created.json()
    assert order["title"] == "Fix: No brakes"
    assert order["work_type"] == "corrective"
    twice = owner.client.post(f"{DEFECTS}/{item['id']}/work-order", headers=owner.csrf)
    assert twice.json()["error"]["code"] == "work_order_exists"
    url = f"{API}/maintenance/work-orders/{order['id']}"
    owner.client.post(f"{url}/start", json={}, headers=owner.csrf)
    # Unfinished work fixes nothing.
    listed = owner.client.get(DEFECTS, params={"status": "open"}).json()
    assert listed["items"][0]["work_order_id"] == order["id"]
    owner.client.post(f"{url}/complete", json={}, headers=owner.csrf)
    assert owner.client.get(DEFECTS, params={"status": "open"}).json()["total"] == 0
    assert alerts(owner, "defect_reported") == []


def test_a_cancelled_work_order_leaves_the_defect_open(owner: Member, car: str) -> None:
    item = defect(owner, car)
    order = owner.client.post(f"{DEFECTS}/{item['id']}/work-order", headers=owner.csrf).json()
    owner.client.post(f"{API}/maintenance/work-orders/{order['id']}/cancel", headers=owner.csrf)
    after = owner.client.get(DEFECTS).json()["items"][0]
    assert after["status"] == "open"
    assert after["work_order_id"] is None
    assert (
        owner.client.post(f"{DEFECTS}/{item['id']}/work-order", headers=owner.csrf).status_code
        == 201
    )


def test_summary(owner: Member, car: str) -> None:
    document(owner, vehicle_id=car, expires_on=day(-1))
    document(owner, vehicle_id=car, title="Soon", expires_on=day(5))
    document(owner, vehicle_id=car, title="Later", expires_on=day(90))
    document(owner, vehicle_id=car, title="Forever")
    inspect(owner, car, template(owner), Brakes="fail")
    defect(owner, car)
    result = owner.client.get(f"{ROOT}/summary").json()
    assert result == {
        "expired_documents": 1,
        "expiring_documents": 1,
        "open_defects": 2,
        "critical_defects": 1,
        "failed_inspections_30_days": 1,
    }


# Who can see and do what


def test_nothing_crosses_organisations(
    owner: Member, car: str, new_owner: Callable[[], Member]
) -> None:
    item = document(owner, vehicle_id=car)
    sheet = template(owner)
    done = inspect(owner, car, sheet).json()
    fault = defect(owner, car)
    stored = upload_document(owner).json()
    other = new_owner()
    their_car = vehicle(other)
    assert other.client.get(DOCUMENTS).json() == []
    assert other.client.get(f"{DOCUMENTS}/{item['id']}").status_code == 404
    assert other.client.get(TEMPLATES).json() == []
    assert other.client.get(f"{INSPECTIONS}/{done['id']}").status_code == 404
    assert (
        other.client.post(
            f"{DEFECTS}/{fault['id']}/resolve", json={}, headers=other.csrf
        ).status_code
        == 404
    )
    assert other.client.get(f"{FILES}/{stored['id']}/link").status_code == 404
    assert inspect(other, their_car, sheet).status_code == 404
    response = other.client.post(
        DOCUMENTS,
        json={
            "vehicle_id": their_car,
            "document_type": "insurance",
            "title": "x",
            "file_id": stored["id"],
        },
        headers=other.csrf,
    )
    assert response.json()["error"]["code"] == "file_not_found"
    foreign = other.client.post(
        DEFECTS,
        json={"vehicle_id": car, "title": "x", "severity": "minor"},
        headers=other.csrf,
    )
    assert foreign.json()["error"]["code"] == "vehicle_not_found"


@pytest.mark.parametrize(
    ("role", "view", "inspect_status", "manage"),
    [
        ("maintenance_manager", 200, 201, 201),
        ("fleet_manager", 200, 201, 201),
        ("dispatcher", 200, 201, 403),
        ("finance_manager", 200, 403, 403),
        ("read_only", 200, 403, 403),
    ],
)
def test_roles(
    owner: Member,
    car: str,
    invite: Callable[..., Member],
    role: str,
    view: int,
    inspect_status: int,
    manage: int,
) -> None:
    sheet = template(owner)
    member = invite(owner, role)
    assert member.client.get(DOCUMENTS).status_code == view
    assert member.client.get(f"{ROOT}/summary").status_code == view
    assert inspect(member, car, sheet).status_code == inspect_status
    payload = {"vehicle_id": car, "document_type": "insurance", "title": "x"}
    assert member.client.post(DOCUMENTS, json=payload, headers=member.csrf).status_code == manage
    assert upload_document(member).status_code == manage


def test_a_driver_inspects_and_reports_only_on_their_own_vehicle(
    owner: Member, car: str, invite: Callable[..., Member]
) -> None:
    sheet = template(owner)
    driver, assigned = driver_for(owner, invite, "KDB 456B")
    other_inspection = inspect(owner, car, sheet).json()
    other_defect = defect(owner, car)

    assert inspect(driver, car, sheet).json()["error"]["code"] == "vehicle_not_found"
    mine = inspect(driver, assigned, sheet, Wipers="fail")
    assert mine.status_code == 201, mine.text
    assert [row["id"] for row in driver.client.get(INSPECTIONS).json()["items"]] == [
        mine.json()["id"]
    ]
    assert driver.client.get(f"{INSPECTIONS}/{other_inspection['id']}").status_code == 404

    reported = defect(driver, assigned, title="Horn broken")
    titles = {row["title"] for row in driver.client.get(DEFECTS).json()["items"]}
    assert titles == {"Wipers", "Horn broken"}
    assert (
        driver.client.post(
            f"{DEFECTS}/{reported['id']}/resolve", json={}, headers=driver.csrf
        ).status_code
        == 403
    )
    assert (
        driver.client.post(
            f"{DEFECTS}/{other_defect['id']}/work-order", headers=driver.csrf
        ).status_code
        == 403
    )
    assert driver.client.get(f"{ROOT}/summary").status_code == 403
    photo = upload(driver, PDF, "photo.pdf", purpose="inspection")
    assert photo.status_code == 201
    assert upload_document(driver).status_code == 403


def test_receipts_still_follow_their_own_rules(
    owner: Member, invite: Callable[..., Member]
) -> None:
    stored = upload(owner).json()
    assert invite(owner, "read_only").client.get(f"{FILES}/{stored['id']}/link").status_code == 200
    assert invite(owner, "driver").client.get(f"{FILES}/{stored['id']}/link").status_code == 404


def test_a_file_can_only_belong_to_one_document(
    owner: Member, car: str, invite: Callable[..., Member]
) -> None:
    """Otherwise a driver's private file could be read through a vehicle document."""
    driver = new_driver(owner)
    stored = upload_document(owner).json()
    private = document(
        owner,
        driver_id=driver["id"],
        document_type="medical",
        title="Medical",
        file_id=stored["id"],
    )
    manager = invite(owner, "maintenance_manager")
    response = manager.client.post(
        DOCUMENTS,
        json={"vehicle_id": car, "document_type": "other", "title": "x", "file_id": stored["id"]},
        headers=manager.csrf,
    )
    assert response.json()["error"]["code"] == "file_not_found"
    theirs = document(manager, vehicle_id=car, title="Mine")
    moved = manager.client.patch(
        f"{DOCUMENTS}/{theirs['id']}", json={"file_id": stored["id"]}, headers=manager.csrf
    )
    assert moved.json()["error"]["code"] == "file_not_found"
    assert manager.client.get(f"{FILES}/{stored['id']}/link").status_code == 404
    # Saving a document with the file it already has is fine.
    kept = owner.client.patch(
        f"{DOCUMENTS}/{private['id']}", json={"file_id": stored["id"]}, headers=owner.csrf
    )
    assert kept.status_code == 200
