from typing import Literal

import structlog
from redis import Redis
from redis.exceptions import RedisError
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.core.config import get_settings
from app.db.session import get_engine

CheckStatus = Literal["ok", "unavailable"]

REDIS_TIMEOUT_SECONDS = 2

logger = structlog.get_logger(__name__)


def check_database() -> CheckStatus:
    """Confirm PostgreSQL answers and that the PostGIS extension is installed."""
    try:
        with get_engine().connect() as connection:
            connection.execute(text("SELECT PostGIS_Version()"))
    except SQLAlchemyError as exc:
        logger.error("database_check_failed", error_type=type(exc).__name__)
        return "unavailable"
    return "ok"


def check_redis() -> CheckStatus:
    client = Redis.from_url(
        str(get_settings().redis_url),
        socket_connect_timeout=REDIS_TIMEOUT_SECONDS,
        socket_timeout=REDIS_TIMEOUT_SECONDS,
    )
    try:
        client.ping()
    except RedisError as exc:
        logger.error("redis_check_failed", error_type=type(exc).__name__)
        return "unavailable"
    finally:
        client.close()
    return "ok"


def check_dependencies() -> dict[str, CheckStatus]:
    return {"database": check_database(), "redis": check_redis()}
