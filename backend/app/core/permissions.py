from enum import StrEnum

from app.models.enums import OrganisationRole


class Permission(StrEnum):
    ORGANISATION_VIEW = "organisation.view"
    ORGANISATION_MANAGE = "organisation.manage"
    MEMBERS_VIEW = "members.view"
    MEMBERS_MANAGE = "members.manage"
    VEHICLES_VIEW = "vehicles.view"
    VEHICLES_MANAGE = "vehicles.manage"
    DRIVERS_VIEW = "drivers.view"
    DRIVERS_MANAGE = "drivers.manage"
    # Licence numbers and contact details. Without it, they are masked or left out.
    DRIVERS_VIEW_SENSITIVE = "drivers.view_sensitive"
    # Without trips.view_all, this only covers trips assigned to the person's own driver record.
    TRIPS_VIEW = "trips.view"
    TRIPS_VIEW_ALL = "trips.view_all"
    TRIPS_MANAGE = "trips.manage"
    GEOFENCES_VIEW = "geofences.view"
    GEOFENCES_MANAGE = "geofences.manage"
    ALERTS_VIEW = "alerts.view"
    ALERTS_MANAGE = "alerts.manage"
    MAINTENANCE_VIEW = "maintenance.view"
    MAINTENANCE_MANAGE = "maintenance.manage"
    # Recording fuel and expenses. Without costs.view, this covers only the person's own records.
    COSTS_SUBMIT = "costs.submit"
    COSTS_VIEW = "costs.view"
    COSTS_APPROVE = "costs.approve"
    # Documents, and everyone's inspections and defects.
    COMPLIANCE_VIEW = "compliance.view"
    COMPLIANCE_MANAGE = "compliance.manage"
    # Carrying out inspections and reporting defects. Alone, this covers only the person's own.
    INSPECTIONS_SUBMIT = "inspections.submit"
    AUTOMATION_MANAGE = "automation.manage"
    REPORTS_VIEW = "reports.view"
    # Owners and administrators only: all permissions, and no other role lists it.
    BILLING_MANAGE = "billing.manage"


_FLEET_READ = frozenset(
    {
        Permission.ORGANISATION_VIEW,
        Permission.VEHICLES_VIEW,
        Permission.DRIVERS_VIEW,
        Permission.TRIPS_VIEW,
        Permission.TRIPS_VIEW_ALL,
        Permission.GEOFENCES_VIEW,
        Permission.ALERTS_VIEW,
        Permission.MAINTENANCE_VIEW,
        Permission.COSTS_VIEW,
        Permission.COMPLIANCE_VIEW,
        Permission.REPORTS_VIEW,
    }
)

# Explicit, with no role inheriting from another, so each role can be reviewed on its own.
# Owner-only rules, such as granting the Owner role, are in services/organisations.py.
ROLE_PERMISSIONS: dict[OrganisationRole, frozenset[Permission]] = {
    OrganisationRole.OWNER: frozenset(Permission),
    OrganisationRole.ADMINISTRATOR: frozenset(Permission),
    OrganisationRole.FLEET_MANAGER: _FLEET_READ
    | {
        Permission.MEMBERS_VIEW,
        Permission.VEHICLES_MANAGE,
        Permission.DRIVERS_MANAGE,
        Permission.DRIVERS_VIEW_SENSITIVE,
        Permission.TRIPS_MANAGE,
        Permission.GEOFENCES_MANAGE,
        Permission.ALERTS_MANAGE,
        Permission.MAINTENANCE_MANAGE,
        Permission.COSTS_SUBMIT,
        Permission.COSTS_APPROVE,
        Permission.COMPLIANCE_MANAGE,
        Permission.INSPECTIONS_SUBMIT,
        Permission.AUTOMATION_MANAGE,
    },
    OrganisationRole.DISPATCHER: _FLEET_READ
    | {
        Permission.TRIPS_MANAGE,
        Permission.DRIVERS_VIEW_SENSITIVE,
        Permission.ALERTS_MANAGE,
        Permission.COSTS_SUBMIT,
        Permission.INSPECTIONS_SUBMIT,
    },
    OrganisationRole.MAINTENANCE_MANAGER: _FLEET_READ
    | {
        Permission.MAINTENANCE_MANAGE,
        Permission.COSTS_SUBMIT,
        Permission.COMPLIANCE_MANAGE,
        Permission.INSPECTIONS_SUBMIT,
    },
    OrganisationRole.FINANCE_MANAGER: _FLEET_READ
    | {Permission.COSTS_SUBMIT, Permission.COSTS_APPROVE},
    OrganisationRole.DRIVER: frozenset(
        {
            Permission.ORGANISATION_VIEW,
            Permission.TRIPS_VIEW,
            Permission.COSTS_SUBMIT,
            Permission.INSPECTIONS_SUBMIT,
        }
    ),
    OrganisationRole.READ_ONLY: _FLEET_READ,
}


def role_has_permission(role: OrganisationRole, permission: Permission) -> bool:
    return permission in ROLE_PERMISSIONS[role]
