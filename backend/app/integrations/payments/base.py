from dataclasses import dataclass
from decimal import Decimal
from typing import Protocol


@dataclass(frozen=True)
class CheckoutRequest:
    reference: str
    email: str
    amount: Decimal
    currency: str
    callback_url: str
    metadata: dict[str, str]


@dataclass(frozen=True)
class VerifiedPayment:
    """Only ever built from a webhook whose signature has been checked."""

    event_id: str
    reference: str
    succeeded: bool
    amount: Decimal
    currency: str


class PaymentProvider(Protocol):
    """Everything FleetPulse needs from a payment service. Adding one means implementing this."""

    name: str

    def start_checkout(self, request: CheckoutRequest) -> str:
        """Returns the address to send the customer to. Paying there proves nothing by itself."""
        ...

    def verify_webhook(self, body: bytes, signature: str | None) -> bool:
        """Must compare in constant time, against the exact bytes received."""
        ...

    def parse_webhook(self, body: bytes) -> VerifiedPayment | None:
        """Returns None for events FleetPulse has no use for."""
        ...
