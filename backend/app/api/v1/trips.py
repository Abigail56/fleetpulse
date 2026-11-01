import uuid
from datetime import date, datetime
from typing import Annotated, Any
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import DbDep, TenantContext, require_permission
from app.core.errors import ApiError
from app.core.permissions import Permission, role_has_permission
from app.models import Trip
from app.models.enums import TripStatus
from app.schemas.trips import (
    RoutePoint,
    TripComplete,
    TripCreate,
    TripDriverOption,
    TripEvent,
    TripListResponse,
    TripOptions,
    TripResponse,
    TripRoute,
    TripStart,
    TripUpdate,
    TripVehicleOption,
)
from app.services import trips as service

router = APIRouter(prefix="/trips", tags=["trips"])

CanView = Annotated[TenantContext, Depends(require_permission(Permission.TRIPS_VIEW))]
CanManage = Annotated[TenantContext, Depends(require_permission(Permission.TRIPS_MANAGE))]


def _only_own(tenant: TenantContext) -> bool:
    return not role_has_permission(tenant.membership.role, Permission.TRIPS_VIEW_ALL)


def _own_driver(db: DbDep, tenant: TenantContext) -> uuid.UUID | None:
    return service.driver_for_user(db, tenant.organisation.id, tenant.user.id)


def _today(tenant: TenantContext) -> date:
    return datetime.now(ZoneInfo(tenant.organisation.timezone)).date()


def _to_response(row: Any) -> TripResponse:
    trip, registration, first_name, last_name = row
    return TripResponse(
        id=trip.id,
        status=trip.status,
        origin_name=trip.origin_name,
        destination_name=trip.destination_name,
        vehicle_id=trip.vehicle_id,
        vehicle_registration=registration,
        driver_id=trip.driver_id,
        driver_name=f"{first_name} {last_name}" if first_name else None,
        planned_departure_at=trip.planned_departure_at,
        estimated_arrival_at=trip.estimated_arrival_at,
        actual_departure_at=trip.actual_departure_at,
        actual_arrival_at=trip.actual_arrival_at,
        distance_km=trip.distance_km,
        distance_source=trip.distance_source,
        dispatch_notes=trip.dispatch_notes,
        created_at=trip.created_at,
        updated_at=trip.updated_at,
    )


def _visible(db: DbDep, tenant: TenantContext, trip_id: uuid.UUID) -> Any:
    only_own = _only_own(tenant)
    return service.get_row(
        db,
        tenant.organisation.id,
        trip_id,
        only_driver_id=_own_driver(db, tenant) if only_own else None,
        only_own=only_own,
    )


def _response(db: DbDep, tenant: TenantContext, trip: Trip) -> TripResponse:
    return _to_response(
        service.get_row(db, tenant.organisation.id, trip.id, only_driver_id=None, only_own=False)
    )


def _can_run(db: DbDep, tenant: TenantContext, trip_id: uuid.UUID) -> None:
    """Dispatchers run any trip. Drivers can start and finish only the ones assigned to them."""
    if role_has_permission(tenant.membership.role, Permission.TRIPS_MANAGE):
        return
    _visible(db, tenant, trip_id)
    if not _only_own(tenant):
        raise ApiError(403, "forbidden", "You don't have permission to do that.")


@router.get("")
def list_trips(
    tenant: CanView,
    db: DbDep,
    search: Annotated[str | None, Query(max_length=100)] = None,
    trip_status: Annotated[list[TripStatus] | None, Query(alias="status")] = None,
    vehicle_id: uuid.UUID | None = None,
    driver_id: uuid.UUID | None = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 25,
) -> TripListResponse:
    only_own = _only_own(tenant)
    rows, total = service.list_trips(
        db,
        tenant.organisation.id,
        only_driver_id=_own_driver(db, tenant) if only_own else None,
        only_own=only_own,
        search=search,
        statuses=trip_status or [],
        vehicle_id=vehicle_id,
        driver_id=driver_id,
        page=page,
        page_size=page_size,
    )
    return TripListResponse(
        items=[_to_response(row) for row in rows], total=total, page=page, page_size=page_size
    )


