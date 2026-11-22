# Sending GPS data to FleetPulse

No tracking vendor is connected yet. Any device platform or script can send positions through this generic feed, and a vendor with its own format gets an adapter in `backend/app/integrations/gps/`.

## Tracking when cellular service is unavailable

FleetPulse is software; it does not include or manufacture a tracker to install in a vehicle. Each vehicle needs a compatible GPS/GNSS tracker and an active data connection to report live positions. For a pilot, an OBD-II tracker is easy to install in a compatible vehicle. For a mixed or heavy-vehicle fleet, ask an installer about a hardwired tracker suitable for the vehicle's 12/24 V system, with ignition sensing and backup power where needed.

To keep a route when the vehicle has no cellular service, choose a tracker that has **on-device store-and-forward memory**. It must keep GPS fixes with their original timestamps while offline and automatically upload the buffered fixes when its data connection returns. A GPS receiver can determine positions without cellular service, but FleetPulse cannot receive or display those positions live during the outage. Satellite messaging is not required for later route history; it is only an option if remote updates during a cellular outage are a separate requirement.

FleetPulse accepts timestamped backfill through the same feed. Positions up to 30 days old can be added to history; older positions are rejected. Send batches of at most 500 positions and 1 MB per request, inspect the per-position result, and retry `429` or `5xx` responses. Re-sending accepted positions is safe: duplicates are ignored. A backfilled position does not replace a newer live position or clear an offline alert; the alert clears when a newer fix arrives. Historical fixes can appear in route history after upload, but geofence crossings are not reconstructed for late deliveries and were therefore not delivered as real-time alerts.

Before buying hardware, confirm with the vendor: its offline storage capacity at the intended reporting interval, whether it preserves original timestamps, automatic backfill behavior, supported vehicle voltage/installation, and cellular coverage and data costs where the fleet operates. Test a real tracker by disconnecting cellular service, driving a known route, reconnecting, and comparing the uploaded route and timestamps with the tracker's own log. This has not yet been tested with a real device.

## Setting up

1. An owner or administrator creates an integration on the **Tracking** page and copies its key, which is shown only once.
2. Register each device with its ID from the provider, and assign it to a vehicle.

## Sending positions

```bash
curl -X POST https://API_HOST/api/v1/ingest/gps \
  -H "Authorization: Bearer fpgps_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"positions": [{
    "device_id": "IMEI-356938035643809",
    "recorded_at": "2026-10-30T14:05:00+01:00",
    "latitude": -1.2921,
    "longitude": 36.8219,
    "speed_kph": 42.5,
    "heading_degrees": 180,
    "ignition_on": true,
    "signal_status": "good"
  }]}'
```

| Field | Required | Notes |
|---|---|---|
| `device_id` | Yes | As registered in FleetPulse |
| `recorded_at` | Yes | ISO 8601 with a time zone |
| `latitude`, `longitude` | Yes | Decimal degrees |
| `speed_kph`, `heading_degrees`, `ignition_on` | No | Leave out if unknown; they're never assumed to be zero |
| `signal_status` | No | `good`, `weak`, `lost` or `unknown` |

Limits: 500 positions and 1 MB per request, and 600 requests a minute per key.

## The response

`202` with counts. A bad position doesn't reject the rest of the batch:

```json
{"accepted": 1, "duplicates": 0, "rejected": [{"index": 1, "reason": "unknown_device"}]}
```

Resending a position is safe, as it's counted under `duplicates`. Rejection reasons: `invalid: <fields>`, `unknown_device`, `device_inactive`, `device_not_assigned`, `vehicle_archived`, `timestamp_in_future`, `timestamp_too_old`, `recorded_before_reassignment`.

Retry on `429` and `5xx`. A `401` means the key is wrong or has been revoked.
