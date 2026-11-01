import json
import uuid
from functools import lru_cache
from typing import Any

import structlog
from redis import Redis
from redis.exceptions import RedisError

from app.core.config import Settings

SOCKET_TIMEOUT_SECONDS = 2

logger = structlog.get_logger(__name__)


def channel_for(organisation_id: uuid.UUID) -> str:
    """One channel per organisation, so a subscriber can't receive another's positions."""
    return f"fleet:{organisation_id}"


@lru_cache
def _client(url: str) -> Redis:
    return Redis.from_url(
        url, socket_connect_timeout=SOCKET_TIMEOUT_SECONDS, socket_timeout=SOCKET_TIMEOUT_SECONDS
    )


def publish_positions(
    settings: Settings, organisation_id: uuid.UUID, positions: list[dict[str, Any]]
) -> None:
    """Best effort: positions are already stored, and pages also refresh on a timer."""
    try:
        _client(str(settings.redis_url)).publish(
            channel_for(organisation_id),
            json.dumps({"type": "positions", "positions": positions}),
        )
    except RedisError as exc:
        logger.warning("fleet_stream_publish_failed", error_type=type(exc).__name__)
