from fastapi import APIRouter, Depends

from app.api.deps import require_trusted_origin
from app.api.v1 import (
    admin,
    alerts,
    auth,
    billing,
    compliance,
    contact,
    costs,
    dashboard,
    drivers,
    files,
    geofences,
    google,
    health,
    maintenance,
    notifications,
    organisations,
    reports,
    tracking,
    trips,
    vehicles,
)

api_router = APIRouter(prefix="/api/v1", dependencies=[Depends(require_trusted_origin)])
api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(organisations.router)
api_router.include_router(contact.router)
api_router.include_router(dashboard.router)
api_router.include_router(vehicles.router)
api_router.include_router(drivers.router)
api_router.include_router(google.router)
api_router.include_router(tracking.router)
api_router.include_router(trips.router)
api_router.include_router(geofences.router)
api_router.include_router(alerts.router)
api_router.include_router(maintenance.router)
api_router.include_router(costs.router)
api_router.include_router(files.router)
api_router.include_router(compliance.router)
api_router.include_router(notifications.router)
api_router.include_router(reports.router)
api_router.include_router(billing.router)
api_router.include_router(admin.router)
