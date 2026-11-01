import asyncio
import json
import time
import uuid
from collections import Counter

import structlog
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from redis.asyncio import Redis as AsyncRedis
from redis.exceptions import RedisError
from starlette.concurrency import run_in_threadpool

from app.api.cookies import ACCESS_COOKIE
from app.api.deps import get_auth_context, resolve_tenant
from app.core.config import Settings
from app.core.errors import ApiError
from app.core.permissions import Permission, role_has_permission
from app.db.session import get_session
from app.services.fleet_stream import channel_for

# Not on the main router: its dependencies are for HTTP requests.
router = APIRouter(prefix="/api/v1", tags=["tracking"])

CLOSE_UNAUTHORISED = 4401
CLOSE_FORBIDDEN = 4403
CLOSE_TOO_MANY = 4429
CLOSE_UNAVAILABLE = 1013
MAX_CONNECTIONS_PER_ORGANISATION = 1000
POLL_SECONDS = 1.0

logger = structlog.get_logger(__name__)
_connections: Counter[uuid.UUID] = Counter()


def _authorise(websocket: WebSocket, settings: Settings, token: str | None) -> uuid.UUID:
    """Returns the organisation to stream. Raises ApiError for anyone not allowed to see it."""
    # A connection lasts far longer than a request, so it doesn't hold a database session.
    factory = websocket.app.dependency_overrides.get(get_session, get_session)
    sessions = factory()
    db = next(sessions)
    try:
        auth = get_auth_context(db, settings, token)
        tenant = resolve_tenant(db, auth)
        if not role_has_permission(tenant.membership.role, Permission.VEHICLES_VIEW):
            raise ApiError(403, "forbidden", "You don't have permission to do that.")
        return tenant.organisation.id
    finally:
        sessions.close()


@router.websocket("/tracking/stream")
async def fleet_stream(websocket: WebSocket) -> None:
    settings: Settings = websocket.app.state.settings
    # Browsers attach cookies to cross-site WebSockets and CORS doesn't apply, so this check is
    # what stops another website opening this stream with a visitor's session.
    origin = websocket.headers.get("origin")
    if origin is None or origin not in settings.cors_origins:
        await websocket.close(code=CLOSE_FORBIDDEN)
        return

    token = websocket.cookies.get(ACCESS_COOKIE)
    try:
        organisation_id = await run_in_threadpool(_authorise, websocket, settings, token)
    except ApiError as exc:
        await websocket.close(
            code=CLOSE_UNAUTHORISED if exc.status_code == 401 else CLOSE_FORBIDDEN
        )
        return

    if _connections[organisation_id] >= MAX_CONNECTIONS_PER_ORGANISATION:
        await websocket.close(code=CLOSE_TOO_MANY)
        return

    redis = AsyncRedis.from_url(str(settings.redis_url))
    pubsub = redis.pubsub()
    _connections[organisation_id] += 1
    try:
        await websocket.accept()
        await pubsub.subscribe(channel_for(organisation_id))
        await websocket.send_json({"type": "ready"})
        receiver = asyncio.create_task(_wait_for_disconnect(websocket))
        last_check = time.monotonic()
        try:
            while not receiver.done():
                message = await pubsub.get_message(
                    ignore_subscribe_messages=True, timeout=POLL_SECONDS
                )
                if message is not None:
                    await websocket.send_json(json.loads(message["data"]))
                if time.monotonic() - last_check >= settings.gps_stream_recheck_seconds:
                    last_check = time.monotonic()
                    # Sign-out, revocation, removal or a role change ends the stream too.
                    allowed = await run_in_threadpool(_authorise, websocket, settings, token)
                    if allowed != organisation_id:
                        await websocket.close(code=CLOSE_FORBIDDEN)
                        return
                    await websocket.send_json({"type": "ping"})
        finally:
            receiver.cancel()
    except ApiError as exc:
        await websocket.close(
            code=CLOSE_UNAUTHORISED if exc.status_code == 401 else CLOSE_FORBIDDEN
        )
    except RedisError as exc:
        logger.warning("fleet_stream_redis_failed", error_type=type(exc).__name__)
        await websocket.close(code=CLOSE_UNAVAILABLE)
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        _connections[organisation_id] -= 1
        if _connections[organisation_id] <= 0:
            del _connections[organisation_id]
        await pubsub.aclose()  # type: ignore[no-untyped-call]
        await redis.aclose()


async def _wait_for_disconnect(websocket: WebSocket) -> None:
    # Nothing is expected from clients, and anything sent is discarded.
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        return
