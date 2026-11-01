import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any
from zoneinfo import ZoneInfo

import structlog
from sqlalchemy import text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import SQLAlchemyError
from sqlmodel import Session, col, func, select, update

from app.core.errors import ApiError
from app.db.session import set_db_context
from app.integrations.gps.base import RawPosition
from app.models import (
    Alert,
    AlertSettings,
    ComplianceDocument,
    Driver,
    Geofence,
    GeofenceEvent,
    GeofenceOccupancy,
    MaintenanceSchedule,
    Vehicle,
)
from app.models.base import utcnow
from app.models.enums import AlertSeverity, AlertType, GeofenceEventType, GpsSignalStatus
from app.services.audit import record_audit
from app.services.dashboard import LICENCE_WARNING_DAYS
from app.services.geo import distance_km
from app.services.maintenance import due_state

# Two readings in a row, so one bad GPS sample doesn't accuse a driver of speeding.
SPEEDING_CONFIRM_WINDOW = timedelta(minutes=5)
UNRELIABLE_SIGNALS = (GpsSignalStatus.WEAK, GpsSignalStatus.LOST)
# Above this, a vehicle with its ignition off is really moving rather than drifting GPS.
UNUSUAL_SPEED_KPH = Decimal("10")
UNUSUAL_DISTANCE_KM = 0.5
# Late deliveries still update history, but stale conditions shouldn't look like current ones.
ALERT_MAX_AGE = timedelta(hours=1)

DOCUMENT_WARNING_DAYS = 30

logger = structlog.get_logger(__name__)


@dataclass
class Reading:
    """One newly stored position, in the terms the checks need."""

    vehicle_id: uuid.UUID
    position: RawPosition
    is_simulated: bool


def get_settings_row(db: Session, organisation_id: uuid.UUID) -> AlertSettings:
    existing = db.exec(
        select(AlertSettings).where(AlertSettings.organisation_id == organisation_id)
    ).first()
    return existing or AlertSettings(organisation_id=organisation_id)


def update_settings(
    db: Session, organisation_id: uuid.UUID, actor_id: uuid.UUID, changes: dict[str, Any]
) -> AlertSettings:
    row = get_settings_row(db, organisation_id)
    for field, value in changes.items():
        setattr(row, field, value)
    row.updated_at = utcnow()
    db.add(row)
    record_audit(
        db,
        "alert_settings.updated",
        actor_user_id=actor_id,
        organisation_id=organisation_id,
        entity_type="alert_settings",
        entity_id=row.id,
        details={"fields": sorted(changes)},
    )
    db.commit()
    if "speed_limit_kph" in changes and changes["speed_limit_kph"] is None:
        _resolve(db, organisation_id, AlertType.SPEEDING)
        db.commit()
    if changes.get("offline_alerts_enabled") is False:
        _resolve(db, organisation_id, AlertType.VEHICLE_OFFLINE)
        db.commit()
    return row


def _alert_values(
    organisation_id: uuid.UUID,
    alert_type: AlertType,
    severity: AlertSeverity,
    title: str,
    message: str,
    occurred_at: datetime,
    *,
    vehicle_id: uuid.UUID | None = None,
    driver_id: uuid.UUID | None = None,
    geofence_id: uuid.UUID | None = None,
    is_simulated: bool = False,
    dedupe_key: str | None = None,
) -> dict[str, Any]:
    return {
        "id": uuid.uuid4(),
        "organisation_id": organisation_id,
        "alert_type": alert_type,
        "severity": severity,
        "title": title,
        "message": message,
        "occurred_at": occurred_at,
        "vehicle_id": vehicle_id,
        "driver_id": driver_id,
        "geofence_id": geofence_id,
        "is_simulated": is_simulated,
        "dedupe_key": dedupe_key,
        "created_at": utcnow(),
    }


def _raise(db: Session, values: list[dict[str, Any]]) -> None:
    """A condition that already has an unresolved alert doesn't raise another."""
    if values:
        db.execute(insert(Alert).on_conflict_do_nothing(), values)


