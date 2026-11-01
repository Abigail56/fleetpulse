from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, HttpUrl

from app.models.enums import BillingPlan, PaymentStatus
from app.schemas.auth import RequestModel

SubscriptionState = Literal["trial", "active", "grace", "expired"]


class PlanResponse(BaseModel):
    key: BillingPlan
    name: str
    price_per_vehicle: Decimal
    currency: str
    max_vehicles: int
    max_members: int | None


class BillingStatus(BaseModel):
    # False until a provider is configured. Nothing can be bought, and no limits apply.
    payments_enabled: bool
    enforced: bool
    state: SubscriptionState
    plan: BillingPlan | None
    trial_ends_at: datetime | None
    paid_until: datetime | None
    vehicles_paid_for: int
    vehicles_used: int
    members_used: int
    max_vehicles: int | None
    max_members: int | None


class CheckoutCreate(RequestModel):
    plan: BillingPlan


class CheckoutResponse(BaseModel):
    checkout_url: HttpUrl
    reference: str
    amount: Decimal
    currency: str
    vehicles: int


class PaymentResponse(BaseModel):
    id: str
    reference: str
    plan: BillingPlan
    vehicles: int
    amount: Decimal
    currency: str
    status: PaymentStatus
    created_at: datetime
    paid_at: datetime | None


class WebhookResult(BaseModel):
    outcome: str
