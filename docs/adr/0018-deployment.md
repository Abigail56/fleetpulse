# ADR 0018: Deployment

Status: Accepted (Phase 22). **Checked locally only. It hasn't run on a real server.**

## Decisions

- **Docker Compose on one server to start with.** It's enough for a first customer, is easy to understand, and every service can move to a managed one later. No host has been chosen yet.
- **Caddy as the proxy,** because it gets and renews HTTPS certificates by itself and needs very little configuration.
- **Only the proxy is published.** The database, Redis and application can only be reached inside the Compose network. That's also what makes trusting forwarded client addresses safe. Caddy replaces any forwarded address a client sends, and a test confirms forging one doesn't get around the login limit.
- **Migrations run as a one-time step before the API starts,** with the owner account available only to that step.
- **Containers run as non-root users.**
- **Backups restore into a new database,** leaving the current one alone until someone decides.
- **The same stack can be checked locally** with `docker-compose.verify.yml`, so what's tested is what would be deployed.

## Consequences

- One server is a single point of failure. A managed database and a second server are the first things to add.
- Nothing alerts anyone when something fails until an uptime monitor and error tracking are set up.
- `NEXT_PUBLIC_*` values are written into the web image, so changing a domain needs a rebuild.
