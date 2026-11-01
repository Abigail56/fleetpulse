# Running FleetPulse in production

**Status:** this setup has been checked on one machine with HTTPS, a locally issued certificate and stand-ins for email and storage (see [Checking a stack](#checking-a-stack)). It hasn't yet run on a real server, with a real domain, email provider or storage.

## What you need first

- A server with Docker Compose, at least 4 GB of memory, and ports 80 and 443 open.
- Two domain names pointing at it, on the same site, such as `app.example.com` and `api.example.com`. They have to share a site, or browsers won't send sign-in cookies.
- An email provider with SMTP and STARTTLS.
- A private S3-compatible bucket, with public access blocked. Turn on the provider's versioning, because database backups don't include files.
- Somewhere off the server to keep backups.

## First deployment

```bash
cp deploy/.env.production.example deploy/.env.production
chmod 600 deploy/.env.production
# Fill it in. Generate each secret with: openssl rand -hex 32

docker compose --env-file deploy/.env.production -f deploy/docker-compose.prod.yml up -d --build --wait
```

This builds the images, runs migrations, starts everything, and gets HTTPS certificates. It refuses to start in production with a missing or unsafe setting, such as no STARTTLS or the GPS simulator on.

Then:

1. Run [the checks](#checking-a-stack) against your real addresses.
2. Sign up your own account, and make it staff: `docker compose --env-file deploy/.env.production -f deploy/docker-compose.prod.yml exec api python -m app.db.make_platform_admin you@example.com`. Visit `/admin` and check that services and jobs are healthy.
3. Set up [backups](#backups), and do a [test restore](#restoring-from-a-backup).

## Releasing a new version

```bash
deploy/backup.sh
git pull
docker compose --env-file deploy/.env.production -f deploy/docker-compose.prod.yml up -d --build --wait
```

Migrations run by themselves before the API starts. If one fails, the API stays on the old version and doesn't start the new one.

**Rolling back:** check out the previous version and run the same `up` command. If the release included a migration, the old code may not work with the new database, so read the migration first. To undo it, run `alembic downgrade -1` in the `migrate` service, and note that this can lose data added since.

## Backups

```bash
deploy/backup.sh /path/to/backups
```

Schedule it daily with cron, and copy the file off the server: a backup on this server is lost with this server. Backups contain personal data, including location history, so store them encrypted and limit who can reach them.

Backups contain the database only. Uploaded files rely on the storage provider's versioning.

## Restoring from a backup

```bash
deploy/restore.sh backups/fleetpulse-20300101T000000Z.dump fleetpulse_restored
```

This restores into a new database and leaves the current one alone, so you can inspect it first. To go live with it, stop `api`, `worker` and `beat`, set `POSTGRES_DB=fleetpulse_restored` in `.env.production`, and run the `up` command. Do a test restore regularly: a backup you've never restored isn't known to work.

## Secrets

| Secret | Effect of changing it |
|---|---|
| `FLEETPULSE_JWT_SECRET` | Everyone's access token and CSRF token stop working until their next refresh |
| `FLEETPULSE_APP_DB_PASSWORD` | Applied by the `migrate` step on the next `up` |
| `POSTGRES_PASSWORD` | Must also be changed inside PostgreSQL, because it's only read when the database is first created |
| `REDIS_PASSWORD` | Rate-limit counters and queued jobs survive, because they're on disk |
| `FLEETPULSE_PAYSTACK_SECRET_KEY` | Webhooks signed with the old key stop being accepted |

Never commit `deploy/.env.production`. Git already ignores it.

## Monitoring

- **`/api/v1/health/ready`** returns 503 if the database or Redis is unreachable. Point an outside uptime monitor at it, and at the web address.
- **`/admin`** shows services, background jobs (including any that are late), failed emails and failed automation.
- **Logs** are JSON, on standard output: `docker compose ... logs -f api worker`. Ship them somewhere if you have more than one server.

Nothing currently pages anyone. Error tracking, such as Sentry, needs an account and isn't set up.

### If something's wrong

| Symptom | Check |
|---|---|
| Jobs show late in `/admin` | `beat` and `worker` are running, and there's exactly one `beat` |
| Sign-in fails right after sign-up with no error | The app and API domains are on the same site, and `FLEETPULSE_CORS_ORIGINS` is exact |
| No emails | Worker logs for `notification_email_failed`, and the SMTP settings |
| Uploads return 503 | The bucket exists, and the keys and endpoint are right |
| Live map says updates are paused | The proxy reaches the API, and `Origin` matches `APP_DOMAIN` |

## Scaling up

- **Database:** a managed PostgreSQL with PostGIS 17 gives you backups, failover and monitoring without the work. Set the URLs to point at it and remove the `db` service.
- **API and web:** run more copies behind the proxy. The live stream goes through Redis, so it works across copies, though this hasn't been tested with several servers.
- **`beat`:** always exactly one.

## Before taking real customers

- [ ] Real domains, HTTPS, email and storage, with [the checks](#checking-a-stack) passing against them
- [ ] A lawyer has reviewed the Terms and Privacy pages, including how long location history is kept, and `NEXT_PUBLIC_LEGAL_*` is set
- [ ] A real Paystack test payment, before setting `FLEETPULSE_BILLING_ENFORCED=true`
- [ ] Prices confirmed
- [ ] A real GPS device or vendor feed tested
- [ ] Backups scheduled and copied off the server, and a restore tested
- [ ] An outside uptime monitor
- [ ] OpenFreeMap reviewed, as it has no uptime guarantee
- [ ] An independent security test, because this project's own review can't replace one

## Checking a stack

To check a release on one machine before deploying it, the stack can run with a locally issued certificate and stand-ins for email and storage, using its own ports and data:

```bash
# Make deploy/.env.verify from the example, with APP_DOMAIN=app.fleetpulse.localhost,
# API_DOMAIN=api.fleetpulse.localhost, PUBLIC_PORT_SUFFIX=:8443, FLEETPULSE_ENVIRONMENT=staging,
# FLEETPULSE_SMTP_HOST=mailpit, FLEETPULSE_SMTP_PORT=1025, FLEETPULSE_SMTP_STARTTLS=false,
# FLEETPULSE_STORAGE_ENDPOINT_URL=http://storage:8333 and FLEETPULSE_STORAGE_PUBLIC_URL=http://localhost:9110
docker compose --env-file deploy/.env.verify -f deploy/docker-compose.prod.yml -f deploy/docker-compose.verify.yml up -d --build --wait
cd frontend && npx playwright test -c playwright.production.config.ts
```

Against a real deployment, set `E2E_PRODUCTION_URL`, `E2E_PRODUCTION_API_URL`, `E2E_PRODUCTION_MAIL_URL` and `E2E_REAL_CERTIFICATE=1`. The sign-up step needs an inbox the test can read, so on a real server use a staging environment with a mail catcher. Run it only where test accounts are acceptable.