def _resolve(
    db: Session,
    organisation_id: uuid.UUID,
    alert_type: AlertType,
    vehicle_ids: set[uuid.UUID] | None = None,
) -> None:
    statement = update(Alert).where(
        col(Alert.organisation_id) == organisation_id,
        col(Alert.alert_type) == alert_type,
        col(Alert.resolved_at).is_(None),
    )
    if vehicle_ids is not None:
        statement = statement.where(col(Alert.vehicle_id).in_(vehicle_ids))
    db.execute(statement.values(resolved_at=utcnow()))


def previous_positions(
    db: Session, organisation_id: uuid.UUID, vehicle_ids: set[uuid.UUID]
) -> dict[uuid.UUID, Any]:
    """Each vehicle's latest position. Must be read before this batch updates it.

    Holds each vehicle until commit, so overlapping batches for one vehicle take turns and a
    crossing is only ever seen once. Sorted, so batches can't deadlock on each other.
    """
    db.execute(
        text(
            """
            SELECT id FROM vehicles WHERE organisation_id = :org AND id = ANY(:vehicles)
            ORDER BY id FOR NO KEY UPDATE
            """
        ),
        {"org": organisation_id, "vehicles": list(vehicle_ids)},
    ).all()
    rows = db.execute(
        text(
            """
            SELECT vehicle_id, recorded_at, ST_Y(location::geometry) AS latitude,
                ST_X(location::geometry) AS longitude, speed_kph, ignition_on, signal_status
            FROM vehicle_latest_locations
            WHERE organisation_id = :org AND vehicle_id = ANY(:vehicles)
            """
        ),
        {"org": organisation_id, "vehicles": list(vehicle_ids)},
    ).mappings()
    return {row["vehicle_id"]: row for row in rows}


def _covering_geofences(
    db: Session, organisation_id: uuid.UUID, readings: list[Reading]
) -> dict[int, set[uuid.UUID]]:
    rows = db.execute(
        text(
            """
            SELECT p.ordinal, g.id
            FROM unnest(CAST(:lats AS double precision[]), CAST(:lngs AS double precision[]))
                WITH ORDINALITY AS p(lat, lng, ordinal)
            JOIN geofences g ON g.organisation_id = :org AND g.archived_at IS NULL
                AND ST_Covers(g.area, ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326)::geography)
            """
        ),
        {
            "org": organisation_id,
            "lats": [reading.position.latitude for reading in readings],
            "lngs": [reading.position.longitude for reading in readings],
        },
    ).all()
    covers: dict[int, set[uuid.UUID]] = {}
    for ordinal, geofence_id in rows:
        covers.setdefault(ordinal - 1, set()).add(geofence_id)
    return covers


