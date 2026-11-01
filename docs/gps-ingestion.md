# Sending GPS data to FleetPulse

No tracking vendor is connected yet. Any device platform or script can send positions through this generic feed, and a vendor with its own format gets an adapter in `backend/app/integrations/gps/`.

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
