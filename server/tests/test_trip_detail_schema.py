"""Guards the GET /api/trips/:id wire shape — the event timeline mapping.

Pure unit tests (no DB): build a fake ORM trip and assert TripDetailOut emits
events sorted by time, with enum types lower-cased and coordinates passed through.
"""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace

from app.models.enums import EventType, TripStatus
from app.schemas.trip import EventOut, TripDetailOut


def _fake_event(*, event_id: str, type_: EventType, ts: datetime, lat=None, lng=None, severity=1.0):
    return SimpleNamespace(id=event_id, type=type_, severity=severity, timestamp=ts, lat=lat, lng=lng)


def _fake_trip(events: list) -> SimpleNamespace:
    return SimpleNamespace(
        id="trip-1",
        user_id="usr-1",
        start_time=datetime(2026, 6, 14, 8, 0, tzinfo=UTC),
        end_time=datetime(2026, 6, 14, 8, 15, tzinfo=UTC),
        distance_km=6.2,
        duration_seconds=900,
        avg_score=72.0,
        points=40,
        hard_brakes=2,
        aggressive_accels=0,
        sharp_turns=1,
        touch_epochs=0,
        screen_interaction_seconds=0,
        risk_multiplier=1.0,
        start_location=None,
        end_location=None,
        ai_insight=None,
        status=SimpleNamespace(value=TripStatus.COMPLETED.value),
        idempotency_key=None,
        route_waypoints=None,
        events=events,
    )


def test_event_out_lowercases_type_and_passes_coords() -> None:
    e = _fake_event(
        event_id="e1", type_=EventType.HARD_BRAKE, ts=datetime(2026, 6, 14, 8, 3, tzinfo=UTC), lat=32.07, lng=34.78
    )
    out = EventOut.from_orm_event(e)
    assert out.type == "hard_brake", "enum type must be lower-cased on the wire"
    assert out.lat == 32.07 and out.lng == 34.78


def test_event_out_allows_null_coords() -> None:
    e = _fake_event(event_id="e1", type_=EventType.PHONE_USE, ts=datetime(2026, 6, 14, 8, 6, tzinfo=UTC))
    out = EventOut.from_orm_event(e)
    assert out.type == "phone_use" and out.lat is None and out.lng is None


def test_trip_detail_sorts_events_by_timestamp() -> None:
    later = _fake_event(event_id="late", type_=EventType.SHARP_TURN, ts=datetime(2026, 6, 14, 8, 10, tzinfo=UTC))
    earlier = _fake_event(event_id="early", type_=EventType.HARD_BRAKE, ts=datetime(2026, 6, 14, 8, 2, tzinfo=UTC))
    detail = TripDetailOut.from_orm_trip_detail(_fake_trip([later, earlier]))
    assert [e.id for e in detail.events] == ["early", "late"], "events must be chronological"


def test_trip_detail_empty_events() -> None:
    detail = TripDetailOut.from_orm_trip_detail(_fake_trip([]))
    assert detail.events == []


def test_trip_detail_serializes_events_with_camel_alias() -> None:
    e = _fake_event(event_id="e1", type_=EventType.HARD_BRAKE, ts=datetime(2026, 6, 14, 8, 3, tzinfo=UTC))
    detail = TripDetailOut.from_orm_trip_detail(_fake_trip([e]))
    dumped = detail.model_dump(by_alias=True)
    assert dumped["events"][0]["type"] == "hard_brake"
    assert "timestamp" in dumped["events"][0]