def _check_geofences(
    db: Session,
    organisation_id: uuid.UUID,
    readings: list[Reading],
    previous: dict[uuid.UUID, Any],
    registrations: dict[uuid.UUID, str],
    pending: list[dict[str, Any]],
) -> None:
    fences = {
        fence.id: fence
        for fence in db.exec(
            select(Geofence).where(
                Geofence.organisation_id == organisation_id, col(Geofence.archived_at).is_(None)
            )
        ).all()
    }
    if not fences:
        return
    active_ids = set(fences)
    covers = _covering_geofences(db, organisation_id, readings)
    inside: dict[uuid.UUID, set[uuid.UUID]] = {}
    for vehicle_id, geofence_id in db.exec(
        select(GeofenceOccupancy.vehicle_id, GeofenceOccupancy.geofence_id).where(
            GeofenceOccupancy.organisation_id == organisation_id,
            col(GeofenceOccupancy.vehicle_id).in_({item.vehicle_id for item in readings}),
        )
    ).all():
        inside.setdefault(vehicle_id, set()).add(geofence_id)

    newest = {vehicle_id: row["recorded_at"] for vehicle_id, row in previous.items()}
    entered_at: dict[tuple[uuid.UUID, uuid.UUID], datetime] = {}
    left: set[tuple[uuid.UUID, uuid.UUID]] = set()
    events: list[dict[str, Any]] = []
    for index, reading in enumerate(readings):
        vehicle_id = reading.vehicle_id
        recorded_at = reading.position.recorded_at
        assert recorded_at is not None  # noqa: S101  (validated before storing)
        first_ever = vehicle_id not in newest
        # A late delivery says nothing about where the vehicle is now.
        if not first_ever and recorded_at <= newest[vehicle_id]:
            continue
        newest[vehicle_id] = recorded_at
        current = inside.setdefault(vehicle_id, set())
        covering = covers.get(index, set()) & active_ids
        registration = registrations.get(vehicle_id, "A vehicle")
        for fence_id in covering - current:
            current.add(fence_id)
            entered_at[(fence_id, vehicle_id)] = recorded_at
            # With no earlier position, it may have been inside all along: that isn't an entry.
            if not first_ever:
                _transition(
                    fences[fence_id],
                    reading,
                    GeofenceEventType.ENTRY,
                    registration,
                    events,
                    pending,
                )
        for fence_id in (current & active_ids) - covering:
            current.discard(fence_id)
            left.add((fence_id, vehicle_id))
            entered_at.pop((fence_id, vehicle_id), None)
            _transition(
                fences[fence_id], reading, GeofenceEventType.EXIT, registration, events, pending
            )

    # In one go, so a batch with many crossings stays quick. Each vehicle is held by this
    # transaction (see previous_positions), so these can't conflict with another batch.
    if left:
        db.execute(
            text(
                """
                DELETE FROM geofence_occupancies o
                USING unnest(CAST(:fences AS uuid[]), CAST(:vehicles AS uuid[]))
                    AS d(fence, vehicle)
                WHERE o.organisation_id = :org AND o.geofence_id = d.fence
                  AND o.vehicle_id = d.vehicle
                """
            ),
            {
                "org": organisation_id,
                "fences": [fence for fence, _ in left],
                "vehicles": [vehicle for _, vehicle in left],
            },
        )
    if entered_at:
        db.execute(
            insert(GeofenceOccupancy).on_conflict_do_nothing(),
            [
                {
                    "id": uuid.uuid4(),
                    "organisation_id": organisation_id,
                    "geofence_id": fence,
                    "vehicle_id": vehicle,
                    "entered_at": when,
                }
                for (fence, vehicle), when in entered_at.items()
            ],
        )
    if events:
        db.execute(insert(GeofenceEvent), events)


def _transition(
    fence: Geofence,
    reading: Reading,
    event_type: GeofenceEventType,
    registration: str,
    events: list[dict[str, Any]],
    pending: list[dict[str, Any]],
) -> None:
    position = reading.position
    assert position.recorded_at is not None  # noqa: S101
    events.append(
        {
            "id": uuid.uuid4(),
            "organisation_id": fence.organisation_id,
            "geofence_id": fence.id,
            "vehicle_id": reading.vehicle_id,
            "event_type": event_type,
            "occurred_at": position.recorded_at,
            "latitude": position.latitude,
            "longitude": position.longitude,
            "is_simulated": reading.is_simulated,
        }
    )
    entered = event_type == GeofenceEventType.ENTRY
    wanted = fence.alert_on_entry or fence.is_restricted if entered else fence.alert_on_exit
    if not wanted:
        return
    restricted = entered and fence.is_restricted
    area = "restricted area " if fence.is_restricted else ""
    pending.append(
        _alert_values(
            fence.organisation_id,
            AlertType.GEOFENCE_ENTRY if entered else AlertType.GEOFENCE_EXIT,
            AlertSeverity.CRITICAL if restricted else AlertSeverity.INFO,
            f"{registration} {'entered' if entered else 'left'} {fence.name}",
            f"{registration} {'entered' if entered else 'left'} {area}{fence.name}.",
            position.recorded_at,
            vehicle_id=reading.vehicle_id,
            geofence_id=fence.id,
            is_simulated=reading.is_simulated,
        )
    )


