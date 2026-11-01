import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal

import structlog
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, col, func, select

from app.core.config import Settings
from app.core.errors import ApiError
from app.db.session import set_db_context
from app.integrations.payments.base import CheckoutRequest, PaymentProvider, VerifiedPayment
from app.integrations.payments.paystack import PaystackProvider
from app.models import (
    BillingEvent,
    Organisation,
    OrganisationMembership,
    Payment,
    Subscription,
    Vehicle,
)
from app.models.base import utcnow
from app.models.enums import BillingPlan, MembershipStatus, PaymentStatus
from app.services.audit import record_audit

TRIAL_DAYS = 14
GRACE_DAYS = 7
PERIOD_DAYS = 30
REFERENCE_BYTES = 16

logger = structlog.get_logger(__name__)


@dataclass(frozen=True)
class Plan:
    name: str
    price_per_vehicle: Decimal
    max_vehicles: int
    max_members: int | None


# Must match the public pricing page. Enterprise is agreed by hand, so it can't be bought here.
PLANS = {
    BillingPlan.STARTER: Plan("Starter", Decimal("9.00"), 25, 5),
    BillingPlan.GROWTH: Plan("Growth", Decimal("15.00"), 250, None),
}
TRIAL_PLAN = PLANS[BillingPlan.STARTER]


def provider_for(settings: Settings) -> PaymentProvider | None:
    key = settings.paystack_secret_key
    # An empty key would let anyone sign a webhook, so it counts as no key at all.
    if key is None or not key.get_secret_value():
        return None
    return PaystackProvider(key.get_secret_value())


@dataclass(frozen=True)
class Usage:
    state: str
    plan: BillingPlan | None
    trial_ends_at: datetime | None
    paid_until: datetime | None
    vehicles_paid_for: int
    vehicles_used: int
    members_used: int
    max_vehicles: int | None
    max_members: int | None


def _subscription(db: Session, organisation_id: uuid.UUID) -> Subscription | None:
    return db.exec(
        select(Subscription).where(Subscription.organisation_id == organisation_id)
    ).first()


def usage(db: Session, organisation: Organisation) -> Usage:
    now = utcnow()
    subscription = _subscription(db, organisation.id)
    vehicles_used = db.exec(
        select(func.count()).where(
            Vehicle.organisation_id == organisation.id, col(Vehicle.archived_at).is_(None)
        )
    ).one()
    members_used = db.exec(
        select(func.count()).where(
            OrganisationMembership.organisation_id == organisation.id,
            OrganisationMembership.status == MembershipStatus.ACTIVE,
        )
    ).one()
    trial_ends = organisation.created_at + timedelta(days=TRIAL_DAYS)
    plan_key = None
    paid_until = None
    paid_for = 0
    if subscription is not None and subscription.paid_until is not None:
        plan_key = subscription.plan
        paid_until = subscription.paid_until
        paid_for = subscription.vehicles_paid_for
    if paid_until and now <= paid_until:
        state = "active"
    elif paid_until and now <= paid_until + timedelta(days=GRACE_DAYS):
        state = "grace"
    elif now <= trial_ends and paid_until is None:
        state = "trial"
    else:
        state = "expired"
    limits = PLANS.get(plan_key) if plan_key and state in ("active", "grace") else None
    if state == "trial":
        limits = TRIAL_PLAN
    return Usage(
        state,
        plan_key,
        trial_ends if paid_until is None else None,
        paid_until,
        paid_for,
        vehicles_used,
        members_used,
        limits.max_vehicles if limits else None,
        limits.max_members if limits else None,
    )


def _over_limit(message: str) -> ApiError:
    return ApiError(402, "plan_limit", message)


def check_can_add_vehicle(db: Session, settings: Settings, organisation: Organisation) -> None:
    """No-ops until billing is switched on, so nobody is limited before they can pay."""
    if not settings.billing_enforced:
        return
    current = usage(db, organisation)
    if current.state == "expired":
        raise _over_limit("Your subscription has ended. Renew it to add vehicles.")
    if current.max_vehicles is not None and current.vehicles_used >= current.max_vehicles:
        raise _over_limit(f"Your plan covers up to {current.max_vehicles} vehicles.")


def check_can_add_member(db: Session, settings: Settings, organisation: Organisation) -> None:
    if not settings.billing_enforced:
        return
    current = usage(db, organisation)
    if current.state == "expired":
        raise _over_limit("Your subscription has ended. Renew it to invite people.")
    if current.max_members is not None and current.members_used >= current.max_members:
        raise _over_limit(f"Your plan covers up to {current.max_members} team members.")


