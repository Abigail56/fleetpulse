# ADR 0006: GPS tracking

Status: Accepted (Phase 10)

## Decisions

- **Adapters:** a vendor format is translated in one adapter, and everything after that uses `RawPosition`. Only a documented generic feed exists today, and no vendor has been connected or tested.
- **Ingestion keys:** one per integration, belonging to one organisation, stored only as a SHA-256 hash and shown once. A vendor that signs its webhooks should have that signature checked in its adapter.
- **Isolation:** a key resolves to its organisation through a narrow `SECURITY DEFINER` function, and all later work runs under that organisation's row-level security. A key can't reach another organisation's devices.
- **Device IDs:** unique per organisation and provider, rather than globally as first designed, because one customer could otherwise block another by registering their device ID.
- **Attribution:** a position belongs to the device's current vehicle. Positions recorded before a device was moved are refused, rather than given to the wrong vehicle.
- **Timestamps:** positions more than 5 minutes ahead or 30 days old are rejected. This catches bad device clocks and keeps rows out of the default partition.
- **Stale data:** `is_stale` is calculated when read (after 15 minutes by default), from the position's own time, not when it arrived.
- **Simulator:** off by default, and only reachable by the worker. `is_simulated` comes from the device record, never the request, so simulated data can't pass as real or real as simulated.
- **Scheduled upkeep:** Celery Beat creates partitions and applies retention (13 months by default) daily, through `SECURITY DEFINER` functions, because the app role can't create or drop tables. Exactly one Beat process must run.
- **Journeys:** reconstructed when read, split at reporting gaps over 10 minutes, whenever the ignition is off, and when a vehicle stays within 50 metres for longer than that gap, so it also works without ignition data.

- **Real-time updates:** after a batch is stored, each vehicle's newest position is published to a Redis channel per organisation, and a native WebSocket forwards it. Publishing is best effort, because pages also refresh every 30 seconds. The socket checks `Origin` itself, because browsers send cookies on cross-site WebSockets and CORS doesn't apply, and it re-checks the session, membership and role every 60 seconds.

## Consequences

- The ingestion endpoint stores each batch in one statement. It has been measured on one development machine only, so it needs load testing on production-like hardware (Phase 21).
- Rows already in the default partition aren't removed by retention, and would block creating a partition for their month; the task logs that failure. Timestamp limits make this unlikely.
- Vehicle location history is personal data once a driver is assigned. The retention period and lawful basis need legal review by Phase 21.
