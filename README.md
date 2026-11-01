# FleetPulse

Every Vehicle. Every Journey. Under Control.

FleetPulse is a multi-tenant fleet management SaaS: vehicles and drivers, GPS tracking and a live map, trips and dispatch, geofences and alerts, maintenance, fuel and expenses, inspections and compliance, notifications and automation, reports, billing and platform administration. All planned features are built, but it hasn't run in production, and no GPS vendor or payment provider is connected yet. The map on the landing page is a labelled demonstration with simulated data. See [the product specification](docs/product-spec.md), [architecture decisions](docs/adr/) and [how to run it in production](docs/operations.md). [The project guide](docs/project-guide.md) explains how it all works, and what it still needs.

## Prerequisites

- Docker with Compose
- [uv](https://docs.astral.sh/uv/) (installs Python 3.13 automatically)
- Node.js 22 and npm

## Setup

```bash
# 1. Configuration: copy, then replace both database passwords (each appears twice) and the JWT secret
cp .env.example .env
cp frontend/.env.example frontend/.env.local

# 2. Start PostGIS, Redis, file storage and the local email inbox (http://localhost:8027)
docker compose up -d --wait db redis mailpit storage

# 3. Database migrations, then the API at http://localhost:8010
cd backend
uv sync
uv run alembic upgrade head
uv run python -m app.db.provision_app_role
uv run uvicorn app.main:app --reload --port 8010

# 4. Background worker, in a second terminal
cd backend
uv run celery -A app.worker.celery_app worker --loglevel=INFO

# 5. Web app, at http://localhost:3210, in a third terminal
cd frontend
npm install
npm run dev
```

To run the migrations, API and worker in containers instead of steps 3 and 4, use `docker compose --profile app up -d --build`.

Health endpoints: `GET /api/v1/health` (the process is up) and `GET /api/v1/health/ready` (PostGIS and Redis are reachable; returns 503 if not).

## Database changes

Change the models in `backend/app/models/`, then from `backend/`:

```bash
uv run alembic revision --autogenerate -m "describe the change"
# Review the generated file before applying it. Autogenerate can miss or misread changes.
uv run alembic upgrade head
```

Tables are only ever created by migrations, never at application startup. Every new table needs explicit grants to `fleetpulse_app`, and a row-level security policy if it holds tenant data; tests fail otherwise. See [ADR 0004](docs/adr/0004-multi-tenancy-and-rbac.md). Telemetry partitions are managed as described in [ADR 0002](docs/adr/0002-database-architecture.md).

## GPS data

No tracking vendor is connected. Positions arrive through a documented feed ([docs/gps-ingestion.md](docs/gps-ingestion.md)), or from a simulator for testing, turned on with `FLEETPULSE_GPS_SIMULATOR_ENABLED=true`. Simulated positions are always labelled.

Scheduled upkeep and the simulator need one Celery Beat process, which `--profile app` starts. If you run the backend by hand, add `uv run celery -A app.worker.celery_app beat --loglevel=INFO`.

## Google sign-in (optional)

The button stays hidden until these are set. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials), create an **OAuth client ID** of type **Web application**, with this authorised redirect URI:

```text
http://localhost:8010/api/v1/auth/google/callback
```

Then add the values to `.env` and restart the API:

```bash
FLEETPULSE_GOOGLE_CLIENT_ID=your-client-id
FLEETPULSE_GOOGLE_CLIENT_SECRET=your-client-secret
```

In production, register the production callback instead and set `FLEETPULSE_API_PUBLIC_URL` to the API's https address.

## Local ports

| Service | Port |
|---|---|
| Web app | 3210 (browser tests: 3211) |
| API | 8010 |
| PostgreSQL | 5440 |
| Redis | 6390 |
| Mailpit SMTP / inbox | 1027 / 8027 |
| File storage (S3-compatible) | 9010 |

## Checks

Backend, from `backend/`:

```bash
uv run ruff check .
uv run ruff format --check .
uv run mypy app tests
uv run pytest                  # unit tests, no services needed
uv run pytest -m integration   # needs PostGIS, Redis and file storage running
```

Frontend, from `frontend/`:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run e2e:build                      # separate build on port 3211, so `npm run dev` can keep running
npm run e2e                            # browser tests
E2E_LIVE_API=1 npm run e2e             # also runs full journeys; needs the app containers
# The full journeys sign up many accounts from one address. Start the containers with
# FLEETPULSE_AUTH_REQUESTS_PER_HOUR_PER_IP=2000 for this run, or the rate limit stops them.
npm run e2e:dev                        # checks development mode, whose errors production builds never show
```

The first browser test run needs `npx playwright install chromium`.

CI runs the same checks through `.github/workflows/ci.yml`.

## Layout

```text
backend/app/
  api/        Routes, dependencies and cookies
  core/       Configuration, logging, security and rate limiting
  integrations/  External services (SMTP)
  schemas/    Request and response contracts
  db/         Database engine, sessions and partition management
  models/     SQLModel tables
  services/   Business logic
  worker/     Celery app and tasks
backend/migrations/  Alembic migrations
frontend/src/
  app/        Next.js routes and layouts
  components/ Shared UI and layout (see docs/design-system.md)
  features/   Feature modules
docs/         Product specification and architecture decisions
```

The scheduled jobs in the `worker` and `beat` containers act on the same database as the integration tests, and would race them. Before running `uv run pytest -m integration`, run `docker compose stop worker beat`, and start them again afterwards.

## Online payment (optional)

Billing stays off until a provider is configured. To turn it on with Paystack:

1. Set `FLEETPULSE_PAYSTACK_SECRET_KEY`, and `FLEETPULSE_BILLING_CURRENCY` to a currency your Paystack account accepts.
2. In the Paystack dashboard, set the webhook URL to `https://your-api-address/api/v1/billing/webhooks/paystack`.
3. Make a real test-mode payment, and check the subscription activates.
4. Only then set `FLEETPULSE_BILLING_ENFORCED=true`, which applies plan limits.

This has been tested against a stand-in for Paystack's server, and hasn't yet run against a real account.

## Platform administration

FleetPulse staff use `/admin`, which looks like a missing page to everyone else. Access can only be granted from the server, for an account with a verified email:

```bash
uv run python -m app.db.make_platform_admin someone@example.com          # from backend/
uv run python -m app.db.make_platform_admin someone@example.com --remove
```

## Production

See [docs/operations.md](docs/operations.md) for deployment, backups, restoring, monitoring and the pre-launch checklist.