def start_checkout(
    db: Session,
    settings: Settings,
    organisation: Organisation,
    actor_id: uuid.UUID,
    actor_email: str,
    plan_key: BillingPlan,
) -> tuple[str, Payment]:
    provider = provider_for(settings)
    if provider is None:
        raise ApiError(409, "payments_not_configured", "Online payment isn't set up yet.")
    plan = PLANS.get(plan_key)
    if plan is None:
        raise ApiError(422, "plan_not_available", "That plan isn't available online.")
    current = usage(db, organisation)
    if current.vehicles_used > plan.max_vehicles:
        raise ApiError(
            409, "too_many_vehicles", f"That plan covers up to {plan.max_vehicles} vehicles."
        )
    # At least one, so a new fleet can start paying before adding vehicles.
    vehicles = max(current.vehicles_used, 1)
    payment = Payment(
        organisation_id=organisation.id,
        provider=provider.name,
        reference=f"fp_{secrets.token_urlsafe(REFERENCE_BYTES)}",
        plan=plan_key,
        vehicles=vehicles,
        amount=plan.price_per_vehicle * vehicles,
        currency=settings.billing_currency,
        created_by_user_id=actor_id,
    )
    db.add(payment)
    record_audit(
        db,
        "billing.checkout_started",
        actor_user_id=actor_id,
        organisation_id=organisation.id,
        entity_type="payment",
        entity_id=payment.id,
        details={"plan": plan_key.value, "vehicles": vehicles},
    )
    db.commit()
    address = provider.start_checkout(
        CheckoutRequest(
            reference=payment.reference,
            email=actor_email,
            amount=payment.amount,
            currency=payment.currency,
            callback_url=f"{settings.frontend_base_url.rstrip('/')}/billing?reference={payment.reference}",
            metadata={"organisation_id": str(organisation.id)},
        )
    )
    return address, payment


def _organisation_for_reference(db: Session, provider: str, reference: str) -> uuid.UUID | None:
    # A webhook arrives with no organisation context, and only a reference we issued can find one.
    return db.execute(
        text("SELECT payment_organisation(:provider, :reference)"),
        {"provider": provider, "reference": reference},
    ).scalar_one_or_none()


def handle_webhook(
    db: Session, provider: PaymentProvider, body: bytes, signature: str | None
) -> str:
    """The only thing that can mark a payment as paid. A browser redirect never does."""
    if not provider.verify_webhook(body, signature):
        raise ApiError(401, "invalid_signature", "The signature didn't match.")
    try:
        verified = provider.parse_webhook(body)
    except (KeyError, TypeError, ValueError) as exc:
        raise ApiError(422, "invalid_webhook", "The webhook couldn't be read.") from exc
    if verified is None:
        return "ignored"
    organisation_id = _organisation_for_reference(db, provider.name, verified.reference)
    if organisation_id is None:
        # Signed but not ours, so there's nothing to change. Acknowledged, so it isn't retried.
        logger.warning("billing_unknown_reference", provider=provider.name)
        return "ignored"
    set_db_context(db, organisation_id=organisation_id)
    return _apply(db, provider.name, organisation_id, verified)


def _apply(
    db: Session, provider: str, organisation_id: uuid.UUID, verified: VerifiedPayment
) -> str:
    now = utcnow()
    payment = db.exec(
        select(Payment)
        .where(
            Payment.provider == provider,
            Payment.reference == verified.reference,
            Payment.organisation_id == organisation_id,
        )
        .with_for_update()
    ).one()
    event = BillingEvent(
        organisation_id=organisation_id,
        provider=provider,
        event_id=verified.event_id,
        reference=verified.reference,
        outcome="pending",
    )
    db.add(event)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        return "duplicate"
    if not verified.succeeded:
        if payment.status == PaymentStatus.PENDING:
            payment.status = PaymentStatus.FAILED
        event.outcome = "failed"
    elif verified.amount != payment.amount or verified.currency != payment.currency:
        # Never grant service for a different sum than was asked for.
        payment.status = PaymentStatus.MISMATCHED
        event.outcome = "mismatched"
        logger.error("billing_amount_mismatch", reference=verified.reference)
    elif payment.status == PaymentStatus.PAID:
        event.outcome = "already_paid"
    else:
        payment.status = PaymentStatus.PAID
        payment.paid_at = now
        event.outcome = "paid"
        subscription = _subscription(db, organisation_id) or Subscription(
            organisation_id=organisation_id, plan=payment.plan
        )
        # Paying early adds to what's left rather than losing it.
        start = max(subscription.paid_until or now, now)
        subscription.plan = payment.plan
        subscription.paid_until = start + timedelta(days=PERIOD_DAYS)
        subscription.vehicles_paid_for = payment.vehicles
        subscription.updated_at = now
        db.add(subscription)
    db.add_all([payment, event])
    record_audit(
        db,
        f"billing.payment_{event.outcome}",
        organisation_id=organisation_id,
        entity_type="payment",
        entity_id=payment.id,
    )
    db.commit()
    return "processed"


def list_payments(db: Session, organisation_id: uuid.UUID) -> list[Payment]:
    return list(
        db.exec(
            select(Payment)
            .where(Payment.organisation_id == organisation_id)
            .order_by(col(Payment.created_at).desc())
            .limit(200)
        ).all()
    )
