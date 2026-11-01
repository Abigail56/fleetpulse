import uuid
from dataclasses import dataclass
from datetime import timedelta

from redis import Redis
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, col, select

from app.core import rate_limit
from app.core.config import Settings
from app.core.errors import ApiError
from app.core.security import (
    burn_password_check,
    create_access_token,
    hash_password,
    hash_token,
    new_opaque_token,
    password_needs_rehash,
    password_problem,
    verify_password,
)
from app.db.session import set_db_context
from app.models import (
    AuthSession,
    EmailVerificationToken,
    OrganisationMembership,
    PasswordResetToken,
    RefreshToken,
    User,
    UserIdentity,
)
from app.models.base import utcnow
from app.models.enums import MembershipStatus
from app.services.audit import record_audit
from app.services.email import (
    EmailQueue,
    account_exists_email,
    google_linked_email,
    password_changed_email,
    password_reset_email,
    verification_email,
)


@dataclass(frozen=True)
class IssuedTokens:
    access_token: str
    refresh_token: str
    session_id: uuid.UUID


GOOGLE_PROVIDER = "google"


def normalize_email(email: str) -> str:
    return email.strip().lower()


def _invalid_token() -> ApiError:
    return ApiError(400, "invalid_token", "This link is invalid or has expired.")


def _invalid_session() -> ApiError:
    return ApiError(401, "invalid_session", "Please sign in again.", clear_auth_cookies=True)


def _issue_tokens(db: Session, settings: Settings, auth_session: AuthSession) -> IssuedTokens:
    """Extend the session and add a new refresh token. The caller commits."""
    now = utcnow()
    absolute_limit = auth_session.created_at + timedelta(days=settings.session_max_days)
    expires_at = min(now + timedelta(days=settings.refresh_token_days), absolute_limit)
    auth_session.expires_at = expires_at
    auth_session.last_active_at = now

    raw_refresh_token = new_opaque_token()
    db.add(
        RefreshToken(
            session_id=auth_session.id,
            token_hash=hash_token(raw_refresh_token),
            expires_at=expires_at,
        )
    )
    return IssuedTokens(
        access_token=create_access_token(settings, auth_session.user_id, auth_session.id),
        refresh_token=raw_refresh_token,
        session_id=auth_session.id,
    )


def _new_one_time_token[OneTimeTokenModel: (EmailVerificationToken, PasswordResetToken)](
    db: Session, model: type[OneTimeTokenModel], user_id: uuid.UUID, lifetime: timedelta
) -> str:
    """Create a token and cancel earlier ones, so only the latest email's link works."""
    now = utcnow()
    earlier = db.exec(
        select(model).where(model.user_id == user_id, col(model.consumed_at).is_(None))
    ).all()
    for token in earlier:
        token.consumed_at = now
    raw = new_opaque_token()
    db.add(model(user_id=user_id, token_hash=hash_token(raw), expires_at=now + lifetime))
    return raw


def _consume_one_time_token[OneTimeTokenModel: (EmailVerificationToken, PasswordResetToken)](
    db: Session, model: type[OneTimeTokenModel], raw: str, required_password: str | None = None
) -> User:
    # The row lock stops two simultaneous requests both using the same link.
    token = db.exec(
        select(model).where(model.token_hash == hash_token(raw)).with_for_update()
    ).first()
    now = utcnow()
    if token is None or token.consumed_at is not None or token.expires_at <= now:
        raise _invalid_token()
    user = db.get(User, token.user_id)
    if user is None or not user.is_active:
        raise _invalid_token()
    # Checked before consuming, so a mistyped password doesn't use up the link.
    if required_password is not None and not verify_password(user.password_hash, required_password):
        raise ApiError(400, "incorrect_password", "That isn't the password you registered with.")
    token.consumed_at = now
    return user


def _revoke_user_sessions(
    db: Session, user_id: uuid.UUID, reason: str, keep: uuid.UUID | None = None
) -> int:
    now = utcnow()
    sessions = db.exec(
        select(AuthSession).where(
            AuthSession.user_id == user_id, col(AuthSession.revoked_at).is_(None)
        )
    ).all()
    revoked = 0
    for auth_session in sessions:
        if auth_session.id != keep:
            auth_session.revoked_at = now
            auth_session.revoked_reason = reason
            revoked += 1
    return revoked


