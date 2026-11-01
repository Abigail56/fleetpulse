import uuid
from datetime import datetime
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import DbDep, TenantContext, require_permission
from app.core.permissions import Permission, role_has_permission
from app.models import Driver
from app.models.enums import DriverAvailability, DriverStatus
from app.schemas.drivers import (
    AssignmentRequest,
    AssignmentResponse,
    CurrentVehicle,
    DriverAccountRequest,
    DriverCreate,
    DriverListResponse,
    DriverResponse,
    DriverSort,
    DriverUpdate,
    LicenceFilter,
)
from app.services import drivers as service

router = APIRouter(prefix="/drivers", tags=["drivers"])

CanView = Annotated[TenantContext, Depends(require_permission(Permission.DRIVERS_VIEW))]
CanManage = Annotated[TenantContext, Depends(require_permission(Permission.DRIVERS_MANAGE))]


def can_see_sensitive(tenant: TenantContext) -> bool:
    return role_has_permission(tenant.membership.role, Permission.DRIVERS_VIEW_SENSITIVE)


def to_response(
    driver: Driver, sensitive: bool, vehicle: tuple[uuid.UUID, str] | None
) -> DriverResponse:
    return DriverResponse(
        id=driver.id,
        user_id=driver.user_id,
        first_name=driver.first_name,
        last_name=driver.last_name,
        phone=driver.phone if sensitive else None,
        email=driver.email if sensitive else None,
        licence_number=driver.licence_number
        if sensitive
        else service.mask_licence(driver.licence_number),
        sensitive_visible=sensitive,
        licence_class=driver.licence_class,
        licence_country_code=driver.licence_country_code,
        licence_expires_on=driver.licence_expires_on,
        status=driver.status,
        availability=driver.availability,
        archived_at=driver.archived_at,
        created_at=driver.created_at,
        updated_at=driver.updated_at,
        current_vehicle=CurrentVehicle(id=vehicle[0], registration_number=vehicle[1])
        if vehicle
        else None,
    )


def one_response(db: DbDep, tenant: TenantContext, driver: Driver) -> DriverResponse:
    vehicles = service.current_vehicles(db, tenant.organisation.id, [driver.id])
    return to_response(driver, can_see_sensitive(tenant), vehicles.get(driver.id))


@router.get("")
def list_drivers(
    tenant: CanView,
    db: DbDep,
    search: Annotated[str | None, Query(max_length=100)] = None,
    driver_status: Annotated[DriverStatus | None, Query(alias="status")] = None,
    availability: DriverAvailability | None = None,
    licence: LicenceFilter | None = None,
    archived: bool = False,
    sort: DriverSort = "last_name",
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 25,
) -> DriverListResponse:
    organisation = tenant.organisation
    sensitive = can_see_sensitive(tenant)
    items, total = service.list_drivers(
        db,
        organisation.id,
        today=datetime.now(ZoneInfo(organisation.timezone)).date(),
        can_search_sensitive=sensitive,
        search=search,
        status=driver_status,
        availability=availability,
        licence=licence,
        archived=archived,
        sort=sort,
        page=page,
        page_size=page_size,
    )
    vehicles = service.current_vehicles(db, organisation.id, [item.id for item in items])
    return DriverListResponse(
        items=[to_response(item, sensitive, vehicles.get(item.id)) for item in items],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post("/{driver_id}/account")
def link_account(
    driver_id: uuid.UUID, body: DriverAccountRequest, tenant: CanManage, db: DbDep
) -> DriverResponse:
    driver = service.link_account(
        db, tenant.organisation.id, driver_id, tenant.user.id, body.user_id
    )
    return one_response(db, tenant, driver)


@router.post("", status_code=status.HTTP_201_CREATED)
def create_driver(body: DriverCreate, tenant: CanManage, db: DbDep) -> DriverResponse:
    driver = service.create_driver(db, tenant.organisation.id, tenant.user.id, body.model_dump())
    return one_response(db, tenant, driver)


@router.get("/{driver_id}")
def get_driver(driver_id: uuid.UUID, tenant: CanView, db: DbDep) -> DriverResponse:
    return one_response(db, tenant, service.get_driver(db, tenant.organisation.id, driver_id))


@router.patch("/{driver_id}")
def update_driver(
    driver_id: uuid.UUID, body: DriverUpdate, tenant: CanManage, db: DbDep
) -> DriverResponse:
    driver = service.update_driver(
        db,
        tenant.organisation.id,
        tenant.user.id,
        driver_id,
        body.model_dump(exclude_unset=True),
    )
    return one_response(db, tenant, driver)


@router.post("/{driver_id}/archive")
def archive_driver(driver_id: uuid.UUID, tenant: CanManage, db: DbDep) -> DriverResponse:
    driver = service.archive_driver(db, tenant.organisation.id, tenant.user.id, driver_id)
    return one_response(db, tenant, driver)


@router.post("/{driver_id}/restore")
def restore_driver(driver_id: uuid.UUID, tenant: CanManage, db: DbDep) -> DriverResponse:
    driver = service.restore_driver(db, tenant.organisation.id, tenant.user.id, driver_id)
    return one_response(db, tenant, driver)


@router.post("/{driver_id}/assign")
def assign_vehicle(
    driver_id: uuid.UUID, body: AssignmentRequest, tenant: CanManage, db: DbDep
) -> DriverResponse:
    organisation_id = tenant.organisation.id
    service.assign_vehicle(db, organisation_id, tenant.user.id, driver_id, body.vehicle_id)
    return one_response(db, tenant, service.get_driver(db, organisation_id, driver_id))


@router.post("/{driver_id}/unassign")
def unassign_vehicle(driver_id: uuid.UUID, tenant: CanManage, db: DbDep) -> DriverResponse:
    organisation_id = tenant.organisation.id
    service.unassign_vehicle(db, organisation_id, tenant.user.id, driver_id)
    return one_response(db, tenant, service.get_driver(db, organisation_id, driver_id))


@router.get("/{driver_id}/assignments")
def list_assignments(driver_id: uuid.UUID, tenant: CanView, db: DbDep) -> list[AssignmentResponse]:
    return [
        AssignmentResponse(
            id=assignment.id,
            vehicle_id=assignment.vehicle_id,
            registration_number=registration,
            started_at=assignment.started_at,
            ended_at=assignment.ended_at,
        )
        for assignment, registration in service.assignment_history(
            db, tenant.organisation.id, driver_id
        )
    ]
