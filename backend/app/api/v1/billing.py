from typing import Annotated

from fastapi import APIRouter, Depends, Header, Request

from app.api.deps import DbDep, SettingsDep, TenantContext, require_permission
from app.core.errors import ApiError
from app.core.permissions import Permission
from app.schemas.billing import (
    BillingStatus,
    CheckoutCreate,
    CheckoutResponse,
    PaymentResponse,
    PlanResponse,
    WebhookResult,
)
from app.services import billing as service

router = APIRouter(prefix="/billing", tags=["billing"])

CanManage = Annotated[TenantContext, Depends(require_permission(Permission.BILLING_MANAGE))]
# Far larger than any real payment event, and too small to tie up the server.
MAX_WEBHOOK_BYTES = 256 * 1024


@router.get("/plans")
def list_plans(tenant: CanManage, settings: SettingsDep) -> list[PlanResponse]:
    _ = tenant
    return [
        PlanResponse(
            key=key,
            name=plan.name,
            price_per_vehicle=plan.price_per_vehicle,
            currency=settings.billing_currency,
            max_vehicles=plan.max_vehicles,
            max_members=plan.max_members,
        )
        for key, plan in service.PLANS.items()
    ]


@router.get("/status")
def billing_status(tenant: CanManage, db: DbDep, settings: SettingsDep) -> BillingStatus:
    current = service.usage(db, tenant.organisation)
    return BillingStatus(
        payments_enabled=service.provider_for(settings) is not None,
        enforced=settings.billing_enforced,
        state=current.state,
        plan=current.plan,
        trial_ends_at=current.trial_ends_at,
        paid_until=current.paid_until,
        vehicles_paid_for=current.vehicles_paid_for,
        vehicles_used=current.vehicles_used,
        members_used=current.members_used,
        max_vehicles=current.max_vehicles,
        max_members=current.max_members,
    )


@router.post("/checkout")
def start_checkout(
    body: CheckoutCreate, tenant: CanManage, db: DbDep, settings: SettingsDep
) -> CheckoutResponse:
    address, payment = service.start_checkout(
        db, settings, tenant.organisation, tenant.user.id, tenant.user.email, body.plan
    )
    return CheckoutResponse.model_validate(
        {
            "checkout_url": address,
            "reference": payment.reference,
            "amount": payment.amount,
            "currency": payment.currency,
            "vehicles": payment.vehicles,
        }
    )


@router.get("/payments")
def list_payments(tenant: CanManage, db: DbDep) -> list[PaymentResponse]:
    return [
        PaymentResponse(
            id=str(item.id),
            reference=item.reference,
            plan=item.plan,
            vehicles=item.vehicles,
            amount=item.amount,
            currency=item.currency,
            status=item.status,
            created_at=item.created_at,
            paid_at=item.paid_at,
        )
        for item in service.list_payments(db, tenant.organisation.id)
    ]


@router.post("/webhooks/paystack")
async def paystack_webhook(
    request: Request,
    db: DbDep,
    settings: SettingsDep,
    signature: Annotated[str | None, Header(alias="x-paystack-signature")] = None,
) -> WebhookResult:
    """Public by necessity, so the signature is what authenticates it."""
    provider = service.provider_for(settings)
    if provider is None or provider.name != "paystack":
        raise ApiError(404, "not_found", "Not found.")
    body = await request.body()
    if len(body) > MAX_WEBHOOK_BYTES:
        raise ApiError(413, "too_large", "That's too large.")
    return WebhookResult(outcome=service.handle_webhook(db, provider, body, signature))
