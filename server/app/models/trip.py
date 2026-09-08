from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import Boolean, DateTime, Enum, Float, ForeignKey, Index, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base
from app.models.enums import TripStatus

if TYPE_CHECKING:
    from app.models.event import Event
    from app.models.user import User

# The five behaviours the v2 engine scores, mirroring `WeakestFactor` in
# app/services/scoring.py. Spelled out again rather than imported: no other model
# reaches into a service, and this one column is not worth being the exception.
# `test_trip_weakest_factor.py` fails if the two lists ever drift apart.
WEAKEST_FACTORS = ("braking", "acceleration", "cornering", "speeding", "distraction")


class Trip(Base):
    __tablename__ = "trips"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: uuid.uuid4().hex)
    user_id: Mapped[str] = mapped_column(String(32), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)

    start_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    end_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    duration_seconds: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    distance_km: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)

    start_lat: Mapped[float | None] = mapped_column(Float)
    start_lng: Mapped[float | None] = mapped_column(Float)
    end_lat: Mapped[float | None] = mapped_column(Float)
    end_lng: Mapped[float | None] = mapped_column(Float)

    avg_score: Mapped[float | None] = mapped_column(Float)
    points: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    risk_multiplier: Mapped[float] = mapped_column(Float, default=1.0, nullable=False)

    # score_v2 holds the same value as avg_score — one engine writes both
    # (docs/scoring.md). NULL only on rows scored before the engines merged.
    score_v2: Mapped[float | None] = mapped_column(Float)
    scoring_version: Mapped[str] = mapped_column(String(32), server_default="2026-06-v1-legacy", nullable=False)
    status: Mapped[TripStatus] = mapped_column(
        Enum(TripStatus, name="trip_status"), default=TripStatus.ACTIVE, nullable=False
    )

    hard_brakes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    aggressive_accels: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    sharp_turns: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    touch_epochs: Mapped[int] = mapped_column(Integer, server_default="0", nullable=False)
    screen_interaction_seconds: Mapped[int] = mapped_column(Integer, server_default="0", nullable=False)

    # Per-trip accelerometer health, as reported by the SDK (CAR-189/CAR-228).
    # `accel_available` latches true if the sensor was ever confirmed live during
    # the trip; `accel_init_failed` says registration itself threw. Together they
    # separate a healthy drive, a device with no accelerometer, and a driver whose
    # sensor never started.
    #
    # Nullable, and it has to stay nullable: a trip saved before this landed, or by
    # a client too old to send the fields, is *unknown*. Defaulting to false would
    # assert "the accelerometer was never live" about trips nobody ever measured.
    accel_available: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    accel_init_failed: Mapped[bool | None] = mapped_column(Boolean, nullable=True)

    # The behaviour that cost this trip the most (CAR-185), stored so the "one
    # thing to fix" line survives past the save response (CAR-186).
    #
    # NULL carries two answers and cannot separate them: a trip scored before
    # this landed was never asked, and a trip whose worst subscore is still above
    # 90 has nothing worth naming. Both mean the same thing to the screen — show
    # no line — which is why one column is enough.
    weakest_factor: Mapped[str | None] = mapped_column(Enum(*WEAKEST_FACTORS, name="weakest_factor"), nullable=True)

    ai_insight: Mapped[str | None] = mapped_column(String(500))
    # Set the first time generation is attempted for this trip, success or not.
    # Without it a failed/quota-exhausted call retries on every future view of
    # the same trip, burning the free Gemini tier's daily budget on a trip that
    # already failed once.
    ai_insight_attempted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    start_location: Mapped[str | None] = mapped_column(String(200))
    end_location: Mapped[str | None] = mapped_column(String(200))

    synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    idempotency_key: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)
    telemetry_digest: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    payload_signature: Mapped[str | None] = mapped_column(String(128), nullable=True)
    route_waypoints: Mapped[list[Any] | None] = mapped_column(JSONB, nullable=True)

    user: Mapped[User] = relationship(back_populates="trips")
    events: Mapped[list[Event]] = relationship(back_populates="trip", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_trips_user_start", "user_id", "start_time"),
        Index("ix_trips_status", "status"),
    )
