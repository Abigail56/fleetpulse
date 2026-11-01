from collections.abc import Callable
from datetime import timedelta
from typing import Any

import httpx
import pytest

from app.models.base import utcnow
from tests.integration.conftest import API, Member
from tests.integration.test_drivers import created as new_driver
from tests.integration.test_drivers import vehicle as new_vehicle
from tests.integration.test_tracking import vehicle
from tests.integration.test_trips import link

pytestmark = pytest.mark.integration

ROOT = f"{API}/costs"
FUEL = f"{ROOT}/fuel"
EXPENSES = f"{ROOT}/expenses"
FILES = f"{API}/files"
PDF = b"%PDF-1.7 a receipt"
PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 20


def day(offset: int = 0) -> str:
    return str(utcnow().date() + timedelta(days=offset))


def moment(days_ago: float = 0) -> str:
    return (utcnow() - timedelta(days=days_ago)).isoformat()


def fuel(member: Member, car: str, **extra: Any) -> dict[str, Any]:
    response = member.client.post(
        FUEL,
        json={
            "vehicle_id": car,
            "filled_at": moment(),
            "quantity": "40",
            "unit_price": "200",
            "currency": "KES",
        }
        | extra,
        headers=member.csrf,
    )
    assert response.status_code == 201, response.text
    result: dict[str, Any] = response.json()
    return result


def expense(member: Member, car: str, **extra: Any) -> dict[str, Any]:
    response = member.client.post(
        EXPENSES,
        json={
            "vehicle_id": car,
            "category": "tolls",
            "amount": "500",
            "currency": "KES",
            "incurred_on": day(),
        }
        | extra,
        headers=member.csrf,
    )
    assert response.status_code == 201, response.text
    result: dict[str, Any] = response.json()
    return result


def upload(member: Member, data: bytes = PDF, name: str = "receipt.pdf", **form: str) -> Any:
    return member.client.post(
        FILES, files={"file": (name, data, "application/pdf")}, data=form, headers=member.csrf
    )


def review(member: Member, item: dict[str, Any], action: str, note: str | None = None) -> Any:
    return member.client.post(
        f"{EXPENSES}/{item['id']}/{action}", json={"note": note}, headers=member.csrf
    )


@pytest.fixture
def owner(new_owner: Callable[[], Member]) -> Member:
    return new_owner()


@pytest.fixture
def car(owner: Member) -> str:
    return vehicle(owner)


def driver_for(
    owner: Member, invite: Callable[..., Member], registration: str
) -> tuple[Member, str]:
    """A driver-role member, assigned to a vehicle through their driver record."""
    member = invite(owner, "driver")
    record = new_driver(owner, licence_number=f"DL-{registration}")
    link(owner, record["id"], member)
    assigned = new_vehicle(owner, registration)
    response = owner.client.post(
        f"{API}/drivers/{record['id']}/assign",
        json={"vehicle_id": assigned["id"]},
        headers=owner.csrf,
    )
    assert response.status_code in (200, 201), response.text
    return member, assigned["id"]


# Fuel


def test_the_total_is_worked_out_by_the_server(owner: Member, car: str) -> None:
    entry = fuel(owner, car, quantity="33.333", unit_price="201.5")
    assert float(entry["total_cost"]) == 6716.60  # 33.333 x 201.5, rounded to cents
    assert entry["vehicle_registration"] == "KCA 123A"
    response = owner.client.post(
        FUEL,
        json={
            "vehicle_id": car,
            "filled_at": moment(),
            "quantity": "1",
            "unit_price": "1",
            "currency": "KES",
            "total_cost": "1",
        },
        headers=owner.csrf,
    )
    assert response.status_code == 422


def test_any_currency_is_kept_as_entered(owner: Member, car: str) -> None:
    assert fuel(owner, car, currency="NGN")["currency"] == "NGN"
    assert fuel(owner, car, currency="USD")["currency"] == "USD"


def test_electric_charging_is_recorded_in_kwh(owner: Member, car: str) -> None:
    assert fuel(owner, car, unit="kwh")["unit"] == "kwh"


