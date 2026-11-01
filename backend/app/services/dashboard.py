import uuid
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from sqlmodel import Session, col, func, select

from app.models import Driver, Trip, Vehicle
from app.models.enums import DriverAvailability, DriverStatus, TripStatus, VehicleStatus
from app.schemas.dashboard import DriverSummary, TripSummary, VehicleSummary

LICENCE_WARNING_DAYS = 30


def vehicle_summary(db: Session, organisation_id: uuid.UUID) -> VehicleSummary:
    rows = db.exec(
        select(Vehicle.status, func.count())
        .where(Vehicle.organisation_id == organisation_id, col(Vehicle.archived_at).is_(None))
        .group_by(Vehicle.status)
    ).all()
    counts = dict(rows)
    total = sum(counts.values())
    active = counts.get(VehicleStatus.ACTIVE, 0)
    return VehicleSummary(
        total=total,
        active=active,
        idle=counts.get(VehicleStatus.IDLE, 0),
        maintenance=counts.get(VehicleStatus.MAINTENANCE, 0),
        out_of_service=counts.get(VehicleStatus.OUT_OF_SERVICE, 0),
        utilisation_percent=round(active / total * 100) if total else None,
    )


def driver_summary(db: Session, organisation_id: uuid.UUID, timezone: str) -> DriverSummary:
    # Only drivers currently employed count: an inactive driver's licence isn't a compliance issue.
    current = (
        Driver.organisation_id == organisation_id,
        col(Driver.archived_at).is_(None),
        Driver.status == DriverStatus.ACTIVE,
    )
    counts = dict(
        db.exec(
            select(Driver.availability, func.count()).where(*current).group_by(Driver.availability)
        ).all()
    )
    # "Today" in the organisation's own time zone, so expiry doesn't flip at UTC midnight.
    today = datetime.now(ZoneInfo(timezone)).date()
    expired = db.exec(
        select(func.count()).where(*current, col(Driver.licence_expires_on) < today)
    ).one()
    expiring = db.exec(
        select(func.count()).where(
            *current,
            col(Driver.licence_expires_on) >= today,
            col(Driver.licence_expires_on) <= today + timedelta(days=LICENCE_WARNING_DAYS),
        )
    ).one()
    return DriverSummary(
        total=sum(counts.values()),
        available=counts.get(DriverAvailability.AVAILABLE, 0),
        on_trip=counts.get(DriverAvailability.ON_TRIP, 0),
        off_duty=counts.get(DriverAvailability.OFF_DUTY, 0),
        unavailable=counts.get(DriverAvailability.UNAVAILABLE, 0),
        licences_expiring_soon=expiring,
        licences_expired=expired,
    )


def trip_summary(db: Session, organisation_id: uuid.UUID) -> TripSummary:
    counts = dict(
        db.exec(
            select(Trip.status, func.count())
            .where(Trip.organisation_id == organisation_id)
            .group_by(Trip.status)
        ).all()
    )
    return TripSummary(
        in_progress=counts.get(TripStatus.IN_PROGRESS, 0),
        scheduled=counts.get(TripStatus.PLANNED, 0) + counts.get(TripStatus.DISPATCHED, 0),
    )
