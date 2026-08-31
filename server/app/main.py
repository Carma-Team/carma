from __future__ import annotations

# Set up logging FIRST so even early imports go through the right formatter.
from app.core.logging import configure_logging

configure_logging()

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded

from app.config import settings
from app.core.limiter import limiter
from app.middlewares.rate_limit import DefaultRateLimitMiddleware, rate_limit_handler
from app.middlewares.request_id import RequestIdMiddleware
from app.middlewares.request_log import RequestLogMiddleware
from app.monitoring import configure_monitoring
from app.routers import (
    admin_business_requests,
    auth,
    business,
    business_invitations,
    business_join_requests,
    business_memberships,
    fraud,
    friends,
    health,
    invites,
    leaderboard,
    levels,
    notifications,
    rewards,
    trips,
    users,
)


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    log = logging.getLogger(__name__)
    log.info("CARMA API ready — env=%s, sms=%s, docs=/api/docs", settings.env, settings.sms_provider)
    if settings.env == "production" and not settings.cors_allows_credentials:
        log.warning(
            "CORS_ORIGINS is '*' in production — credentialed cross-origin requests are refused. "
            "Set an explicit comma-separated origin list."
        )
    yield


app = FastAPI(
    title="CARMA API",
    description="Backend for the CARMA safe-driving rewards platform",
    version="0.1.0",
    docs_url="/api/docs",
    redoc_url=None,
    openapi_url="/api/openapi.json",
    lifespan=_lifespan,
)


# The handler is registered for the decorated routes, which raise from inside
# the handler; the middleware answers on its own — see `middlewares/rate_limit`.
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, rate_limit_handler)  # type: ignore[arg-type]
app.add_middleware(DefaultRateLimitMiddleware)

# Order matters: RequestId runs first (sets contextvar), then RequestLog uses it.
app.add_middleware(RequestLogMiddleware)
app.add_middleware(RequestIdMiddleware)

# Wildcard origins and credentials are mutually exclusive under the CORS spec.
# Asking for both used to be harmless only because Starlette quietly dropped the
# credentials — protection by accident. Say it out loud instead.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=settings.cors_allows_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    path = request.url.path
    logging.getLogger(__name__).exception("%s %s", request.method, path)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "Internal server error", "path": path},
    )


app.include_router(auth.router)
app.include_router(levels.router)
app.include_router(users.router)
app.include_router(users.stats_router)
app.include_router(trips.router)
app.include_router(fraud.router)
app.include_router(rewards.rewards_router)
app.include_router(rewards.vouchers_router)
app.include_router(business.router)
app.include_router(business_invitations.router)
app.include_router(business_invitations.redeem_router)
app.include_router(business_memberships.router)
app.include_router(business_join_requests.router)
app.include_router(admin_business_requests.router)
app.include_router(leaderboard.router)
app.include_router(friends.router)
app.include_router(invites.router)
app.include_router(notifications.router)
app.include_router(health.router)


configure_monitoring(app)
