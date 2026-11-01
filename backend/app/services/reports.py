import csv
import io
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from fpdf import FPDF
from sqlalchemy import select as sa_select
from sqlmodel import Session, col, func, select

from app.core.errors import ApiError
from app.models import (
    Alert,
    Defect,
    Driver,
    Expense,
    FuelTransaction,
    Inspection,
    Trip,
    Vehicle,
    WorkOrder,
)
from app.models.enums import (
    AlertSeverity,
    DefectSeverity,
    DefectStatus,
    ExpenseStatus,
    InspectionOutcome,
    TripStatus,
    WorkOrderStatus,
    WorkOrderType,
)
from app.services.alerts import document_state
from app.services.compliance import list_documents
from app.services.costs import _consumption

ROW_LIMIT = 5000
MAX_PERIOD_DAYS = 3660
PDF_ROW_LIMIT = 1000
HUNDRED = Decimal(100)
FONT_DIR = Path("/usr/share/fonts/truetype/dejavu")
FORMULA_STARTS = ("=", "+", "-", "@", "\t", "\r")

CATALOGUE = {
    "utilisation": ("Vehicle utilisation", "How much each vehicle was used on trips."),
    "trips": ("Trip performance", "Each trip, with timing and distance."),
    "drivers": ("Driver activity", "Trips, hours and distance for each driver."),
    "fuel": ("Fuel consumption", "Quantity, cost and consumption by vehicle."),
    "expenses": ("Operating expenses", "Approved expenses by category."),
    "maintenance": ("Maintenance costs", "Work done and what it cost, by vehicle."),
    "fleet": ("Fleet performance", "Total cost and cost per distance, by vehicle."),
    "compliance": ("Compliance", "Document status, defects and inspection results."),
    "alerts": ("Alerts", "Alerts raised and how quickly they were acknowledged."),
}


@dataclass
class Report:
    key: str
    title: str
    start: date
    end: date
    columns: list[dict[str, str]]
    rows: list[dict[str, Any]]
    tiles: list[dict[str, str]] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    truncated: bool = False


@dataclass
class Period:
    start: date
    end: date
    start_at: datetime
    end_at: datetime

    @property
    def days(self) -> int:
        return (self.end - self.start).days + 1


def period_for(start: date | None, end: date | None, timezone: str) -> Period:
    zone = ZoneInfo(timezone)
    finish = end or datetime.now(zone).date()
    begin = start or finish - timedelta(days=29)
    if begin > finish or (finish - begin).days > MAX_PERIOD_DAYS:
        raise ApiError(422, "invalid_period", "Choose a start date before the end date.")
    # Whole days where the organisation is, not in UTC.
    return Period(
        begin,
        finish,
        datetime.combine(begin, time.min, tzinfo=zone).astimezone(UTC),
        datetime.combine(finish + timedelta(days=1), time.min, tzinfo=zone).astimezone(UTC),
    )


def _column(key: str, label: str, kind: str = "text") -> dict[str, str]:
    return {"key": key, "label": label, "kind": kind}


def _vehicles(db: Session, organisation_id: uuid.UUID) -> dict[uuid.UUID, Vehicle]:
    """Includes archived vehicles, because their history still happened."""
    rows = db.exec(select(Vehicle).where(Vehicle.organisation_id == organisation_id)).all()
    return {item.id: item for item in rows}


def _hours(start: datetime | None, end: datetime | None) -> Decimal:
    if start is None or end is None:
        return Decimal(0)
    return Decimal(str(round((end - start).total_seconds() / 3600, 2)))


def _ratio(part: Decimal | int, whole: Decimal | int) -> Decimal | None:
    if not whole:
        return None
    return (Decimal(part) / Decimal(whole) * HUNDRED).quantize(Decimal("0.1"))


