"""Guards the trip → Event persistence parsers in app.services.trips.

Before this, the per-event timeline never reached the DB: the client array was
dropped at ingestion, so the events table stayed empty and the v2 severity inputs
had nowhere to land. These tests pin the defensive parsing that turns an untrusted
client events array into persistable Event rows — without a DB or a live server.

Key invariants under test:
  * The SDK's PHONE_USAGE name is bridged to the column's PHONE_USE.
  * Unknown types, non-dicts, and junk coordinates are dropped, never guessed.
  * A bad timestamp falls back to the trip start (an event is never lost over it).
  * The full raw payload survives in sensor_data (forward-proofing peak_g).
  * The row count is capped, and individually-invalid entries don't sink the batch.
"""

from __future__ import annotations

import math
from datetime import UTC, datetime

import pytest

from app.models import EventType
from app.services.trips import (
    _MAX_EVENTS_PER_TRIP,
    _build_trip_events,
    _coerce_coord,
    _coerce_event_timestamp,
    _parse_event,
)

TRIP_START = datetime(2026, 6, 14, 8, 0, tzinfo=UTC)


# ─── _parse_event — type mapping ───────────────────────────────────────────────


def test_parse_event_maps_known_types() -> None:
    for client_name, expected in [
        ("HARD_BRAKE", EventType.HARD_BRAKE),
        ("AGGRESSIVE_ACCEL", EventType.AGGRESSIVE_ACCEL),
        ("SHARP_TURN", EventType.SHARP_TURN),
        ("SPEEDING", EventType.SPEEDING),
    ]:
        ev = _parse_event({"type": client_name}, TRIP_START)
        assert ev is not None and ev.type is expected


def test_parse_event_bridges_phone_usage_to_phone_use() -> None:
    # SDK emits PHONE_USAGE; the column stores PHONE_USE — the bridge must hold.
    ev = _parse_event({"type": "PHONE_USAGE"}, TRIP_START)
    assert ev is not None and ev.type is EventType.PHONE_USE


def test_parse_event_accepts_canonical_phone_use() -> None:
    ev = _parse_event({"type": "PHONE_USE"}, TRIP_START)
    assert ev is not None and ev.type is EventType.PHONE_USE


def test_parse_event_type_is_case_and_whitespace_insensitive() -> None:
    ev = _parse_event({"type": "  hard_brake "}, TRIP_START)
    assert ev is not None and ev.type is EventType.HARD_BRAKE


def test_parse_event_unknown_type_dropped() -> None:
    assert _parse_event({"type": "TELEPORT"}, TRIP_START) is None


def test_parse_event_missing_type_dropped() -> None:
    assert _parse_event({"severity": 0.9}, TRIP_START) is None


def test_parse_event_non_dict_dropped() -> None:
    assert _parse_event("HARD_BRAKE", TRIP_START) is None
    assert _parse_event(None, TRIP_START) is None
    assert _parse_event(42, TRIP_START) is None


# ─── _parse_event — severity ───────────────────────────────────────────────────


def test_parse_event_severity_remapped_to_the_server_axis() -> None:
    ev = _parse_event({"type": "HARD_BRAKE", "severity": 0.73}, TRIP_START)
    assert ev is not None and ev.severity == pytest.approx(2.46)


def test_parse_event_severity_endpoints_pin_the_axis() -> None:
    # The SDK's 0 and 1 are the floor and ceiling the server already uses, so a
    # client event can never be worth less than one event nor more than the worst.
    floor = _parse_event({"type": "HARD_BRAKE", "severity": 0.0}, TRIP_START)
    ceiling = _parse_event({"type": "HARD_BRAKE", "severity": 1.0}, TRIP_START)
    assert floor is not None and floor.severity == 1.0
    assert ceiling is not None and ceiling.severity == 3.0


def test_parse_event_severity_defaults_to_the_floor_when_missing() -> None:
    ev = _parse_event({"type": "HARD_BRAKE"}, TRIP_START)
    assert ev is not None and ev.severity == 1.0


def test_parse_event_severity_junk_defaults_to_the_floor() -> None:
    ev = _parse_event({"type": "HARD_BRAKE", "severity": "very-hard"}, TRIP_START)
    assert ev is not None and ev.severity == 1.0


def test_parse_event_negative_severity_clamped_to_the_floor() -> None:
    ev = _parse_event({"type": "HARD_BRAKE", "severity": -3.0}, TRIP_START)
    assert ev is not None and ev.severity == 1.0


def test_parse_event_huge_severity_clamped_to_the_ceiling() -> None:
    # The events array is unsigned, so a hostile client claiming 1e9 must land on
    # the same ceiling as an honest one claiming 1.0.
    ev = _parse_event({"type": "HARD_BRAKE", "severity": 1e9}, TRIP_START)
    assert ev is not None and ev.severity == 3.0


def test_parse_event_nan_severity_falls_to_the_floor() -> None:
    # NaN compares False against everything, so it slips through the clamp and
    # would be written to a NOT NULL column.
    for payload in ("nan", float("nan")):
        ev = _parse_event({"type": "HARD_BRAKE", "severity": payload}, TRIP_START)
        assert ev is not None
        assert not math.isnan(ev.severity)
        assert ev.severity == 1.0


def test_parse_event_infinite_severity_clamped_to_the_ceiling() -> None:
    ev = _parse_event({"type": "HARD_BRAKE", "severity": float("inf")}, TRIP_START)
    assert ev is not None and ev.severity == 3.0
    ev = _parse_event({"type": "HARD_BRAKE", "severity": float("-inf")}, TRIP_START)
    assert ev is not None and ev.severity == 1.0


