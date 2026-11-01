from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.deps import DbDep, TenantContext, get_tenant_context
from app.core.permissions import Permission, role_has_permission
from app.schemas.dashboard import DashboardResponse
from app.services import dashboard as service

router = APIRouter(tags=["dashboard"])


@router.get("/dashboard")
def get_dashboard(
    tenant: Annotated[TenantContext, Depends(get_tenant_context)], db: DbDep
) -> DashboardResponse:
    organisation = tenant.organisation
    role = tenant.membership.role
    return DashboardResponse(
        vehicles=service.vehicle_summary(db, organisation.id)
        if role_has_permission(role, Permission.VEHICLES_VIEW)
        else None,
        drivers=service.driver_summary(db, organisation.id, organisation.timezone)
        if role_has_permission(role, Permission.DRIVERS_VIEW)
        else None,
        trips=service.trip_summary(db, organisation.id)
        if role_has_permission(role, Permission.TRIPS_VIEW)
        else None,
    )