def _completed_trips(db: Session, organisation_id: uuid.UUID, period: Period) -> list[Any]:
    # Just these columns: building full records for every trip took most of a report's time.
    return list(
        db.execute(
            sa_select(
                col(Trip.vehicle_id),
                col(Trip.driver_id),
                col(Trip.actual_departure_at),
                col(Trip.actual_arrival_at),
                col(Trip.estimated_arrival_at),
                col(Trip.distance_km),
                col(Trip.distance_source),
            ).where(
                col(Trip.organisation_id) == organisation_id,
                col(Trip.status) == TripStatus.COMPLETED,
                col(Trip.actual_arrival_at) >= period.start_at,
                col(Trip.actual_arrival_at) < period.end_at,
            )
        ).all()
    )


def _distance_note(trips: list[Any]) -> list[str]:
    notes = []
    unknown = sum(1 for trip in trips if trip.distance_km is None)
    if unknown:
        notes.append(f"{unknown} completed trips have no recorded distance and add nothing to it.")
    if any(trip.distance_source == "simulated" for trip in trips):
        notes.append("Some distances come from simulated test data.")
    return notes


def _utilisation(db: Session, organisation_id: uuid.UUID, period: Period, _: bool) -> Report:
    vehicles = _vehicles(db, organisation_id)
    trips = _completed_trips(db, organisation_id, period)
    by_vehicle: dict[uuid.UUID, list[Any]] = defaultdict(list)
    for trip in trips:
        if trip.vehicle_id:
            by_vehicle[trip.vehicle_id].append(trip)
    rows = []
    for vehicle_id, vehicle in sorted(
        vehicles.items(), key=lambda item: item[1].registration_number
    ):
        mine = by_vehicle.get(vehicle_id, [])
        if vehicle.archived_at is not None and not mine:
            continue
        days = {
            trip.actual_departure_at.date() for trip in mine if trip.actual_departure_at is not None
        }
        rows.append(
            {
                "vehicle": vehicle.registration_number,
                "status": vehicle.status.value.replace("_", " "),
                "trips": len(mine),
                "hours": sum(
                    (_hours(trip.actual_departure_at, trip.actual_arrival_at) for trip in mine),
                    Decimal(0),
                ),
                "distance": sum((trip.distance_km or Decimal(0) for trip in mine), Decimal(0)),
                "days_used": len(days),
                "utilisation": _ratio(min(len(days), period.days), period.days),
            }
        )
    used = sum(1 for row in rows if row["trips"])
    return Report(
        "utilisation",
        CATALOGUE["utilisation"][0],
        period.start,
        period.end,
        [
            _column("vehicle", "Vehicle"),
            _column("status", "Status now"),
            _column("trips", "Completed trips", "number"),
            _column("hours", "Trip hours", "number"),
            _column("distance", "Trip distance", "distance"),
            _column("days_used", "Days used", "number"),
            _column("utilisation", "Days used, % of period", "percent"),
        ],
        rows,
        [
            {"label": "Vehicles used", "value": f"{used} of {len(rows)}"},
            {"label": "Completed trips", "value": str(len(trips))},
        ],
        [
            "Based on completed trips in the period. Use outside recorded trips isn't counted.",
            *_distance_note(trips),
        ],
    )