def _check_movement(
    db: Session,
    organisation_id: uuid.UUID,
    readings: list[Reading],
    previous: dict[uuid.UUID, Any],
    registrations: dict[uuid.UUID, str],
    limit: int | None,
    pending: list[dict[str, Any]],
) -> None:
    now = utcnow()
    last = dict(previous)
    calm: set[uuid.UUID] = set()
    ignition_on: set[uuid.UUID] = set()
    for reading in readings:
        position = reading.position
        vehicle_id = reading.vehicle_id
        assert position.recorded_at is not None  # noqa: S101
        before = last.get(vehicle_id)
        if before is not None and position.recorded_at <= before["recorded_at"]:
            continue
        last[vehicle_id] = {
            "recorded_at": position.recorded_at,
            "latitude": position.latitude,
            "longitude": position.longitude,
            "speed_kph": position.speed_kph,
            "ignition_on": position.ignition_on,
            "signal_status": position.signal_status,
        }
        registration = registrations.get(vehicle_id, "A vehicle")
        current = now - position.recorded_at <= ALERT_MAX_AGE
        usable = position.signal_status not in UNRELIABLE_SIGNALS

        if limit is not None and position.speed_kph is not None and usable:
            if position.speed_kph <= limit:
                calm.add(vehicle_id)
            elif (
                current
                and before is not None
                and before["speed_kph"] is not None
                and before["speed_kph"] > limit
                and before["signal_status"] not in UNRELIABLE_SIGNALS
                and position.recorded_at - before["recorded_at"] <= SPEEDING_CONFIRM_WINDOW
            ):
                calm.discard(vehicle_id)
                pending.append(
                    _alert_values(
                        organisation_id,
                        AlertType.SPEEDING,
                        AlertSeverity.WARNING,
                        f"{registration} over the speed limit",
                        f"{registration} reported {position.speed_kph} km/h. "
                        f"Your limit is {limit} km/h.",
                        position.recorded_at,
                        vehicle_id=vehicle_id,
                        is_simulated=reading.is_simulated,
                        dedupe_key=f"speeding:{vehicle_id}",
                    )
                )

        if position.ignition_on is True:
            ignition_on.add(vehicle_id)
        if position.ignition_on is False and current and usable:
            moved = (
                before is not None
                and before["ignition_on"] is False
                and distance_km(
                    float(before["latitude"]),
                    float(before["longitude"]),
                    float(position.latitude or 0),
                    float(position.longitude or 0),
                )
                >= UNUSUAL_DISTANCE_KM
            )
            fast = position.speed_kph is not None and position.speed_kph >= UNUSUAL_SPEED_KPH
            if moved or fast:
                ignition_on.discard(vehicle_id)
                pending.append(
                    _alert_values(
                        organisation_id,
                        AlertType.UNUSUAL_MOVEMENT,
                        AlertSeverity.CRITICAL,
                        f"{registration} moving with the ignition off",
                        f"{registration} reported movement while its ignition was off. "
                        "It may be being towed or moved without authorisation.",
                        position.recorded_at,
                        vehicle_id=vehicle_id,
                        is_simulated=reading.is_simulated,
                        dedupe_key=f"unusual:{vehicle_id}",
                    )
                )
    # Resolved first, so a condition that ended and began again in one batch raises a new alert.
    if calm:
        _resolve(db, organisation_id, AlertType.SPEEDING, calm)
    if ignition_on:
        _resolve(db, organisation_id, AlertType.UNUSUAL_MOVEMENT, ignition_on)


def evaluate_positions(
    db: Session,
    organisation_id: uuid.UUID,
    readings: list[Reading],
    previous: dict[uuid.UUID, Any],
) -> None:
    """Runs in the ingestion transaction, so positions and their events commit together.

    A fault here must never lose positions, so it's confined to a savepoint.
    """
    if not readings:
        return
    readings = sorted(
        readings,
        key=lambda item: item.position.recorded_at,  # type: ignore[arg-type,return-value]
    )
    try:
        with db.begin_nested():
            vehicle_ids = {reading.vehicle_id for reading in readings}
            # Reporting again ends an offline alert.
            _resolve(db, organisation_id, AlertType.VEHICLE_OFFLINE, vehicle_ids)
            registrations = dict(
                db.exec(
                    select(Vehicle.id, Vehicle.registration_number).where(
                        Vehicle.organisation_id == organisation_id,
                        col(Vehicle.id).in_(vehicle_ids),
                    )
                ).all()
            )
            limit = get_settings_row(db, organisation_id).speed_limit_kph
            pending: list[dict[str, Any]] = []
            _check_geofences(db, organisation_id, readings, previous, registrations, pending)
            _check_movement(db, organisation_id, readings, previous, registrations, limit, pending)
            _raise(db, pending)
    except SQLAlchemyError as exc:
        logger.error("alert_evaluation_failed", error_type=type(exc).__name__)


