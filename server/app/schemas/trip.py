from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import AliasChoices, Field, model_validator

from app.schemas._base import CamelModel


class SaveTripIn(CamelModel):
    """May's frontend posts a mix of snake_case and camelCase. Accept all variants."""

    start_time: datetime | None = Field(default=None, validation_alias=AliasChoices("startTime", "start_time"))
    end_time: datetime | None = Field(default=None, validation_alias=AliasChoices("endTime", "end_time"))
    distance_km: float | None = Field(default=None, validation_alias=AliasChoices("distanceKm", "distance"))
    avg_score: float | None = Field(default=None, validation_alias=AliasChoices("avgScore", "avg_score", "score"))
    duration_seconds: int | None = None
    points: int | None = None
    hard_brakes: int | None = None
    aggressive_accels: int | None = None
    sharp_turns: int | None = None
    phone_seconds: int | None = None
    events: list[dict[str, Any]] | None = Field(
        default=None, validation_alias=AliasChoices("events", "eventsArray", "events_array")
    )
    start_location: str | None = None
    end_location: str | None = None
    ai_insight: str | None = None

    @model_validator(mode="after")
    def _defaults(self) -> SaveTripIn:
        if self.start_time is None:
            self.start_time = datetime.utcnow()
        return self


class TripOut(CamelModel):
    """Shape returned to the mobile app — emits both snake_case and camelCase keys it needs."""

    id: str
    user_id: str
    start_time: datetime
    end_time: datetime | None
    distance_km: float
    duration_seconds: int
    avg_score: float
    points: int
    hard_brakes: int
    aggressive_accels: int
    sharp_turns: int
    phone_seconds: int
    risk_multiplier: float
    start_location: str | None
    end_location: str | None
    ai_insight: str | None
    status: str
    idempotency_key: str | None = None

    @classmethod
    def from_orm_trip(cls, trip: Any) -> TripOut:
        return cls.model_validate(
            {
                "id": trip.id,
                "user_id": trip.user_id,
                "start_time": trip.start_time,
                "end_time": trip.end_time,
                "distance_km": trip.distance_km,
                "duration_seconds": trip.duration_seconds,
                "avg_score": trip.avg_score or 0.0,
                "points": trip.points,
                "hard_brakes": trip.hard_brakes,
                "aggressive_accels": trip.aggressive_accels,
                "sharp_turns": trip.sharp_turns,
                "phone_seconds": trip.phone_seconds,
                "risk_multiplier": trip.risk_multiplier,
                "start_location": trip.start_location,
                "end_location": trip.end_location,
                "ai_insight": trip.ai_insight,
                "status": trip.status.value.lower(),
                "idempotency_key": trip.idempotency_key,
            }
        )


class TripList(CamelModel):
    trips: list[TripOut]


class TripSingle(CamelModel):
    trip: TripOut
