# ADR 0015: Billing and integrations

Status: Accepted (Phase 19). **Not yet tested against a real payment account.**

## Decisions

- **A provider-neutral core with one adapter.** `integrations/payments/base.py` says what's needed from a provider. Paystack is the first, because it serves Nigeria, Ghana, Kenya and South Africa, and takes USD on eligible accounts. Adding Stripe or Flutterwave means writing one more adapter. The user hasn't chosen a provider yet, so this can change.
- **Only a verified webhook can mark a payment as paid.** The return from the payment page changes nothing, and that page just waits for confirmation.
- **Webhook checks, in order:** an HMAC-SHA512 signature over the exact bytes, compared in constant time; a reference we issued; the amount and currency that were expected. A mismatch grants nothing and is flagged for review.
- **Idempotency:** a unique key on provider and event means a repeat delivery changes nothing. The payment row is locked while it's processed.
- **An empty secret key counts as no key.** Otherwise anyone could sign a webhook with an empty key.
- **Off by default, in two steps.** Without a key, nothing can be bought and the webhook returns 404. Limits apply only when `billing_enforced` is on, and production refuses to start with limits on and no way to pay.
- **Status is worked out from dates,** not stored, so it can't go stale: trial for 14 days, active until `paid_until`, 7 days of grace, then expired.
- **Ending a subscription never removes data.** It stops adding vehicles and inviting people.
- **Periods are paid one at a time,** for 30 days, charged for the vehicles in use at checkout.
- **No card details reach FleetPulse.** Customers pay on the provider's page.

## Other integrations

GPS (Phase 10), email (Phase 3) and object storage (Phase 15) already have adapters. No integration with an external business system was added, because nothing yet justifies one. The spec asks for these only "where justified".

## Consequences

- **No automatic renewal yet.** Someone has to pay each period. Recurring charges need Paystack's subscription plans, set up with a real account.
- **Adding vehicles mid-period isn't charged** until the next payment.
- There are no invoices or tax handling yet. These depend on the business's registration and legal advice.
- The prices are the planned launch prices from the pricing page, in one configurable currency, and need the owner's confirmation.
