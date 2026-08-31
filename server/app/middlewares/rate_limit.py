"""The default rate limit, applied to every route that does not declare its own.

This replaces `slowapi.middleware.SlowAPIMiddleware`, which stopped limiting
anything at all under FastAPI 0.137. That release made `include_router` store
the router itself instead of copying its routes out, so `app.routes` holds
`_IncludedRouter` wrappers rather than a flat list of endpoints. SlowAPI walks
that list looking for an `.endpoint`, finds none, and treats every request as
unroutable — which it exempts. Measured on our own app: 35 requests to a plain
route produced zero calls to the limiter (CAR-126). Only the decorated routes
kept working, because those are counted inside the handler and never reach the
middleware.

The fix is `iter_route_contexts`, which FastAPI added for exactly this — it
flattens the tree back into the routes a caller can match against. The same
0.137 change broke Prometheus, Elastic APM and OpenTelemetry the same way.

Counting happens here rather than in a dependency so that it lands before
authentication and before the body is parsed: an unauthenticated flood should
cost us a dictionary lookup, not a database round trip.

The four underscore-prefixed attributes reached for below are SlowAPI's, and
using them is the price of keeping its decorators, its storage and its error
type. `tests/test_default_rate_limit.py` is what makes that safe to do.
"""

from __future__ import annotations

import time
from collections.abc import Awaitable, Callable
from typing import Any

from fastapi import Request, status
from fastapi.responses import JSONResponse
from fastapi.routing import iter_route_contexts
from slowapi.errors import RateLimitExceeded
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response
from starlette.routing import Match

from app.core.limiter import limiter


def _rate_limit_headers(request: Request) -> dict[str, str]:
    """The IETF `RateLimit-*` triad for whichever window SlowAPI last checked.

    `_check_request_limit` — called by this middleware and, for a decorated
    route, by the route's own wrapper before `call_next` returns here — always
    records the window it checked on `request.state.view_rate_limit` as
    `(RateLimitItem, identifiers)`, win or lose: the tighter of the 30/min and
    500/hour defaults here, or the route's own declared limit on a decorated
    route. So one read here after `call_next` covers both paths with no change
    to any route signature. Unset (exempt route, unmatched path) means no
    headers, correctly.
    """
    view_rate_limit = getattr(request.state, "view_rate_limit", None)
    if not view_rate_limit:
        return {}
    item, identifiers = view_rate_limit
    reset_epoch, remaining = limiter.limiter.get_window_stats(item, *identifiers)
    return {
        "RateLimit-Limit": str(item.amount),
        "RateLimit-Remaining": str(remaining),
        "RateLimit-Reset": str(max(0, round(reset_epoch - time.time()))),
    }


def rate_limit_handler(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    """Answer a throttled caller in the shape the app already understands.

    SlowAPI's own handler returns `{"error": "Rate limit exceeded: 20 per 1
    minute"}`. The mobile client reads `detail` and shows it verbatim, so that
    string reached the user as-is — developer wording, in English, in an app
    that is otherwise Hebrew. `Retry-After` gives the client something concrete
    to say instead of "try again later".

    `request` goes unused — this is Starlette's exception-handler signature, and
    the middleware below calls it directly rather than keeping a second copy.
    """
    # `exc.limit` is optional in slowapi's own typing; a minute is the shortest
    # window we declare anywhere, so it is the honest fallback.
    seconds = exc.limit.limit.get_expiry() if exc.limit else 60
    return JSONResponse(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        content={"detail": "Too many attempts. Try again shortly.", "retryAfterSeconds": seconds},
        headers={"Retry-After": str(seconds)},
    )


def _matched_endpoint(request: Request) -> Callable[..., Any] | None:
    """The handler this request is heading for, or None if nothing matches.

    Middleware runs before routing, so the decision has to be made twice — once
    here and once by FastAPI. None means an unknown path, which is left alone:
    it is answered with a 404 without touching anything expensive.
    """
    for context in iter_route_contexts(request.app.routes):
        match, _ = context.matches(request.scope)
        if match == Match.FULL:
            return context.endpoint
    return None


class DefaultRateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        if not limiter.enabled:
            return await call_next(request)

        endpoint = _matched_endpoint(request)
        if endpoint is None:
            return await call_next(request)

        name = f"{endpoint.__module__}.{endpoint.__name__}"
        # A route carrying `@limiter.limit` counts itself inside the handler, and
        # a tighter ceiling there must not be shadowed by the looser one here.
        # SlowAPI files a limit under `_dynamic_route_limits` instead when its
        # value is a callable, so checking only `_route_limits` would stack the
        # default on top of a ceiling that route already declared.
        if name in limiter._exempt_routes or name in limiter._route_limits or name in limiter._dynamic_route_limits:
            # A decorated route counts itself inside the handler, which
            # `call_next` runs — by the time it returns, `view_rate_limit` is
            # populated and `_rate_limit_headers` below picks it up.
            response = await call_next(request)
            response.headers.update(_rate_limit_headers(request))
            return response

        try:
            limiter._check_request_limit(request, endpoint, True)
        except RateLimitExceeded as exc:
            # Raising would escape past the exception handlers, which Starlette
            # installs inside the middleware stack rather than around it. The
            # caller would get a 500 for being too quick.
            response = rate_limit_handler(request, exc)
            response.headers.update(_rate_limit_headers(request))
            return response

        response = await call_next(request)
        response.headers.update(_rate_limit_headers(request))
        return response