def _sweep_offline(db: Session, organisation_id: uuid.UUID, minutes: int) -> int:
    # A vehicle whose ignition was last off is parked, and many devices sleep while parked.
    rows = db.execute(
        text(
            """
            SELECT v.id, v.registration_number, l.recorded_at, l.is_simulated
            FROM vehicle_latest_locations l
            JOIN vehicles v ON v.id = l.vehicle_id AND v.organisation_id = l.organisation_id
            WHERE l.organisation_id = :org
              AND l.recorded_at < :cutoff
              AND COALESCE(l.ignition_on, true)
              AND v.archived_at IS NULL
              AND v.status NOT IN ('maintenance', 'out_of_service')
              AND EXISTS (
                  SELECT 1 FROM tracking_devices d
                  WHERE d.organisation_id = v.organisation_id AND d.vehicle_id = v.id
                    AND d.status = 'active'
              )
            """
        ),
        {"org": organisation_id, "cutoff": utcnow() - timedelta(minutes=minutes)},
    ).all()
    _raise(
        db,
        [
            _alert_values(
                organisation_id,
                AlertType.VEHICLE_OFFLINE,
                AlertSeverity.WARNING,
                f"{registration} has stopped reporting",
                f"No position received from {registration} for over {minutes} minutes.",
                recorded_at + timedelta(minutes=minutes),
                vehicle_id=vehicle_id,
                is_simulated=is_simulated,
                dedupe_key=f"offline:{vehicle_id}",
            )
            for vehicle_id, registration, recorded_at, is_simulated in rows
        ],
    )
    return len(rows)


def _sweep_licences(db: Session, organisation_id: uuid.UUID, today: date) -> None:
    drivers = db.exec(
        select(Driver).where(
            Driver.organisation_id == organisation_id,
            col(Driver.archived_at).is_(None),
            col(Driver.licence_expires_on).is_not(None),
            col(Driver.licence_expires_on) <= today + timedelta(days=LICENCE_WARNING_DAYS),
        )
    ).all()
    wanted: set[str] = set()
    pending: list[dict[str, Any]] = []
    now = utcnow()
    for driver in drivers:
        name = f"{driver.first_name} {driver.last_name}"
        expiry = driver.licence_expires_on
        assert expiry is not None  # noqa: S101  (filtered above)
        if expiry < today:
            key = f"licence_expired:{driver.id}:{expiry}"
            severity, title = AlertSeverity.CRITICAL, f"{name}'s licence has expired"
        else:
            key = f"licence_expiring:{driver.id}:{expiry}"
            severity, title = AlertSeverity.WARNING, f"{name}'s licence expires soon"
        wanted.add(key)
        pending.append(
            _alert_values(
                organisation_id,
                AlertType.LICENCE_EXPIRY,
                severity,
                title,
                f"Licence expiry date: {expiry.isoformat()}.",
                now,
                driver_id=driver.id,
                dedupe_key=key,
            )
        )
    _raise(db, pending)
    # Renewed, archived or moved on to "expired": the older alert no longer applies.
    _resolve_except(db, organisation_id, AlertType.LICENCE_EXPIRY, wanted)


def _resolve_except(
    db: Session, organisation_id: uuid.UUID, alert_type: AlertType, wanted: set[str]
) -> None:
    now = utcnow()
    open_alerts = db.exec(
        select(Alert).where(
            Alert.organisation_id == organisation_id,
            Alert.alert_type == alert_type,
            col(Alert.resolved_at).is_(None),
        )
    ).all()
    for alert in open_alerts:
        if alert.dedupe_key not in wanted:
            alert.resolved_at = now
            db.add(alert)


def document_state(expires_on: date | None, today: date) -> str:
    if expires_on is None:
        return "no_expiry"
    if expires_on < today:
        return "expired"
    return "expiring" if expires_on <= today + timedelta(days=DOCUMENT_WARNING_DAYS) else "valid"


def resolve_alert_key(db: Session, organisation_id: uuid.UUID, key: str) -> None:
    db.execute(
        update(Alert)
        .where(
            col(Alert.organisation_id) == organisation_id,
            col(Alert.dedupe_key) == key,
            col(Alert.resolved_at).is_(None),
        )
        .values(resolved_at=utcnow())
    )


