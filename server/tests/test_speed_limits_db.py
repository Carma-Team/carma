"""The posted-limit lookup, against a real PostGIS database (CAR-222).

Everything here needs the spatial index and the geography functions, so it
cannot be a pure unit test. The rules being pinned are the ones a driver would
feel if they broke: an ambiguous match never invents an offence, a road that is
merely nearby is not a match, and a database with no map in it degrades to "no
limit" rather than to a wrong one.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services import speed_limits

# Four north-south roads. At Israel's latitude 0.00005 deg of longitude is
# about 4.7 m and 0.0002 deg is about 18.9 m, which straddles the tie window.
_SEED = """
    INSERT INTO road_segments (osm_id, geom, limit_kmh, limit_source, fclass) VALUES
    (1, ST_Transform(ST_GeomFromText('LINESTRING(34.8 32.0, 34.8 32.01)', 4326), 2039),
     50, 'urban', 'residential'),
    (2, ST_Transform(ST_GeomFromText('LINESTRING(34.80005 32.0, 34.80005 32.01)', 4326), 2039),
     90, 'tagged', 'primary'),
    (3, ST_Transform(ST_GeomFromText('LINESTRING(34.9 32.0, 34.9 32.01)', 4326), 2039),
     50, 'urban', 'residential'),
    (4, ST_Transform(ST_GeomFromText('LINESTRING(34.7 32.0, 34.7 32.01)', 4326), 2039),
     50, 'urban', 'tertiary'),
    (5, ST_Transform(ST_GeomFromText('LINESTRING(34.7002 32.0, 34.7002 32.01)', 4326), 2039),
     90, 'class', 'primary')
"""


def _wp(lat: float | None = None, lng: float | None = None) -> dict[str, Any]:
    point: dict[str, Any] = {"ts": 0, "speedKmh": 60}
    if lat is not None:
        point["lat"], point["lng"] = lat, lng
    return point


@pytest.fixture
async def seeded(db_session: AsyncSession) -> AsyncIterator[AsyncSession]:
    """Three known roads, removed again afterwards.

    The suite shares a database with whatever else is running, and this table is
    global rather than per-user, so the cleanup is not optional.
    """
    await db_session.execute(text("DELETE FROM road_segments"))
    await db_session.execute(text(_SEED))
    await db_session.commit()
    try:
        yield db_session
    finally:
        await db_session.execute(text("DELETE FROM road_segments"))
        await db_session.commit()


class TestResolve:
    async def test_a_road_running_alongside_lifts_the_limit(self, seeded: AsyncSession) -> None:
        # Standing on the 50 road with the 90 road 4.7 m away - a service road
        # beside a fast one. Charging the 50 would invent an offence for anyone
        # on the faster road whose GPS drifted a few metres.
        assert await speed_limits.resolve(seeded, [_wp(32.005, 34.8)]) == [90.0]

    async def test_a_faster_road_beyond_the_tie_window_does_not_lift_the_limit(self, seeded: AsyncSession) -> None:
        # 18.9 m away is inside the match radius but is a different street, not
        # the same road. Letting it win is what read Dizengoff in Tel Aviv as an
        # 80 zone and made 90 km/h down it score clean.
        assert await speed_limits.resolve(seeded, [_wp(32.005, 34.7)]) == [50.0]

    async def test_unambiguous_match_takes_its_own_limit(self, seeded: AsyncSession) -> None:
        assert await speed_limits.resolve(seeded, [_wp(32.005, 34.9)]) == [50.0]

    async def test_a_road_kilometres_away_is_not_a_match(self, seeded: AsyncSession) -> None:
        assert await speed_limits.resolve(seeded, [_wp(32.005, 34.85)]) == [None]

    async def test_malformed_waypoints_keep_their_place_in_the_list(self, seeded: AsyncSession) -> None:
        # Alignment is the whole contract: telemetry pairs these to waypoints by
        # index, so a dropped entry would shift every limit after it.
        waypoints = [_wp(32.005, 34.9), "junk", _wp(), {"lat": "x", "lng": "y"}, _wp(32.005, 34.9)]
        assert await speed_limits.resolve(seeded, waypoints) == [50.0, None, None, None, 50.0]  # type: ignore[list-item]

    async def test_repeated_positions_resolve_identically(self, seeded: AsyncSession) -> None:
        # A stationary car emits the same fix many times; the dedupe must not
        # change the answer for any of them.
        assert await speed_limits.resolve(seeded, [_wp(32.005, 34.9)] * 5) == [50.0] * 5

    async def test_no_trace_is_no_lookup(self, seeded: AsyncSession) -> None:
        assert await speed_limits.resolve(seeded, None) == []
        assert await speed_limits.resolve(seeded, []) == []

    async def test_unloaded_map_yields_no_limits_rather_than_wrong_ones(self, db_session: AsyncSession) -> None:
        await db_session.execute(text("DELETE FROM road_segments"))
        await db_session.commit()
        assert await speed_limits.resolve(db_session, [_wp(32.005, 34.8)]) == [None]