def register(
    db: Session, settings: Settings, queue: EmailQueue, email: str, password: str, full_name: str
) -> None:
    """Responds identically whether or not the address is taken; the email differs."""
    email = normalize_email(email)
    _require_acceptable_password(password, email, full_name)
    # Hashed first in every case, so timing doesn't reveal whether the address is taken.
    password_hash = hash_password(password)
    existing = db.exec(select(User).where(User.email == email)).first()

    if existing is None:
        user = User(email=email, password_hash=password_hash, full_name=full_name)
        db.add(user)
        try:
            db.flush()
        except IntegrityError:  # lost a race with a simultaneous registration
            db.rollback()
            queue(account_exists_email(settings, email))
            return
        record_audit(db, "auth.registered", actor_user_id=user.id)
        raw = _new_one_time_token(
            db, EmailVerificationToken, user.id, timedelta(hours=settings.email_verification_hours)
        )
        db.commit()
        queue(verification_email(settings, email, raw))
    else:
        # Also for unverified accounts, and never a verification link: the unverified password
        # may be an attacker's, set in advance. A reset replaces it; verifying would activate it.
        queue(account_exists_email(settings, email))


def resend_verification(db: Session, settings: Settings, queue: EmailQueue, email: str) -> None:
    email = normalize_email(email)
    user = db.exec(select(User).where(User.email == email)).first()
    if user is None or user.email_verified_at is not None or not user.is_active:
        return
    raw = _new_one_time_token(
        db, EmailVerificationToken, user.id, timedelta(hours=settings.email_verification_hours)
    )
    db.commit()
    queue(verification_email(settings, email, raw))


def _require_acceptable_password(password: str, email: str, full_name: str | None = None) -> None:
    problem = password_problem(password, email, full_name)
    if problem is not None:
        raise ApiError(400, "weak_password", problem)


def verify_email(db: Session, raw_token: str, password: str) -> None:
    """Needs the registration password too, so clicking a link from someone else's registration

    of your address can't activate an account whose password they know.
    """
    user = _consume_one_time_token(db, EmailVerificationToken, raw_token, password)
    user.email_verified_at = user.email_verified_at or utcnow()
    record_audit(db, "auth.email_verified", actor_user_id=user.id)
    db.commit()


def _sole_organisation_id(db: Session, user_id: uuid.UUID) -> uuid.UUID | None:
    """Someone in exactly one organisation goes straight there; others choose."""
    set_db_context(db, user_id=user_id)
    organisation_ids = db.exec(
        select(OrganisationMembership.organisation_id).where(
            OrganisationMembership.user_id == user_id,
            OrganisationMembership.status == MembershipStatus.ACTIVE,
        )
    ).all()
    return organisation_ids[0] if len(organisation_ids) == 1 else None


def login(
    db: Session,
    redis: Redis,
    settings: Settings,
    email: str,
    password: str,
    client_ip: str,
    user_agent: str | None,
) -> tuple[User, IssuedTokens]:
    email = normalize_email(email)
    window = settings.login_failure_window_seconds
    email_ip_key = rate_limit.hashed_key("login:email_ip", f"{email}|{client_ip}")
    email_key = rate_limit.hashed_key("login:email", email)
    ip_key = rate_limit.hashed_key("login:ip", client_ip)
    rate_limit.assert_under_limit(
        redis, email_ip_key, settings.login_max_failures_per_email_ip, window
    )
    rate_limit.assert_under_limit(redis, email_key, settings.login_max_failures_per_email, window)
    rate_limit.assert_under_limit(redis, ip_key, settings.login_max_failures_per_ip, window)

    user = db.exec(select(User).where(User.email == email)).first()
    if user is None:
        burn_password_check(password)
        password_ok = False
    else:
        password_ok = verify_password(user.password_hash, password)

    if user is None or not password_ok or not user.is_active:
        rate_limit.increment(redis, email_ip_key, window)
        rate_limit.increment(redis, email_key, window)
        rate_limit.increment(redis, ip_key, window)
        if user is not None:
            record_audit(db, "auth.login_failed", actor_user_id=user.id)
            db.commit()
        raise ApiError(401, "invalid_credentials", "Incorrect email or password.")

    # Only reached with the correct password, so this reveals nothing to a guesser.
    if user.email_verified_at is None:
        raise ApiError(403, "email_not_verified", "Please verify your email address first.")

    rate_limit.reset(redis, email_ip_key)
    rate_limit.reset(redis, email_key)
    if password_needs_rehash(user.password_hash):
        user.password_hash = hash_password(password)
    tokens = _start_session(db, settings, user, user_agent, method="password")
    db.commit()
    db.refresh(user)
    return user, tokens


