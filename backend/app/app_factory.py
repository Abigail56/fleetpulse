import time
import uuid
from collections.abc import Awaitable, Callable

import structlog
from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from redis import Redis
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.api.cookies import clear_auth_cookies
from app.api.v1 import fleet_stream
from app.api.v1.router import api_router
from app.core.config import Settings
from app.core.errors import ApiError
from app.core.logging import configure_logging

REDIS_TIMEOUT_SECONDS = 2

MAX_REQUEST_BYTES = 12 * 1024 * 1024

logger = structlog.get_logger(__name__)


async def log_requests(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    # Always generated here: a client-supplied ID could forge entries in the logs.
    request_id = str(uuid.uuid4())
    structlog.contextvars.clear_contextvars()
    structlog.contextvars.bind_contextvars(request_id=request_id)
    started = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        logger.exception("request_failed", method=request.method, path=request.url.path)
        raise
    response.headers["X-Request-ID"] = request_id
    logger.info(
        "request_completed",
        method=request.method,
        path=request.url.path,
        status_code=response.status_code,
        duration_ms=round((time.perf_counter() - started) * 1000, 1),
    )
    return response


async def add_security_headers(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    # API responses can hold private data; shared caches and browsers must not keep them.
    response.headers["Cache-Control"] = "no-store"
    if request.app.state.settings.cookie_secure:
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response


class LimitRequestSize:
    """Stops an oversized request while it arrives, before anything has to hold it all."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        declared = dict(scope["headers"]).get(b"content-length", b"0")
        if declared.isdigit() and int(declared) > MAX_REQUEST_BYTES:
            await _too_large(scope, receive, send)
            return
        received = 0
        responded = False

        async def counting_receive() -> Message:
            # Covers requests that don't declare a size, or understate it.
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > MAX_REQUEST_BYTES:
                    raise _RequestTooLarge
            return message

        async def tracking_send(message: Message) -> None:
            nonlocal responded
            responded = True
            await send(message)

        try:
            await self.app(scope, counting_receive, tracking_send)
        except _RequestTooLarge:
            if not responded:
                await _too_large(scope, receive, send)


class _RequestTooLarge(Exception):
    pass


async def _too_large(scope: Scope, receive: Receive, send: Send) -> None:
    response = JSONResponse(
        status_code=413,
        content={"error": {"code": "request_too_large", "message": "That's too large to send."}},
    )
    await response(scope, receive, send)


async def handle_api_error(request: Request, exc: Exception) -> Response:
    assert isinstance(exc, ApiError)  # noqa: S101  (registered for ApiError only)
    response = JSONResponse(
        status_code=exc.status_code,
        content={"error": {"code": exc.code, "message": exc.message}},
    )
    if exc.retry_after is not None:
        response.headers["Retry-After"] = str(exc.retry_after)
    if exc.clear_auth_cookies:
        clear_auth_cookies(response, request.app.state.settings)
    return response


async def handle_validation_error(_request: Request, exc: Exception) -> Response:
    """Replaces FastAPI's default, which echoes submitted values, including passwords."""
    assert isinstance(exc, RequestValidationError)  # noqa: S101  (registered for this type only)
    fields = [
        {"field": ".".join(str(part) for part in error["loc"]), "message": error["msg"]}
        for error in exc.errors()
    ]
    return JSONResponse(
        status_code=422,
        content={
            "error": {
                "code": "validation_error",
                "message": "Please check the submitted values.",
                "fields": fields,
            }
        },
    )


def create_app(settings: Settings) -> FastAPI:
    configure_logging(settings)
    app = FastAPI(
        title="FleetPulse API",
        version="0.1.0",
        docs_url=None if settings.is_production else "/docs",
        redoc_url=None,
        openapi_url=None if settings.is_production else "/openapi.json",
    )
    app.state.settings = settings
    app.state.redis = Redis.from_url(
        str(settings.redis_url),
        socket_connect_timeout=REDIS_TIMEOUT_SECONDS,
        socket_timeout=REDIS_TIMEOUT_SECONDS,
    )
    app.add_exception_handler(ApiError, handle_api_error)
    app.add_exception_handler(RequestValidationError, handle_validation_error)
    app.middleware("http")(add_security_headers)
    app.middleware("http")(log_requests)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        # Lets the web app read the name of a file it downloads.
        expose_headers=["Content-Disposition"],
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Content-Type", "X-CSRF-Token"],
    )
    # Added last, so it runs first.
    app.add_middleware(LimitRequestSize)
    app.include_router(api_router)
    app.include_router(fleet_stream.router)
    return app
