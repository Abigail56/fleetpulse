import math
import random
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import text
from sqlmodel import Session, col, select

from app.core.config import Settings
from app.db.session import set_db_context
from app.integrations.gps.base import RawPosition
from app.models import TrackingDevice, Vehicle
from app.models.base import utcnow
from app.models.enums import GpsSignalStatus, TrackingDeviceStatus
from app.services.alerts import Reading, evaluate_positions, previous_positions
from app.services.fleet_stream import publish_positions
from app.services.geo import distance_km

_LOCATION_COLUMNS = (
    "organisation_id, vehicle_id, device_id, recorded_at, location, "
    "speed_kph, heading_degrees, ignition_on, signal_status, is_simulated"
)
_ROWS_FROM_ARRAYS = """
    SELECT CAST(:org AS uuid), vehicle, device, recorded,
        ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography,
        speed, heading, ignition, signal, simulated
    FROM unnest(
        CAST(:vehicles AS uuid[]), CAST(:devices AS uuid[]), CAST(:recorded AS timestamptz[]),
        CAST(:lngs AS double precision[]), CAST(:lats AS double precision[]),
        CAST(:speeds AS numeric[]), CAST(:headings AS numeric[]), CAST(:ignitions AS boolean[]),
        CAST(:signals AS text[]), CAST(:simulated AS boolean[])
    ) AS row (vehicle, device, recorded, lng, lat, speed, heading, ignition, signal, simulated)
"""
# One statement per batch, because a round trip per position wouldn't keep up with large fleets.
INSERT_POSITIONS = text(
    f"""
    INSERT INTO vehicle_locations ({_LOCATION_COLUMNS}) {_ROWS_FROM_ARRAYS}
    ON CONFLICT (organisation_id, vehicle_id, recorded_at) DO NOTHING
    RETURNING vehicle_id, recorded_at
    """
)
# Only a newer position replaces the latest: providers can deliver late and out of order.
UPSERT_LATEST = text(
    f"""
    INSERT INTO vehicle_latest_locations ({_LOCATION_COLUMNS}) {_ROWS_FROM_ARRAYS}
    ON CONFLICT (vehicle_id) DO UPDATE SET
        device_id = EXCLUDED.device_id, recorded_at = EXCLUDED.recorded_at,
        received_at = now(), location = EXCLUDED.location, speed_kph = EXCLUDED.speed_kph,
        heading_degrees = EXCLUDED.heading_degrees, ignition_on = EXCLUDED.ignition_on,
        signal_status = EXCLUDED.signal_status, is_simulated = EXCLUDED.is_simulated
    WHERE EXCLUDED.recorded_at > vehicle_latest_locations.recorded_at
    """
)


def _array_parameters(
    organisation_id: uuid.UUID, rows: list[tuple[TrackingDevice, RawPosition]]
) -> dict[str, Any]:
    return {
        "org": organisation_id,
        "vehicles": [device.vehicle_id for device, _ in rows],
        "devices": [device.id for device, _ in rows],
        "recorded": [position.recorded_at for _, position in rows],
        "lngs": [position.longitude for _, position in rows],
        "lats": [position.latitude for _, position in rows],
        "speeds": [position.speed_kph for _, position in rows],
        "headings": [position.heading_degrees for _, position in rows],
        "ignitions": [position.ignition_on for _, position in rows],
        "signals": [position.signal_status.value for _, position in rows],
        # From the device record, never the request, so simulated data can't pass as real.
        "simulated": [device.is_simulated for device, _ in rows],
    }


@dataclass(frozen=True)
class IngestResult:
    accepted: int
    duplicates: int
    rejected: list[dict[str, Any]]


