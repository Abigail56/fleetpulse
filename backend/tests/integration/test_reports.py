import csv
import io
from collections.abc import Callable
from datetime import timedelta
from typing import Any

import pytest
from sqlmodel import select

from app.models import AuditLog
from app.models.base import utcnow
from tests.integration.conftest import API, Member
from tests.integration.test_compliance import defect, document, inspect, template
from tests.integration.test_costs import expense, fuel, review
from tests.integration.test_drivers import created as new_driver
from tests.integration.test_tracking import vehicle
from tests.integration.test_trips import post, ready

pytestmark = pytest.mark.integration

URL = f"{API}/reports"
KEYS = [
    "utilisation",
    "trips",
    "drivers",
    "fuel",
    "expenses",
    "maintenance",
    "fleet",
    "compliance",
    "alerts",
]


def day(offset: int = 0) -> str:
    return str(utcnow().date() + timedelta(days=offset))


def moment(hours_ago: float) -> str:
    return (utcnow() - timedelta(hours=hours_ago)).isoformat()


def get(member: Member, key: str, **params: Any) -> dict[str, Any]:
    response = member.client.get(f"{URL}/{key}", params=params)
    assert response.status_code == 200, response.text
    result: dict[str, Any] = response.json()
    return result


def tile(report: dict[str, Any], label: str) -> str:
    return str(next(item["value"] for item in report["tiles"] if item["label"] == label))


def finish_trip(member: Member, trip: dict[str, Any], **complete: Any) -> None:
    for step in ("plan", "dispatch"):
        assert post(member, f"/{trip['id']}/{step}").status_code == 200
    post(member, f"/{trip['id']}/start", {"actual_departure_at": moment(5)})
    response = post(member, f"/{trip['id']}/complete", complete)
    assert response.status_code == 200, response.text


def complete_work(member: Member, car: str, **costs: Any) -> None:
    order = member.client.post(
        f"{API}/maintenance/work-orders",
        json={
            "vehicle_id": car,
            "work_type": costs.pop("work_type", "corrective"),
            "title": "Work",
        },
        headers=member.csrf,
    ).json()
    url = f"{API}/maintenance/work-orders/{order['id']}"
    member.client.post(f"{url}/start", json={}, headers=member.csrf)
    member.client.post(f"{url}/complete", json=costs, headers=member.csrf)


@pytest.fixture
def owner(new_owner: Callable[[], Member]) -> Member:
    return new_owner()


@pytest.mark.parametrize("key", KEYS)
def test_an_empty_organisation_gets_an_empty_report_not_invented_figures(
    owner: Member, key: str
) -> None:
    report = get(owner, key)
    assert report["rows"] == []
    assert report["columns"]
    assert report["truncated"] is False


def test_the_catalogue_lists_every_report(owner: Member) -> None:
    assert [item["key"] for item in owner.client.get(URL).json()] == KEYS


def test_unknown_reports_and_bad_periods_are_refused(owner: Member) -> None:
    assert owner.client.get(f"{URL}/payroll").status_code == 404
    response = owner.client.get(f"{URL}/trips", params={"start": day(), "end": day(-3)})
    assert response.json()["error"]["code"] == "invalid_period"


def test_trip_performance_counts_on_time_only_where_it_can_be_measured(owner: Member) -> None:
    late = ready(owner, "1")  # estimated arrival is 9 hours ahead, so it arrives early
    finish_trip(owner, late, distance_km="100")
    report = get(owner, "trips")
    row = report["rows"][0]
    assert row["status"] == "completed"
    assert row["vehicle"] == "KCA 1"
    assert row["distance_source"] == "manual"
    assert float(row["minutes_late"]) == 0
    assert tile(report, "Arrived on time") == "100.0% of 1"


def test_a_late_arrival_says_how_late(owner: Member) -> None:
    trip = ready(owner, "1")
    owner.client.patch(
        f"{API}/trips/{trip['id']}",
        json={"planned_departure_at": moment(4), "estimated_arrival_at": moment(2)},
        headers=owner.csrf,
    )
    finish_trip(owner, trip)
    report = get(owner, "trips")
    assert float(report["rows"][0]["minutes_late"]) >= 119
    assert tile(report, "Arrived on time") == "0.0% of 1"
    # Its distance is unknown, and the report says so rather than treating it as zero.
    assert report["rows"][0]["distance"] is None
    assert any("no recorded distance" in note for note in report["notes"])


def test_no_estimates_means_no_on_time_figure(owner: Member) -> None:
    assert tile(get(owner, "trips"), "Arrived on time") == "No trips to measure"


