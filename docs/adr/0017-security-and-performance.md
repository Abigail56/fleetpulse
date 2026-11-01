# ADR 0017: Security review and performance

Status: Accepted (Phase 21)

## What was reviewed

Dependency scans (`pip-audit`, `npm audit`), static analysis (`bandit`), a search for committed secrets, and a manual review of authorisation, file access, uploads, injection and headers. The four medium `bandit` findings are SQL built from a constant column list, with values bound, so they're false positives.

This was the project's own review. It doesn't replace an independent security test before taking real customers.

## Decisions

- **Content-Security-Policy with a per-response nonce,** set in `src/proxy.ts`. Scripts need the nonce, so injected markup can't run. Connections are limited to the API, its stream and the map provider. Browser tests confirm injected inline scripts and event handlers are refused in Chromium and Firefox.
- **Every page now renders per request,** because a nonce can't be built ahead of time. This costs a little server work on public pages, and is the accepted price of not allowing `unsafe-inline`.
- **`style-src` allows `unsafe-inline`,** because style attributes are used throughout and can't run code.
- **Zod's `eval` probe is off,** so validation doesn't trip the policy.
- **Request size is limited to 12 MB as data arrives,** including when a request doesn't declare its size.
- **A file can belong to one document,** closing a route to a driver's private file through a vehicle document.

## Performance

Measured with 2,000 vehicles, 2,000 drivers, 50,000 trips, 50,000 fuel records and 50,000 alerts, on a development machine under memory pressure:

| Operation | Time |
|---|---|
| Live fleet query | 16 ms |
| Lists and alert counts | 3–190 ms |
| Slowest report, before and after loading only needed columns | 3.8 s → 1 s |
| Ingestion, 500 positions with 100 geofences | about 1.4 s |

These aren't production figures, because that machine was heavily swapping and ran everything itself. The fleet query was measured with no latest positions in that seed.

## Known limits

- An early test injected a script through the browser automation tool, and it ran. Script in the page's HTML, which is what real injection looks like, is refused. The tool is probably exempt, but that wasn't proven.
- Uploads never attached to a record stay in storage.
- Alerts, notifications and geofence events have no retention period yet, pending legal review.
- Backend test coverage is 95%. Frontend coverage hasn't been measured.
