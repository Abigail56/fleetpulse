import smtplib
from datetime import date

import structlog
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlmodel import Session

from app.core.config import get_settings
from app.db.partitions import drop_partitions_before, ensure_monthly_partitions
from app.db.session import get_engine
from app.integrations.smtp import send_via_smtp
from app.services import alerts, notifications
from app.services.job_health import tracked
from app.services.telemetry import simulate_tick
from app.worker.celery_app import celery_app

PARTITION_MONTHS_AHEAD = 4

logger = structlog.get_logger(__name__)


def _months_before(day: date, months: int) -> date:
    index = day.year * 12 + day.month - 1 - months
    return date(index // 12, index % 12 + 1, 1)


@celery_app.task(name="system.ping")  # type: ignore[untyped-decorator]
def ping() -> str:
    """Round-trip check that a worker is consuming from the broker."""
    return "pong"


@celery_app.task(  # type: ignore[untyped-decorator]
    name="email.send",
    autoretry_for=(smtplib.SMTPException, OSError),
    retry_backoff=True,
    retry_backoff_max=300,
    max_retries=5,
    ignore_result=True,
)
def send_email(to: str, subject: str, body: str) -> None:
    send_via_smtp(get_settings(), to, subject, body)


@celery_app.task(name="telemetry.ensure_partitions", ignore_result=True)  # type: ignore[untyped-decorator]
@tracked("telemetry.ensure_partitions")
def ensure_partitions() -> None:
    with get_engine().begin() as connection:
        ensure_monthly_partitions(connection, date.today(), PARTITION_MONTHS_AHEAD)


@celery_app.task(name="telemetry.apply_retention", ignore_result=True)  # type: ignore[untyped-decorator]
@tracked("telemetry.apply_retention")
def apply_retention() -> list[str]:
    cutoff = _months_before(date.today(), get_settings().telemetry_retention_months)
    with get_engine().begin() as connection:
        dropped = drop_partitions_before(connection, cutoff)
    logger.info("telemetry_retention_applied", dropped=dropped)
    return dropped


@celery_app.task(name="gps.simulate", ignore_result=True)  # type: ignore[untyped-decorator]
def simulate() -> int:
    settings = get_settings()
    if not settings.gps_simulator_enabled:
        return 0
    try:
        with Session(get_engine()) as db:
            return simulate_tick(db, settings)
    except SQLAlchemyError as exc:
        logger.error("gps_simulator_failed", error_type=type(exc).__name__)
        raise


@celery_app.task(name="alerts.sweep", ignore_result=True)  # type: ignore[untyped-decorator]
@tracked("alerts.sweep")
def sweep_alerts() -> int:
    with Session(get_engine()) as db:
        return alerts.sweep(db)


@celery_app.task(name="notifications.dispatch", ignore_result=True)  # type: ignore[untyped-decorator]
@tracked("notifications.dispatch")
def dispatch_notifications() -> None:
    settings = get_settings()

    def deliver(to: str, subject: str, body: str) -> None:
        send_via_smtp(settings, to, subject, body)

    with Session(get_engine()) as db:
        notifications.dispatch(db, settings, deliver)


@celery_app.task(name="auth.cleanup", ignore_result=True)  # type: ignore[untyped-decorator]
@tracked("auth.cleanup")
def cleanup_expired_auth() -> int:
    """Long-expired sessions and one-time tokens are of no use to anyone, so they're removed."""
    with get_engine().begin() as connection:
        removed = int(connection.execute(text("SELECT cleanup_expired_auth()")).scalar_one())
    logger.info("auth_cleanup_finished", removed=removed)
    return removed