def test_utilisation(owner: Member) -> None:
    trip = ready(owner, "1")
    vehicle(owner, "UNUSED")
    finish_trip(owner, trip, distance_km="50")
    report = get(owner, "utilisation", start=day(-9), end=day())
    rows = {row["vehicle"]: row for row in report["rows"]}
    assert rows["KCA 1"]["trips"] == 1
    assert rows["KCA 1"]["days_used"] == 1
    assert float(rows["KCA 1"]["utilisation"]) == 10
    assert float(rows["KCA 1"]["hours"]) >= 4.9
    assert rows["UNUSED"]["trips"] == 0
    assert tile(report, "Vehicles used") == "1 of 2"


def test_driver_activity_doesnt_rank_people_on_it_alone(owner: Member) -> None:
    trip = ready(owner, "1")
    new_driver(owner, licence_number="DL-IDLE", first_name="Idle")
    finish_trip(owner, trip, distance_km="50")
    report = get(owner, "drivers")
    rows = {row["driver"]: row for row in report["rows"]}
    assert rows["Tunde Adeyemi"]["trips"] == 1
    assert rows["Idle Adeyemi"]["trips"] == 0
    assert rows["Idle Adeyemi"]["on_time"] is None
    assert any("isn't a measure of a person's performance" in note for note in report["notes"])


def test_fuel_groups_by_unit_and_currency_and_measures_consumption(owner: Member) -> None:
    car = vehicle(owner)
    fuel(owner, car, odometer_km="1000", is_full_tank=True, filled_at=moment(50), quantity="40")
    fuel(owner, car, odometer_km="1500", is_full_tank=True, filled_at=moment(40), quantity="50")
    fuel(owner, car, currency="USD", quantity="10", unit_price="1", filled_at=moment(30))
    voided = fuel(owner, car, quantity="999")
    owner.client.post(f"{API}/costs/fuel/{voided['id']}/void", headers=owner.csrf)
    rows = {row["currency"]: row for row in get(owner, "fuel")["rows"]}
    assert float(rows["KES"]["quantity"]) == 90
    assert float(rows["KES"]["per_100_km"]) == 10
    assert float(rows["USD"]["cost"]) == 10


def test_expenses_count_only_what_is_approved(owner: Member) -> None:
    car = vehicle(owner)
    review(owner, expense(owner, car, category="parking", amount="100"), "approve")
    expense(owner, car, category="tyres", amount="999")
    report = get(owner, "expenses")
    assert [row["category"] for row in report["rows"]] == ["parking"]
    assert tile(report, "Awaiting approval") == "1"


def test_maintenance_says_when_costs_are_missing(owner: Member) -> None:
    car = vehicle(owner)
    complete_work(owner, car, labour_cost="100", parts_cost="50")
    complete_work(owner, car, work_type="preventive")
    report = get(owner, "maintenance")
    row = report["rows"][0]
    assert (row["completed"], row["preventive"], row["corrective"], row["no_cost"]) == (2, 1, 1, 1)
    assert float(row["labour"]) == 100
    assert any("no recorded cost" in note for note in report["notes"])


def test_fleet_performance_needs_two_readings_for_cost_per_km(owner: Member) -> None:
    car = vehicle(owner)
    fuel(owner, car, odometer_km="1000", filled_at=moment(5))
    assert get(owner, "fleet")["rows"][0]["per_km"] is None
    fuel(owner, car, odometer_km="1500", filled_at=moment(1))
    review(owner, expense(owner, car, amount="500"), "approve")
    row = get(owner, "fleet")["rows"][0]
    assert float(row["total"]) == 16500
    assert float(row["distance"]) == 500
    assert float(row["per_km"]) == 33


def test_compliance_report(owner: Member) -> None:
    car = vehicle(owner)
    document(owner, vehicle_id=car, expires_on=day(-1))
    document(owner, vehicle_id=car, title="Soon", expires_on=day(10))
    defect(owner, car, severity="critical")
    inspect(owner, car, template(owner))
    report = get(owner, "compliance")
    assert tile(report, "Documents expired") == "1"
    assert tile(report, "Expiring within 30 days") == "1"
    assert tile(report, "Critical defects") == "1"
    assert tile(report, "Inspections passed") == "100.0% of 1"
    assert any("isn't necessarily uninsured" in note for note in report["notes"])


def test_driver_documents_stay_hidden_from_roles_that_cant_see_them(
    owner: Member, invite: Callable[..., Member]
) -> None:
    driver = new_driver(owner)
    document(owner, driver_id=driver["id"], document_type="medical", title="Medical")
    assert len(get(owner, "compliance")["rows"]) == 1
    viewer = invite(owner, "read_only")
    report = get(viewer, "compliance")
    assert report["rows"] == []
    assert any("aren't shown" in note for note in report["notes"])
    export = viewer.client.get(f"{URL}/compliance/export", params={"format": "csv"})
    assert b"Medical" not in export.content


