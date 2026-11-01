# ADR 0013: Notifications and automation

Status: Accepted (Phase 17)

## Decisions

- **The alert row is the outbox.** `alerts.notified_at` stays empty until a worker has told people and matched rules. Raising an alert and promising to deliver it therefore commit together, with no separate queue that could lose it. A job runs every 30 seconds, and `SKIP LOCKED` stops two workers taking the same alert.
- **Delivery is at least once, and duplicates are stopped by constraints:** one notification per person and alert, and one run per rule and alert.
- **Email retries with backoff,** up to 5 attempts, then records `failed` and says so on screen. Each email's result is committed straight after sending, so a crash can't resend earlier ones. A failed email doesn't affect the in-app notification.
- **Who's told is checked each time:** active, verified members whose role can view alerts. Rules can't send alerts to roles that can't view them, because alerts can name vehicles and people.
- **Defaults:** in-app for everything, and email for critical alerts only. People can change this per alert type. A rule can ask to email regardless, because an organisation may need to be sure someone hears.
- **An alert that ended before the job reached it tells nobody.**
- **Automation is rules from a fixed list:** triggered by alert types, limited by severity and vehicle, and acting by notifying roles or creating a work order. Actions are checked against a closed schema, so no user-supplied code exists to run. A rule's actions happen together or not at all, so a retry can't repeat half of them.
- **Retries:** up to 3 attempts with backoff, then `failed` in the history. Recorded outcomes are fixed phrases, never exception text, which could hold personal data. Turning a rule off also stops its pending retries.
- **Housekeeping:** a daily job removes sessions and one-time tokens that expired over 30 days ago, through one narrow `SECURITY DEFINER` function.

## Consequences

- A notification can arrive up to about 30 seconds after an alert.
- Alert emails go through the configured SMTP service, which needs a real provider in production.
- Emails have no one-click unsubscribe. People change preferences after signing in.
- Automation triggers only on alerts, not arbitrary events. Other triggers can be added when there's a need.
