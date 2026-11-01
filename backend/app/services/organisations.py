import re
import secrets
import uuid
from datetime import timedelta
from typing import Any

from redis import Redis
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, col, func, select

from app.core import rate_limit
from app.core.config import Settings
from app.core.errors import ApiError
from app.core.security import hash_token, new_opaque_token
from app.db.session import set_db_context
from app.models import (
    AuthSession,
    Organisation,
    OrganisationInvitation,
    OrganisationMembership,
    User,
)
from app.models.base import utcnow
from app.models.enums import MembershipStatus, OrganisationRole, OrganisationStatus
from app.services.audit import record_audit
from app.services.auth import normalize_email
from app.services.email import EmailQueue, invitation_email

HOUR_SECONDS = 3600
MAX_SLUG_BASE_LENGTH = 80


def _not_found(what: str) -> ApiError:
    return ApiError(404, "not_found", f"{what} not found.")


def _invalid_invitation() -> ApiError:
    # One message for every failure, so a link reveals nothing about who it was meant for.
    return ApiError(400, "invalid_invitation", "This invitation is invalid or has expired.")


def _slug_for(name: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:MAX_SLUG_BASE_LENGTH].strip("-")
    # The random suffix means a slug clash can't reveal that another organisation has this name.
    return f"{base or 'organisation'}-{secrets.token_hex(3)}"


def create_organisation(
    db: Session,
    redis: Redis,
    settings: Settings,
    user: User,
    auth_session: AuthSession,
    values: dict[str, Any],
) -> Organisation:
    rate_limit.enforce_limit(
        redis,
        rate_limit.hashed_key("create_organisation:user", str(user.id)),
        settings.organisations_per_hour_per_user,
        HOUR_SECONDS,
    )
    organisation = Organisation(slug=_slug_for(values["name"]), **values)
    set_db_context(db, organisation_id=organisation.id)
    db.add(organisation)
    db.flush()
    db.add(
        OrganisationMembership(
            organisation_id=organisation.id, user_id=user.id, role=OrganisationRole.OWNER
        )
    )
    auth_session.active_organisation_id = organisation.id
    record_audit(
        db,
        "organisation.created",
        actor_user_id=user.id,
        organisation_id=organisation.id,
        entity_type="organisation",
        entity_id=organisation.id,
    )
    db.commit()
    db.refresh(organisation)
    return organisation


def list_my_organisations(
    db: Session, user_id: uuid.UUID
) -> list[tuple[Organisation, OrganisationMembership]]:
    statement = (
        select(Organisation, OrganisationMembership)
        .join(
            OrganisationMembership,
            col(OrganisationMembership.organisation_id) == col(Organisation.id),
        )
        .where(
            OrganisationMembership.user_id == user_id,
            OrganisationMembership.status == MembershipStatus.ACTIVE,
            Organisation.status == OrganisationStatus.ACTIVE,
            col(Organisation.archived_at).is_(None),
        )
        .order_by(Organisation.name)
    )
    return [(row[0], row[1]) for row in db.exec(statement).all()]


def switch_organisation(
    db: Session, user_id: uuid.UUID, auth_session: AuthSession, organisation_id: uuid.UUID
) -> Organisation:
    # Same 404 for an organisation that doesn't exist and one this user isn't in.
    for organisation, _membership in list_my_organisations(db, user_id):
        if organisation.id == organisation_id:
            set_db_context(db, organisation_id=organisation_id)
            auth_session.active_organisation_id = organisation_id
            record_audit(
                db,
                "organisation.switched",
                actor_user_id=user_id,
                organisation_id=organisation_id,
                entity_type="session",
                entity_id=auth_session.id,
            )
            db.commit()
            db.refresh(organisation)
            return organisation
    raise _not_found("Organisation")


def update_organisation(
    db: Session, organisation: Organisation, actor_id: uuid.UUID, changes: dict[str, Any]
) -> Organisation:
    for field, value in changes.items():
        setattr(organisation, field, value)
    record_audit(
        db,
        "organisation.updated",
        actor_user_id=actor_id,
        organisation_id=organisation.id,
        entity_type="organisation",
        entity_id=organisation.id,
        details={"fields": sorted(changes)},
    )
    db.commit()
    db.refresh(organisation)
    return organisation


def list_members(
    db: Session, organisation_id: uuid.UUID
) -> list[tuple[OrganisationMembership, User]]:
    statement = (
        select(OrganisationMembership, User)
        .join(User, col(User.id) == col(OrganisationMembership.user_id))
        .where(OrganisationMembership.organisation_id == organisation_id)
        .order_by(User.full_name)
    )
    return [(row[0], row[1]) for row in db.exec(statement).all()]