def _stream_position(device: TrackingDevice, position: RawPosition) -> dict[str, Any]:
    assert position.recorded_at is not None  # noqa: S101  (validated before storing)
    return {
        "vehicle_id": str(device.vehicle_id),
        "recorded_at": position.recorded_at.isoformat(),
        "latitude": position.latitude,
        "longitude": position.longitude,
        "speed_kph": None if position.speed_kph is None else str(position.speed_kph),
        "heading_degrees": (
            None if position.heading_degrees is None else str(position.heading_degrees)
        ),
        "ignition_on": position.ignition_on,
        "signal_status": position.signal_status.value,
        "is_simulated": device.is_simulated,
    }


def ingest_positions(
    db: Session,
    settings: Settings,
    organisation_id: uuid.UUID,
    provider: str,
    positions: list[RawPosition],
) -> IngestResult:
    now = utcnow()
    oldest = now - timedelta(days=settings.gps_max_position_age_days)
    newest = now + timedelta(seconds=settings.gps_max_future_seconds)
    wanted = {position.device_id for position in positions if position.device_id}
    devices = {
        device.external_device_id: device
        for device in db.exec(
            select(TrackingDevice).where(
                TrackingDevice.organisation_id == organisation_id,
                TrackingDevice.provider == provider,
                col(TrackingDevice.external_device_id).in_(wanted),
            )
        ).all()
    }
    vehicle_ids = {device.vehicle_id for device in devices.values() if device.vehicle_id}
    active_vehicles = set(
        db.exec(
            select(Vehicle.id).where(
                Vehicle.organisation_id == organisation_id,
                col(Vehicle.id).in_(vehicle_ids),
                col(Vehicle.archived_at).is_(None),
            )
        ).all()
    )

    rejected: list[dict[str, Any]] = []
    valid: list[tuple[TrackingDevice, RawPosition]] = []

    def reject(index: int, reason: str) -> None:
        rejected.append({"index": index, "reason": reason})

    for index, position in enumerate(positions):
        if position.error or position.recorded_at is None or position.device_id is None:
            reject(index, position.error or "invalid")
            continue
        device = devices.get(position.device_id)
        if device is None:
            reject(index, "unknown_device")
        elif device.status != TrackingDeviceStatus.ACTIVE:
            reject(index, "device_inactive")
        elif device.vehicle_id is None:
            reject(index, "device_not_assigned")
        elif device.vehicle_id not in active_vehicles:
            reject(index, "vehicle_archived")
        elif position.recorded_at > newest:
            # Also protects partitioning: far-future rows would land in the default partition.
            reject(index, "timestamp_in_future")
        elif position.recorded_at < oldest:
            reject(index, "timestamp_too_old")
        elif device.reassigned_at is not None and position.recorded_at < device.reassigned_at:
            # A late delivery from before the device moved belongs to its previous vehicle.
            reject(index, "recorded_before_reassignment")
        else:
            valid.append((device, position))

    if not valid:
        db.commit()
        return IngestResult(0, 0, rejected)

    inserted = {
        (row[0], row[1])
        for row in db.execute(INSERT_POSITIONS, _array_parameters(organisation_id, valid)).all()
    }
    newest_by_vehicle: dict[uuid.UUID, tuple[TrackingDevice, RawPosition]] = {}
    seen_at: dict[uuid.UUID, datetime] = {}
    for device, position in valid:
        if (device.vehicle_id, position.recorded_at) not in inserted:
            continue
        assert device.vehicle_id is not None  # noqa: S101  (checked above)
        assert position.recorded_at is not None  # noqa: S101  (checked above)
        best = newest_by_vehicle.get(device.vehicle_id)
        if best is None or position.recorded_at > best[1].recorded_at:  # type: ignore[operator]
            newest_by_vehicle[device.vehicle_id] = (device, position)
        if device.id not in seen_at or position.recorded_at > seen_at[device.id]:
            seen_at[device.id] = position.recorded_at
    readings = [
        Reading(device.vehicle_id, position, device.is_simulated)
        for device, position in valid
        if device.vehicle_id and (device.vehicle_id, position.recorded_at) in inserted
    ]
    previous = previous_positions(db, organisation_id, {item.vehicle_id for item in readings})
    if newest_by_vehicle:
        db.execute(
            UPSERT_LATEST, _array_parameters(organisation_id, list(newest_by_vehicle.values()))
        )
    evaluate_positions(db, organisation_id, readings, previous)
    for device in devices.values():
        recorded_at = seen_at.get(device.id)
        if recorded_at and (device.last_seen_at is None or recorded_at > device.last_seen_at):
            device.last_seen_at = recorded_at
    db.commit()
    if newest_by_vehicle:
        publish_positions(
            settings,
            organisation_id,
            [_stream_position(device, position) for device, position in newest_by_vehicle.values()],
        )
    accepted = len(inserted)
    return IngestResult(accepted, len(valid) - accepted, rejected)


