# ADR 0003: Authentication and session security

Status: Accepted (Phase 3)

## Decisions

### Tokens and sessions

- **Access token:** a 15-minute HS256 JWT in an HTTP-only cookie. The algorithm is fixed in code. Issuer, audience, expiry and all claims are required.
- **Revocation is immediate:** every authenticated request also loads the session from PostgreSQL. This costs one primary-key lookup per request, and means logout, revocation and deactivation don't wait for the JWT to expire.
- **Refresh token:** an opaque random value stored only as a SHA-256 hash. SHA-256 is suitable here because the value is high-entropy, so slow hashing adds nothing.
- **Session lifetime:** 14 days from the last refresh, capped at 90 days from sign-in.
- **Reuse detection:** presenting a consumed token revokes the whole session. Within 10 seconds of consumption it returns 409 instead, without issuing tokens, because two tabs refreshing together would otherwise sign the user out. The first response has already set the new cookies, so the client retries.
- **Refresh cookie path:** limited to `/api/v1/auth`, so ordinary API requests never carry it.

### CSRF

Three layers apply:

1. Cookies use `SameSite=Lax`.
2. Every unsafe request under `/api/v1` is rejected if its `Origin` header isn't in the allowlist.
3. Routes that act on a signed-in session require `X-CSRF-Token`, an HMAC of the session ID. It is returned in the body of login, refresh and `/me` responses, which other sites can't read, and the frontend keeps it in memory.

`/refresh` is exempt from the third layer, because after a page reload the client has no token until refresh succeeds. A forged call only rotates the victim's own cookies and reveals nothing.

**Deployment requirement:** the frontend and API must be on the same site (for example `app.example.com` and `api.example.com`). `SameSite=Lax` cookies aren't sent otherwise. `cookie_domain` stays unset unless a deployment needs sharing across subdomains.

### Account enumeration

Register, resend-verification and forgot-password return the same response whether or not an account exists. Registration hashes the password in every case, and login verifies against a dummy hash for unknown accounts. Those endpoints and the email ones also take at least 400 ms, which hides the small remaining differences in database work.

`email_not_verified` is only returned after the correct password, so it reveals nothing to someone guessing.

### Account pre-hijacking

An attacker could register someone else's address with a password they know. Two rules stop this:

1. Verifying an email requires the password chosen at registration as well as the link. A victim who clicks a link from an attacker's registration can't complete it, and the attacker never receives the link.
2. Registering an existing address, verified or not, never sends a verification link or changes the password. It sends "you already have an account" with a reset link. A reset replaces the password and proves ownership of the address.

### Rate limiting

Redis counters:

- Failed logins in 15 minutes: 10 per email and IP together, 100 per email from anywhere, 50 per IP.
- Other auth requests: 30 per hour per IP.
- Emails to any one address: 5 per hour.

Identifiers are hashed before being used as keys. **Login fails closed:** if Redis is down it returns 503, because otherwise password guessing would be unlimited.

The tight limit includes the IP, so someone elsewhere can't lock the real user out. A botnet could still reach the per-email ceiling and block that account for up to 15 minutes; this is accepted to stop distributed guessing.

### Email

Sent by a Celery task with retries and backoff, through an SMTP adapter. Development uses a Mailpit container. Production refuses to start without an SMTP host and STARTTLS.

One-time links pass through Redis in the task body until the worker takes them, so production Redis must be private and authenticated. Task arguments are redacted from worker logs and events.

### Other

- **Passwords:** 12–128 characters, rejecting a small list of common passwords, very repetitive ones, and ones containing the user's name or email. This isn't a breached-password check, which would need an external service.
- **Security headers:** every API response sets `nosniff`, `DENY` framing, `no-referrer` and `no-store`, plus HSTS in staging and production.
- **Validation errors:** a custom handler stops FastAPI echoing submitted values, including passwords, in 422 responses.
- **IP addresses:** used only as hashed rate-limit keys that expire; not stored on sessions or audit rows.
- **Signing key:** one secret signs JWTs and derives CSRF tokens, with domain separation. Rotating it signs everyone out of their current access token and invalidates CSRF tokens until the next refresh.

## Frontend

- Cookies belong to the API's host, so Next.js can't read them in production. Protected pages decide what to display from `/auth/me` in the browser, and the API authorises every request.
- `lib/api/client.ts` holds the CSRF token in memory only and shares one refresh between simultaneous requests, since duplicate refreshes would look like token theft.
- One-time tokens are removed from the address bar after being read, and those pages send no referrer.
- `next` redirects after sign-in are limited to paths on this site.
- Password forms clear on success, and signing out does a full page load (`changeSession`), to wipe data from memory.
- `cacheComponents`, which the project scaffold enabled, is turned off. It kept visited pages mounted but hidden along with their form values, and raised validation errors in development for pages that render only after the browser confirms the session. It's aimed at server-rendered content, while this app's signed-in pages render in the browser.

## Consequences

- Phase 6 must keep the CSRF token in memory, send it as `X-CSRF-Token`, call `/refresh` on 401 and retry on 409. Its verify-email page must ask for the password. Pages receiving tokens in URLs must set `Referrer-Policy: no-referrer`.
- Behind a proxy, the app must be configured to trust forwarded headers (Phase 22), or all users share one IP rate-limit bucket.
- Expired sessions and tokens need a cleanup job (Phase 17).
- Delivered email isn't tracked: after a worker exhausts its retries, the user must request another.
- `cryptography` isn't installed, because HS256 doesn't need it. It can be added if asymmetric signing or field encryption requires it.