@router.get("/options")
def trip_options(tenant: CanManage, db: DbDep) -> TripOptions:
    vehicles, drivers = service.options(db, tenant.organisation.id)
    return TripOptions(
        vehicles=[
            TripVehicleOption(
                id=item.id,
                registration_number=item.registration_number,
                make=item.make,
                model=item.model,
            )
            for item in vehicles
        ],
        drivers=[
            TripDriverOption(id=item.id, name=f"{item.first_name} {item.last_name}")
            for item in drivers
        ],
    )


@router.post("", status_code=status.HTTP_201_CREATED)
def create_trip(body: TripCreate, tenant: CanManage, db: DbDep) -> TripResponse:
    trip = service.create_trip(db, tenant.organisation.id, tenant.user.id, body.model_dump())
    return _response(db, tenant, trip)


@router.get("/{trip_id}")
def get_trip(trip_id: uuid.UUID, tenant: CanView, db: DbDep) -> TripResponse:
    return _to_response(_visible(db, tenant, trip_id))


@router.patch("/{trip_id}")
def update_trip(trip_id: uuid.UUID, body: TripUpdate, tenant: CanManage, db: DbDep) -> TripResponse:
    trip = service.update_trip(
        db, tenant.organisation.id, trip_id, tenant.user.id, body.model_dump(exclude_unset=True)
    )
    return _response(db, tenant, trip)


@router.post("/{trip_id}/plan")
def plan_trip(trip_id: uuid.UUID, tenant: CanManage, db: DbDep) -> TripResponse:
    trip = service.plan_trip(db, tenant.organisation.id, trip_id, tenant.user.id)
    return _response(db, tenant, trip)


@router.post("/{trip_id}/dispatch")
def dispatch_trip(trip_id: uuid.UUID, tenant: CanManage, db: DbDep) -> TripResponse:
    trip = service.dispatch_trip(
        db, tenant.organisation.id, trip_id, tenant.user.id, _today(tenant)
    )
    return _response(db, tenant, trip)


@router.post("/{trip_id}/start")
def start_trip(trip_id: uuid.UUID, body: TripStart, tenant: CanView, db: DbDep) -> TripResponse:
    _can_run(db, tenant, trip_id)
    trip = service.start_trip(
        db,
        tenant.organisation.id,
        trip_id,
        tenant.user.id,
        _today(tenant),
        body.actual_departure_at,
    )
    return _response(db, tenant, trip)


@router.post("/{trip_id}/complete")
def complete_trip(
    trip_id: uuid.UUID, body: TripComplete, tenant: CanView, db: DbDep
) -> TripResponse:
    _can_run(db, tenant, trip_id)
    trip = service.complete_trip(
        db,
        tenant.organisation.id,
        trip_id,
        tenant.user.id,
        body.actual_arrival_at,
        body.distance_km,
    )
    return _response(db, tenant, trip)


@router.post("/{trip_id}/cancel")
def cancel_trip(trip_id: uuid.UUID, tenant: CanManage, db: DbDep) -> TripResponse:
    trip = service.cancel_trip(db, tenant.organisation.id, trip_id, tenant.user.id)
    return _response(db, tenant, trip)


@router.get("/{trip_id}/events")
def trip_events(trip_id: uuid.UUID, tenant: CanView, db: DbDep) -> list[TripEvent]:
    _visible(db, tenant, trip_id)
    return [
        TripEvent(action=action, occurred_at=occurred_at, actor_name=name)
        for action, occurred_at, name in service.events(db, tenant.organisation.id, trip_id)
    ]


@router.get("/{trip_id}/route")
def trip_route(trip_id: uuid.UUID, tenant: CanView, db: DbDep) -> TripRoute:
    trip = _visible(db, tenant, trip_id)[0]
    rows = service.route(db, tenant.organisation.id, trip)
    return TripRoute(
        points=[
            RoutePoint(
                recorded_at=row["recorded_at"],
                latitude=row["latitude"],
                longitude=row["longitude"],
            )
            for row in rows
        ],
        is_simulated=any(row["is_simulated"] for row in rows),
        is_limited=len(rows) == service.ROUTE_POINT_LIMIT,
    )