def _trips(db: Session, organisation_id: uuid.UUID, period: Period, _: bool) -> Report:
    vehicles = _vehicles(db, organisation_id)
    drivers = {
        item.id: f"{item.first_name} {item.last_name}"
        for item in db.exec(select(Driver).where(Driver.organisation_id == organisation_id)).all()
    }
    trips = list(
        db.exec(
            select(Trip)
            .where(
                Trip.organisation_id == organisation_id,
                col(Trip.created_at) < period.end_at,
                func.coalesce(Trip.actual_arrival_at, Trip.planned_departure_at, Trip.created_at)
                >= period.start_at,
                func.coalesce(Trip.actual_arrival_at, Trip.planned_departure_at, Trip.created_at)
                < period.end_at,
            )
            .order_by(col(Trip.planned_departure_at).desc().nulls_last())
            .limit(ROW_LIMIT + 1)
        ).all()
    )
    truncated = len(trips) > ROW_LIMIT
    trips = trips[:ROW_LIMIT]
    rows = []
    timed = on_time = 0
    for trip in trips:
        late: Decimal | None = None
        if (
            trip.status == TripStatus.COMPLETED
            and trip.estimated_arrival_at
            and trip.actual_arrival_at
        ):
            timed += 1
            minutes = (trip.actual_arrival_at - trip.estimated_arrival_at).total_seconds() / 60
            late = Decimal(str(round(max(minutes, 0))))
            on_time += minutes <= 0
        vehicle = vehicles.get(trip.vehicle_id) if trip.vehicle_id else None
        rows.append(
            {
                "route": f"{trip.origin_name} to {trip.destination_name}",
                "status": trip.status.value.replace("_", " "),
                "vehicle": vehicle.registration_number if vehicle else None,
                "driver": drivers.get(trip.driver_id) if trip.driver_id else None,
                "planned": trip.planned_departure_at,
                "departed": trip.actual_departure_at,
                "arrived": trip.actual_arrival_at,
                "minutes_late": late,
                "distance": trip.distance_km,
                "distance_source": trip.distance_source,
            }
        )
    completed = [trip for trip in trips if trip.status == TripStatus.COMPLETED]
    cancelled = sum(1 for trip in trips if trip.status == TripStatus.CANCELLED)
    rate = _ratio(on_time, timed)
    return Report(
        "trips",
        CATALOGUE["trips"][0],
        period.start,
        period.end,
        [
            _column("route", "Route"),
            _column("status", "Status"),
            _column("vehicle", "Vehicle"),
            _column("driver", "Driver"),
            _column("planned", "Planned departure", "datetime"),
            _column("departed", "Departed", "datetime"),
            _column("arrived", "Arrived", "datetime"),
            _column("minutes_late", "Minutes late", "number"),
            _column("distance", "Distance", "distance"),
            _column("distance_source", "Distance source"),
        ],
        rows,
        [
            {"label": "Trips", "value": str(len(trips))},
            {"label": "Completed", "value": str(len(completed))},
            {"label": "Cancelled", "value": str(cancelled)},
            {
                "label": "Arrived on time",
                "value": f"{rate}% of {timed}" if rate is not None else "No trips to measure",
            },
        ],
        [
            "On-time only counts completed trips that had an estimated arrival.",
            *_distance_note(completed),
        ],
        truncated,
    )


def _drivers(db: Session, organisation_id: uuid.UUID, period: Period, _: bool) -> Report:
    trips = _completed_trips(db, organisation_id, period)
    by_driver: dict[uuid.UUID, list[Any]] = defaultdict(list)
    for trip in trips:
        if trip.driver_id:
            by_driver[trip.driver_id].append(trip)
    drivers = db.exec(
        select(Driver)
        .where(Driver.organisation_id == organisation_id)
        .order_by(col(Driver.last_name), col(Driver.first_name))
    ).all()
    rows = []
    for driver in drivers:
        mine = by_driver.get(driver.id, [])
        if driver.archived_at is not None and not mine:
            continue
        timed = [trip for trip in mine if trip.estimated_arrival_at and trip.actual_arrival_at]
        on_time = sum(
            1
            for trip in timed
            if trip.actual_arrival_at
            and trip.estimated_arrival_at
            and trip.actual_arrival_at <= trip.estimated_arrival_at
        )
        rows.append(
            {
                "driver": f"{driver.first_name} {driver.last_name}",
                "status": driver.status.value,
                "trips": len(mine),
                "hours": sum(
                    (_hours(trip.actual_departure_at, trip.actual_arrival_at) for trip in mine),
                    Decimal(0),
                ),
                "distance": sum((trip.distance_km or Decimal(0) for trip in mine), Decimal(0)),
                "on_time": _ratio(on_time, len(timed)),
            }
        )
    return Report(
        "drivers",
        CATALOGUE["drivers"][0],
        period.start,
        period.end,
        [
            _column("driver", "Driver"),
            _column("status", "Status now"),
            _column("trips", "Completed trips", "number"),
            _column("hours", "Trip hours", "number"),
            _column("distance", "Trip distance", "distance"),
            _column("on_time", "Arrived on time", "percent"),
        ],
        rows,
        [
            {"label": "Drivers", "value": str(len(rows))},
            {
                "label": "Completed trips",
                "value": str(sum(len(item) for item in by_driver.values())),
            },
        ],
        [
            "This shows recorded activity, and isn't a measure of a person's performance on its "
            "own. "
            "Late arrivals can have causes outside a driver's control.",
            *_distance_note(trips),
        ],
    )


