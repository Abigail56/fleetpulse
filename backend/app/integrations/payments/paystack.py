import hashlib
import hmac
import json
from decimal import Decimal

import httpx

from app.core.errors import ApiError
from app.integrations.payments.base import CheckoutRequest, VerifiedPayment

API_BASE = "https://api.paystack.co"
TIMEOUT_SECONDS = 15
# Paystack counts in the currency's smallest unit, such as kobo or cents.
MINOR_UNITS = Decimal(100)
PAYMENT_EVENTS = {"charge.success": True, "charge.failed": False}


class PaystackProvider:
    name = "paystack"

    def __init__(self, secret_key: str, client: httpx.Client | None = None) -> None:
        self._secret_key = secret_key
        self._client = client or httpx.Client(base_url=API_BASE, timeout=TIMEOUT_SECONDS)

    def start_checkout(self, request: CheckoutRequest) -> str:
        unavailable = ApiError(503, "payment_unavailable", "Payment isn't available right now.")
        try:
            response = self._client.post(
                "/transaction/initialize",
                headers={"Authorization": f"Bearer {self._secret_key}"},
                json={
                    "reference": request.reference,
                    "email": request.email,
                    "amount": int(request.amount * MINOR_UNITS),
                    "currency": request.currency,
                    "callback_url": request.callback_url,
                    "metadata": request.metadata,
                },
            )
            response.raise_for_status()
            address = response.json()["data"]["authorization_url"]
        except (httpx.HTTPError, KeyError, TypeError, ValueError) as exc:
            raise unavailable from exc
        if not isinstance(address, str) or not address.startswith("https://"):
            raise unavailable
        return address

    def verify_webhook(self, body: bytes, signature: str | None) -> bool:
        if not signature:
            return False
        expected = hmac.new(self._secret_key.encode(), body, hashlib.sha512).hexdigest()
        return hmac.compare_digest(expected, signature)

    def parse_webhook(self, body: bytes) -> VerifiedPayment | None:
        event = json.loads(body)
        kind = event.get("event")
        if kind not in PAYMENT_EVENTS:
            return None
        data = event["data"]
        reference = str(data["reference"])
        return VerifiedPayment(
            # A reference has one success, so this also catches a provider's repeat deliveries.
            event_id=f"{kind}:{reference}",
            reference=reference,
            succeeded=PAYMENT_EVENTS[kind],
            amount=Decimal(int(data["amount"])) / MINOR_UNITS,
            currency=str(data["currency"]).upper(),
        )
