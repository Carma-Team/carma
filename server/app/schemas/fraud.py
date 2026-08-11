from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import AliasChoices, Field

from app.schemas._base import CamelModel


class FraudSignals(CamelModel):
    """The three rule gates behind the classification, one field per gate.

    Named after the physical observation rather than the rule letter (A/B/C) that
    computes it on the device: the letters are only meaningful next to
    FraudDetector.ts, and these values are read months later from a table row.
    """

    constant_high_speed: bool | None = None
    no_lateral_force: bool | None = None
    no_heading_change: bool | None = None


class FraudTelemetry(CamelModel):
    """Window aggregates the gates were computed from — never raw sample traces."""

    avg_speed_kmh: float | None = None
    max_lateral_accel_g: float | None = None
    yaw_variance: float | None = None  # rad²/s², variance of yaw *rate*


class FraudDetection(CamelModel):
    """Why the device classified a session as non-car travel.

    The score alone says a trip was flagged; the signals say which gate fired and
    the telemetry says by how much. Both are needed to recalibrate a threshold or
    clear a false positive without a client release.
    """

    fraud_score: float | None = Field(default=None, ge=0.0, le=1.0)
    # Plain string, not an enum: the v2 roadmap adds BUS/METRO/BICYCLE, and a
    # server enum would 422 the first client that ships one of them.
    detected_mode: str | None = None
    signals: FraudSignals | None = None
    telemetry: FraudTelemetry | None = None
    max_speed_kmh: float | None = None
    # Device clock at detection. Distinct from fraud_reports.reported_at, which is
    # server receipt time and can trail it by hours when the report syncs offline.
    detected_at: datetime | None = None


class InvalidTripPayload(CamelModel):
    idempotency_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices("idempotencyKey", "idempotency_key"),
    )
    trip_duration_seconds: int | None = None
    # Null for a pre-trip rejection: the trip was never confirmed, so no distance
    # was ever accumulated. Populated for a mid-trip detection.
    distance_km: float | None = None
    anomaly_flags: list[str] = Field(default_factory=list)
    detection: FraudDetection | None = None
    raw_payload: dict[str, Any] | None = None


class FraudReportOut(CamelModel):
    id: str
    user_id: str
    reported_at: datetime
    anomaly_flags: list[str]