def _fills(db: Session, organisation_id: uuid.UUID, period: Period) -> list[Any]:
    return list(
        db.execute(
            sa_select(
                col(FuelTransaction.vehicle_id),
                col(FuelTransaction.unit),
                col(FuelTransaction.currency),
                col(FuelTransaction.quantity),
                col(FuelTransaction.total_cost),
                col(FuelTransaction.odometer_km),
                col(FuelTransaction.is_full_tank),
            )
            .where(
                col(FuelTransaction.organisation_id) == organisation_id,
                col(FuelTransaction.voided_at).is_(None),
                col(FuelTransaction.filled_at) >= period.start_at,
                col(FuelTransaction.filled_at) < period.end_at,
            )
            .order_by(col(FuelTransaction.filled_at))
        ).all()
    )


def _fuel(db: Session, organisation_id: uuid.UUID, period: Period, _: bool) -> Report:
    vehicles = _vehicles(db, organisation_id)
    fills = _fills(db, organisation_id, period)
    grouped: dict[tuple[uuid.UUID, str, str], list[Any]] = defaultdict(list)
    per_vehicle: dict[uuid.UUID, list[Any]] = defaultdict(list)
    for fill in fills:
        grouped[(fill.vehicle_id, str(fill.unit), fill.currency)].append(fill)
        per_vehicle[fill.vehicle_id].append(fill)
    rates = {
        (vehicle_id, str(unit)): rate
        for vehicle_id, items in per_vehicle.items()
        for unit, rate, _distance in _consumption(items)
    }
    rows = []
    for (vehicle_id, unit, currency), items in sorted(
        grouped.items(), key=lambda entry: vehicles[entry[0][0]].registration_number
    ):
        quantity = sum((item.quantity for item in items), Decimal(0))
        cost = sum((item.total_cost for item in items), Decimal(0))
        rows.append(
            {
                "vehicle": vehicles[vehicle_id].registration_number,
                "unit": unit,
                "fills": len(items),
                "quantity": quantity,
                "currency": currency,
                "cost": cost,
                "average_price": (cost / quantity).quantize(Decimal("0.01")),
                "per_100_km": rates.get((vehicle_id, unit)),
            }
        )
    return Report(
        "fuel",
        CATALOGUE["fuel"][0],
        period.start,
        period.end,
        [
            _column("vehicle", "Vehicle"),
            _column("unit", "Unit"),
            _column("fills", "Fill-ups", "number"),
            _column("quantity", "Quantity", "number"),
            _column("currency", "Currency"),
            _column("cost", "Cost", "money"),
            _column("average_price", "Average price per unit", "money"),
            _column("per_100_km", "Used per 100 km", "number"),
        ],
        rows,
        [{"label": "Fill-ups", "value": str(len(fills))}],
        [
            "Consumption needs two full fills with odometer readings, and is blank without them.",
            "Voided records aren't included. Currencies are shown separately and never converted.",
        ],
    )


