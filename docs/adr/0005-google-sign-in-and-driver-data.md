# ADR 0005: Google sign-in and driver personal data

Status: Accepted (Phase 9)

## Google sign-in

FleetPulse still owns accounts and sessions. Google is an additional way to prove who someone is, not the primary authentication provider, and a Google sign-in ends in the same database-backed session as a password one.

- **Flow:** OpenID Connect authorization code with PKCE, handled entirely by the API. Tokens never reach the browser or a URL.
- **Attempt state:** the nonce and PKCE verifier stay in Redis for 10 minutes and are deleted on first use. A cookie ties the attempt to the browser, which stops an attacker signing a victim in to the attacker's account.
- **ID token:** the signature, issuer, audience, expiry and nonce are all checked, and `email_verified` must be exactly `true`.
- **Identity:** Google's subject identifies the person (`user_identities`), not the email, which can change.

### Linking to an existing email

- **Verified account:** linked, and the owner is emailed.
- **Unverified account:** linked, and the password is replaced with a random one. Nobody proved the address when that password was set, so it may be an attacker's, chosen in advance.
- **New account:** created with a random password. The owner can set a real one through "forgot password".

This relies on Google's own email verification. A person who loses their Google account to someone else also loses this route into FleetPulse, as with any email-based recovery.

### Availability

The button only appears when `GET /auth/providers` says Google is configured. Until then there is no button that can fail.

## Driver personal data

Licence numbers, phone numbers and email addresses are treated as sensitive:

- Reading them needs `drivers.view_sensitive` (owner, administrator, fleet manager, dispatcher). Others get a masked licence and no contact details.
- Roles without that permission can't search those fields, because search results would reveal hidden values one character at a time.
- Audit entries record which fields changed, never their values.

**Field-level encryption isn't used.** It would prevent the duplicate-licence check and search, or require a separate key and blind-index design, and it mainly protects against a stolen database, which disk and backup encryption also address. Production must use encrypted storage and backups (Phase 22). This should be reviewed in Phase 21 against the data-protection laws of the launch markets.

Reads of sensitive fields aren't audited, because every list view would create entries. Retention and deletion of a former driver's personal data also still needs a decision, as archiving keeps it.

## Editing conflicts

Forms send the `updated_at` they loaded as `expected_updated_at`. If the record has changed since, the API returns 409 `stale_update`, and nothing is overwritten. Only changed fields are sent, but any change to the record counts as a conflict, which is the stricter and simpler rule.
