import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import DbDep, TenantContext, require_permission
from app.core.permissions import Permission
from app.models import Geofence
from app.schemas.alerts import (
    GeofenceCreate,
    GeofenceEventList,
    GeofenceEventResponse,
    GeofenceResponse,
    GeofenceUpdate,
)
from app.services import geofences as service

router = APIRouter(prefix="/geofences", tags=["geofences"])

CanView = Annotated[TenantContext, Depends(require_permission(Permission.GEOFENCES_VIEW))]
CanManage = Annotated[TenantContext, Depends(require_permission(Permission.GEOFENCES_MANAGE))]


def _to_response(
    geofence: Geofence, boundaries: dict[uuid.UUID, list[list[float]]], inside: dict[uuid.UUID, int]
) -> GeofenceResponse:
    return GeofenceResponse(
        id=geofence.id,
        name=geofence.name,
        kind=geofence.kind,
        boundary=boundaries.get(geofence.id, []),
        center_latitude=geofence.center_latitude,
        center_longitude=geofence.center_longitude,
        radius_m=geofence.radius_m,
        is_restricted=geofence.is_restricted,
        alert_on_entry=geofence.alert_on_entry,
        alert_on_exit=geofence.alert_on_exit,
        vehicles_inside=inside.get(geofence.id, 0),
        archived_at=geofence.archived_at,
        created_at=geofence.created_at,
    )


def _one(db: DbDep, tenant: TenantContext, geofence: Geofence) -> GeofenceResponse:
    organisation_id = tenant.organisation.id
    return _to_response(
        geofence,
        service.boundaries(db, organisation_id),
        service.occupancy_counts(db, organisation_id),
    )


@router.get("")
def list_geofences(tenant: CanView, db: DbDep, archived: bool = False) -> list[GeofenceResponse]:
    organisation_id = tenant.organisation.id
    boundaries = service.boundaries(db, organisation_id)
    inside = service.occupancy_counts(db, organisation_id)
    return [
        _to_response(item, boundaries, inside)
        for item in service.list_geofences(db, organisation_id, archived)
    ]


@router.post("", status_code=status.HTTP_201_CREATED)
def create_geofence(body: GeofenceCreate, tenant: CanManage, db: DbDep) -> GeofenceResponse:
    geofence = service.create_geofence(
        db, tenant.organisation.id, tenant.user.id, body.model_dump()
    )
    return _one(db, tenant, geofence)


@router.get("/{geofence_id}")
def get_geofence(geofence_id: uuid.UUID, tenant: CanView, db: DbDep) -> GeofenceResponse:
    return _one(db, tenant, service.get_geofence(db, tenant.organisation.id, geofence_id))


@router.patch("/{geofence_id}")
def update_geofence(
    geofence_id: uuid.UUID, body: GeofenceUpdate, tenant: CanManage, db: DbDep
) -> GeofenceResponse:
    geofence = service.update_geofence(
        db,
        tenant.organisation.id,
        geofence_id,
        tenant.user.id,
        body.model_dump(exclude_unset=True),
    )
    return _one(db, tenant, geofence)


@router.post("/{geofence_id}/archive")
def archive_geofence(geofence_id: uuid.UUID, tenant: CanManage, db: DbDep) -> GeofenceResponse:
    geofence = service.archive_geofence(db, tenant.organisation.id, geofence_id, tenant.user.id)
    return _one(db, tenant, geofence)


@router.get("/{geofence_id}/events")
def list_events(
    geofence_id: uuid.UUID,
    tenant: CanView,
    db: DbDep,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 25,
) -> GeofenceEventList:
    rows, total = service.list_events(db, tenant.organisation.id, geofence_id, page, page_size)
    return GeofenceEventList(
        items=[
            GeofenceEventResponse(
                id=event.id,
                vehicle_id=event.vehicle_id,
                vehicle_registration=registration,
                event_type=event.event_type,
                occurred_at=event.occurred_at,
                latitude=event.latitude,
                longitude=event.longitude,
                is_simulated=event.is_simulated,
            )
            for event, registration in rows
        ],
        total=total,
        page=page,
        page_size=page_size,
    )