def test_alert_report(owner: Member) -> None:
    car = vehicle(owner)
    defect(owner, car, severity="critical")
    defect(owner, car, severity="major", title="Other")
    alerts = owner.client.get(f"{API}/alerts").json()["items"]
    owner.client.post(f"{API}/alerts/{alerts[0]['id']}/acknowledge", headers=owner.csrf)
    report = get(owner, "alerts")
    assert tile(report, "Alerts") == "2"
    assert tile(report, "Critical") == "1"
    assert sum(row["raised"] for row in report["rows"]) == 2
    assert sum(row["acknowledged"] for row in report["rows"]) == 1


def test_the_date_range_limits_what_counts(owner: Member) -> None:
    car = vehicle(owner)
    fuel(owner, car, filled_at=moment(24 * 40))
    assert get(owner, "fuel")["rows"] == []  # default is the last 30 days
    assert len(get(owner, "fuel", start=day(-50), end=day(-20))["rows"]) == 1


def test_days_are_whole_days_where_the_organisation_is(owner: Member) -> None:
    owner.client.patch(f"{API}/organisation", json={"timezone": "Asia/Tokyo"}, headers=owner.csrf)
    report = get(owner, "alerts", start="2030-01-01", end="2030-01-01")
    assert report["start"] == "2030-01-01"


# Exports


def test_csv_export(owner: Member) -> None:
    car = vehicle(owner)
    fuel(owner, car)
    response = owner.client.get(f"{URL}/fuel/export", params={"format": "csv"})
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert 'attachment; filename="fleetpulse-fuel-' in response.headers["content-disposition"]
    rows = list(csv.reader(io.StringIO(response.content.decode("utf-8-sig"))))
    assert rows[0][0] == "Vehicle"
    assert rows[1][0] == "KCA 123A"


def test_csv_cant_carry_a_spreadsheet_formula(owner: Member) -> None:
    trip = owner.client.post(
        f"{API}/trips",
        json={"origin_name": '=HYPERLINK("http://evil.example.com")', "destination_name": "B"},
        headers=owner.csrf,
    )
    assert trip.status_code == 201
    new_driver(owner, first_name="@SUM(1)", licence_number="DL-F")
    rows = owner.client.get(f"{URL}/drivers/export", params={"format": "csv"}).content
    parsed = list(csv.reader(io.StringIO(rows.decode("utf-8-sig"))))
    assert parsed[1][0].startswith("'@SUM")


def test_numbers_stay_numbers_in_csv(owner: Member) -> None:
    car = vehicle(owner)
    fuel(owner, car, quantity="40", unit_price="200")
    parsed = list(
        csv.DictReader(
            io.StringIO(
                owner.client.get(f"{URL}/fuel/export", params={"format": "csv"}).content.decode(
                    "utf-8-sig"
                )
            )
        )
    )
    assert float(parsed[0]["Cost"]) == 8000


@pytest.mark.parametrize("key", KEYS)
def test_pdf_export(owner: Member, key: str) -> None:
    response = owner.client.get(f"{URL}/{key}/export", params={"format": "pdf"})
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert response.content.startswith(b"%PDF-")


def test_a_pdf_copes_with_names_outside_latin_1(owner: Member) -> None:
    new_driver(owner, first_name="Ọlá", last_name="Ṣàngó", licence_number="DL-U")
    response = owner.client.get(f"{URL}/drivers/export", params={"format": "pdf"})
    assert response.status_code == 200
    assert response.content.startswith(b"%PDF-")


def test_unknown_format_is_refused(owner: Member) -> None:
    assert owner.client.get(f"{URL}/fuel/export", params={"format": "exe"}).status_code == 422


def test_exports_are_audited(owner: Member, db: Any) -> None:
    owner.client.get(f"{URL}/fuel/export", params={"format": "csv"})
    rows = db.exec(
        select(AuditLog).where(
            AuditLog.action == "report.exported",
            AuditLog.organisation_id == owner.organisation_id,
        )
    ).all()
    assert [row.details for row in rows] == [{"report": "fuel", "format": "csv"}]


# Who can see what


def test_nothing_crosses_organisations(owner: Member, new_owner: Callable[[], Member]) -> None:
    car = vehicle(owner)
    fuel(owner, car)
    document(owner, vehicle_id=car, expires_on=day(-1))
    finish_trip(owner, ready(owner, "1"))
    other = new_owner()
    for key in KEYS:
        assert get(other, key)["rows"] == []
        exported = other.client.get(f"{URL}/{key}/export", params={"format": "csv"})
        assert b"KCA" not in exported.content


@pytest.mark.parametrize(
    ("role", "status"),
    [
        ("fleet_manager", 200),
        ("dispatcher", 200),
        ("maintenance_manager", 200),
        ("finance_manager", 200),
        ("read_only", 200),
        ("driver", 403),
    ],
)
def test_roles(owner: Member, invite: Callable[..., Member], role: str, status: int) -> None:
    member = invite(owner, role)
    assert member.client.get(URL).status_code == status
    assert member.client.get(f"{URL}/fleet").status_code == status
    assert member.client.get(f"{URL}/fleet/export").status_code == status