@pytest.mark.parametrize(
    "extra",
    [
        {"quantity": "0"},
        {"quantity": "-1"},
        {"unit_price": "-1"},
        {"currency": "kes"},
        {"currency": "KENYA"},
        {"filled_at": "2030-01-01T10:00:00"},
        {"odometer_km": "-1"},
        {"unit": "gallons"},
    ],
)
def test_bad_fuel_records_are_rejected(owner: Member, car: str, extra: dict[str, Any]) -> None:
    payload = {
        "vehicle_id": car,
        "filled_at": moment(),
        "quantity": "40",
        "unit_price": "200",
        "currency": "KES",
    } | extra
    assert owner.client.post(FUEL, json=payload, headers=owner.csrf).status_code == 422


def test_a_fill_up_in_the_future_is_refused(owner: Member, car: str) -> None:
    response = owner.client.post(
        FUEL,
        json={
            "vehicle_id": car,
            "filled_at": moment(-2),
            "quantity": "1",
            "unit_price": "1",
            "currency": "KES",
        },
        headers=owner.csrf,
    )
    assert response.json()["error"]["code"] == "date_in_future"


def test_a_newer_reading_updates_the_vehicle_but_an_older_one_doesnt(
    owner: Member, car: str
) -> None:
    fuel(owner, car, odometer_km="5000")
    assert float(owner.client.get(f"{API}/vehicles/{car}").json()["odometer_km"]) == 5000
    fuel(owner, car, odometer_km="4000", filled_at=moment(10))
    assert float(owner.client.get(f"{API}/vehicles/{car}").json()["odometer_km"]) == 5000


def test_editing_recalculates_and_voiding_keeps_the_record(owner: Member, car: str) -> None:
    entry = fuel(owner, car)
    url = f"{FUEL}/{entry['id']}"
    changed = owner.client.patch(url, json={"quantity": "10"}, headers=owner.csrf).json()
    assert float(changed["total_cost"]) == 2000
    owner.client.post(f"{url}/void", headers=owner.csrf)
    assert owner.client.get(FUEL).json()["total"] == 0
    assert owner.client.get(FUEL, params={"voided": True}).json()["total"] == 1
    refused = owner.client.patch(url, json={"quantity": "1"}, headers=owner.csrf)
    assert refused.json()["error"]["code"] == "record_voided"


# Expenses and approval


def test_approval_needs_someone_else(
    owner: Member, car: str, invite: Callable[..., Member]
) -> None:
    finance = invite(owner, "finance_manager")
    theirs = expense(finance, car)
    assert theirs["status"] == "submitted"
    refused = review(finance, theirs, "approve")
    assert refused.json()["error"]["code"] == "own_expense"
    approved = review(owner, theirs, "approve")
    assert approved.json()["status"] == "approved"
    assert approved.json()["reviewed_at"] is not None


def test_an_owner_can_approve_their_own(owner: Member, car: str) -> None:
    assert review(owner, expense(owner, car), "approve").json()["status"] == "approved"


def test_a_rejection_needs_a_reason_and_editing_resubmits(owner: Member, car: str) -> None:
    item = expense(owner, car)
    assert review(owner, item, "reject").json()["error"]["code"] == "note_required"
    rejected = review(owner, item, "reject", "No receipt").json()
    assert rejected["status"] == "rejected"
    assert rejected["review_note"] == "No receipt"
    resubmitted = owner.client.patch(
        f"{EXPENSES}/{item['id']}", json={"amount": "450"}, headers=owner.csrf
    ).json()
    assert resubmitted["status"] == "submitted"
    assert resubmitted["review_note"] is None


def test_approved_expenses_are_locked_and_reviews_happen_once(owner: Member, car: str) -> None:
    item = expense(owner, car)
    review(owner, item, "approve")
    assert review(owner, item, "reject", "x").json()["error"]["code"] == "already_reviewed"
    changed = owner.client.patch(
        f"{EXPENSES}/{item['id']}", json={"amount": "1"}, headers=owner.csrf
    )
    assert changed.json()["error"]["code"] == "expense_approved"
    voided = owner.client.post(f"{EXPENSES}/{item['id']}/void", headers=owner.csrf)
    assert voided.json()["voided_at"] is not None