def _expenses(db: Session, organisation_id: uuid.UUID, period: Period, _: bool) -> Report:
    rows_raw = db.exec(
        select(Expense.category, Expense.currency, func.count(), func.sum(Expense.amount))
        .where(
            Expense.organisation_id == organisation_id,
            col(Expense.voided_at).is_(None),
            Expense.status == ExpenseStatus.APPROVED,
            col(Expense.incurred_on) >= period.start,
            col(Expense.incurred_on) <= period.end,
        )
        .group_by(col(Expense.category), col(Expense.currency))
        .order_by(col(Expense.currency), col(Expense.category))
    ).all()
    waiting = db.exec(
        select(func.count()).where(
            Expense.organisation_id == organisation_id,
            col(Expense.voided_at).is_(None),
            Expense.status == ExpenseStatus.SUBMITTED,
            col(Expense.incurred_on) >= period.start,
            col(Expense.incurred_on) <= period.end,
        )
    ).one()
    return Report(
        "expenses",
        CATALOGUE["expenses"][0],
        period.start,
        period.end,
        [
            _column("category", "Category"),
            _column("currency", "Currency"),
            _column("count", "Expenses", "number"),
            _column("amount", "Amount", "money"),
        ],
        [
            {
                "category": str(category).replace("_", " "),
                "currency": currency,
                "count": count,
                "amount": amount,
            }
            for category, currency, count, amount in rows_raw
        ],
        [{"label": "Awaiting approval", "value": str(waiting)}],
        [
            f"Approved expenses only. {waiting} more in this period await approval and "
            "aren't counted.",
            "Currencies are shown separately and never converted.",
        ],
    )


def _maintenance(db: Session, organisation_id: uuid.UUID, period: Period, _: bool) -> Report:
    vehicles = _vehicles(db, organisation_id)
    orders = db.execute(
        sa_select(
            col(WorkOrder.vehicle_id),
            col(WorkOrder.currency),
            col(WorkOrder.work_type),
            col(WorkOrder.labour_cost),
            col(WorkOrder.parts_cost),
        ).where(
            col(WorkOrder.organisation_id) == organisation_id,
            col(WorkOrder.status) == WorkOrderStatus.COMPLETED,
            col(WorkOrder.completed_on) >= period.start,
            col(WorkOrder.completed_on) <= period.end,
        )
    ).all()
    grouped: dict[tuple[uuid.UUID, str], list[Any]] = defaultdict(list)
    for order in orders:
        grouped[(order.vehicle_id, order.currency)].append(order)
    rows = []
    unknown_total = 0
    for (vehicle_id, currency), items in sorted(
        grouped.items(), key=lambda entry: vehicles[entry[0][0]].registration_number
    ):
        unknown = sum(1 for item in items if item.labour_cost is None and item.parts_cost is None)
        unknown_total += unknown
        rows.append(
            {
                "vehicle": vehicles[vehicle_id].registration_number,
                "completed": len(items),
                "preventive": sum(
                    1 for item in items if item.work_type == WorkOrderType.PREVENTIVE
                ),
                "corrective": sum(
                    1 for item in items if item.work_type == WorkOrderType.CORRECTIVE
                ),
                "currency": currency,
                "labour": sum((item.labour_cost or Decimal(0) for item in items), Decimal(0)),
                "parts": sum((item.parts_cost or Decimal(0) for item in items), Decimal(0)),
                "no_cost": unknown,
            }
        )
    notes = ["Currencies are shown separately and never converted."]
    if unknown_total:
        notes.insert(
            0, f"{unknown_total} completed work orders have no recorded cost, so totals may be low."
        )
    return Report(
        "maintenance",
        CATALOGUE["maintenance"][0],
        period.start,
        period.end,
        [
            _column("vehicle", "Vehicle"),
            _column("completed", "Completed", "number"),
            _column("preventive", "Preventive", "number"),
            _column("corrective", "Corrective", "number"),
            _column("currency", "Currency"),
            _column("labour", "Labour", "money"),
            _column("parts", "Parts", "money"),
            _column("no_cost", "With no recorded cost", "number"),
        ],
        rows,
        [{"label": "Work orders completed", "value": str(len(orders))}],
        notes,
    )


