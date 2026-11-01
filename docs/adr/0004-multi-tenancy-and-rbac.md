# ADR 0004: Multi-tenancy and role-based access

Status: Accepted (Phase 4)

## Decisions

### Layers of tenant isolation

1. **No organisation IDs in tenant routes.** The organisation comes from the session and is re-checked against the user's membership on every request, so removal or suspension applies immediately.
2. **Queries filter by organisation** in the service layer.
3. **Row-level security** makes the database enforce the same rule, so a forgotten filter returns nothing instead of another tenant's data.
4. **Composite foreign keys** make links between organisations impossible ([ADR 0002](0002-database-architecture.md)).

### Row-level security

- The app connects as `fleetpulse_app`, which isn't a superuser and doesn't own the tables. Migrations use the owner account through a separate URL that the running app never receives.
- Each transaction sets `app.current_organisation_id` and `app.current_user_id` with `set_config(..., true)`. They end with the transaction, so they can't leak through the connection pool, and a Session event reapplies them after each commit.
- With no context set, tenant tables return nothing.
- `ENABLE`, not `FORCE`: policies always apply to the app role because it isn't the owner, and migrations can still backfill.
- Telemetry partitions have no grants, so the protected parent table is the only route in.
- `users`, `sessions` and token tables have no RLS. They aren't tenant data, and login needs them before any context exists. Reads of other users' details must go through membership queries.

`organisation_id_for_invitation` is the only `SECURITY DEFINER` function the app can call. Accepting an invitation is the one point where the organisation isn't known yet. It needs the hash of the token and returns only the organisation ID.

### Roles and permissions

Each role's permissions are listed explicitly in `app/core/permissions.py`, without inheritance. Owner-only rules sit in the service layer:

- Only an owner can grant the owner role or change another owner.
- An organisation must keep at least one active owner. Changes lock the organisation row, so two concurrent demotions can't both succeed.
- `is_platform_admin` is separate, and no organisation role grants it.

Domain permissions such as `vehicles.manage` are defined now, ready for later phases, and the role table is expected to grow with them.

### Invitations

Invitations have their own table instead of an `invited` membership status with a pre-created user. Creating accounts for invited people would let someone set up an account for another person's address.

The link only works when signed in with the invited email address, so a forwarded or leaked link is useless to anyone else. A new invitation cancels the previous one, and a suspended member can't rejoin through an old link.

### Active organisation

Stored on the session, which keeps IDs out of URLs. Someone in exactly one organisation is placed there at login. Switching affects every tab of that session, so the frontend does a full page load and tells its other tabs to reload (`lib/session-change.ts`), and no tab can act on the previous organisation's data. A tab that misses the message (with no `BroadcastChannel` support, for example) would still send requests for the new organisation, which the API authorises correctly, but its screen could be out of date until reloaded.

## Consequences

- Every new table needs explicit grants, and an RLS policy if it holds tenant data. Tests fail otherwise.
- Migrations need permission to create roles, which managed PostgreSQL hosts handle differently. To be confirmed in Phase 22.
- Background jobs must set a tenant context per organisation; with none set, they see no tenant rows.