POSITION_COLUMNS = """
    vehicle_id, device_id, recorded_at, received_at, ST_Y(location::geometry) AS latitude,
    ST_X(location::geometry) AS longitude, speed_kph, heading_degrees, ignition_on,
    signal_status, is_simulated
"""


def latest_positions(db: Session, organisation_id: uuid.UUID) -> list[Any]:
    return list(
        db.execute(
            text(
                f"""
                SELECT {POSITION_COLUMNS}, v.registration_number
                FROM vehicle_latest_locations l
                JOIN vehicles v ON v.id = l.vehicle_id AND v.organisation_id = l.organisation_id
                WHERE l.organisation_id = :org AND v.archived_at IS NULL
                ORDER BY v.registration_number
                """  # noqa: S608  (a constant column list; values are bound)
            ).bindparams(org=organisation_id)
        ).mappings()
    )


def latest_position(db: Session, organisation_id: uuid.UUID, vehicle_id: uuid.UUID) -> Any | None:
    return (
        db.execute(
            text(
                f"""
                SELECT {POSITION_COLUMNS} FROM vehicle_latest_locations
                WHERE organisation_id = :org AND vehicle_id = :vehicle
                """  # noqa: S608  (a constant column list; values are bound)
            ),
            {"org": organisation_id, "vehicle": vehicle_id},
        )
        .mappings()
        .first()
    )


def position_history(
    db: Session,
    organisation_id: uuid.UUID,
    vehicle_id: uuid.UUID,
    start: datetime,
    end: datetime,
    limit: int,
) -> list[Any]:
    """In time order. If there are more than `limit`, these are the newest ones."""
    rows = (
        db.execute(
            text(
                f"""
                SELECT {POSITION_COLUMNS} FROM vehicle_locations
                WHERE organisation_id = :org AND vehicle_id = :vehicle
                  AND recorded_at >= :start AND recorded_at < :end
                ORDER BY recorded_at DESC
                LIMIT :limit
                """  # noqa: S608  (a constant column list; values are bound)
            ),
            {
                "org": organisation_id,
                "vehicle": vehicle_id,
                "start": start,
                "end": end,
                "limit": limit,
            },
        )
        .mappings()
        .all()
    )
    return list(reversed(rows))


def fleet_positions(db: Session, organisation_id: uuid.UUID, include_drivers: bool) -> list[Any]:
    """Every current vehicle, with its latest position if it has ever reported."""
    return list(
        db.execute(
            text(
                """
                SELECT v.id AS id, v.registration_number, v.make, v.model,
                    v.status AS vehicle_status,
                    l.recorded_at, ST_Y(l.location::geometry) AS latitude,
                    ST_X(l.location::geometry) AS longitude, l.speed_kph, l.heading_degrees,
                    l.ignition_on, l.signal_status, COALESCE(l.is_simulated, false) AS is_simulated,
                    CASE WHEN :include_drivers THEN d.first_name || ' ' || d.last_name END
                        AS driver_name
                FROM vehicles v
                LEFT JOIN vehicle_latest_locations l
                    ON l.vehicle_id = v.id AND l.organisation_id = v.organisation_id
                LEFT JOIN vehicle_assignments a ON a.vehicle_id = v.id
                    AND a.organisation_id = v.organisation_id AND a.ended_at IS NULL
                LEFT JOIN drivers d ON d.id = a.driver_id
                    AND d.organisation_id = a.organisation_id
                WHERE v.organisation_id = :org AND v.archived_at IS NULL
                ORDER BY v.registration_number
                """
            ),
            {"org": organisation_id, "include_drivers": include_drivers},
        ).mappings()
    )


