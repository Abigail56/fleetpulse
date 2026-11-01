import secrets
import uuid
from decimal import Decimal
from typing import Any

from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, col, select

from app.core.config import Settings
from app.core.errors import ApiError
from app.core.security import hash_token
from app.integrations.gps.base import RawPosition
from app.integrations.gps.registry import ADAPTERS, GENERIC_PROVIDER, SIMULATOR_PROVIDER
from app.models import GpsIntegration, TrackingDevice, Vehicle
from app.models.base import utcnow
from app.models.enums import GpsSignalStatus
from app.services.audit import record_audit
from app.services.telemetry import ingest_positions

KEY_PREFIX = "fpgps_"
VISIBLE_KEY_CHARACTERS = 12


def _commit_or_conflict(db: Session) -> None:
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        message = str(exc.orig)
        if "vehicle_id_active" in message:
            raise ApiError(
                409, "vehicle_has_device", "That vehicle already has an active device."
            ) from exc
        if "external_device_id" in message:
            raise ApiError(
                409, "duplicate_device", "This device ID is already registered."
            ) from exc
        raise


def _device_not_found() -> ApiError:
    return ApiError(404, "not_found", "Device not found.")


def _require_vehicle(db: Session, organisation_id: uuid.UUID, vehicle_id: uuid.UUID) -> None:
    vehicle = db.exec(
        select(Vehicle).where(Vehicle.id == vehicle_id, Vehicle.organisation_id == organisation_id)
    ).first()
    if vehicle is None:
        raise ApiError(404, "not_found", "Vehicle not found.")
    if vehicle.archived_at is not None:
        raise ApiError(409, "vehicle_archived", "An archived vehicle can't have a device.")


def list_integrations(db: Session, organisation_id: uuid.UUID) -> list[GpsIntegration]:
    statement = (
        select(GpsIntegration)
        .where(
            GpsIntegration.organisation_id == organisation_id,
            col(GpsIntegration.revoked_at).is_(None),
        )
        .order_by(col(GpsIntegration.created_at).desc())
    )
    return list(db.exec(statement).all())


def create_integration(
    db: Session, organisation_id: uuid.UUID, actor_id: uuid.UUID, name: str
) -> tuple[GpsIntegration, str]:
    """The key is returned once, here, and can never be shown again."""
    key = f"{KEY_PREFIX}{secrets.token_urlsafe(40)}"
    integration = GpsIntegration(
        organisation_id=organisation_id,
        name=name,
        provider=GENERIC_PROVIDER,
        key_hash=hash_token(key),
        key_prefix=key[:VISIBLE_KEY_CHARACTERS],
        created_by_user_id=actor_id,
    )
    db.add(integration)
    record_audit(
        db,
        "gps_integration.created",
        actor_user_id=actor_id,
        organisation_id=organisation_id,
        entity_type="gps_integration",
        entity_id=integration.id,
    )
    db.commit()
    db.refresh(integration)
    return integration, key


def revoke_integration(
    db: Session, organisation_id: uuid.UUID, actor_id: uuid.UUID, integration_id: uuid.UUID
) -> None:
    integration = db.exec(
        select(GpsIntegration).where(
            GpsIntegration.id == integration_id,
            GpsIntegration.organisation_id == organisation_id,
            col(GpsIntegration.revoked_at).is_(None),
        )
    ).first()
    if integration is None:
        raise ApiError(404, "not_found", "Integration not found.")
    integration.revoked_at = utcnow()
    record_audit(
        db,
        "gps_integration.revoked",
        actor_user_id=actor_id,
        organisation_id=organisation_id,
        entity_type="gps_integration",
        entity_id=integration.id,
    )
    db.commit()


def list_devices(
    db: Session, organisation_id: uuid.UUID
) -> list[tuple[TrackingDevice, str | None]]:
    rows = db.exec(
        select(TrackingDevice, Vehicle.registration_number)
        .join(Vehicle, col(Vehicle.id) == col(TrackingDevice.vehicle_id), isouter=True)
        .where(TrackingDevice.organisation_id == organisation_id)
        .order_by(col(TrackingDevice.created_at).desc())
    ).all()
    return [(row[0], row[1]) for row in rows]


def create_device(
    db: Session,
    settings: Settings,
    organisation_id: uuid.UUID,
    actor_id: uuid.UUID,
    *,
    external_device_id: str | None,
    vehicle_id: uuid.UUID | None,
    simulated: bool,
    start_latitude: float | None,
    start_longitude: float | None,
) -> TrackingDevice:
    if simulated and not settings.gps_simulator_enabled:
        raise ApiError(409, "simulator_disabled", "Simulated tracking is turned off.")
    if vehicle_id is not None:
        _require_vehicle(db, organisation_id, vehicle_id)
    device = TrackingDevice(
        organisation_id=organisation_id,
        vehicle_id=vehicle_id,
        provider=SIMULATOR_PROVIDER if simulated else GENERIC_PROVIDER,
        external_device_id=external_device_id or f"sim-{uuid.uuid4().hex[:12]}",
        is_simulated=simulated,
    )
    db.add(device)
    record_audit(
        db,
        "tracking_device.created",
        actor_user_id=actor_id,
        organisation_id=organisation_id,
        entity_type="tracking_device",
        entity_id=device.id,
        details={"simulated": simulated},
    )
    _commit_or_conflict(db)
    db.refresh(device)
    if simulated and start_latitude is not None and start_longitude is not None:
        # The simulator moves vehicles from their last position, so it needs a first one.
        ingest_positions(
            db,
            settings,
            organisation_id,
            SIMULATOR_PROVIDER,
            [
                RawPosition(
                    device_id=device.external_device_id,
                    recorded_at=utcnow(),
                    latitude=start_latitude,
                    longitude=start_longitude,
                    speed_kph=Decimal("0"),
                    heading_degrees=Decimal("0"),
                    ignition_on=True,
                    signal_status=GpsSignalStatus.GOOD,
                )
            ],
        )
        db.refresh(device)
    return device


def update_device(
    db: Session,
    organisation_id: uuid.UUID,
    actor_id: uuid.UUID,
    device_id: uuid.UUID,
    changes: dict[str, Any],
) -> TrackingDevice:
    device = db.exec(
        select(TrackingDevice)
        .where(TrackingDevice.id == device_id, TrackingDevice.organisation_id == organisation_id)
        .with_for_update()
    ).first()
    if device is None:
        raise _device_not_found()
    if changes.get("vehicle_id") is not None:
        _require_vehicle(db, organisation_id, changes["vehicle_id"])
    if (
        "vehicle_id" in changes
        and changes["vehicle_id"] is not None
        and device.vehicle_id != changes["vehicle_id"]
    ):
        device.reassigned_at = utcnow()
    for field, value in changes.items():
        setattr(device, field, value)
    record_audit(
        db,
        "tracking_device.updated",
        actor_user_id=actor_id,
        organisation_id=organisation_id,
        entity_type="tracking_device",
        entity_id=device.id,
        details={"fields": sorted(changes)},
    )
    _commit_or_conflict(db)
    db.refresh(device)
    return device


def adapter_for(provider: str) -> Any:
    return ADAPTERS.get(provider)


def touch_integration(db: Session, integration_id: uuid.UUID) -> None:
    integration = db.get(GpsIntegration, integration_id)
    if integration is not None:
        integration.last_used_at = utcnow()
        db.commit()