def _lock_organisation(db: Session, organisation_id: uuid.UUID) -> None:
    """Serialises membership changes, so two requests can't remove the last two owners at once."""
    db.exec(select(Organisation).where(Organisation.id == organisation_id).with_for_update()).one()


def _get_member(
    db: Session, organisation_id: uuid.UUID, membership_id: uuid.UUID
) -> OrganisationMembership:
    membership = db.exec(
        select(OrganisationMembership).where(
            OrganisationMembership.id == membership_id,
            OrganisationMembership.organisation_id == organisation_id,
        )
    ).first()
    if membership is None:
        raise _not_found("Member")
    return membership


def _assert_not_last_owner(db: Session, target: OrganisationMembership) -> None:
    if target.role != OrganisationRole.OWNER or target.status != MembershipStatus.ACTIVE:
        return
    owners = db.exec(
        select(func.count())
        .select_from(OrganisationMembership)
        .where(
            OrganisationMembership.organisation_id == target.organisation_id,
            OrganisationMembership.role == OrganisationRole.OWNER,
            OrganisationMembership.status == MembershipStatus.ACTIVE,
        )
    ).one()
    if owners <= 1:
        raise ApiError(409, "last_owner", "An organisation must keep at least one owner.")


def _assert_may_manage(actor: OrganisationMembership, target: OrganisationMembership) -> None:
    if target.role == OrganisationRole.OWNER and actor.role != OrganisationRole.OWNER:
        raise ApiError(403, "forbidden", "Only an owner can change another owner.")


def _assert_may_grant(actor: OrganisationMembership, role: OrganisationRole) -> None:
    if role == OrganisationRole.OWNER and actor.role != OrganisationRole.OWNER:
        raise ApiError(403, "forbidden", "Only an owner can grant the owner role.")


def update_member(
    db: Session,
    actor: OrganisationMembership,
    membership_id: uuid.UUID,
    role: OrganisationRole | None,
    status: MembershipStatus | None,
) -> OrganisationMembership:
    _lock_organisation(db, actor.organisation_id)
    target = _get_member(db, actor.organisation_id, membership_id)
    _assert_may_manage(actor, target)
    if role is not None:
        _assert_may_grant(actor, role)
    if target.id == actor.id and status == MembershipStatus.SUSPENDED:
        raise ApiError(409, "cannot_suspend_self", "You can't suspend yourself.")

    stops_being_active_owner = (role is not None and role != OrganisationRole.OWNER) or (
        status is not None and status != MembershipStatus.ACTIVE
    )
    if stops_being_active_owner:
        _assert_not_last_owner(db, target)

    details: dict[str, str] = {}
    if role is not None and role != target.role:
        details |= {"role_from": target.role, "role_to": role}
        target.role = role
    if status is not None and status != target.status:
        details |= {"status_from": target.status, "status_to": status}
        target.status = status
    record_audit(
        db,
        "member.updated",
        actor_user_id=actor.user_id,
        organisation_id=actor.organisation_id,
        entity_type="membership",
        entity_id=target.id,
        details=details,
    )
    db.commit()
    db.refresh(target)
    return target


def remove_member(db: Session, actor: OrganisationMembership, membership_id: uuid.UUID) -> None:
    _lock_organisation(db, actor.organisation_id)
    target = _get_member(db, actor.organisation_id, membership_id)
    _assert_may_manage(actor, target)
    _assert_not_last_owner(db, target)
    record_audit(
        db,
        "member.removed",
        actor_user_id=actor.user_id,
        organisation_id=actor.organisation_id,
        entity_type="membership",
        entity_id=target.id,
        details={"user_id": str(target.user_id), "role": target.role},
    )
    db.delete(target)
    db.commit()


def leave_organisation(
    db: Session, membership: OrganisationMembership, auth_session: AuthSession
) -> None:
    _lock_organisation(db, membership.organisation_id)
    _assert_not_last_owner(db, membership)
    record_audit(
        db,
        "member.left",
        actor_user_id=membership.user_id,
        organisation_id=membership.organisation_id,
        entity_type="membership",
        entity_id=membership.id,
    )
    db.delete(membership)
    auth_session.active_organisation_id = None
    db.commit()


