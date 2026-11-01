from celery import Celery

from app.core.config import get_settings

DAY_SECONDS = 86400
SIMULATOR_SECONDS = 30
ALERT_SWEEP_SECONDS = 60
NOTIFICATION_SECONDS = 30

_redis_url = str(get_settings().redis_url)

celery_app = Celery(
    "fleetpulse",
    broker=_redis_url,
    backend=_redis_url,
    include=["app.worker.tasks"],
)
celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    result_expires=3600,
    broker_connection_retry_on_startup=True,
    # Run by one Celery Beat process only: see docker-compose.yml.
    beat_schedule={
        "telemetry-partitions": {"task": "telemetry.ensure_partitions", "schedule": DAY_SECONDS},
        "telemetry-retention": {"task": "telemetry.apply_retention", "schedule": DAY_SECONDS},
        "gps-simulator": {"task": "gps.simulate", "schedule": SIMULATOR_SECONDS},
        "alerts-sweep": {"task": "alerts.sweep", "schedule": ALERT_SWEEP_SECONDS},
        "notifications-dispatch": {
            "task": "notifications.dispatch",
            "schedule": NOTIFICATION_SECONDS,
        },
        "auth-cleanup": {"task": "auth.cleanup", "schedule": DAY_SECONDS},
    },
)