def _fleet(db: Session, organisation_id: uuid.UUID, period: Period, _: bool) -> Report:
    vehicles = _vehicles(db, organisation_id)
    costs: dict[tuple[uuid.UUID, str], dict[str, Decimal]] = defaultdict(
        lambda: {"fuel": Decimal(0), "maintenance": Decimal(0), "expenses": Decimal(0)}
    )
    readings: dict[uuid.UUID, list[Decimal]] = defaultdict(list)
    for fill in _fills(db, organisation_id, period):
        costs[(fill.vehicle_id, fill.currency)]["fuel"] += fill.total_cost
        if fill.odometer_km is not None:
            readings[fill.vehicle_id].append(fill.odometer_km)
    for expense in db.execute(
        sa_select(col(Expense.vehicle_id), col(Expense.currency), col(Expense.amount)).where(
            col(Expense.organisation_id) == organisation_id,
            col(Expense.voided_at).is_(None),
            col(Expense.status) == ExpenseStatus.APPROVED,
            col(Expense.incurred_on) >= period.start,
            col(Expense.incurred_on) <= period.end,
        )
    ).all():
        costs[(expense.vehicle_id, expense.currency)]["expenses"] += expense.amount
    for order in db.execute(
        sa_select(
            col(WorkOrder.vehicle_id),
            col(WorkOrder.currency),
            col(WorkOrder.labour_cost),
            col(WorkOrder.parts_cost),
            col(WorkOrder.odometer_km),
        ).where(
            col(WorkOrder.organisation_id) == organisation_id,
            col(WorkOrder.status) == WorkOrderStatus.COMPLETED,
            col(WorkOrder.completed_on) >= period.start,
            col(WorkOrder.completed_on) <= period.end,
        )
    ).all():
        costs[(order.vehicle_id, order.currency)]["maintenance"] += (
            order.labour_cost or Decimal(0)
        ) + (order.parts_cost or Decimal(0))
        if order.odometer_km is not None:
            readings[order.vehicle_id].append(order.odometer_km)
    trips = _completed_trips(db, organisation_id, period)
    trip_counts: dict[uuid.UUID, int] = defaultdict(int)
    for trip in trips:
        if trip.vehicle_id:
            trip_counts[trip.vehicle_id] += 1
    rows = []
    for (vehicle_id, currency), parts in sorted(
        costs.items(), key=lambda entry: vehicles[entry[0][0]].registration_number
    ):
        total = sum(parts.values(), Decimal(0))
        points = readings.get(vehicle_id, [])
        distance = (
            max(points) - min(points) if len(points) >= 2 and max(points) > min(points) else None
        )
        rows.append(
            {
                "vehicle": vehicles[vehicle_id].registration_number,
                "trips": trip_counts.get(vehicle_id, 0),
                "currency": currency,
                "fuel": parts["fuel"],
                "maintenance": parts["maintenance"],
                "expenses": parts["expenses"],
                "total": total,
                "distance": distance,
                "per_km": (total / distance).quantize(Decimal("0.01")) if distance else None,
            }
        )
    return Report(
        "fleet",
        CATALOGUE["fleet"][0],
        period.start,
        period.end,
        [
            _column("vehicle", "Vehicle"),
            _column("trips", "Completed trips", "number"),
            _column("currency", "Currency"),
            _column("fuel", "Fuel", "money"),
            _column("maintenance", "Maintenance", "money"),
            _column("expenses", "Expenses", "money"),
            _column("total", "Total", "money"),
            _column("distance", "Distance by odometer", "distance"),
            _column("per_km", "Cost per km", "money"),
        ],
        rows,
        [{"label": "Vehicles with costs", "value": str(len({key[0] for key in costs}))}],
        [
            "Cost per km needs two different odometer readings in the period, and is blank "
            "without them.",
            "Approved expenses only. Currencies are shown separately and never converted.",
        ],
    )


