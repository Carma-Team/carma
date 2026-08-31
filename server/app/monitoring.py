from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from app.config import settings

if TYPE_CHECKING:
    from fastapi import FastAPI

log = logging.getLogger(__name__)

# FastAPIInstrumentor's server_request_hook fires from the outer ASGI
# middleware, before Starlette routing runs — scope["route"] isn't resolved
# yet, so this can't reuse core.logging.redact_path's route-template approach
# and instead masks by raw-path prefix.
_SENSITIVE_PATH_PREFIXES = ("/api/business/vouchers/", "/api/invitations/")


def _redact_span_path(span: Any, scope: Any) -> None:
    """Overwrite the raw-path span attributes FastAPIInstrumentor's own
    default hook already set, before the span is exported anywhere.

    Otherwise a voucher code or invitation token — which live in the URL
    path, not a header or body — reach Application Insights on every request,
    span attributes being exactly the kind of field `RedactFilter` and
    `redact_path` exist to keep them out of.
    """
    if span is None or not span.is_recording():
        return
    path = scope.get("path", "")
    if not path.startswith(_SENSITIVE_PATH_PREFIXES):
        return
    prefix = next(p for p in _SENSITIVE_PATH_PREFIXES if path.startswith(p))
    redacted = prefix + "***"
    for attribute in ("http.target", "http.url", "url.path", "url.full"):
        span.set_attribute(attribute, redacted)


def configure_monitoring(app: FastAPI) -> None:
    """No-op if APPLICATIONINSIGHTS_CONNECTION_STRING is unset."""
    conn = settings.applicationinsights_connection_string
    if not conn:
        return
    try:
        from azure.monitor.opentelemetry import configure_azure_monitor
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
        from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor

        configure_azure_monitor(connection_string=conn)
        FastAPIInstrumentor.instrument_app(app, server_request_hook=_redact_span_path)
        SQLAlchemyInstrumentor().instrument()
        log.info("Application Insights enabled")
    except Exception as e:  # noqa: BLE001
        log.warning("Failed to start Application Insights: %s", e)
