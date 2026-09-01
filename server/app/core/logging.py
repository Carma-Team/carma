"""Structured logging with correlation IDs.

- Dev: human-readable single-line records.
- Prod (ENV=production): JSON records that Application Insights parses automatically.
- Every record carries a `request_id` set by `app.middlewares.request_id`.
- `RedactFilter` blanks out password/code/token/qr_code if they ever leak.
"""

from __future__ import annotations

import logging
import os
import re
from contextvars import ContextVar
from typing import TYPE_CHECKING

from pythonjsonlogger import jsonlogger

if TYPE_CHECKING:
    from starlette.requests import Request

request_id_ctx: ContextVar[str | None] = ContextVar("request_id", default=None)
user_id_ctx: ContextVar[str | None] = ContextVar("user_id", default=None)

# Params masked wherever they appear in a route template, e.g. a voucher `code`
# or an invitation `token` — see redact_path().
_SENSITIVE_PATH_PARAMS = {"code", "token"}


def redact_path(request: Request) -> str:
    """The logged request path, with sensitive path-param values masked.

    Rebuilt from the matched route's template (`/api/business/vouchers/{code}`)
    rather than pattern-matched against the raw path, so a new route with a
    `code` or `token` param is covered without anyone adding a pattern for it.
    Falls back to the raw path when routing hasn't resolved (e.g. a 404).
    """
    route = request.scope.get("route")
    if route is None:
        return request.url.path

    path_params = request.scope.get("path_params", {})
    result: str = route.path
    for name, value in path_params.items():
        placeholder = "***" if name in _SENSITIVE_PATH_PARAMS else str(value)
        result = result.replace("{" + name + "}", placeholder)
    return result


class ContextFilter(logging.Filter):
    """Inject request_id and user_id from contextvars into every record."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_ctx.get() or "-"
        record.user_id = user_id_ctx.get() or "-"
        return True


_SENSITIVE_PATTERN = re.compile(
    r"(password|passwd|code|token|qr_code|authorization)\s*[:=]\s*['\"]?[^'\"\s,}]+",
    re.IGNORECASE,
)


class RedactFilter(logging.Filter):
    """Defensive scrub of credential-like fragments in log messages."""

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str):
            record.msg = _SENSITIVE_PATTERN.sub(r"\1=***", record.msg)
        return True


def configure_logging() -> None:
    """Idempotent. Call from app.main once, before any other imports that log."""
    if getattr(configure_logging, "_done", False):
        return

    level = os.getenv("LOG_LEVEL", "INFO").upper()
    env = os.getenv("ENV", "development")

    root = logging.getLogger()
    root.handlers.clear()
    root.setLevel(level)

    handler = logging.StreamHandler()
    handler.addFilter(ContextFilter())
    handler.addFilter(RedactFilter())

    if env == "production":
        handler.setFormatter(
            jsonlogger.JsonFormatter(  # type: ignore[no-untyped-call]
                "%(asctime)s %(levelname)s %(name)s %(request_id)s %(user_id)s %(message)s",
                rename_fields={"levelname": "level", "asctime": "timestamp", "name": "logger"},
            )
        )
    else:
        handler.setFormatter(
            logging.Formatter(
                "%(asctime)s %(levelname)-5s %(name)s [req=%(request_id)s user=%(user_id)s] %(message)s",
                datefmt="%H:%M:%S",
            )
        )

    root.addHandler(handler)

    # Calm down a few noisy libraries unless explicitly bumped.
    for noisy in ("uvicorn.access",):
        logging.getLogger(noisy).setLevel("WARNING")

    if os.getenv("SQL_ECHO", "").lower() == "true":
        logging.getLogger("sqlalchemy.engine").setLevel("INFO")

    configure_logging._done = True  # type: ignore[attr-defined]