def test_expense_filters(owner: Member, car: str) -> None:
    item = expense(owner, car, category="parking")
    expense(owner, car, category="tyres")
    review(owner, item, "approve")
    assert owner.client.get(EXPENSES, params={"status": "approved"}).json()["total"] == 1
    assert owner.client.get(EXPENSES, params={"category": "tyres"}).json()["total"] == 1
    assert owner.client.get(EXPENSES, params={"vehicle_id": car}).json()["total"] == 2


@pytest.mark.parametrize(
    "extra", [{"amount": "0"}, {"amount": "-5"}, {"category": "bribes"}, {"currency": "x"}]
)
def test_bad_expenses_are_rejected(owner: Member, car: str, extra: dict[str, Any]) -> None:
    payload = {
        "vehicle_id": car,
        "category": "tolls",
        "amount": "5",
        "currency": "KES",
        "incurred_on": day(),
    } | extra
    assert owner.client.post(EXPENSES, json=payload, headers=owner.csrf).status_code == 422


# Totals and cost per kilometre


def test_summary_counts_only_real_costs_and_never_mixes_currencies(owner: Member, car: str) -> None:
    fuel(owner, car)  # 8000 KES
    fuel(owner, car, currency="USD", quantity="10", unit_price="1")  # 10 USD
    voided = fuel(owner, car)
    owner.client.post(f"{FUEL}/{voided['id']}/void", headers=owner.csrf)
    review(owner, expense(owner, car, category="parking"), "approve")  # 500 KES
    expense(owner, car, amount="999")  # awaiting review, so not a cost yet
    rejected = expense(owner, car, amount="888")
    review(owner, rejected, "reject", "No")
    fuel(owner, car, filled_at=moment(60))  # outside the default 30 days

    result = owner.client.get(f"{ROOT}/summary").json()
    lines = {line["currency"]: line for line in result["totals"]}
    assert float(lines["KES"]["fuel"]) == 8000
    assert float(lines["KES"]["expenses"]) == 500
    assert float(lines["KES"]["total"]) == 8500
    assert float(lines["USD"]["total"]) == 10
    assert result["awaiting_approval"] == 1
    assert [row["category"] for row in result["expense_categories"]] == ["parking"]


def test_maintenance_costs_are_included(owner: Member, car: str) -> None:
    work = owner.client.post(
        f"{API}/maintenance/work-orders",
        json={"vehicle_id": car, "work_type": "corrective", "title": "Brakes"},
        headers=owner.csrf,
    ).json()
    url = f"{API}/maintenance/work-orders/{work['id']}"
    owner.client.post(f"{url}/start", json={}, headers=owner.csrf)
    owner.client.post(f"{url}/complete", json={"parts_cost": "750"}, headers=owner.csrf)
    lines = owner.client.get(f"{ROOT}/summary").json()["totals"]
    assert float(lines[0]["maintenance"]) == 750


def test_cost_per_km_needs_two_readings(owner: Member, car: str) -> None:
    url = f"{ROOT}/vehicles/{car}"
    assert owner.client.get(url).json()["distance_km"] is None
    fuel(owner, car, odometer_km="1000", filled_at=moment(5))
    one = owner.client.get(url).json()
    assert one["distance_km"] is None
    assert one["costs"][0]["cost_per_km"] is None
    assert float(one["costs"][0]["total"]) == 8000

    fuel(owner, car, odometer_km="1500", filled_at=moment(1))
    two = owner.client.get(url).json()
    assert float(two["distance_km"]) == 500
    assert float(two["costs"][0]["cost_per_km"]) == 32  # 16000 over 500 km


def test_consumption_runs_only_between_full_tanks(owner: Member, car: str) -> None:
    url = f"{ROOT}/vehicles/{car}"
    fuel(owner, car, odometer_km="1000", is_full_tank=True, filled_at=moment(5), quantity="50")
    assert owner.client.get(url).json()["consumption"] == []
    fuel(owner, car, odometer_km="1200", is_full_tank=False, filled_at=moment(4), quantity="20")
    assert owner.client.get(url).json()["consumption"] == []
    fuel(owner, car, odometer_km="1500", is_full_tank=True, filled_at=moment(3), quantity="30")
    # 50 litres used over 500 km. The first fill's 50 litres came before the distance.
    result = owner.client.get(url).json()["consumption"]
    assert [(row["unit"], float(row["per_100_km"])) for row in result] == [("litres", 10)]


