from pydantic import BaseModel


class VehicleSummary(BaseModel):
    total: int
    active: int
    idle: int
    maintenance: int
    out_of_service: int
    # Active vehicles as a share of all vehicles; None when there are no vehicles to measure.
    utilisation_percent: int | None


class DriverSummary(BaseModel):
    total: int
    available: int
    on_trip: int
    off_duty: int
    unavailable: int
    licences_expiring_soon: int
    licences_expired: int


class TripSummary(BaseModel):
    in_progress: int
    scheduled: int


class DashboardResponse(BaseModel):
    """A section is null when the member's role doesn't permit seeing it."""

    vehicles: VehicleSummary | None
    drivers: DriverSummary | None
    trips: TripSummary | None