def _compliance(
    db: Session, organisation_id: uuid.UUID, period: Period, include_drivers: bool
) -> Report:
    today = period.end
    documents = list_documents(
        db,
        organisation_id,
        today,
        include_driver_documents=include_drivers,
        only_driver_id=None,
        vehicle_id=None,
        driver_id=None,
        state=None,
        archived=False,
    )
    rows = []
    counts: dict[str, int] = defaultdict(int)
    for document, registration, first_name, last_name, _file in documents:
        state = document_state(document.expires_on, today)
        counts[state] += 1
        rows.append(
            {
                "owner": registration or f"{first_name} {last_name}",
                "type": document.document_type.value.replace("_", " "),
                "title": document.title,
                "expires": document.expires_on,
                "state": state.replace("_", " "),
            }
        )
    inspections = dict(
        db.exec(
            select(Inspection.outcome, func.count())
            .where(
                Inspection.organisation_id == organisation_id,
                col(Inspection.performed_at) >= period.start_at,
                col(Inspection.performed_at) < period.end_at,
            )
            .group_by(col(Inspection.outcome))
        ).all()
    )
    total = sum(inspections.values())
    rate = _ratio(inspections.get(InspectionOutcome.PASSED, 0), total)
    defects = dict(
        db.exec(
            select(Defect.severity, func.count())
            .where(Defect.organisation_id == organisation_id, Defect.status == DefectStatus.OPEN)
            .group_by(col(Defect.severity))
        ).all()
    )
    return Report(
        "compliance",
        CATALOGUE["compliance"][0],
        period.start,
        period.end,
        [
            _column("owner", "Vehicle or driver"),
            _column("type", "Type"),
            _column("title", "Document"),
            _column("expires", "Expires", "date"),
            _column("state", "Status on the end date"),
        ],
        rows,
        [
            {"label": "Documents expired", "value": str(counts["expired"])},
            {"label": "Expiring within 30 days", "value": str(counts["expiring"])},
            {"label": "Open defects", "value": str(sum(defects.values()))},
            {"label": "Critical defects", "value": str(defects.get(DefectSeverity.CRITICAL, 0))},
            {
                "label": "Inspections passed",
                "value": f"{rate}% of {total}" if rate is not None else "None in this period",
            },
        ],
        [
            "Only what's been recorded in FleetPulse. A vehicle with no insurance document on file "
            "isn't necessarily uninsured, and doesn't appear here as expired.",
            *(
                []
                if include_drivers
                else ["Driver documents aren't shown, because your role can't view them."]
            ),
        ],
    )


def _alerts(db: Session, organisation_id: uuid.UUID, period: Period, _: bool) -> Report:
    alerts = db.execute(
        sa_select(
            col(Alert.alert_type),
            col(Alert.severity),
            col(Alert.created_at),
            col(Alert.acknowledged_at),
            col(Alert.resolved_at),
            col(Alert.is_simulated),
        ).where(
            col(Alert.organisation_id) == organisation_id,
            col(Alert.occurred_at) >= period.start_at,
            col(Alert.occurred_at) < period.end_at,
        )
    ).all()
    grouped: dict[tuple[str, str], list[Any]] = defaultdict(list)
    for alert in alerts:
        grouped[(str(alert.alert_type), str(alert.severity))].append(alert)
    rows = []
    for (kind, severity), items in sorted(grouped.items()):
        waits = [
            (item.acknowledged_at - item.created_at).total_seconds() / 60
            for item in items
            if item.acknowledged_at is not None
        ]
        rows.append(
            {
                "type": kind.replace("_", " "),
                "severity": severity,
                "raised": len(items),
                "acknowledged": len(waits),
                "resolved": sum(1 for item in items if item.resolved_at is not None),
                "minutes_to_acknowledge": (
                    Decimal(str(round(sum(waits) / len(waits)))) if waits else None
                ),
            }
        )
    critical = sum(1 for alert in alerts if alert.severity == AlertSeverity.CRITICAL)
    simulated = sum(1 for alert in alerts if alert.is_simulated)
    return Report(
        "alerts",
        CATALOGUE["alerts"][0],
        period.start,
        period.end,
        [
            _column("type", "Type"),
            _column("severity", "Severity"),
            _column("raised", "Raised", "number"),
            _column("acknowledged", "Acknowledged", "number"),
            _column("resolved", "Resolved", "number"),
            _column("minutes_to_acknowledge", "Average minutes to acknowledge", "number"),
        ],
        rows,
        [
            {"label": "Alerts", "value": str(len(alerts))},
            {"label": "Critical", "value": str(critical)},
        ],
        [f"{simulated} of these came from simulated test data."] if simulated else [],
    )


