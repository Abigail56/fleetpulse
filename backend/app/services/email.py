from collections.abc import Callable
from dataclasses import dataclass

import structlog
from kombu.exceptions import OperationalError

from app.core.config import Settings

logger = structlog.get_logger(__name__)


@dataclass(frozen=True)
class OutgoingEmail:
    to: str
    subject: str
    body: str


EmailQueue = Callable[[OutgoingEmail], None]


def queue_email_or_raise(email: OutgoingEmail) -> None:
    """For when the caller must know about failure, such as a contact form saying "sent"."""
    from app.worker.tasks import send_email  # imported here: the worker needs full settings

    send_email.apply_async(
        kwargs={"to": email.to, "subject": email.subject, "body": email.body},
        retry=False,
        # Bodies hold one-time links. Keep them out of worker logs and task events.
        argsrepr="()",
        kwargsrepr="{}",
    )


def queue_email(email: OutgoingEmail) -> None:
    """Hand off to the worker, so response time doesn't reveal whether an email was sent.

    A failed hand-off is logged but not raised: telling the caller would reveal that an account
    exists. The user can request another email.
    """
    try:
        queue_email_or_raise(email)
    except OperationalError as exc:
        logger.error("email_queue_failed", error_type=type(exc).__name__)


def verification_email(settings: Settings, to: str, token: str) -> OutgoingEmail:
    link = f"{settings.frontend_base_url}/verify-email?token={token}"
    return OutgoingEmail(
        to=to,
        subject="Verify your FleetPulse email address",
        body=(
            f"Confirm your email address by opening this link:\n\n{link}\n\n"
            "You'll be asked for the password you chose when you registered. "
            f"The link expires in {settings.email_verification_hours} hours.\n\n"
            "If you didn't create a FleetPulse account, ignore this email."
        ),
    )


def account_exists_email(settings: Settings, to: str) -> OutgoingEmail:
    return OutgoingEmail(
        to=to,
        subject="You already have a FleetPulse account",
        body=(
            "Someone tried to register with this email address, but it already has an account.\n\n"
            f"To sign in, go to {settings.frontend_base_url}/login\n"
            f"Forgot your password? Reset it at {settings.frontend_base_url}/forgot-password\n\n"
            "If this wasn't you, no action is needed."
        ),
    )


def password_reset_email(settings: Settings, to: str, token: str) -> OutgoingEmail:
    link = f"{settings.frontend_base_url}/reset-password?token={token}"
    return OutgoingEmail(
        to=to,
        subject="Reset your FleetPulse password",
        body=(
            f"Reset your password by opening this link:\n\n{link}\n\n"
            f"It expires in {settings.password_reset_minutes} minutes. "
            "If you didn't ask for this, you can ignore this email; your password hasn't changed."
        ),
    )


def invitation_email(
    settings: Settings, to: str, token: str, organisation_name: str, inviter_name: str
) -> OutgoingEmail:
    link = f"{settings.frontend_base_url}/accept-invitation?token={token}"
    return OutgoingEmail(
        to=to,
        subject="You've been invited to an organisation on FleetPulse",
        body=(
            f'{inviter_name} invited you to join "{organisation_name}" on FleetPulse.\n\n'
            f"To accept, sign in or create an account with this email address, "
            f"then open this link:\n\n{link}\n\n"
            f"It expires in {settings.invitation_days} days. "
            "If you weren't expecting this, you can ignore this email."
        ),
    )


def contact_message_email(
    inbox: str, name: str, email: str, company: str | None, fleet_size: str | None, message: str
) -> OutgoingEmail:
    return OutgoingEmail(
        to=inbox,
        subject="New FleetPulse website enquiry",
        body=(
            f"From: {name} <{email}>\n"
            f"Company: {company or 'Not given'}\n"
            f"Fleet size: {fleet_size or 'Not given'}\n\n"
            f"{message}"
        ),
    )


def google_linked_email(settings: Settings, to: str) -> OutgoingEmail:
    return OutgoingEmail(
        to=to,
        subject="Google sign-in was added to your FleetPulse account",
        body=(
            "You can now sign in to FleetPulse with Google.\n\n"
            "If this wasn't you, reset your password at "
            f"{settings.frontend_base_url}/forgot-password and contact your administrator."
        ),
    )


def password_changed_email(settings: Settings, to: str) -> OutgoingEmail:
    return OutgoingEmail(
        to=to,
        subject="Your FleetPulse password was changed",
        body=(
            "Your password was just changed.\n\n"
            "If this wasn't you, reset your password immediately at "
            f"{settings.frontend_base_url}/forgot-password"
        ),
    )
