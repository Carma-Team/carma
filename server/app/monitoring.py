from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from app.config import settings

if TYPE_CHECKING:
    from fastapi import FastAPI

log = logging.getLogger(__name__)


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
        FastAPIInstrumentor.instrument_app(app)
        SQLAlchemyInstrumentor().instrument()
        log.info("Application Insights enabled")
    except Exception as e:  # noqa: BLE001
        log.warning("Failed to start Application Insights: %s", e)