def test_a_full_tank_with_no_reading_breaks_the_chain(owner: Member, car: str) -> None:
    fuel(owner, car, odometer_km="1000", is_full_tank=True, filled_at=moment(5))
    fuel(owner, car, is_full_tank=True, filled_at=moment(4))
    fuel(owner, car, odometer_km="1500", is_full_tank=True, filled_at=moment(3))
    assert owner.client.get(f"{ROOT}/vehicles/{car}").json()["consumption"] == []


def test_a_bad_period_is_refused(owner: Member) -> None:
    response = owner.client.get(f"{ROOT}/summary", params={"start": day(), "end": day(-5)})
    assert response.json()["error"]["code"] == "invalid_period"


# Receipts


def test_a_receipt_uploads_and_downloads_through_a_short_lived_link(
    owner: Member, car: str
) -> None:
    uploaded = upload(owner)
    assert uploaded.status_code == 201, uploaded.text
    stored = uploaded.json()
    assert stored["content_type"] == "application/pdf"
    item = expense(owner, car, receipt_file_id=stored["id"])
    assert item["receipt"]["filename"] == "receipt.pdf"

    link_response = owner.client.get(f"{FILES}/{stored['id']}/link").json()
    assert link_response["expires_in_seconds"] <= 300
    download = httpx.get(link_response["url"])
    assert download.status_code == 200
    assert download.content == PDF
    assert download.headers["content-disposition"].startswith("attachment")
    # Without the signature, the file isn't reachable.
    assert httpx.get(link_response["url"].split("?")[0]).status_code == 403


@pytest.mark.parametrize(
    "data",
    [
        b"<html><script>alert(1)</script></html>",
        b"<svg xmlns='http://www.w3.org/2000/svg'/>",
        b"MZ\x90\x00 an executable",
        b"plain text",
    ],
)
def test_only_real_documents_and_images_are_accepted(owner: Member, data: bytes) -> None:
    # The name and the browser's claim both say PDF: the bytes decide.
    response = upload(owner, data)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "unsupported_file"


def test_files_have_limits(owner: Member) -> None:
    assert upload(owner, b"").json()["error"]["code"] == "empty_file"
    too_big = PDF + b"0" * (10 * 1024 * 1024)
    assert upload(owner, too_big).status_code == 413


def test_a_hostile_filename_is_cleaned(owner: Member) -> None:
    response = upload(owner, PNG, name="../../etc/passwd<x>.png").json()
    assert response["filename"] == "passwdx.png"
    assert response["content_type"] == "image/png"


def test_uploading_needs_csrf_and_a_session(owner: Member) -> None:
    response = owner.client.post(FILES, files={"file": ("a.pdf", PDF, "application/pdf")})
    assert response.status_code in (401, 403)


def test_files_never_cross_organisations(
    owner: Member, car: str, new_owner: Callable[[], Member]
) -> None:
    stored = upload(owner).json()
    other = new_owner()
    assert other.client.get(f"{FILES}/{stored['id']}/link").status_code == 404
    their_car = vehicle(other)
    response = other.client.post(
        EXPENSES,
        json={
            "vehicle_id": their_car,
            "category": "tolls",
            "amount": "5",
            "currency": "KES",
            "incurred_on": day(),
            "receipt_file_id": stored["id"],
        },
        headers=other.csrf,
    )
    assert response.json()["error"]["code"] == "file_not_found"


def test_storage_being_down_is_a_clear_error(owner: Member, app: Any) -> None:
    app.state.settings = app.state.settings.model_copy(update={"storage_bucket": None})
    response = upload(owner)
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "storage_unavailable"


# Who can see and do what


def test_nothing_crosses_organisations(
    owner: Member, car: str, new_owner: Callable[[], Member]
) -> None:
    entry = fuel(owner, car)
    item = expense(owner, car)
    other = new_owner()
    assert other.client.get(FUEL).json()["total"] == 0
    assert other.client.get(EXPENSES).json()["total"] == 0
    assert other.client.get(f"{FUEL}/{entry['id']}").status_code == 404
    assert other.client.get(f"{EXPENSES}/{item['id']}").status_code == 404
    assert review(other, item, "approve").status_code == 404
    assert other.client.get(f"{ROOT}/vehicles/{car}").status_code == 404
    assert other.client.get(f"{ROOT}/summary").json()["totals"] == []
    response = other.client.post(
        FUEL,
        json={
            "vehicle_id": car,
            "filled_at": moment(),
            "quantity": "1",
            "unit_price": "1",
            "currency": "KES",
        },
        headers=other.csrf,
    )
    assert response.json()["error"]["code"] == "vehicle_not_found"


