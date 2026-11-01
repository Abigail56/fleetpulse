import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import DbDep, SettingsDep, TenantContext, require_permission
from app.core.permissions import Permission, role_has_permission
from app.models.enums import VehicleStatus, VehicleType
from app.schemas.vehicles import (
    AssignedDriver,
    VehicleCreate,
    VehicleDetailResponse,
    VehicleListResponse,
    VehicleResponse,
    VehicleSort,
    VehicleUpdate,
)
from app.services import vehicles as service
from app.services.billing import check_can_add_vehicle

router = APIRouter(prefix="/vehicles", tags=["vehicles"])

CanView = Annotated[TenantContext, Depends(require_permission(Permission.VEHICLES_VIEW))]
CanManage = Annotated[TenantContext, Depends(require_permission(Permission.VEHICLES_MANAGE))]


@router.get("")
def list_vehicles(
    tenant: CanView,
    db: DbDep,
    search: Annotated[str | None, Query(max_length=100)] = None,
    vehicle_status: Annotated[VehicleStatus | None, Query(alias="status")] = None,
    vehicle_type: VehicleType | None = None,
    archived: bool = False,
    sort: VehicleSort = "registration_number",
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 25,
) -> VehicleListResponse:
    items, total = service.list_vehicles(
        db,
        tenant.organisation.id,
        search=search,
        status=vehicle_status,
        vehicle_type=vehicle_type,
        archived=archived,
        sort=sort,
        page=page,
        page_size=page_size,
    )
    return VehicleListResponse(
        items=[VehicleResponse.model_validate(item) for item in items],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post("", status_code=status.HTTP_201_CREATED)
def create_vehicle(
    body: VehicleCreate, tenant: CanManage, db: DbDep, settings: SettingsDep
) -> VehicleResponse:
    check_can_add_vehicle(db, settings, tenant.organisation)
    return VehicleResponse.model_validate(
        service.create_vehicle(db, tenant.organisation.id, tenant.user.id, body.model_dump())
    )


@router.get("/{vehicle_id}")
def get_vehicle(vehicle_id: uuid.UUID, tenant: CanView, db: DbDep) -> VehicleDetailResponse:
    organisation_id = tenant.organisation.id
    vehicle = service.get_vehicle(db, organisation_id, vehicle_id)
    response = VehicleDetailResponse.model_validate(vehicle)
    if role_has_permission(tenant.membership.role, Permission.DRIVERS_VIEW):
        driver = service.current_driver(db, organisation_id, vehicle_id)
        if driver is not None:
            response.current_driver = AssignedDriver(
                id=driver.id, name=f"{driver.first_name} {driver.last_name}"
            )
    return response


@router.patch("/{vehicle_id}")
def update_vehicle(
    vehicle_id: uuid.UUID, body: VehicleUpdate, tenant: CanManage, db: DbDep
) -> VehicleResponse:
    return VehicleResponse.model_validate(
        service.update_vehicle(
            db,
            tenant.organisation.id,
            tenant.user.id,
            vehicle_id,
            body.model_dump(exclude_unset=True),
        )
    )


@router.post("/{vehicle_id}/archive")
def archive_vehicle(vehicle_id: uuid.UUID, tenant: CanManage, db: DbDep) -> VehicleResponse:
    return VehicleResponse.model_validate(
        service.archive_vehicle(db, tenant.organisation.id, tenant.user.id, vehicle_id)
    )


@router.post("/{vehicle_id}/restore")
def restore_vehicle(
    vehicle_id: uuid.UUID, tenant: CanManage, db: DbDep, settings: SettingsDep
) -> VehicleResponse:
    check_can_add_vehicle(db, settings, tenant.organisation)
    return VehicleResponse.model_validate(
        service.restore_vehicle(db, tenant.organisation.id, tenant.user.id, vehicle_id)
    )