def _start_session(
    db: Session, settings: Settings, user: User, user_agent: str | None, *, method: str
) -> IssuedTokens:
    """Adds to the caller's transaction, which commits."""
    now = utcnow()
    user.last_login_at = now
    auth_session = AuthSession(
        user_id=user.id,
        user_agent=user_agent[:512] if user_agent else None,
        created_at=now,
        expires_at=now + timedelta(days=settings.refresh_token_days),
        active_organisation_id=_sole_organisation_id(db, user.id),
    )
    db.add(auth_session)
    db.flush()
    tokens = _issue_tokens(db, settings, auth_session)
    record_audit(
        db,
        "auth.login",
        actor_user_id=user.id,
        entity_type="session",
        entity_id=auth_session.id,
        details={"method": method},
    )
    return tokens


def sign_in_with_google(
    db: Session,
    settings: Settings,
    queue: EmailQueue,
    subject: str,
    email: str,
    full_name: str,
    user_agent: str | None,
) -> IssuedTokens:
    """Finds or creates the account. Only called with an address Google says is verified."""
    email = normalize_email(email)
    identity = db.exec(
        select(UserIdentity).where(
            UserIdentity.provider == GOOGLE_PROVIDER, UserIdentity.provider_subject == subject
        )
    ).first()
    linked_existing = False
    if identity is not None:
        user = db.get(User, identity.user_id)
        if user is None:
            raise ApiError(401, "invalid_credentials", "This account can't sign in.")
    else:
        existing = db.exec(select(User).where(User.email == email)).first()
        if existing is None:
            # No usable password: the owner can set one later through "forgot password".
            user = User(
                email=email,
                password_hash=hash_password(new_opaque_token()),
                full_name=full_name[:200] or email,
                email_verified_at=utcnow(),
            )
            db.add(user)
            db.flush()
            record_audit(db, "auth.registered", actor_user_id=user.id, details={"method": "google"})
        else:
            user = existing
            linked_existing = True
            if user.email_verified_at is None:
                # Nobody proved this address when that password was set, so it may be an
                # attacker's, chosen in advance. The real owner has just proved it.
                user.password_hash = hash_password(new_opaque_token())
                user.password_changed_at = utcnow()
                user.email_verified_at = utcnow()
        db.add(UserIdentity(user_id=user.id, provider=GOOGLE_PROVIDER, provider_subject=subject))
        record_audit(
            db, "auth.identity_linked", actor_user_id=user.id, details={"provider": "google"}
        )
    if not user.is_active:
        db.rollback()
        raise ApiError(401, "invalid_credentials", "This account can't sign in.")
    tokens = _start_session(db, settings, user, user_agent, method="google")
    recipient = user.email
    db.commit()
    if linked_existing:
        queue(google_linked_email(settings, recipient))
    return tokens


def refresh_session(db: Session, settings: Settings, raw_token: str | None) -> IssuedTokens:
    if raw_token is None:
        raise _invalid_session()

    token = db.exec(
        select(RefreshToken)
        .where(RefreshToken.token_hash == hash_token(raw_token))
        .with_for_update()
    ).first()
    if token is None:
        raise _invalid_session()
    auth_session = db.get(AuthSession, token.session_id, with_for_update=True)
    now = utcnow()
    if (
        auth_session is None
        or auth_session.revoked_at is not None
        or auth_session.expires_at <= now
    ):
        raise _invalid_session()

    if token.consumed_at is not None:
        age = (now - token.consumed_at).total_seconds()
        if age <= settings.refresh_reuse_grace_seconds:
            # Another tab has just rotated this token. Its response already set the new cookies.
            raise ApiError(409, "refresh_in_progress", "Please retry the request.")
        # An old token being replayed means it was copied. Either copy could be the thief's,
        # so the whole session ends.
        auth_session.revoked_at = now
        auth_session.revoked_reason = "refresh_token_reuse"
        record_audit(
            db,
            "auth.refresh_reuse_detected",
            actor_user_id=auth_session.user_id,
            entity_type="session",
            entity_id=auth_session.id,
        )
        db.commit()
        raise _invalid_session()

    user = db.get(User, auth_session.user_id)
    if token.expires_at <= now or user is None or not user.is_active:
        raise _invalid_session()

    token.consumed_at = now
    db.flush()  # the consumed mark must land first: one unconsumed token per session
    tokens = _issue_tokens(db, settings, auth_session)
    db.commit()
    return tokens


