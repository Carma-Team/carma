from __future__ import annotations

from datetime import UTC, datetime
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
    touch_epochs: int | None = Field(default=None, validation_alias=AliasChoices("touchEpochs", "touch_epochs"))
    screen_interaction_seconds: int | None = Field(
        default=None,
        validation_alias=AliasChoices("screenInteractionSeconds", "screen_interaction_seconds"),
    )
    risk_multiplier: float | None = Field(
        default=None, validation_alias=AliasChoices("riskMultiplier", "risk_multiplier")
    )
    telemetry_digest: dict[str, Any] | None = Field(
        default=None,
        validation_alias=AliasChoices("telemetryDigest", "telemetry_digest"),
    )
    payload_signature: str | None = Field(
        default=None,
        validation_alias=AliasChoices("payloadSignature", "payload_signature"),
    )
    penalties: int | None = None
    events: list[dict[str, Any]] | None = Field(
        default=None, validation_alias=AliasChoices("events", "eventsArray", "events_array")
    )
    route_waypoints: list[dict[str, Any]] | None = Field(
        default=None, validation_alias=AliasChoices("routeWaypoints", "route_waypoints")
    )
    start_location: str | None = None
    end_location: str | None = None
    ai_insight: str | None = None

    @model_validator(mode="after")
    def _defaults(self) -> SaveTripIn:
        if self.start_time is None:
            self.start_time = datetime.now(UTC)
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
    touch_epochs: int
    screen_interaction_seconds: int
    risk_multiplier: float
    start_location: str | None
    end_location: str | None
    ai_insight: str | None
    status: str
    idempotency_key: str | None = None
    # True when the daily anti-grind caps (§8) reduced this trip's award —
    # lets the client explain a low/zero award. Save-response only; defaults
    # False on list/detail reads where the context is gone.
    points_capped: bool = False
    # The driver's level after this trip, as the server resolved it — including
    # the driver-score cap (#37), which the client cannot reproduce from points
    # alone. Save-response only, like points_capped; None on list/detail reads.
    user_level: int | None = None

    @classmethod
    def from_orm_trip(cls, trip: Any, points_capped: bool = False, user_level: int | None = None) -> TripOut:
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
                "touch_epochs": trip.touch_epochs,
                "screen_interaction_seconds": trip.screen_interaction_seconds,
                "risk_multiplier": trip.risk_multiplier,
                "start_location": trip.start_location,
                "end_location": trip.end_location,
                "ai_insight": trip.ai_insight,
                "status": trip.status.value.lower(),
                "idempotency_key": trip.idempotency_key,
                "points_capped": points_capped,
                "user_level": user_level,
            }
        )


class EventOut(CamelModel):
    """A single driving event on a trip's timeline — map markers + severity readout.

    `type` is the enum value lower-cased to match the wire convention used by the
    other enums (status, category). Coordinates are nullable: an event detected
    during a GPS gap has no location.
    """

    id: str
    type: str
    severity: float
    timestamp: datetime
    lat: float | None
    lng: float | None

    @classmethod
    def from_orm_event(cls, e: Any) -> EventOut:
        return cls.model_validate(
            {
                "id": e.id,
                "type": e.type.value.lower(),
                "severity": e.severity,
                "timestamp": e.timestamp,
                "lat": e.lat,
                "lng": e.lng,
            }
        )


class TripDetailOut(TripOut):
    """Extended trip shape for GET /api/trips/:id — adds the GPS route track and
    the per-event timeline (map markers). `events` defaults to empty for trips
    saved before event persistence landed."""

    route_waypoints: list[dict[str, Any]] | None = None
    events: list[EventOut] = []

    @classmethod
    def from_orm_trip_detail(cls, trip: Any) -> TripDetailOut:
        base = TripOut.from_orm_trip(trip)
        events = sorted(trip.events, key=lambda e: e.timestamp)
        return cls.model_validate(
            {
                **base.model_dump(),
                "route_waypoints": trip.route_waypoints,
                "events": [EventOut.from_orm_event(e) for e in events],
            }
        )


class TripList(CamelModel):
    trips: list[TripOut]


class TripSingle(CamelModel):
    trip: TripDetailOut
