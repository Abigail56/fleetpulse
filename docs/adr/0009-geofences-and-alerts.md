# ADR 0009: Geofences and alerts

Status: Accepted (Phase 13)

## Decisions

- **Checks run inside ingestion:** positions, geofence events and alerts commit in one transaction, so a crash can't lose an entry or exit. A background queue could lose or reorder them. A fault in the checks is confined to a savepoint, because alerts must never cost us positions.
- **Conditions that positions can't reveal** (a vehicle going silent, a licence expiring) come from a Celery Beat sweep every 60 seconds. It reaches each organisation through one narrow `SECURITY DEFINER` function.
- **Occupancy rows mean "inside":** no row means outside. Entries and exits are atomic insert and delete operations, so two batches racing produce one event.
- **Avoiding false alarms:**
  - Drawing or redrawing a fence around a vehicle isn't an entry, and neither is a vehicle's first-ever position.
  - A late delivery updates history, but doesn't change where a vehicle is considered to be, so its crossings aren't recorded.
  - Speeding needs two consecutive readings within 5 minutes, without a weak or lost signal.
  - Unknown ignition is never treated as off.
  - A vehicle last reported with its ignition off, or in maintenance, isn't "offline".
  - Speed and ignition checks ignore positions over an hour old.
- **Unusual movement** has one specific meaning: moving with the ignition off, by speed of at least 10 km/h or at least 500 m between positions. It's a reason to look, not a finding of theft.
- **No default speed limit:** the right number varies by fleet and road, so it stays off until someone sets one.
- **Dedupe:** a continuing condition holds one unresolved alert per key, enforced by a partial unique index. Conditions resolve themselves when they end. An entry or exit is a moment, so acknowledging it closes it.
- **Simulated data:** alerts and events from simulated devices are labelled.

## Consequences

- Maintenance alerts wait for Phase 14, and document expiry beyond driver licences waits for Phase 16, because those records don't exist yet.
- Alerts appear in the app only. Email and other delivery is Phase 17.
- Geofences apply to every vehicle, not selected ones.
- Polygons can't cross the antimeridian.
- Alerts and geofence events have no retention period yet. They're location history, so this needs the same legal review as positions.