def _sweep_documents(db: Session, organisation_id: uuid.UUID, today: date) -> None:
    rows = db.exec(
        select(ComplianceDocument, Vehicle.registration_number, Driver.first_name, Driver.last_name)
        .join(
            Vehicle,
            (col(Vehicle.id) == ComplianceDocument.vehicle_id)
            & (col(Vehicle.organisation_id) == ComplianceDocument.organisation_id),
            isouter=True,
        )
        .join(
            Driver,
            (col(Driver.id) == ComplianceDocument.driver_id)
            & (col(Driver.organisation_id) == ComplianceDocument.organisation_id),
            isouter=True,
        )
        .where(
            ComplianceDocument.organisation_id == organisation_id,
            col(ComplianceDocument.archived_at).is_(None),
            col(ComplianceDocument.expires_on).is_not(None),
            col(ComplianceDocument.expires_on) <= today + timedelta(days=DOCUMENT_WARNING_DAYS),
        )
    ).all()
    wanted: set[str] = set()
    pending: list[dict[str, Any]] = []
    now = utcnow()
    for document, registration, first_name, last_name in rows:
        expiry = document.expires_on
        assert expiry is not None  # noqa: S101  (filtered above)
        # An archived or sold vehicle's or former driver's paperwork needs no reminder.
        if document.vehicle_id is not None and registration is None:
            continue
        owner = registration or f"{first_name} {last_name}"
        expired = expiry < today
        key = f"document:{document.id}:{'expired' if expired else 'expiring'}:{expiry}"
        wanted.add(key)
        pending.append(
            _alert_values(
                organisation_id,
                AlertType.DOCUMENT_EXPIRY,
                AlertSeverity.CRITICAL if expired else AlertSeverity.WARNING,
                f"{owner}: {document.title} {'has expired' if expired else 'expires soon'}",
                f"Expiry date: {expiry.isoformat()}.",
                now,
                vehicle_id=document.vehicle_id,
                driver_id=document.driver_id,
                dedupe_key=key,
            )
        )
    _raise(db, pending)
    _resolve_except(db, organisation_id, AlertType.DOCUMENT_EXPIRY, wanted)


def _sweep_maintenance(db: Session, organisation_id: uuid.UUID, today: date) -> None:
    rows = db.exec(
        select(MaintenanceSchedule, Vehicle)
        .join(
            Vehicle,
            (col(Vehicle.id) == MaintenanceSchedule.vehicle_id)
            & (col(Vehicle.organisation_id) == MaintenanceSchedule.organisation_id),
        )
        .where(
            MaintenanceSchedule.organisation_id == organisation_id,
            col(MaintenanceSchedule.archived_at).is_(None),
            col(Vehicle.archived_at).is_(None),
        )
    ).all()
    wanted: set[str] = set()
    pending: list[dict[str, Any]] = []
    now = utcnow()
    for schedule, vehicle in rows:
        due = due_state(schedule, vehicle.odometer_km, today)
        if due.state == "ok":
            continue
        # Includes the due point, so a completed service raises a new alert next time round.
        key = f"maintenance:{schedule.id}:{due.state}:{due.next_due_on}:{due.next_due_km}"
        wanted.add(key)
        points = [
            *([f"on {due.next_due_on.isoformat()}"] if due.next_due_on else []),
            *([f"at {due.next_due_km} km"] if due.next_due_km is not None else []),
        ]
        overdue = due.state == "overdue"
        pending.append(
            _alert_values(
                organisation_id,
                AlertType.MAINTENANCE_DUE,
                AlertSeverity.CRITICAL if overdue else AlertSeverity.WARNING,
                f"{vehicle.registration_number}: {schedule.name} "
                f"{'is overdue' if overdue else 'is due soon'}",
                f"Due {' or '.join(points)}. Odometer on record: {vehicle.odometer_km} km.",
                now,
                vehicle_id=vehicle.id,
                dedupe_key=key,
            )
        )
    _raise(db, pending)
    _resolve_except(db, organisation_id, AlertType.MAINTENANCE_DUE, wanted)


