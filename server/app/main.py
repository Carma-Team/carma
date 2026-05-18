from __future__ import annotations

# Set up logging FIRST so even early imports go through the right formatter.
from app.core.logging import configure_logging

configure_logging()

import logging

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi.util import get_remote_address

from app.config import settings
from app.middlewares.request_id import RequestIdMiddleware
from app.middlewares.request_log import RequestLogMiddleware
from app.monitoring import configure_monitoring
from app.routers import (
    auth,
    health,
    leaderboard,
    notifications,
    rewards,
    trips,
    users,
)

limiter = Limiter(key_func=get_remote_address, default_limits=["500/hour", "30/minute"])

app = FastAPI(
    title="CARMA API",
    description="Backend for the CARMA safe-driving rewards platform",
    version="0.1.0",
    docs_url="/api/docs",
    redoc_url=None,
    openapi_url="/api/openapi.json",
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore[arg-type]
app.add_middleware(SlowAPIMiddleware)

# Order matters: RequestId runs first (sets contextvar), then RequestLog uses it.
app.add_middleware(RequestLogMiddleware)
app.add_middleware(RequestIdMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logging.getLogger(__name__).exception("%s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "Internal server error", "path": request.url.path},
    )


app.include_router(auth.router)
app.include_router(users.router)
app.include_router(users.stats_router)
app.include_router(trips.router)
app.include_router(rewards.rewards_router)
app.include_router(rewards.vouchers_router)
app.include_router(leaderboard.router)
app.include_router(notifications.router)
app.include_router(health.router)


configure_monitoring(app)


@app.on_event("startup")
async def _startup() -> None:
    logging.getLogger(__name__).info(
        "CARMA API ready — env=%s, sms=%s, docs=/api/docs", settings.env, settings.sms_provider
    )
