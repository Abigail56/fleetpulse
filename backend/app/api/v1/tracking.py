import json
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, Query, Request, status
from sqlalchemy import text
from starlette.concurrency import run_in_threadpool

from app.api.deps import DbDep, RedisDep, SettingsDep, TenantContext, require_permission
from app.core import rate_limit
from app.core.config import Settings
from app.core.errors import ApiError
from app.core.permissions import Permission, role_has_permission
from app.core.security import hash_token
from app.db.session import set_db_context
from app.integrations.gps.base import InvalidPayload
from app.models import GpsIntegration
from app.schemas.tracking import (
    DeviceCreate,
    DeviceResponse,
    DeviceUpdate,
    FleetVehicleResponse,
    IngestResponse,
    IntegrationCreate,
    IntegrationCreated,
    IntegrationResponse,
    JourneyResponse,
    LatestPositionResponse,
    PositionResponse,
    TrackingConfig,
)
from app.services import telemetry, tracking
from app.services.vehicles import get_vehicle

router = APIRouter(tags=["tracking"])

CanView = Annotated[TenantContext, Depends(require_permission(Permission.VEHICLES_VIEW))]
CanManage = Annotated[TenantContext, Depends(require_permission(Permission.VEHICLES_MANAGE))]
# Keys let someone write positions for the whole fleet, so they're for organisation managers.
CanManageKeys = Annotated[
    TenantContext, Depends(require_permission(Permission.ORGANISATION_MANAGE))
]

MAX_BODY_BYTES = 1_000_000
MAX_HISTORY_POINTS = 5000
MAX_RANGE_DAYS = 31
JOURNEY_POINT_LIMIT = 20000
MINUTE_SECONDS = 60


def _invalid_key() -> ApiError:
    return ApiError(401, "invalid_key", "This key isn't valid.")


def _integration_response(item: GpsIntegration) -> IntegrationResponse:
    return IntegrationResponse(
        id=item.id,
        name=item.name,
        provider=item.provider,
        key_prefix=item.key_prefix,
        created_at=item.created_at,
        last_used_at=item.last_used_at,
    )


def _latest_response(row: Any, settings: Settings) -> LatestPositionResponse:
    age = datetime.now(UTC) - row["recorded_at"]
    return LatestPositionResponse(
        **row, is_stale=age > timedelta(minutes=settings.gps_stale_minutes)
    )


def _range(start: datetime, end: datetime) -> None:
    if start.tzinfo is None or end.tzinfo is None:
        raise ApiError(400, "invalid_range", "Dates must include a time zone.")
    if end <= start or end - start > timedelta(days=MAX_RANGE_DAYS):
        raise ApiError(400, "invalid_range", f"Choose a range of up to {MAX_RANGE_DAYS} days.")


@router.post("/ingest/gps", status_code=status.HTTP_202_ACCEPTED)
async def ingest_gps(
    request: Request,
    db: DbDep,
    redis: RedisDep,
    settings: SettingsDep,
    authorization: Annotated[str | None, Header()] = None,
) -> IngestResponse:
    """For tracking providers, not browsers: the key is the only credential, not cookies."""
    if authorization is None or not authorization.startswith("Bearer "):
        raise _invalid_key()
    body = await request.body()
    if len(body) > MAX_BODY_BYTES:
        raise ApiError(413, "payload_too_large", "Send fewer positions at a time.")

    def work() -> IngestResponse:
        found = (
            db.execute(
                text("SELECT * FROM gps_integration_for_key(:key_hash)"),
                {"key_hash": hash_token(authorization.removeprefix("Bearer ").strip())},
            )
            .mappings()
            .first()
        )
        if found is None:
            raise _invalid_key()
        adapter = tracking.adapter_for(found["provider"])
        if adapter is None:
            raise ApiError(409, "provider_unavailable", "This provider isn't supported.")
        rate_limit.enforce_limit(
            redis,
            rate_limit.hashed_key("gps_ingest:integration", str(found["id"])),
            settings.gps_requests_per_minute,
            MINUTE_SECONDS,
        )
        try:
            positions = adapter.parse(json.loads(body))
        except (InvalidPayload, ValueError) as exc:
            raise ApiError(400, "invalid_payload", str(exc)[:200]) from exc
        set_db_context(db, organisation_id=found["organisation_id"])
        result = telemetry.ingest_positions(
            db, settings, found["organisation_id"], found["provider"], positions
        )
        tracking.touch_integration(db, found["id"])
        return IngestResponse(
            accepted=result.accepted, duplicates=result.duplicates, rejected=result.rejected
        )

    return await run_in_threadpool(work)


@router.get("/tracking/config")
def tracking_config(_tenant: CanView, settings: SettingsDep) -> TrackingConfig:
    return TrackingConfig(
        simulator_enabled=settings.gps_simulator_enabled,
        stale_minutes=settings.gps_stale_minutes,
        offline_minutes=settings.gps_offline_minutes,
    )


@router.get("/tracking/integrations")
def list_integrations(tenant: CanManageKeys, db: DbDep) -> list[IntegrationResponse]:
    return [
        _integration_response(item)
        for item in tracking.list_integrations(db, tenant.organisation.id)
    ]


