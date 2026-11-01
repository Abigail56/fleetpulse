from collections.abc import Callable
from datetime import UTC, datetime
from functools import wraps
from typing import Any

import structlog
from redis import Redis
from redis.exceptions import RedisError

from app.core.config import Settings, get_settings

KEY_PREFIX = "jobs:last_success:"
SOCKET_TIMEOUT_SECONDS = 2
# How often each job should run, in seconds. Twice this without success counts as late.
EXPECTED: dict[str, int] = {
    "alerts.sweep": 60,
    "notifications.dispatch": 30,
    "telemetry.ensure_partitions": 86400,
    "telemetry.apply_retention": 86400,
    "auth.cleanup": 86400,
}
LATE_FACTOR = 2

logger = structlog.get_logger(__name__)


def _client(settings: Settings) -> Redis:
    return Redis.from_url(
        str(settings.redis_url),
        socket_connect_timeout=SOCKET_TIMEOUT_SECONDS,
        socket_timeout=SOCKET_TIMEOUT_SECONDS,
        decode_responses=True,
    )


def tracked[**P, R](name: str) -> Callable[[Callable[P, R]], Callable[P, R]]:
    """Records success after a job finishes. Failing to record must never fail the job."""

    def decorate(function: Callable[P, R]) -> Callable[P, R]:
        @wraps(function)
        def run(*args: P.args, **kwargs: P.kwargs) -> R:
            result = function(*args, **kwargs)
            try:
                _client(get_settings()).set(f"{KEY_PREFIX}{name}", datetime.now(UTC).isoformat())
            except RedisError as exc:
                logger.warning("job_health_not_recorded", job=name, error=type(exc).__name__)
            return result

        return run

    return decorate


def job_states(settings: Settings) -> list[dict[str, Any]]:
    now = datetime.now(UTC)
    client = _client(settings)
    states: list[dict[str, Any]] = []
    for name, every in EXPECTED.items():
        try:
            raw = client.get(f"{KEY_PREFIX}{name}")
        except RedisError:
            states.append({"name": name, "state": "unknown", "last_success_at": None})
            continue
        last = datetime.fromisoformat(str(raw)) if raw else None
        if last is None:
            state = "never"
        elif (now - last).total_seconds() > every * LATE_FACTOR:
            state = "late"
        else:
            state = "ok"
        states.append({"name": name, "state": state, "last_success_at": last})
    return states