# ─── _parse_event — coordinates ────────────────────────────────────────────────


def test_parse_event_nested_location() -> None:
    ev = _parse_event({"type": "SHARP_TURN", "location": {"latitude": 32.07, "longitude": 34.78}}, TRIP_START)
    assert ev is not None and ev.lat == 32.07 and ev.lng == 34.78


def test_parse_event_flat_lat_lng() -> None:
    ev = _parse_event({"type": "SHARP_TURN", "lat": 32.07, "lng": 34.78}, TRIP_START)
    assert ev is not None and ev.lat == 32.07 and ev.lng == 34.78


def test_parse_event_out_of_range_coords_dropped_to_none() -> None:
    ev = _parse_event({"type": "SHARP_TURN", "lat": 200.0, "lng": 999.0}, TRIP_START)
    assert ev is not None and ev.lat is None and ev.lng is None


def test_parse_event_missing_coords_are_none() -> None:
    ev = _parse_event({"type": "HARD_BRAKE"}, TRIP_START)
    assert ev is not None and ev.lat is None and ev.lng is None


def test_parse_event_non_dict_location_ignored() -> None:
    ev = _parse_event({"type": "HARD_BRAKE", "location": "somewhere"}, TRIP_START)
    assert ev is not None and ev.lat is None and ev.lng is None


# ─── _parse_event — timestamp + raw retention ──────────────────────────────────


def test_parse_event_iso_timestamp() -> None:
    ev = _parse_event({"type": "HARD_BRAKE", "timestamp": "2026-06-14T08:05:30Z"}, TRIP_START)
    assert ev is not None
    assert ev.timestamp == datetime(2026, 6, 14, 8, 5, 30, tzinfo=UTC)


def test_parse_event_junk_timestamp_falls_back_to_trip_start() -> None:
    ev = _parse_event({"type": "HARD_BRAKE", "timestamp": "yesterday"}, TRIP_START)
    assert ev is not None and ev.timestamp == TRIP_START


def test_parse_event_retains_full_raw_payload() -> None:
    raw = {"type": "HARD_BRAKE", "severity": 0.8, "peakG": 0.55, "speedKmh": 42}
    ev = _parse_event(raw, TRIP_START)
    # Forward-proofing: peak_g must survive until the v2 engine reads it.
    assert ev is not None and ev.sensor_data == raw
    assert ev.sensor_data["peakG"] == 0.55


# ─── _coerce_event_timestamp ───────────────────────────────────────────────────


def test_timestamp_epoch_milliseconds() -> None:
    ms = int(datetime(2026, 6, 14, 8, 5, tzinfo=UTC).timestamp() * 1000)
    assert _coerce_event_timestamp(ms, TRIP_START) == datetime(2026, 6, 14, 8, 5, tzinfo=UTC)


def test_timestamp_epoch_seconds() -> None:
    s = int(datetime(2026, 6, 14, 8, 5, tzinfo=UTC).timestamp())
    assert _coerce_event_timestamp(s, TRIP_START) == datetime(2026, 6, 14, 8, 5, tzinfo=UTC)


def test_timestamp_naive_datetime_gets_utc() -> None:
    naive = datetime(2026, 6, 14, 8, 5)
    out = _coerce_event_timestamp(naive, TRIP_START)
    assert out.tzinfo is not None and out == datetime(2026, 6, 14, 8, 5, tzinfo=UTC)


def test_timestamp_bool_falls_back() -> None:
    # bool is an int subclass — must not be read as epoch 1/0.
    assert _coerce_event_timestamp(True, TRIP_START) == TRIP_START


def test_timestamp_nan_falls_back() -> None:
    assert _coerce_event_timestamp(float("nan"), TRIP_START) == TRIP_START


# ─── _coerce_coord ─────────────────────────────────────────────────────────────


def test_coerce_coord_valid() -> None:
    assert _coerce_coord(32.07, 90.0) == 32.07


def test_coerce_coord_out_of_range() -> None:
    assert _coerce_coord(120.0, 90.0) is None
    assert _coerce_coord(-200.0, 180.0) is None


def test_coerce_coord_junk_and_specials() -> None:
    assert _coerce_coord("north", 90.0) is None
    assert _coerce_coord(None, 90.0) is None
    assert _coerce_coord(float("inf"), 180.0) is None
    assert _coerce_coord(float("nan"), 90.0) is None


# ─── _build_trip_events ────────────────────────────────────────────────────────


def test_build_none_and_empty() -> None:
    assert _build_trip_events(None, TRIP_START) == []
    assert _build_trip_events([], TRIP_START) == []


def test_build_drops_invalid_keeps_valid() -> None:
    raw = [
        {"type": "HARD_BRAKE"},
        {"type": "TELEPORT"},  # unknown — dropped
        "not-a-dict",  # non-dict — dropped
        {"type": "PHONE_USAGE"},  # bridged
        {"no": "type"},  # missing type — dropped
    ]
    events = _build_trip_events(raw, TRIP_START)
    assert [e.type for e in events] == [EventType.HARD_BRAKE, EventType.PHONE_USE]


def test_build_caps_event_count() -> None:
    raw = [{"type": "HARD_BRAKE"} for _ in range(_MAX_EVENTS_PER_TRIP + 250)]
    events = _build_trip_events(raw, TRIP_START)
    assert len(events) == _MAX_EVENTS_PER_TRIP


def test_build_all_events_get_trip_start_when_timeless() -> None:
    raw = [{"type": "HARD_BRAKE"}, {"type": "SHARP_TURN"}]
    events = _build_trip_events(raw, TRIP_START)
    assert all(e.timestamp == TRIP_START for e in events)
