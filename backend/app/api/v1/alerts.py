import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query

from app.api.deps import DbDep, TenantContext, require_permission
from app.core.permissions import Permission
from app.models import Alert
from app.models.enums import AlertSeverity, AlertType
from app.schemas.alerts import (
    AlertList,
    AlertResponse,
    AlertSettingsResponse,
    AlertSettingsUpdate,
    AlertState,
    AlertSummary,
)
from app.services import alerts as service

router = APIRouter(prefix="/alerts", tags=["alerts"])

CanView = Annotated[TenantContext, Depends(require_permission(Permission.ALERTS_VIEW))]
CanManage = Annotated[TenantContext, Depends(require_permission(Permission.ALERTS_MANAGE))]
# Limits and switches shape what the whole organisation is told, so they go with geofences.
CanConfigure = Annotated[TenantContext, Depends(require_permission(Permission.GEOFENCES_MANAGE))]


def _to_response(alert: Alert, registration: str | None) -> AlertResponse:
    return AlertResponse(
        id=alert.id,
        alert_type=alert.alert_type,
        severity=alert.severity,
        title=alert.title,
        message=alert.message,
        occurred_at=alert.occurred_at,
        vehicle_id=alert.vehicle_id,
        vehicle_registration=registration,
        driver_id=alert.driver_id,
        geofence_id=alert.geofence_id,
        is_simulated=alert.is_simulated,
        acknowledged_at=alert.acknowledged_at,
        resolved_at=alert.resolved_at,
    )


def _settings_response(row: Any) -> AlertSettingsResponse:
    return AlertSettingsResponse(
        speed_limit_kph=row.speed_limit_kph,
        offline_alerts_enabled=row.offline_alerts_enabled,
        offline_minutes=row.offline_minutes,
        licence_alerts_enabled=row.licence_alerts_enabled,
        maintenance_alerts_enabled=row.maintenance_alerts_enabled,
        document_alerts_enabled=row.document_alerts_enabled,
    )


@router.get("")
def list_alerts(
    tenant: CanView,
    db: DbDep,
    state: AlertState = "active",
    alert_type: AlertType | None = None,
    severity: AlertSeverity | None = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 25,
) -> AlertList:
    rows, total = service.list_alerts(
        db,
        tenant.organisation.id,
        state=state,
        alert_type=alert_type,
        severity=severity,
        page=page,
        page_size=page_size,
    )
    return AlertList(
        items=[_to_response(alert, registration) for alert, registration in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/summary")
def alert_summary(tenant: CanView, db: DbDep) -> AlertSummary:
    unacknowledged, critical = service.summary(db, tenant.organisation.id)
    return AlertSummary(unacknowledged=unacknowledged, critical=critical)


@router.get("/settings")
def get_settings(tenant: CanView, db: DbDep) -> AlertSettingsResponse:
    return _settings_response(service.get_settings_row(db, tenant.organisation.id))


@router.patch("/settings")
def update_settings(
    body: AlertSettingsUpdate, tenant: CanConfigure, db: DbDep
) -> AlertSettingsResponse:
    row = service.update_settings(
        db, tenant.organisation.id, tenant.user.id, body.model_dump(exclude_unset=True)
    )
    return _settings_response(row)


@router.post("/{alert_id}/acknowledge")
def acknowledge(alert_id: uuid.UUID, tenant: CanManage, db: DbDep) -> AlertResponse:
    alert = service.acknowledge(db, tenant.organisation.id, alert_id, tenant.user.id)
    return _to_response(alert, None)


@router.post("/{alert_id}/resolve")
def resolve(alert_id: uuid.UUID, tenant: CanManage, db: DbDep) -> AlertResponse:
    alert = service.resolve(db, tenant.organisation.id, alert_id, tenant.user.id)
    return _to_response(alert, None)
