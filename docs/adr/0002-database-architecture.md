# ADR 0002: Database architecture

Status: Accepted (Phase 2)

## Scope

The first migration creates the tables that Phases 3–12 depend on. Geofences, alerts, maintenance, expenses, inspections, documents, notifications, automation and billing get their tables in their own phases, when their requirements are worked through.

## Decisions

### Tenant isolation

Every tenant-owned table has a non-null `organisation_id`. References between tenant tables use **composite foreign keys that include `organisation_id`**, so the database rejects a link between two organisations even if application code has a bug. A unit test fails if any table breaks this rule.

Row-level security adds a second layer; see [ADR 0004](0004-multi-tenancy-and-rbac.md).

### Roles

Roles are a fixed set stored on the membership, with permissions defined in code (Phase 4), instead of `roles` and `permissions` tables. Customer-defined roles aren't a requirement, and code-defined permissions can be reviewed and tested. Tables can be added later if that changes.

### Telemetry

`vehicle_locations` is range-partitioned by month on `recorded_at`.

- **Retention:** dropping a partition is immediate and creates no table bloat, unlike bulk `DELETE`. `app.db.partitions.drop_partitions_before` does this. The retention period is not set yet.
- **New partitions:** the migration creates the current month and the next three. **Phase 10 must schedule `ensure_monthly_partitions`**, or new positions pile up in the default partition. The app role can't create tables, so that job needs the owner connection or a narrow `SECURITY DEFINER` function.
- **Default partition:** catches out-of-range timestamps (bad device clocks, for example), so ingestion doesn't lose data. A partition can't be created for a month while the default holds rows from that month, so it needs monitoring.
- **Idempotency:** the primary key `(organisation_id, vehicle_id, recorded_at)` makes a resent position a conflict rather than a duplicate.
- **Latest position:** `vehicle_latest_locations` holds one row per vehicle, so the live map doesn't scan history.
- **Honesty:** `is_simulated` is stored on every position, and unreported speed, heading and ignition stay NULL rather than zero.

Latitude and longitude are read from the `geography(Point, 4326)` column instead of being stored twice.

### Identity

- Emails are stored in lowercase, enforced by a CHECK constraint.
- Refresh, verification and reset tokens are stored only as hashes.
- A session is a refresh token family. Consumed tokens are kept, so presenting one again reveals reuse. A partial unique index allows one unconsumed token per session, so concurrent rotations can't both succeed. Expired rows need a cleanup job (Phase 17).
- IP addresses are not stored on sessions. The spec only allows them where justified and with a retention policy, and that case hasn't been made.

### Other conventions

- **Archiving, not deleting:** vehicles, drivers and organisations use `archived_at`, and foreign keys default to RESTRICT, so history survives. Uniqueness applies to non-archived rows.
- **Enums:** `VARCHAR` with a CHECK constraint, because PostgreSQL native enum changes are harder to migrate.
- **Audit log:** append-only through a trigger, with no foreign keys so records outlive what they describe. Retention will need a deliberate path around the trigger.
- **UUID primary keys:** IDs can't be guessed or enumerated. Random UUIDs index less efficiently than sequential ones; Python 3.13 has no built-in UUIDv7, so this can be revisited for high-volume tables.
- **Distances:** stored in kilometres, converted for display using `Organisation.distance_unit`.
- **Relationships:** models declare foreign keys but no ORM `Relationship()` attributes yet. Those get added where a service needs them.

## Consequences

- `alembic check` runs in the tests, so a model change without a migration fails.
- Autogenerate must only see the `public` schema, because the PostGIS image's `tiger` and `topology` tables are otherwise proposed for dropping. `migrations/env.py` enforces this. Always review generated migrations.
- Migrations need permission to `CREATE EXTENSION postgis`, which managed PostgreSQL hosts handle in different ways. To be confirmed in Phase 22.
- Driver personal data is covered in [ADR 0005](0005-google-sign-in-and-driver-data.md).
