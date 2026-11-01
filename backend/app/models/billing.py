import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import CheckConstraint, Index, UniqueConstraint
from sqlmodel import Field

from app.models.base import TIMESTAMPTZ, TenantOwned, Timestamps, UUIDPrimaryKey, enum_type, utcnow
from app.models.enums import BillingPlan, PaymentStatus


class Subscription(UUIDPrimaryKey, TenantOwned, Timestamps, table=True):
    __tablename__ = "subscriptions"
    __table_args__ = (UniqueConstraint("organisation_id"),)

    plan: BillingPlan = Field(sa_type=enum_type(BillingPlan, "plan"))
    # Paid up to here. Status is worked out from this, so it can't go stale.
    paid_until: datetime | None = Field(default=None, sa_type=TIMESTAMPTZ)
    vehicles_paid_for: int = Field(default=0)


class Payment(UUIDPrimaryKey, TenantOwned, table=True):
    """Created before the customer pays, so a webhook has an expected amount to match."""

    __tablename__ = "payments"
    __table_args__ = (
        UniqueConstraint("provider", "reference"),
        CheckConstraint("amount > 0", name="amount_positive"),
        CheckConstraint("currency ~ '^[A-Z]{3}$'", name="currency_iso4217"),
        Index("ix_payments_organisation_id_created_at", "organisation_id", "created_at"),
    )

    provider: str = Field(max_length=32)
    reference: str = Field(max_length=100)
    plan: BillingPlan = Field(sa_type=enum_type(BillingPlan, "plan"))
    vehicles: int
    amount: Decimal = Field(max_digits=14, decimal_places=2)
    currency: str = Field(max_length=3)
    status: PaymentStatus = Field(
        default=PaymentStatus.PENDING, sa_type=enum_type(PaymentStatus, "status")
    )
    created_by_user_id: uuid.UUID | None = Field(default=None, foreign_key="users.id")
    created_at: datetime = Field(default_factory=utcnow, sa_type=TIMESTAMPTZ, nullable=False)
    paid_at: datetime | None = Field(default=None, sa_type=TIMESTAMPTZ)


class BillingEvent(UUIDPrimaryKey, TenantOwned, table=True):
    """Each verified webhook, once. A repeat delivery hits the unique key and changes nothing."""

    __tablename__ = "billing_events"
    __table_args__ = (UniqueConstraint("provider", "event_id"),)

    provider: str = Field(max_length=32)
    event_id: str = Field(max_length=150)
    reference: str = Field(max_length=100)
    outcome: str = Field(max_length=32)
    received_at: datetime = Field(default_factory=utcnow, sa_type=TIMESTAMPTZ, nullable=False)