def create_invitation(
    db: Session,
    redis: Redis,
    settings: Settings,
    queue: EmailQueue,
    actor: OrganisationMembership,
    actor_user: User,
    organisation: Organisation,
    email: str,
    role: OrganisationRole,
) -> OrganisationInvitation:
    _assert_may_grant(actor, role)
    rate_limit.enforce_limit(
        redis,
        rate_limit.hashed_key("invite:org", str(organisation.id)),
        settings.invitations_per_hour_per_org,
        HOUR_SECONDS,
    )
    email = normalize_email(email)
    already_member = db.exec(
        select(OrganisationMembership.id)
        .join(User, col(User.id) == col(OrganisationMembership.user_id))
        .where(OrganisationMembership.organisation_id == organisation.id, User.email == email)
    ).first()
    if already_member is not None:
        raise ApiError(409, "already_member", "This person is already a member.")

    now = utcnow()
    # A new invitation replaces a pending one, so only the latest link works.
    for pending in db.exec(
        select(OrganisationInvitation).where(
            OrganisationInvitation.organisation_id == organisation.id,
            OrganisationInvitation.email == email,
            col(OrganisationInvitation.accepted_at).is_(None),
            col(OrganisationInvitation.revoked_at).is_(None),
        )
    ).all():
        pending.revoked_at = now
    db.flush()

    raw = new_opaque_token()
    invitation = OrganisationInvitation(
        organisation_id=organisation.id,
        email=email,
        role=role,
        token_hash=hash_token(raw),
        invited_by_user_id=actor.user_id,
        expires_at=now + timedelta(days=settings.invitation_days),
    )
    db.add(invitation)
    record_audit(
        db,
        "invitation.created",
        actor_user_id=actor.user_id,
        organisation_id=organisation.id,
        entity_type="invitation",
        entity_id=invitation.id,
        details={"role": role},
    )
    try:
        db.commit()
    except IntegrityError as exc:  # lost a race with an identical invitation
        db.rollback()
        raise ApiError(409, "invitation_conflict", "Please try again.") from exc
    db.refresh(invitation)
    queue(invitation_email(settings, email, raw, organisation.name, actor_user.full_name))
    return invitation


def list_invitations(db: Session, organisation_id: uuid.UUID) -> list[OrganisationInvitation]:
    statement = (
        select(OrganisationInvitation)
        .where(
            OrganisationInvitation.organisation_id == organisation_id,
            col(OrganisationInvitation.accepted_at).is_(None),
            col(OrganisationInvitation.revoked_at).is_(None),
            col(OrganisationInvitation.expires_at) > utcnow(),
        )
        .order_by(col(OrganisationInvitation.created_at).desc())
    )
    return list(db.exec(statement).all())


def revoke_invitation(db: Session, actor: OrganisationMembership, invitation_id: uuid.UUID) -> None:
    invitation = db.exec(
        select(OrganisationInvitation).where(
            OrganisationInvitation.id == invitation_id,
            OrganisationInvitation.organisation_id == actor.organisation_id,
            col(OrganisationInvitation.accepted_at).is_(None),
            col(OrganisationInvitation.revoked_at).is_(None),
        )
    ).first()
    if invitation is None:
        raise _not_found("Invitation")
    invitation.revoked_at = utcnow()
    record_audit(
        db,
        "invitation.revoked",
        actor_user_id=actor.user_id,
        organisation_id=actor.organisation_id,
        entity_type="invitation",
        entity_id=invitation.id,
    )
    db.commit()


def accept_invitation(
    db: Session, user: User, auth_session: AuthSession, raw_token: str
) -> Organisation:
    token_hash = hash_token(raw_token)
    # Row-level security hides invitations until the organisation is known, and the token is the
    # only way to learn it. This narrow database function answers just that question.
    organisation_id = db.execute(
        text("SELECT organisation_id_for_invitation(:token_hash)"), {"token_hash": token_hash}
    ).scalar_one_or_none()
    if organisation_id is None:
        raise _invalid_invitation()

    set_db_context(db, organisation_id=organisation_id)
    invitation = db.exec(
        select(OrganisationInvitation)
        .where(OrganisationInvitation.token_hash == token_hash)
        .with_for_update()
    ).first()
    now = utcnow()
    if (
        invitation is None
        or invitation.accepted_at is not None
        or invitation.revoked_at is not None
        or invitation.expires_at <= now
        # A leaked or forwarded link is useless to anyone but the invited address.
        or invitation.email != user.email
    ):
        raise _invalid_invitation()
    existing = db.exec(
        select(OrganisationMembership.id).where(
            OrganisationMembership.organisation_id == organisation_id,
            OrganisationMembership.user_id == user.id,
        )
    ).first()
    # Also stops a suspended member rejoining through an old invitation.
    if existing is not None:
        raise _invalid_invitation()

    invitation.accepted_at = now
    db.add(
        OrganisationMembership(
            organisation_id=organisation_id, user_id=user.id, role=invitation.role
        )
    )
    auth_session.active_organisation_id = organisation_id
    record_audit(
        db,
        "invitation.accepted",
        actor_user_id=user.id,
        organisation_id=organisation_id,
        entity_type="invitation",
        entity_id=invitation.id,
        details={"role": invitation.role},
    )
    db.commit()
    organisation = db.get(Organisation, organisation_id)
    if organisation is None:
        raise _invalid_invitation()
    return organisation
