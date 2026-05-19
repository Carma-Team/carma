from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import AliasChoices, Field

from app.schemas._base import CamelModel


class InvalidTripPayload(CamelModel):
    idempotency_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices("idempotencyKey", "idempotency_key"),
    )
    trip_duration_seconds: int | None = None
    distance_km: float | None = None
    avg_score: float | None = None
    anomaly_flags: list[str] = Field(default_factory=list)
    raw_payload: dict[str, Any] | None = None


class FraudReportOut(CamelModel):
    id: str
    user_id: str
    reported_at: datetime
    anomaly_flags: list[str]