@router.post("/tracking/integrations", status_code=status.HTTP_201_CREATED)
def create_integration(
    body: IntegrationCreate, tenant: CanManageKeys, db: DbDep
) -> IntegrationCreated:
    item, key = tracking.create_integration(db, tenant.organisation.id, tenant.user.id, body.name)
    return IntegrationCreated(**_integration_response(item).model_dump(), key=key)


@router.delete("/tracking/integrations/{integration_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_integration(integration_id: uuid.UUID, tenant: CanManageKeys, db: DbDep) -> None:
    tracking.revoke_integration(db, tenant.organisation.id, tenant.user.id, integration_id)


@router.get("/tracking/devices")
def list_devices(tenant: CanView, db: DbDep) -> list[DeviceResponse]:
    return [
        DeviceResponse(
            id=device.id,
            provider=device.provider,
            external_device_id=device.external_device_id,
            vehicle_id=device.vehicle_id,
            registration_number=registration,
            status=device.status,
            is_simulated=device.is_simulated,
            last_seen_at=device.last_seen_at,
        )
        for device, registration in tracking.list_devices(db, tenant.organisation.id)
    ]


def _one_device(db: DbDep, tenant: TenantContext, device_id: uuid.UUID) -> DeviceResponse:
    for response in list_devices(tenant, db):
        if response.id == device_id:
            return response
    raise ApiError(404, "not_found", "Device not found.")


@router.post("/tracking/devices", status_code=status.HTTP_201_CREATED)
def create_device(
    body: DeviceCreate, tenant: CanManage, db: DbDep, settings: SettingsDep
) -> DeviceResponse:
    device = tracking.create_device(
        db,
        settings,
        tenant.organisation.id,
        tenant.user.id,
        external_device_id=None if body.simulated else body.external_device_id,
        vehicle_id=body.vehicle_id,
        simulated=body.simulated,
        start_latitude=body.start_latitude,
        start_longitude=body.start_longitude,
    )
    return _one_device(db, tenant, device.id)


@router.patch("/tracking/devices/{device_id}")
def update_device(
    device_id: uuid.UUID, body: DeviceUpdate, tenant: CanManage, db: DbDep
) -> DeviceResponse:
    tracking.update_device(
        db,
        tenant.organisation.id,
        tenant.user.id,
        device_id,
        body.model_dump(exclude_unset=True),
    )
    return _one_device(db, tenant, device_id)


@router.get("/tracking/fleet")
def fleet(tenant: CanView, db: DbDep) -> list[FleetVehicleResponse]:
    include_drivers = role_has_permission(tenant.membership.role, Permission.DRIVERS_VIEW)
    rows = telemetry.fleet_positions(db, tenant.organisation.id, include_drivers)
    return [FleetVehicleResponse(**row) for row in rows]


@router.get("/tracking/latest")
def latest_positions(
    tenant: CanView, db: DbDep, settings: SettingsDep
) -> list[LatestPositionResponse]:
    return [
        _latest_response(row, settings)
        for row in telemetry.latest_positions(db, tenant.organisation.id)
    ]


@router.get("/tracking/vehicles/{vehicle_id}/latest")
def vehicle_latest(
    vehicle_id: uuid.UUID, tenant: CanView, db: DbDep, settings: SettingsDep
) -> LatestPositionResponse | None:
    get_vehicle(db, tenant.organisation.id, vehicle_id)
    row = telemetry.latest_position(db, tenant.organisation.id, vehicle_id)
    return None if row is None else _latest_response(row, settings)


@router.get("/tracking/vehicles/{vehicle_id}/history")
def vehicle_history(
    vehicle_id: uuid.UUID,
    tenant: CanView,
    db: DbDep,
    start: datetime,
    end: datetime,
    limit: Annotated[int, Query(ge=1, le=MAX_HISTORY_POINTS)] = 1000,
) -> list[PositionResponse]:
    _range(start, end)
    get_vehicle(db, tenant.organisation.id, vehicle_id)
    rows = telemetry.position_history(db, tenant.organisation.id, vehicle_id, start, end, limit)
    return [PositionResponse(**row) for row in rows]


@router.get("/tracking/vehicles/{vehicle_id}/journeys")
def vehicle_journeys(
    vehicle_id: uuid.UUID,
    tenant: CanView,
    db: DbDep,
    settings: SettingsDep,
    start: datetime,
    end: datetime,
) -> list[JourneyResponse]:
    _range(start, end)
    get_vehicle(db, tenant.organisation.id, vehicle_id)
    rows = telemetry.position_history(
        db, tenant.organisation.id, vehicle_id, start, end, JOURNEY_POINT_LIMIT
    )
    journeys = telemetry.reconstruct_journeys(
        rows, timedelta(minutes=settings.gps_journey_gap_minutes)
    )
    return [
        JourneyResponse(
            started_at=journey.started_at,
            ended_at=journey.ended_at,
            distance_km=round(journey.distance_km, 2),
            points=journey.points,
            is_simulated=journey.is_simulated,
        )
        for journey in journeys
    ]
