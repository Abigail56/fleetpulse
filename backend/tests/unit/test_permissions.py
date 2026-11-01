import pytest

from app.core.permissions import ROLE_PERMISSIONS, Permission, role_has_permission
from app.models.enums import OrganisationRole


def test_every_role_has_an_explicit_permission_set() -> None:
    assert set(ROLE_PERMISSIONS) == set(OrganisationRole)


@pytest.mark.parametrize(
    ("role", "permission", "allowed"),
    [
        (OrganisationRole.OWNER, Permission.MEMBERS_MANAGE, True),
        (OrganisationRole.ADMINISTRATOR, Permission.ORGANISATION_MANAGE, True),
        (OrganisationRole.FLEET_MANAGER, Permission.VEHICLES_MANAGE, True),
        (OrganisationRole.FLEET_MANAGER, Permission.MEMBERS_MANAGE, False),
        (OrganisationRole.DISPATCHER, Permission.TRIPS_MANAGE, True),
        (OrganisationRole.DISPATCHER, Permission.VEHICLES_MANAGE, False),
        (OrganisationRole.MAINTENANCE_MANAGER, Permission.DRIVERS_MANAGE, False),
        (OrganisationRole.FINANCE_MANAGER, Permission.TRIPS_MANAGE, False),
        (OrganisationRole.DRIVER, Permission.VEHICLES_VIEW, False),
        (OrganisationRole.DRIVER, Permission.TRIPS_VIEW, True),
        (OrganisationRole.READ_ONLY, Permission.VEHICLES_VIEW, True),
    ],
)
def test_role_permissions(role: OrganisationRole, permission: Permission, allowed: bool) -> None:
    assert role_has_permission(role, permission) is allowed


def test_read_only_role_cannot_change_anything() -> None:
    assert not [
        permission
        for permission in ROLE_PERMISSIONS[OrganisationRole.READ_ONLY]
        if permission.endswith(".manage")
    ]
