"""Posted speed limit for each waypoint of a trip (CAR-222).

The one impure piece of the speeding component: `telemetry` and `scoring` stay
pure, and this module is the DB read that feeds them. It answers a single
question - "what was the limit where this driver was?" - for a whole trace in one
query.

**Nearest road wins, and ties go to the driver.** This is a proximity lookup,
not a Hidden-Markov map-match: we take the nearest road within
`_MATCH_RADIUS_M`, and where others sit within `_TIE_M` of it - a service road
beside a motorway, the far carriageway of a divided road - the highest limit
among that tied group wins. A wrong match costs a driver points they did not
lose, and inventing an offence is the one mistake this component must never
make.

The tie window is deliberately much narrower than the match radius. Taking the
highest limit anywhere within 25 m reads a dense city block as its fastest
street: Dizengoff in Tel Aviv resolved to 80 that way, leaving 90 km/h down it
scoring as clean driving - the very blindness CAR-222 exists to remove. Roads
that genuinely run alongside each other are within a few metres of the same
point; a different street is not.

A waypoint with no road within the radius resolves to `None`, which
`telemetry.analyze` reads as "limit unknown" - see `_LIMIT_COVERAGE_MIN` there
for what a trip made mostly of those does.
"""

from __future__ import annotations

from typing import Any

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy.ext.asyncio import AsyncSession

# How far a waypoint may sit from any road and still be matched at all. Israeli
# lanes are 3.25-3.50 m and consumer GPS sits around 5 m CEP in the open, worse
# between buildings, so a driver genuinely on a road is almost always inside
# this. Beyond it we say "limit unknown" rather than reach for a distant street.
_MATCH_RADIUS_M = 25.0

# How much further than the nearest road another road may be and still count as
# running alongside it. An Israeli carriageway pair is separated by a few metres
# of kerb; two different streets are not.
_TIE_M = 8.0

# Candidates pulled from the spatial index per waypoint. The tie group is only
# ever the roads touching one point, so this is a ceiling on pathological
# junctions, not a tuning knob. Keeping it small is also what makes the lookup
# fast: the index stops after this many entries instead of measuring every road
# in a dense city block.
_KNN_CANDIDATES = 6

# Waypoints closer together than this share one lookup. At 4 decimal places two
# points are within ~11 m, which is inside the match radius anyway, so the
# answer cannot differ. Pays for itself on urban driving and on a stationary car
# emitting hundreds of near-identical fixes.
_DEDUPE_DECIMALS = 4

# EPSG:2039's area of use. Outside it `ST_Transform` does not fail, it returns a
# plausible-looking coordinate that is metres or kilometres wrong, so a driver in
# another country would be scored against distances that mean nothing. The guard
# turns that silent wrongness into an honest "limit unknown", which the coverage
# gate then reads as "do not score speeding on this trip".
#
# This is the one place the whole component is pinned to Israel. Widening the
# product means a projection per region, not a wider box here.
_ITM_LNG_MIN, _ITM_LNG_MAX = 34.17, 35.69
_ITM_LAT_MIN, _ITM_LAT_MAX = 29.45, 33.28


def _inside_grid(lat: float, lng: float) -> bool:
    return _ITM_LAT_MIN <= lat <= _ITM_LAT_MAX and _ITM_LNG_MIN <= lng <= _ITM_LNG_MAX


_LOOKUP = sa.text(
    """
    SELECT p.idx, c.limit_kmh
      FROM unnest(CAST(:lngs AS double precision[]), CAST(:lats AS double precision[]))
           WITH ORDINALITY AS p(lng, lat, idx)
      LEFT JOIN LATERAL (
          SELECT max(ranked.limit_kmh) AS limit_kmh
            FROM (SELECT knn.limit_kmh, knn.d, min(knn.d) OVER () AS nearest
                    FROM (SELECT r.limit_kmh,
                                 r.geom <-> ST_Transform(ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326), 2039) AS d
                            FROM road_segments r
                           WHERE ST_DWithin(r.geom,
                                            ST_Transform(ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326), 2039),
                                            :radius_m)
                           ORDER BY 2
                           LIMIT :knn) knn) ranked
           WHERE ranked.d <= ranked.nearest + :tie_m
      ) c ON TRUE
    """
).bindparams(
    sa.bindparam("lngs", type_=postgresql.ARRAY(sa.Float)),
    sa.bindparam("lats", type_=postgresql.ARRAY(sa.Float)),
)


def _coords(raw: list[dict[str, Any]] | None) -> list[tuple[float, float] | None]:
    """Waypoint index → (lat, lng), or None where the entry carries no usable fix.

    Deliberately permissive in the same way `telemetry._parse_waypoints` is: this
    runs on untrusted client JSON, and one malformed entry must not cost the
    whole trace its limits.
    """
    out: list[tuple[float, float] | None] = []
    for entry in raw or []:
        if not isinstance(entry, dict):
            out.append(None)
            continue
        try:
            lat = float(entry["lat"])
            lng = float(entry["lng"])
        except (KeyError, TypeError, ValueError):
            out.append(None)
            continue
        out.append((lat, lng) if _inside_grid(lat, lng) else None)
    return out


async def loaded_road_count(db: AsyncSession) -> int:
    """How many roads the map holds. Zero means speeding is not being scored."""
    return int((await db.execute(sa.text("SELECT count(*) FROM road_segments"))).scalar() or 0)


async def resolve(db: AsyncSession, raw_waypoints: list[dict[str, Any]] | None) -> list[float | None]:
    """Posted limit in km/h per waypoint, aligned to `raw_waypoints` by index.

    Returns an empty list for an empty trace, and `None` in every position the
    map cannot answer for - including every position when `road_segments` has
    never been loaded.
    """
    coords = _coords(raw_waypoints)
    if not any(c is not None for c in coords):
        return [None] * len(coords)

    # One lookup per distinct place, not per waypoint.
    keys: dict[tuple[float, float], None] = {}
    for c in coords:
        if c is not None:
            keys[(round(c[0], _DEDUPE_DECIMALS), round(c[1], _DEDUPE_DECIMALS))] = None
    unique = list(keys)

    rows = await db.execute(
        _LOOKUP,
        {
            "lats": [lat for lat, _lng in unique],
            "lngs": [lng for _lat, lng in unique],
            "radius_m": _MATCH_RADIUS_M,
            "tie_m": _TIE_M,
            "knn": _KNN_CANDIDATES,
        },
    )
    # ORDINALITY is 1-based and preserves the order the arrays went in.
    found: dict[tuple[float, float], float] = {}
    for idx, limit_kmh in rows:
        if limit_kmh is not None:
            found[unique[idx - 1]] = float(limit_kmh)

    return [
        None if c is None else found.get((round(c[0], _DEDUPE_DECIMALS), round(c[1], _DEDUPE_DECIMALS))) for c in coords
    ]
