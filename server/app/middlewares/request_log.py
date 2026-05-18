"""One structured log line per request, with duration and status code."""

from __future__ import annotations

import logging
import time

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.core.logging import user_id_ctx

log = logging.getLogger("carma.http")

_QUIET_PREFIXES = ("/health", "/api/docs", "/api/openapi.json")


class RequestLogMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):  # type: ignore[no-untyped-def]
        start = time.perf_counter()
        status = 500
        try:
            response: Response = await call_next(request)
            status = response.status_code
            return response
        finally:
            duration_ms = int((time.perf_counter() - start) * 1000)
            path = request.url.path
            level = logging.DEBUG if path.startswith(_QUIET_PREFIXES) else logging.INFO
            log.log(
                level,
                "http.request",
                extra={
                    "event": "http.request",
                    "method": request.method,
                    "path": path,
                    "status": status,
                    "duration_ms": duration_ms,
                    "user_id": user_id_ctx.get() or "-",
                    "client_ip": request.client.host if request.client else "-",
                    "user_agent": request.headers.get("user-agent", "-"),
                },
            )
