from enum import StrEnum


class OrganisationStatus(StrEnum):
    ACTIVE = "active"
    SUSPENDED = "suspended"


class DistanceUnit(StrEnum):
    KILOMETRES = "km"
    MILES = "mi"


class OrganisationRole(StrEnum):
    OWNER = "owner"
    ADMINISTRATOR = "administrator"
    FLEET_MANAGER = "fleet_manager"
    DISPATCHER = "dispatcher"
    MAINTENANCE_MANAGER = "maintenance_manager"
    FINANCE_MANAGER = "finance_manager"
    DRIVER = "driver"
    READ_ONLY = "read_only"


class MembershipStatus(StrEnum):
    ACTIVE = "active"
    SUSPENDED = "suspended"


class VehicleType(StrEnum):
    CAR = "car"
    VAN = "van"
    PICKUP = "pickup"
    TRUCK = "truck"
    BUS = "bus"
    MOTORCYCLE = "motorcycle"
    HEAVY_EQUIPMENT = "heavy_equipment"
    OTHER = "other"


class FuelType(StrEnum):
    PETROL = "petrol"
    DIESEL = "diesel"
    CNG = "cng"
    LPG = "lpg"
    ELECTRIC = "electric"
    HYBRID = "hybrid"
    OTHER = "other"


class OwnershipType(StrEnum):
    OWNED = "owned"
    LEASED = "leased"
    RENTED = "rented"


class VehicleStatus(StrEnum):
    ACTIVE = "active"
    IDLE = "idle"
    MAINTENANCE = "maintenance"
    OUT_OF_SERVICE = "out_of_service"


class DriverStatus(StrEnum):
    ACTIVE = "active"
    INACTIVE = "inactive"
    SUSPENDED = "suspended"


class DriverAvailability(StrEnum):
    AVAILABLE = "available"
    ON_TRIP = "on_trip"
    OFF_DUTY = "off_duty"
    UNAVAILABLE = "unavailable"


class TrackingDeviceStatus(StrEnum):
    ACTIVE = "active"
    INACTIVE = "inactive"


class GpsSignalStatus(StrEnum):
    GOOD = "good"
    WEAK = "weak"
    LOST = "lost"
    UNKNOWN = "unknown"


class TripStatus(StrEnum):
    DRAFT = "draft"
    PLANNED = "planned"
    DISPATCHED = "dispatched"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class GeofenceKind(StrEnum):
    CIRCLE = "circle"
    POLYGON = "polygon"


class GeofenceEventType(StrEnum):
    ENTRY = "entry"
    EXIT = "exit"


class AlertType(StrEnum):
    GEOFENCE_ENTRY = "geofence_entry"
    GEOFENCE_EXIT = "geofence_exit"
    SPEEDING = "speeding"
    UNUSUAL_MOVEMENT = "unusual_movement"
    VEHICLE_OFFLINE = "vehicle_offline"
    LICENCE_EXPIRY = "licence_expiry"
    MAINTENANCE_DUE = "maintenance_due"
    DOCUMENT_EXPIRY = "document_expiry"
    DEFECT_REPORTED = "defect_reported"


class AlertSeverity(StrEnum):
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"


class WorkOrderType(StrEnum):
    PREVENTIVE = "preventive"
    CORRECTIVE = "corrective"


class WorkOrderStatus(StrEnum):
    OPEN = "open"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class FilePurpose(StrEnum):
    RECEIPT = "receipt"
    DOCUMENT = "document"
    INSPECTION = "inspection"


class FuelUnit(StrEnum):
    LITRES = "litres"
    KWH = "kwh"


class ExpenseCategory(StrEnum):
    TOLLS = "tolls"
    PARKING = "parking"
    INSURANCE = "insurance"
    REPAIRS = "repairs"
    TYRES = "tyres"
    LICENSING = "licensing"
    FINES = "fines"
    CLEANING = "cleaning"
    OTHER = "other"


class ExpenseStatus(StrEnum):
    SUBMITTED = "submitted"
    APPROVED = "approved"
    REJECTED = "rejected"


class DocumentType(StrEnum):
    INSURANCE = "insurance"
    ROADWORTHINESS = "roadworthiness"
    REGISTRATION = "registration"
    PERMIT = "permit"
    LICENCE = "licence"
    MEDICAL = "medical"
    TRAINING = "training"
    OTHER = "other"


class InspectionOutcome(StrEnum):
    PASSED = "passed"
    FAILED = "failed"


class DefectSeverity(StrEnum):
    MINOR = "minor"
    MAJOR = "major"
    CRITICAL = "critical"


class DefectStatus(StrEnum):
    OPEN = "open"
    RESOLVED = "resolved"


class EmailMode(StrEnum):
    OFF = "off"
    CRITICAL = "critical"
    ALL = "all"


class NotificationEmailStatus(StrEnum):
    NOT_REQUESTED = "not_requested"
    PENDING = "pending"
    SENT = "sent"
    FAILED = "failed"


class AutomationRunStatus(StrEnum):
    PENDING = "pending"
    SUCCEEDED = "succeeded"
    SKIPPED = "skipped"
    FAILED = "failed"


class BillingPlan(StrEnum):
    STARTER = "starter"
    GROWTH = "growth"


class PaymentStatus(StrEnum):
    PENDING = "pending"
    PAID = "paid"
    FAILED = "failed"
    MISMATCHED = "mismatched"