@dataclass
class Journey:
    started_at: datetime
    ended_at: datetime
    distance_km: float
    points: int
    is_simulated: bool


STOP_RADIUS_KM = 0.05


def reconstruct_journeys(rows: list[Any], gap: timedelta) -> list[Journey]:
    """Splits positions into journeys at reporting gaps, ignition off, and long stops.

    A stop counts when a vehicle stays within a small radius for longer than the gap, so this
    also works for devices that don't report ignition.
    """
    journeys: list[Journey] = []
    current: Journey | None = None
    previous: Any = None
    anchor: Any = None
    stopped = False
    for row in rows:
        if row["ignition_on"] is False:
            current = previous = anchor = None
            stopped = False
            continue
        if anchor is not None:
            moved = distance_km(
                anchor["latitude"], anchor["longitude"], row["latitude"], row["longitude"]
            )
            if moved >= STOP_RADIUS_KM:
                anchor = row
                if stopped:
                    stopped = False
                    current = previous = None
            elif row["recorded_at"] - anchor["recorded_at"] > gap:
                stopped = True
                current = None
                previous = row
                continue
            elif stopped:
                previous = row
                continue
        else:
            anchor = row
        if (
            current is None
            or previous is None
            or row["recorded_at"] - previous["recorded_at"] > gap
        ):
            current = Journey(row["recorded_at"], row["recorded_at"], 0.0, 1, row["is_simulated"])
            journeys.append(current)
        else:
            current.distance_km += distance_km(
                previous["latitude"], previous["longitude"], row["latitude"], row["longitude"]
            )
            current.ended_at = row["recorded_at"]
            current.points += 1
            current.is_simulated = current.is_simulated or row["is_simulated"]
        previous = row
    # A lone position isn't a journey.
    return [journey for journey in journeys if journey.points > 1]


# Simulator


SIMULATED_STEP_DEGREES = 0.002


def simulate_tick(db: Session, settings: Settings) -> int:
    """Moves each simulated vehicle a little. Does nothing unless explicitly enabled."""
    if not settings.gps_simulator_enabled:
        return 0
    rows = db.execute(text("SELECT * FROM simulated_tracking_devices()")).all()
    moved = 0
    for device_id, organisation_id in rows:
        set_db_context(db, organisation_id=organisation_id)
        device = db.get(TrackingDevice, device_id)
        if device is None or device.vehicle_id is None:
            continue
        latest = latest_position(db, organisation_id, device.vehicle_id)
        if latest is None:
            continue
        # Not security-sensitive: this only makes test data look like movement.
        heading = (float(latest["heading_degrees"] or 0) + random.uniform(-25, 25)) % 360  # noqa: S311
        latitude = max(
            -89.0,
            min(
                89.0, latest["latitude"] + SIMULATED_STEP_DEGREES * math.cos(math.radians(heading))
            ),
        )
        longitude = (
            (latest["longitude"] + SIMULATED_STEP_DEGREES * math.sin(math.radians(heading)) + 180)
            % 360
        ) - 180
        result = ingest_positions(
            db,
            settings,
            organisation_id,
            device.provider,
            [
                RawPosition(
                    device_id=device.external_device_id,
                    recorded_at=utcnow(),
                    latitude=latitude,
                    longitude=longitude,
                    speed_kph=Decimal(str(round(random.uniform(20, 70), 2))),  # noqa: S311
                    heading_degrees=round(Decimal(str(heading)), 2),
                    ignition_on=True,
                    signal_status=GpsSignalStatus.GOOD,
                )
            ],
        )
        moved += result.accepted
    return moved