def logout(db: Session, auth_session: AuthSession) -> None:
    auth_session.revoked_at = utcnow()
    auth_session.revoked_reason = "logout"
    record_audit(
        db,
        "auth.logout",
        actor_user_id=auth_session.user_id,
        entity_type="session",
        entity_id=auth_session.id,
    )
    db.commit()


def logout_all(db: Session, user_id: uuid.UUID) -> None:
    revoked = _revoke_user_sessions(db, user_id, "logout_all")
    record_audit(db, "auth.logout_all", actor_user_id=user_id, details={"sessions": revoked})
    db.commit()


def list_sessions(db: Session, user_id: uuid.UUID) -> list[AuthSession]:
    statement = (
        select(AuthSession)
        .where(
            AuthSession.user_id == user_id,
            col(AuthSession.revoked_at).is_(None),
            col(AuthSession.expires_at) > utcnow(),
        )
        .order_by(col(AuthSession.last_active_at).desc())
    )
    return list(db.exec(statement).all())


def revoke_session(db: Session, user_id: uuid.UUID, session_id: uuid.UUID) -> None:
    # Filtered by owner: someone else's session gets the same 404 as one that doesn't exist.
    auth_session = db.exec(
        select(AuthSession).where(
            AuthSession.id == session_id,
            AuthSession.user_id == user_id,
            col(AuthSession.revoked_at).is_(None),
        )
    ).first()
    if auth_session is None:
        raise ApiError(404, "not_found", "Session not found.")
    auth_session.revoked_at = utcnow()
    auth_session.revoked_reason = "user_revoked"
    record_audit(
        db,
        "auth.session_revoked",
        actor_user_id=user_id,
        entity_type="session",
        entity_id=session_id,
    )
    db.commit()


def forgot_password(db: Session, settings: Settings, queue: EmailQueue, email: str) -> None:
    email = normalize_email(email)
    user = db.exec(select(User).where(User.email == email)).first()
    if user is None or not user.is_active:
        return
    raw = _new_one_time_token(
        db, PasswordResetToken, user.id, timedelta(minutes=settings.password_reset_minutes)
    )
    record_audit(db, "auth.password_reset_requested", actor_user_id=user.id)
    db.commit()
    queue(password_reset_email(settings, email, raw))


def reset_password(
    db: Session, settings: Settings, queue: EmailQueue, raw_token: str, new_password: str
) -> None:
    user = _consume_one_time_token(db, PasswordResetToken, raw_token)
    _require_acceptable_password(new_password, user.email, user.full_name)
    now = utcnow()
    user.password_hash = hash_password(new_password)
    user.password_changed_at = now
    # Following the emailed link also proves ownership of the address.
    user.email_verified_at = user.email_verified_at or now
    revoked = _revoke_user_sessions(db, user.id, "password_reset")
    record_audit(db, "auth.password_reset", actor_user_id=user.id, details={"sessions": revoked})
    db.commit()
    queue(password_changed_email(settings, user.email))


def change_password(
    db: Session,
    settings: Settings,
    queue: EmailQueue,
    user: User,
    current_session_id: uuid.UUID,
    current_password: str,
    new_password: str,
) -> None:
    if not verify_password(user.password_hash, current_password):
        record_audit(db, "auth.password_change_failed", actor_user_id=user.id)
        db.commit()
        raise ApiError(400, "incorrect_password", "Your current password is incorrect.")
    _require_acceptable_password(new_password, user.email, user.full_name)
    user.password_hash = hash_password(new_password)
    user.password_changed_at = utcnow()
    revoked = _revoke_user_sessions(db, user.id, "password_changed", keep=current_session_id)
    record_audit(db, "auth.password_changed", actor_user_id=user.id, details={"sessions": revoked})
    db.commit()
    queue(password_changed_email(settings, user.email))
