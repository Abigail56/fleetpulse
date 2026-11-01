import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, status

from app.api.deps import (
    CsrfProtectedAuth,
    CurrentAuth,
    DbDep,
    EmailQueueDep,
    RedisDep,
    SettingsDep,
    TenantContext,
    get_tenant_context,
    require_permission,
)
from app.core.permissions import ROLE_PERMISSIONS, Permission
from app.models import Organisation, OrganisationInvitation, OrganisationMembership, User
from app.schemas.organisations import (
    CurrentMembershipResponse,
    InvitationAccept,
    InvitationCreate,
    InvitationResponse,
    MemberResponse,
    MemberUpdate,
    MyOrganisationResponse,
    OrganisationCreate,
    OrganisationResponse,
    OrganisationUpdate,
)
from app.services import organisations as service
from app.services.billing import check_can_add_member

router = APIRouter(tags=["organisations"])

Tenant = Annotated[TenantContext, Depends(get_tenant_context)]
CanManageOrganisation = Annotated[
    TenantContext, Depends(require_permission(Permission.ORGANISATION_MANAGE))
]
CanViewMembers = Annotated[TenantContext, Depends(require_permission(Permission.MEMBERS_VIEW))]
CanManageMembers = Annotated[TenantContext, Depends(require_permission(Permission.MEMBERS_MANAGE))]


def organisation_response(organisation: Organisation) -> OrganisationResponse:
    return OrganisationResponse(
        id=organisation.id,
        name=organisation.name,
        slug=organisation.slug,
        country_code=organisation.country_code,
        default_currency=organisation.default_currency,
        timezone=organisation.timezone,
        distance_unit=organisation.distance_unit,
    )


def member_response(membership: OrganisationMembership, user: User) -> MemberResponse:
    return MemberResponse(
        id=membership.id,
        user_id=user.id,
        email=user.email,
        full_name=user.full_name,
        role=membership.role,
        status=membership.status,
    )


def invitation_response(invitation: OrganisationInvitation) -> InvitationResponse:
    return InvitationResponse(
        id=invitation.id,
        email=invitation.email,
        role=invitation.role,
        created_at=invitation.created_at,
        expires_at=invitation.expires_at,
    )


@router.post("/organisations", status_code=status.HTTP_201_CREATED)
def create_organisation(
    body: OrganisationCreate,
    auth: CsrfProtectedAuth,
    db: DbDep,
    redis: RedisDep,
    settings: SettingsDep,
) -> OrganisationResponse:
    return organisation_response(
        service.create_organisation(db, redis, settings, auth.user, auth.session, body.model_dump())
    )


@router.get("/organisations")
def list_my_organisations(auth: CurrentAuth, db: DbDep) -> list[MyOrganisationResponse]:
    active_id = auth.session.active_organisation_id
    return [
        MyOrganisationResponse(
            organisation=organisation_response(organisation),
            role=membership.role,
            is_active=organisation.id == active_id,
        )
        for organisation, membership in service.list_my_organisations(db, auth.user.id)
    ]


@router.post("/organisations/{organisation_id}/switch")
def switch_organisation(
    organisation_id: uuid.UUID, auth: CsrfProtectedAuth, db: DbDep
) -> OrganisationResponse:
    return organisation_response(
        service.switch_organisation(db, auth.user.id, auth.session, organisation_id)
    )


@router.post("/invitations/accept")
def accept_invitation(
    body: InvitationAccept, auth: CsrfProtectedAuth, db: DbDep
) -> OrganisationResponse:
    return organisation_response(service.accept_invitation(db, auth.user, auth.session, body.token))


# Everything below acts on the session's active organisation. No route takes an organisation ID,
# so there is none for a client to tamper with.


@router.get("/organisation")
def current_organisation(tenant: Tenant) -> CurrentMembershipResponse:
    role = tenant.membership.role
    return CurrentMembershipResponse(
        organisation=organisation_response(tenant.organisation),
        role=role,
        permissions=sorted(ROLE_PERMISSIONS[role]),
    )


@router.patch("/organisation")
def update_organisation(
    body: OrganisationUpdate, tenant: CanManageOrganisation, db: DbDep
) -> OrganisationResponse:
    return organisation_response(
        service.update_organisation(
            db, tenant.organisation, tenant.user.id, body.model_dump(exclude_none=True)
        )
    )


@router.post("/organisation/leave", status_code=status.HTTP_204_NO_CONTENT)
def leave_organisation(tenant: Tenant, db: DbDep) -> None:
    service.leave_organisation(db, tenant.membership, tenant.session)


@router.get("/organisation/members")
def list_members(tenant: CanViewMembers, db: DbDep) -> list[MemberResponse]:
    return [
        member_response(membership, user)
        for membership, user in service.list_members(db, tenant.organisation.id)
    ]


@router.patch("/organisation/members/{membership_id}")
def update_member(
    membership_id: uuid.UUID, body: MemberUpdate, tenant: CanManageMembers, db: DbDep
) -> MemberResponse:
    membership = service.update_member(db, tenant.membership, membership_id, body.role, body.status)
    user = db.get(User, membership.user_id)
    assert user is not None  # noqa: S101  (a membership always has a user)
    return member_response(membership, user)


@router.delete("/organisation/members/{membership_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_member(membership_id: uuid.UUID, tenant: CanManageMembers, db: DbDep) -> None:
    service.remove_member(db, tenant.membership, membership_id)


@router.post("/organisation/invitations", status_code=status.HTTP_201_CREATED)
def create_invitation(
    body: InvitationCreate,
    tenant: CanManageMembers,
    db: DbDep,
    redis: RedisDep,
    settings: SettingsDep,
    queue: EmailQueueDep,
) -> InvitationResponse:
    check_can_add_member(db, settings, tenant.organisation)
    return invitation_response(
        service.create_invitation(
            db,
            redis,
            settings,
            queue,
            tenant.membership,
            tenant.user,
            tenant.organisation,
            body.email,
            body.role,
        )
    )


@router.get("/organisation/invitations")
def list_invitations(tenant: CanManageMembers, db: DbDep) -> list[InvitationResponse]:
    return [
        invitation_response(item) for item in service.list_invitations(db, tenant.organisation.id)
    ]


@router.delete("/organisation/invitations/{invitation_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_invitation(invitation_id: uuid.UUID, tenant: CanManageMembers, db: DbDep) -> None:
    service.revoke_invitation(db, tenant.membership, invitation_id)
