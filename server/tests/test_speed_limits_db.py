"""The posted-limit lookup, against a real PostGIS database (CAR-222).

Everything here needs the spatial index and the geography functions, so it
cannot be a pure unit test. The rules being pinned are the ones a driver would
feel if they broke: an ambiguous match never invents an offence, a road that is
merely nearby is not a match, and a database with no map in it degrades to "no
limit" rather than to a wrong one.

**These tests never delete another row than their own.** `road_segments` is a
global lookup table, not per-user state, and a real database has the whole
country loaded into it. An earlier version of this file opened with
`DELETE FROM road_segments`, which silently wiped a loaded map every time the
suite ran. The fixtures below are keyed on a reserved `osm_id` range and sit in
open sea, far from any real road, so they neither destroy nor collide with one.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services import speed_limits

# Reserved for this file. Real OSM way ids are nowhere near it.
_TEST_OSM_ID_BASE = 990_000_000

# ~45 km off the Tel Aviv coast: inside the EPSG:2039 grid's usable extent, and
# the nearest real road is tens of kilometres away, so a loaded map cannot
# interfere with any assertion here.
_LNG = 34.30
_LAT = 32.08

# Five north-south roads. At Israel's latitude 0.00005 deg of longitude is about
# 4.7 m and 0.0002 deg is about 18.9 m, which straddles the 8 m tie window.
_SEED = f"""
    INSERT INTO road_segments (osm_id, geom, limit_kmh, limit_source, fclass) VALUES
    ({_TEST_OSM_ID_BASE + 1},
     ST_Transform(ST_GeomFromText('LINESTRING({_LNG} {_LAT}, {_LNG} {_LAT + 0.01})', 4326), 2039),
     50, 'urban', 'residential'),
    ({_TEST_OSM_ID_BASE + 2},
     ST_Transform(ST_GeomFromText('LINESTRING({_LNG + 0.00005} {_LAT}, {_LNG + 0.00005} {_LAT + 0.01})', 4326), 2039),
     90, 'tagged', 'primary'),
    ({_TEST_OSM_ID_BASE + 3},
     ST_Transform(ST_GeomFromText('LINESTRING({_LNG + 0.1} {_LAT}, {_LNG + 0.1} {_LAT + 0.01})', 4326), 2039),
     50, 'urban', 'residential'),
    ({_TEST_OSM_ID_BASE + 4},
     ST_Transform(ST_GeomFromText('LINESTRING({_LNG - 0.1} {_LAT}, {_LNG - 0.1} {_LAT + 0.01})', 4326), 2039),
     50, 'urban', 'tertiary'),
    ({_TEST_OSM_ID_BASE + 5},
     ST_Transform(ST_GeomFromText('LINESTRING({_LNG - 0.0998} {_LAT}, {_LNG - 0.0998} {_LAT + 0.01})', 4326), 2039),
     90, 'class', 'primary')
"""

_ON_THE_SLOW_ROAD = (_LAT + 0.005, _LNG)  # road 1, with road 2 4.7 m away
_ALONE = (_LAT + 0.005, _LNG + 0.1)  # road 3, nothing else near
_NEAR_A_DIFFERENT_STREET = (_LAT + 0.005, _LNG - 0.1)  # road 4, road 5 18.9 m away
_NOWHERE = (_LAT + 0.005, _LNG + 0.05)  # kilometres from all of them


def _wp(lat: float | None = None, lng: float | None = None) -> dict[str, Any]:
    point: dict[str, Any] = {"ts": 0, "speedKmh": 60}
    if lat is not None:
        point["lat"], point["lng"] = lat, lng
    return point


@pytest.fixture
async def seeded(db_session: AsyncSession) -> AsyncIterator[AsyncSession]:
    """Five known roads in open water, removed again afterwards by id."""
    clean = text("DELETE FROM road_segments WHERE osm_id >= :base").bindparams(base=_TEST_OSM_ID_BASE)
    await db_session.execute(clean)
    await db_session.execute(text(_SEED))
    await db_session.commit()
    try:
        yield db_session
    finally:
        await db_session.execute(clean)
        await db_session.commit()


class TestResolve:
    async def test_a_road_running_alongside_lifts_the_limit(self, seeded: AsyncSession) -> None:
        # Standing on the 50 road with the 90 road 4.7 m away - a service road
        # beside a fast one. Charging the 50 would invent an offence for anyone
        # on the faster road whose GPS drifted a few metres.
        assert await speed_limits.resolve(seeded, [_wp(*_ON_THE_SLOW_ROAD)]) == [90.0]

    async def test_a_faster_road_beyond_the_tie_window_does_not_lift_the_limit(self, seeded: AsyncSession) -> None:
        # 18.9 m away is inside the match radius but is a different street, not
        # the same road. Letting it win is what read Dizengoff in Tel Aviv as an
        # 80 zone and made 90 km/h down it score clean.
        assert await speed_limits.resolve(seeded, [_wp(*_NEAR_A_DIFFERENT_STREET)]) == [50.0]

    async def test_unambiguous_match_takes_its_own_limit(self, seeded: AsyncSession) -> None:
        assert await speed_limits.resolve(seeded, [_wp(*_ALONE)]) == [50.0]

    async def test_a_road_kilometres_away_is_not_a_match(self, seeded: AsyncSession) -> None:
        assert await speed_limits.resolve(seeded, [_wp(*_NOWHERE)]) == [None]

    async def test_malformed_waypoints_keep_their_place_in_the_list(self, seeded: AsyncSession) -> None:
        # Alignment is the whole contract: telemetry pairs these to waypoints by
        # index, so a dropped entry would shift every limit after it.
        waypoints = [_wp(*_ALONE), "junk", _wp(), {"lat": "x", "lng": "y"}, _wp(*_ALONE)]
        assert await speed_limits.resolve(seeded, waypoints) == [50.0, None, None, None, 50.0]  # type: ignore[list-item]

    async def test_repeated_positions_resolve_identically(self, seeded: AsyncSession) -> None:
        # A stationary car emits the same fix many times; the dedupe must not
        # change the answer for any of them.
        assert await speed_limits.resolve(seeded, [_wp(*_ALONE)] * 5) == [50.0] * 5

    async def test_no_trace_is_no_lookup(self, seeded: AsyncSession) -> None:
        assert await speed_limits.resolve(seeded, None) == []
        assert await speed_limits.resolve(seeded, []) == []

    async def test_unloaded_map_yields_no_limits_rather_than_wrong_ones(self, seeded: AsyncSession) -> None:
        # A fresh database has the table but no map, and must answer "unknown"
        # rather than reach for something wrong. Emptying the table is the whole
        # point of the test and would destroy a real map, so it happens inside a
        # savepoint that is always rolled back.
        savepoint = await seeded.begin_nested()
        try:
            await seeded.execute(text("DELETE FROM road_segments"))
            assert await speed_limits.resolve(seeded, [_wp(*_ON_THE_SLOW_ROAD)]) == [None]
        finally:
            await savepoint.rollback()
        assert await speed_limits.resolve(seeded, [_wp(*_ON_THE_SLOW_ROAD)]) == [90.0]
