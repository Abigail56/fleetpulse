import hashlib

import structlog
from redis import Redis
from redis.exceptions import RedisError

from app.core.errors import ApiError

logger = structlog.get_logger(__name__)


def hashed_key(prefix: str, value: str) -> str:
    """Identifiers are hashed so Redis never holds readable emails or IP addresses."""
    return f"ratelimit:{prefix}:{hashlib.sha256(value.casefold().encode()).hexdigest()}"


def _unavailable(exc: RedisError) -> ApiError:
    # Fails closed: without Redis, password guessing would be unlimited.
    logger.error("rate_limit_unavailable", error_type=type(exc).__name__)
    return ApiError(503, "service_unavailable", "Please try again shortly.")


def _too_many(retry_after: int) -> ApiError:
    return ApiError(
        429,
        "too_many_requests",
        "Too many attempts. Please try again later.",
        retry_after=retry_after,
    )


def increment(redis: Redis, key: str, window_seconds: int) -> int:
    try:
        pipeline = redis.pipeline()
        pipeline.set(key, 0, nx=True, ex=window_seconds)
        pipeline.incr(key)
        return int(pipeline.execute()[1])
    except RedisError as exc:
        raise _unavailable(exc) from exc


def enforce_limit(redis: Redis, key: str, limit: int, window_seconds: int) -> None:
    """Count this request and reject it if it goes over the limit."""
    if increment(redis, key, window_seconds) > limit:
        raise _too_many(window_seconds)


def assert_under_limit(redis: Redis, key: str, limit: int, window_seconds: int) -> None:
    """Reject if already at the limit, without counting this request."""
    try:
        current = redis.get(key)
    except RedisError as exc:
        raise _unavailable(exc) from exc
    if current is not None and int(str(current, "ascii")) >= limit:  # type: ignore[arg-type]
        raise _too_many(window_seconds)


def reset(redis: Redis, key: str) -> None:
    try:
        redis.delete(key)
    except RedisError as exc:
        raise _unavailable(exc) from exc