@pytest.mark.parametrize(
    ("role", "submit", "approve", "summary"),
    [
        ("finance_manager", 201, 200, 200),
        ("fleet_manager", 201, 200, 200),
        ("dispatcher", 201, 403, 200),
        ("maintenance_manager", 201, 403, 200),
        ("read_only", 403, 403, 200),
    ],
)
def test_roles(
    owner: Member,
    car: str,
    invite: Callable[..., Member],
    role: str,
    submit: int,
    approve: int,
    summary: int,
) -> None:
    item = expense(owner, car)
    member = invite(owner, role)
    payload = {
        "vehicle_id": car,
        "category": "tolls",
        "amount": "5",
        "currency": "KES",
        "incurred_on": day(),
    }
    assert member.client.post(EXPENSES, json=payload, headers=member.csrf).status_code == submit
    assert review(member, item, "approve").status_code == approve
    assert member.client.get(f"{ROOT}/summary").status_code == summary


def test_a_driver_records_costs_only_for_their_own_vehicle(
    owner: Member, car: str, invite: Callable[..., Member]
) -> None:
    driver, assigned = driver_for(owner, invite, "KDB 456B")
    options = driver.client.get(f"{ROOT}/options").json()
    assert [item["id"] for item in options["vehicles"]] == [assigned]
    payload = {"filled_at": moment(), "quantity": "1", "unit_price": "1", "currency": "KES"}
    mine = driver.client.post(FUEL, json=payload | {"vehicle_id": assigned}, headers=driver.csrf)
    assert mine.status_code == 201
    other = driver.client.post(FUEL, json=payload | {"vehicle_id": car}, headers=driver.csrf)
    assert other.json()["error"]["code"] == "vehicle_not_found"


def test_a_driver_sees_only_their_own_records_and_no_totals(
    owner: Member, car: str, invite: Callable[..., Member]
) -> None:
    driver, assigned = driver_for(owner, invite, "KDB 456B")
    theirs = expense(owner, car)
    their_fuel = fuel(owner, car)
    their_file = upload(owner).json()
    mine = expense(driver, assigned)
    assert [item["id"] for item in driver.client.get(EXPENSES).json()["items"]] == [mine["id"]]
    assert driver.client.get(FUEL).json()["total"] == 0
    assert driver.client.get(f"{EXPENSES}/{theirs['id']}").status_code == 404
    assert driver.client.get(f"{FUEL}/{their_fuel['id']}").status_code == 404
    assert driver.client.get(f"{FILES}/{their_file['id']}/link").status_code == 404
    assert driver.client.get(f"{ROOT}/summary").status_code == 403
    assert driver.client.get(f"{ROOT}/vehicles/{assigned}").status_code == 403
    assert review(driver, mine, "approve").status_code == 403
    # Nor can they attach someone else's file to their own record.
    response = driver.client.patch(
        f"{EXPENSES}/{mine['id']}", json={"receipt_file_id": their_file["id"]}, headers=driver.csrf
    )
    assert response.json()["error"]["code"] == "file_not_found"
    # But they can use their own.
    own_file = upload(driver).json()
    assert driver.client.get(f"{FILES}/{own_file['id']}/link").status_code == 200


def test_a_viewer_cant_edit_other_peoples_records(
    owner: Member, car: str, invite: Callable[..., Member]
) -> None:
    entry = fuel(owner, car)
    item = expense(owner, car)
    dispatcher = invite(owner, "dispatcher")
    assert dispatcher.client.get(f"{FUEL}/{entry['id']}").status_code == 200
    assert (
        dispatcher.client.patch(
            f"{FUEL}/{entry['id']}", json={"quantity": "1"}, headers=dispatcher.csrf
        ).status_code
        == 404
    )
    assert (
        dispatcher.client.patch(
            f"{EXPENSES}/{item['id']}", json={"amount": "1"}, headers=dispatcher.csrf
        ).status_code
        == 404
    )
