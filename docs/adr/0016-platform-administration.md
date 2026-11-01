# ADR 0016: Platform administration

Status: Accepted (Phase 20)

## Decisions

- **Independent from organisation roles.** Being an organisation's owner or administrator gives nothing here. Access comes only from `users.is_platform_admin`, which is set from the command line on the server, and no API can change it.
- **Hidden.** Everyone else gets the same 404 as a route that doesn't exist.
- **A second check:** admins confirm their password, which lasts 30 minutes for that session and is limited to 5 attempts in 15 minutes. A stolen session alone doesn't open the area.
- **The database enforces it too.** All cross-organisation access goes through `SECURITY DEFINER` functions, and each re-checks admin status against the current user. A bug in these routes still can't read across organisations for anyone else.
- **Account-level facts only:** names, counts, status and audit entries. There's deliberately no way to browse a customer's routes, drivers or documents.
- **No impersonation.** Support can't sign in as a customer, which would blur the audit trail and expose private data.
- **Support actions need a reason,** of at least 5 characters, recorded in the audit log with who did it. Suspending an organisation or deactivating a user removes access at once and deletes nothing. Admins can't deactivate themselves.
- **Honest status.** Services are actually contacted. Each job records its last success in Redis, and shows late after twice its interval. An integration shows "set up" only to mean its settings exist, and the page says that doesn't prove it works.

## Consequences

- The password check doesn't suit accounts that only sign in with Google, so staff accounts need a password.
- Audit entries can be read across organisations and may name people. Access to this area should stay limited to a few people.
- There's no impersonation or data-export tool for support. Questions needing fleet data go through the customer.