def sweep(db: Session) -> int:
    """Finds conditions that positions can't reveal, such as a vehicle going silent."""
    organisations = db.execute(text("SELECT * FROM alert_sweep_organisations()")).all()
    raised = 0
    for organisation_id, timezone in organisations:
        try:
            set_db_context(db, organisation_id=organisation_id)
            settings = get_settings_row(db, organisation_id)
            if settings.offline_alerts_enabled:
                raised += _sweep_offline(db, organisation_id, settings.offline_minutes)
            today = datetime.now(ZoneInfo(timezone)).date()
            if settings.licence_alerts_enabled:
                _sweep_licences(db, organisation_id, today)
            else:
                _resolve(db, organisation_id, AlertType.LICENCE_EXPIRY)
            if settings.document_alerts_enabled:
                _sweep_documents(db, organisation_id, today)
            else:
                _resolve(db, organisation_id, AlertType.DOCUMENT_EXPIRY)
            if settings.maintenance_alerts_enabled:
                _sweep_maintenance(db, organisation_id, today)
            else:
                _resolve(db, organisation_id, AlertType.MAINTENANCE_DUE)
            db.commit()
        except SQLAlchemyError as exc:
            # One organisation's problem shouldn't stop the others' alerts.
            db.rollback()
            logger.error(
                "alert_sweep_failed", organisation_id=str(organisation_id), error=type(exc).__name__
            )
    return raised


def list_alerts(
    db: Session,
    organisation_id: uuid.UUID,
    *,
    state: str,
    alert_type: AlertType | None,
    severity: AlertSeverity | None,
    page: int,
    page_size: int,
) -> tuple[list[Any], int]:
    query = (
        select(Alert, Vehicle.registration_number)
        .join(
            Vehicle,
            (col(Vehicle.id) == Alert.vehicle_id)
            & (col(Vehicle.organisation_id) == Alert.organisation_id),
            isouter=True,
        )
        .where(Alert.organisation_id == organisation_id)
    )
    if state == "active":
        query = query.where(col(Alert.resolved_at).is_(None))
    elif state == "unacknowledged":
        query = query.where(col(Alert.resolved_at).is_(None), col(Alert.acknowledged_at).is_(None))
    elif state == "resolved":
        query = query.where(col(Alert.resolved_at).is_not(None))
    if alert_type:
        query = query.where(Alert.alert_type == alert_type)
    if severity:
        query = query.where(Alert.severity == severity)
    total = db.exec(select(func.count()).select_from(query.subquery())).one()
    rows = db.exec(
        query.order_by(col(Alert.occurred_at).desc(), col(Alert.id))
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return list(rows), total


def summary(db: Session, organisation_id: uuid.UUID) -> tuple[int, int]:
    rows = db.exec(
        select(Alert.severity, func.count())
        .where(
            Alert.organisation_id == organisation_id,
            col(Alert.resolved_at).is_(None),
            col(Alert.acknowledged_at).is_(None),
        )
        .group_by(col(Alert.severity))
    ).all()
    counts = dict(rows)
    return sum(counts.values()), counts.get(AlertSeverity.CRITICAL, 0)


def _get(db: Session, organisation_id: uuid.UUID, alert_id: uuid.UUID) -> Alert:
    alert = db.exec(
        select(Alert)
        .where(Alert.id == alert_id, Alert.organisation_id == organisation_id)
        .with_for_update()
    ).first()
    if alert is None:
        raise ApiError(404, "not_found", "Alert not found.")
    return alert


def acknowledge(
    db: Session, organisation_id: uuid.UUID, alert_id: uuid.UUID, actor_id: uuid.UUID
) -> Alert:
    alert = _get(db, organisation_id, alert_id)
    if alert.acknowledged_at is not None:
        return alert
    now = utcnow()
    alert.acknowledged_at = now
    alert.acknowledged_by_user_id = actor_id
    # An entry or exit is a moment rather than a condition, so seeing it closes it.
    if alert.dedupe_key is None:
        alert.resolved_at = alert.resolved_at or now
    db.add(alert)
    record_audit(
        db,
        "alert.acknowledged",
        actor_user_id=actor_id,
        organisation_id=organisation_id,
        entity_type="alert",
        entity_id=alert.id,
    )
    db.commit()
    return alert


def resolve(
    db: Session, organisation_id: uuid.UUID, alert_id: uuid.UUID, actor_id: uuid.UUID
) -> Alert:
    alert = _get(db, organisation_id, alert_id)
    if alert.resolved_at is not None:
        return alert
    alert.resolved_at = utcnow()
    db.add(alert)
    record_audit(
        db,
        "alert.resolved",
        actor_user_id=actor_id,
        organisation_id=organisation_id,
        entity_type="alert",
        entity_id=alert.id,
    )
    db.commit()
    return alert
