"""Importing this package registers every table on SQLModel.metadata (Alembic relies on it)."""

from app.models.alerts import Alert, AlertSettings, Geofence, GeofenceEvent, GeofenceOccupancy
from app.models.audit import AuditLog
from app.models.billing import BillingEvent, Payment, Subscription
from app.models.compliance import ComplianceDocument, Defect, Inspection, InspectionTemplate
from app.models.costs import Expense, FuelTransaction, StoredFile
from app.models.driver import Driver, VehicleAssignment
from app.models.identity import (
    AuthSession,
    EmailVerificationToken,
    PasswordResetToken,
    RefreshToken,
    User,
    UserIdentity,
)
from app.models.maintenance import MaintenanceSchedule, WorkOrder
from app.models.notifications import (
    AutomationRule,
    AutomationRun,
    Notification,
    NotificationPreference,
)
from app.models.organisation import Organisation, OrganisationInvitation, OrganisationMembership
from app.models.telemetry import GpsIntegration, VehicleLatestLocation, VehicleLocation
from app.models.trip import Trip
from app.models.vehicle import TrackingDevice, Vehicle

__all__ = [
    "Alert",
    "AlertSettings",
    "AuditLog",
    "AuthSession",
    "AutomationRule",
    "AutomationRun",
    "BillingEvent",
    "ComplianceDocument",
    "Defect",
    "Driver",
    "EmailVerificationToken",
    "Expense",
    "FuelTransaction",
    "Geofence",
    "GeofenceEvent",
    "GeofenceOccupancy",
    "GpsIntegration",
    "Inspection",
    "InspectionTemplate",
    "MaintenanceSchedule",
    "Notification",
    "NotificationPreference",
    "Organisation",
    "OrganisationInvitation",
    "OrganisationMembership",
    "PasswordResetToken",
    "Payment",
    "RefreshToken",
    "StoredFile",
    "Subscription",
    "TrackingDevice",
    "Trip",
    "User",
    "UserIdentity",
    "Vehicle",
    "VehicleAssignment",
    "VehicleLatestLocation",
    "VehicleLocation",
    "WorkOrder",
]