BUILDERS = {
    "utilisation": _utilisation,
    "trips": _trips,
    "drivers": _drivers,
    "fuel": _fuel,
    "expenses": _expenses,
    "maintenance": _maintenance,
    "fleet": _fleet,
    "compliance": _compliance,
    "alerts": _alerts,
}


def build(
    db: Session, organisation_id: uuid.UUID, key: str, period: Period, include_drivers: bool
) -> Report:
    builder = BUILDERS.get(key)
    if builder is None:
        raise ApiError(404, "not_found", "Report not found.")
    report = builder(db, organisation_id, period, include_drivers)
    if len(report.rows) > ROW_LIMIT:
        report.rows = report.rows[:ROW_LIMIT]
        report.truncated = True
    return report


def _plain(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d %H:%M UTC")
    if isinstance(value, Decimal):
        return format(value.normalize(), "f")
    return str(value)


def _safe_cell(value: Any) -> str:
    """Spreadsheets run cells that start like a formula, and names and notes are user-typed."""
    cell = _plain(value)
    if not isinstance(value, Decimal | int) and cell.startswith(FORMULA_STARTS):
        return f"'{cell}"
    return cell


def to_csv(report: Report) -> bytes:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(column["label"] for column in report.columns)
    for row in report.rows:
        writer.writerow(_safe_cell(row.get(column["key"])) for column in report.columns)
    # A byte order mark, so spreadsheets read accented names correctly.
    return buffer.getvalue().encode("utf-8-sig")


def to_pdf(report: Report, organisation_name: str) -> bytes:
    pdf = FPDF(orientation="L", format="A4")
    pdf.set_auto_page_break(auto=True, margin=12)
    regular, bold = FONT_DIR / "DejaVuSans.ttf", FONT_DIR / "DejaVuSans-Bold.ttf"
    # Fleet names aren't all in Latin-1, which the PDF built-in fonts stop at.
    unicode_font = regular.exists() and bold.exists()
    family = "DejaVu" if unicode_font else "Helvetica"
    if unicode_font:
        pdf.add_font("DejaVu", "", str(regular))
        pdf.add_font("DejaVu", "B", str(bold))

    def fit(value: str) -> str:
        return value if unicode_font else value.encode("latin-1", "replace").decode("latin-1")

    pdf.add_page()
    pdf.set_font(family, "B", 16)
    pdf.multi_cell(0, 8, fit(report.title), new_x="LMARGIN", new_y="NEXT")
    pdf.set_font(family, "", 9)
    pdf.multi_cell(
        0,
        5,
        fit(f"{organisation_name}. {report.start.isoformat()} to {report.end.isoformat()}."),
        new_x="LMARGIN",
        new_y="NEXT",
    )
    for tile in report.tiles:
        pdf.multi_cell(
            0, 5, fit(f"{tile['label']}: {tile['value']}"), new_x="LMARGIN", new_y="NEXT"
        )
    pdf.ln(2)
    rows = report.rows[:PDF_ROW_LIMIT]
    if rows:
        pdf.set_font(family, "", 7)
        with pdf.table(
            first_row_as_headings=True,
            text_align="LEFT",
            line_height=4,
        ) as table:
            heading = table.row()
            for column in report.columns:
                heading.cell(fit(column["label"]))
            for row in rows:
                line = table.row()
                for column in report.columns:
                    line.cell(fit(_plain(row.get(column["key"]))))
    else:
        pdf.multi_cell(0, 5, "Nothing to report in this period.", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(3)
    pdf.set_font(family, "", 8)
    notes = list(report.notes)
    if len(report.rows) > PDF_ROW_LIMIT or report.truncated:
        notes.append(f"Only the first {len(rows)} rows are shown. Export as CSV for more.")
    for note in notes:
        pdf.multi_cell(0, 4, fit(note), new_x="LMARGIN", new_y="NEXT")
    return bytes(pdf.output())
