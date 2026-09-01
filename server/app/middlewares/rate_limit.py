"""Where every request gets counted — the default ceiling, a route's own tighter
one, and the bucket for a path that matches no route at all.

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

The underscore-prefixed names reached for below are SlowAPI's, and using them
is the price of keeping its decorators, its storage and its error type.
`tests/test_default_rate_limit.py` is what makes that safe to do.
"""

from __future__ import annotations

import time
from collections.abc import Awaitable, Callable
from typing import Any

import limits
from fastapi import Request, status
from fastapi.responses import JSONResponse
from fastapi.routing import iter_route_contexts
from slowapi.errors import RateLimitExceeded
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response
from starlette.routing import Match

from app.core.limiter import BURST_LIMIT, SUSTAINED_LIMIT, limiter

# SlowAPI's own tie-break for `view_rate_limit` compares window granularity
# (`RateLimitItem.__lt__`), not remaining budget, so on the default path it
# always resolves to the 30/minute item — a client pacing under that ceiling
# would never see the 500/hour budget in the headers until the request that
# it refuses. Both defaults share the middleware's key and scope, so
# re-querying both here and reporting whichever has less budget left is a
# second cheap storage read, not a second rate-limit check.
_DEFAULT_LIMIT_ITEMS = (limits.parse(SUSTAINED_LIMIT), limits.parse(BURST_LIMIT))


def _rate_limit_headers(request: Request) -> dict[str, str]:
    """The IETF `RateLimit-*` triad for the window actually binding this request.

    `_check_request_limit` — called by this middleware and, for a decorated
    route, by the route's own wrapper before `call_next` returns here —
    records the window it checked on `request.state.view_rate_limit` as
    `(RateLimitItem, identifiers)`. On the default path that item is always
    the 30/minute one; both defaults are re-queried below and the tighter
    result reported. A decorated route's own declared limit has no sibling to
    compare against and is used as-is. Unset (exempt route, unmatched path)
    means no headers, correctly.
    """
    view_rate_limit = getattr(request.state, "view_rate_limit", None)
    if not view_rate_limit:
        return {}
    item, identifiers = view_rate_limit
    candidates = _DEFAULT_LIMIT_ITEMS if item in _DEFAULT_LIMIT_ITEMS else (item,)
    tightest_item, reset_epoch, remaining = min(
        ((candidate, *limiter.limiter.get_window_stats(candidate, *identifiers)) for candidate in candidates),
        key=lambda stat: stat[2],
    )
    return {
        "RateLimit-Limit": str(tightest_item.amount),
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
    here and once by FastAPI. None means an unknown path or a method mismatch on
    a known one — a scan for `/admin` and a wrong-method probe of a real route
    both land here, and both must still spend a budget.
    """
    for context in iter_route_contexts(request.app.routes):
        match, _ = context.matches(request.scope)
        if match == Match.FULL:
            return context.endpoint
    return None


def _unmatched_bucket(request: Request) -> None:
    """Never called — only named, so every unrouteable request shares one key.

    `_check_request_limit` keys its counter off `__module__.__qualname__`. A
    real endpoint would give a 404 sweep one fresh budget per path tried; this
    sentinel gives the whole sweep one shared budget regardless of path.
    """


def _counts_by_address(endpoint_name: str) -> bool:
    """Whether every limit declared for this route can be counted here.

    A route keyed on the caller's address (the default, or a route's own
    tighter ceiling declared with no `key_func`) is safe to count before
    routing runs. A route keyed on something else — `business_key`, which
    reads `request.state.business_id` — depends on a FastAPI dependency that
    only runs *after* this middleware returns, so it cannot be evaluated here
    and is left for the decorator to count in-handler, as SlowAPI always did.
    """
    limits = limiter._route_limits.get(endpoint_name, [])
    groups = limiter._dynamic_route_limits.get(endpoint_name, [])
    key_funcs = [limit.key_func for limit in limits] + [group.key_function for group in groups]
    return all(key_func is limiter._key_func for key_func in key_funcs)


class DefaultRateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        if not limiter.enabled:
            return await call_next(request)

        endpoint = _matched_endpoint(request)

        try:
            if endpoint is None:
                limiter._check_request_limit(request, _unmatched_bucket, True)
            elif _counts_by_address(f"{endpoint.__module__}.{endpoint.__name__}"):
                # `in_middleware=False` is what makes `_check_request_limit` also
                # consult `_route_limits`/`_dynamic_route_limits` — the ceilings
                # `@limiter.limit` registers — so a route's own tighter budget is
                # spent here, before FastAPI parses the body. Setting the flag
                # below tells the decorator's own wrapper the check already ran,
                # so a request that clears validation is not counted twice.
                limiter._check_request_limit(request, endpoint, False)
                request.state._rate_limiting_complete = True
        except RateLimitExceeded as exc:
            # Raising would escape past the exception handlers, which Starlette
            # installs inside the middleware stack rather than around it. The
            # caller would get a 500 for being too quick.
            response: Response = rate_limit_handler(request, exc)
            response.headers.update(_rate_limit_headers(request))
            return response

        response = await call_next(request)
        response.headers.update(_rate_limit_headers(request))
        return response
