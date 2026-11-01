"""Fails when a new route forgets authentication or CSRF protection."""

from collections.abc import Callable
from typing import Any

from fastapi.dependencies.models import Dependant
from fastapi.routing import iter_route_contexts

from app.api.deps import (
    get_auth_context,
    get_tenant_context,
    require_csrf,
    require_trusted_origin,
)
from app.api.v1.router import api_router

PUBLIC_ROUTES = {
    ("GET", "/api/v1/health"),
    ("GET", "/api/v1/health/ready"),
    ("POST", "/api/v1/auth/register"),
    ("POST", "/api/v1/auth/verify-email"),
    ("POST", "/api/v1/auth/resend-verification"),
    ("POST", "/api/v1/auth/login"),
    ("POST", "/api/v1/auth/refresh"),
    ("POST", "/api/v1/auth/forgot-password"),
    ("POST", "/api/v1/auth/reset-password"),
    ("POST", "/api/v1/contact"),
    ("GET", "/api/v1/auth/providers"),
    ("GET", "/api/v1/auth/google/start"),
    ("GET", "/api/v1/auth/google/callback"),
    ("POST", "/api/v1/ingest/gps"),
    ("POST", "/api/v1/billing/webhooks/paystack"),
}


def dependency_calls(dependant: Dependant) -> set[Callable[..., Any]]:
    calls: set[Callable[..., Any]] = set()
    for dependency in dependant.dependencies:
        if dependency.call is not None:
            calls.add(dependency.call)
        calls |= dependency_calls(dependency)
    return calls


def api_routes() -> list[tuple[str, str, set[Callable[..., Any]]]]:
    routes = [
        (method, str(context.path), dependency_calls(getattr(context, "dependant")))  # noqa: B009
        for context in iter_route_contexts(api_router.routes)
        for method in context.methods or ()
    ]
    # Guards against these tests silently checking nothing.
    assert len(routes) >= len(PUBLIC_ROUTES)
    return routes


def test_every_non_public_route_requires_authentication() -> None:
    unprotected = [
        (method, path)
        for method, path, calls in api_routes()
        if (method, path) not in PUBLIC_ROUTES and get_auth_context not in calls
    ]
    assert unprotected == []


def test_every_authenticated_write_requires_csrf() -> None:
    unprotected = [
        (method, path)
        for method, path, calls in api_routes()
        if method not in {"GET", "HEAD"}
        and (method, path) not in PUBLIC_ROUTES
        and not calls & {require_csrf, get_tenant_context}
    ]
    assert unprotected == []


def test_every_route_checks_the_request_origin() -> None:
    assert [path for _, path, calls in api_routes() if require_trusted_origin not in calls] == []


def test_public_route_list_has_no_stale_entries() -> None:
    assert {(method, path) for method, path, _ in api_routes()} >= PUBLIC_ROUTES
