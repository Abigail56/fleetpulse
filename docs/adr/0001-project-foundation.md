# ADR 0001: Project foundation

Status: Accepted (Phase 1)

## Decisions

- **Monorepo:** `backend/` and `frontend/` live in one repository, so a change to an API and its client can ship together.
- **Python 3.13, pinned:** `backend/.python-version`, `requires-python` and the Docker image all use 3.13 rather than the host's 3.14, so every environment runs the same interpreter.
- **PostGIS and Redis in Docker:** local development and CI use the same images (`postgis/postgis:17-3.5`, `redis:8.0-alpine`).
- **Local ports:** 5440 (Postgres), 6390 (Redis), 8010 (API) and 3210 (web), bound to localhost, because the usual ports are often used by other projects.
- **Synchronous database access:** route handlers that touch the database are plain `def`, which FastAPI runs in a thread pool, so they don't block the event loop.
- **No insecure configuration defaults:** database and Redis URLs are required. The app refuses to start with a wildcard CORS origin in any environment, or a non-https origin in production.
- **Two test tiers:** `pytest` runs unit tests with no services. `pytest -m integration` needs real services and fails, rather than skips, when they are down.

## Consequences

- Alembic is added in Phase 2 with the first schema, and Celery Beat in Phase 17 with the first scheduled job.
- The frontend has no production container yet; that belongs to Phase 22.
