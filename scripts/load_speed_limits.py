"""Fill `road_segments` from a Geofabrik OpenStreetMap road shapefile (CAR-222).

    python scripts/load_speed_limits.py path/to/gis_osm_roads_free_1.shp

Get the input from https://download.geofabrik.de/asia/israel-and-palestine-latest-free.shp.zip
and unzip it. That layer already carries `fclass` and `maxspeed` per road, which
is why this needs no OSM toolchain - only `pyshp`, a pure-Python reader. Parsing
a .pbf would mean osmium or osm2pgsql, neither of which installs cleanly on the
Windows machines this team develops on.

Run it again to refresh: the load is a replace, inside one transaction, so a
failure leaves the previous map in place rather than an empty table.

Why an offline load instead of a live map API: the alternative is posting every
driver's GPS trace to a third party on every trip save. That is a per-request
cost, a latency dependency in the save path, and a disclosure of exactly the
data we promise to look after. The map changes about as often as roads get
built, so a monthly refresh is the whole requirement.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path
from typing import Any

# Settings reads `.env` relative to the working directory, so these scripts run
# from server/ whatever directory they were invoked from. The shapefile argument
# is resolved against where the user actually stood, not against server/.
_INVOKED_FROM = Path.cwd()
_SERVER = Path(__file__).resolve().parents[1] / "server"
sys.path.insert(0, str(_SERVER))
os.chdir(_SERVER)

from app.database import SessionLocal  # noqa: E402
from sqlalchemy import text  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession  # noqa: E402

# Israel's statutory defaults, mapped onto the road classes Geofabrik emits.
# Israeli law sets the limit by road category rather than by sign - 50 built-up,
# 80 open road, 90 with a central divider - so an untagged road here still has a
# real limit, which is what makes this fallback honest rather than a guess.
# Source: OSM's Israel page, which documents the same mapping its editors assume.
#
# Every value is the *permissive* reading of its class. `trunk` is 100 rather
# than the 90 a plain divided road would get, and `unclassified` is 80 rather
# than 50, because a class default that runs low invents offences on roads
# nobody has surveyed. The explicit `maxspeed` tag overrides all of it.
_CLASS_LIMITS: dict[str, int] = {
    "motorway": 110,
    "motorway_link": 110,
    "trunk": 100,
    "trunk_link": 100,
    "primary": 90,
    "primary_link": 90,
    "secondary": 80,
    "secondary_link": 80,
    "tertiary": 80,
    "tertiary_link": 80,
    "unclassified": 80,
    "residential": 50,
    "living_street": 50,
    "service": 50,
}

# Anything not in _CLASS_LIMITS is not a road a car is scored on: footways,
# cycleways, tracks, steps. Loading them would put a 50 km/h limit within the
# match radius of a driver on the road beside them.

# Classes whose class default is only right outside a town. Israeli law sets the
# limit by built-up area, not by road class: the same untagged `tertiary` is 50
# inside a city and 80 outside it. Left at 80 everywhere, the component is blind
# to exactly the offence CAR-222 was opened for - Dizengoff in Tel Aviv resolved
# to 80, so 90 km/h down it scored as clean driving.
#
# Motorway, trunk and primary are deliberately not in this set. Those are the
# signed arterials that keep a high limit through a city, so demoting them to 50
# would invent offences on the road types where speed is legitimately highest.
_URBAN_DEMOTED = ("secondary", "secondary_link", "tertiary", "tertiary_link", "unclassified")
_URBAN_LIMIT_KMH = 50

# OSM place classes that mean "built-up area" for that rule.
_BUILT_UP_FCLASS = ("city", "town", "village", "suburb", "neighbourhood", "hamlet")


def _limit(fclass: str, maxspeed: Any) -> tuple[int, str] | None:
    """(limit, source) for one road, or None if it is not a road we score on."""
    try:
        tagged = int(maxspeed)
    except (TypeError, ValueError):
        tagged = 0
    # Geofabrik writes 0 for "no maxspeed tag". Values above the national
    # maximum are mistagged (mph written as km/h, or vandalism) and are treated
    # as untagged rather than trusted.
    if 0 < tagged <= 120:
        return tagged, "tagged"
    default = _CLASS_LIMITS.get(fclass)
    return (default, "class") if default is not None else None


def _rows(shp_path: Path) -> list[dict[str, Any]]:
    import shapefile  # pyshp

    reader = shapefile.Reader(str(shp_path))
    rows: list[dict[str, Any]] = []
    skipped = 0
    # iterShapeRecords keeps geometry and attributes on one cursor. Zipping
    # iterShapes() against iterRecords() walks two files independently, and a
    # single skipped record there would silently pair every later road with the
    # wrong speed limit.
    for sr in reader.iterShapeRecords():
        attrs = sr.record.as_dict()
        shape = sr.shape
        resolved = _limit(str(attrs.get("fclass", "")), attrs.get("maxspeed"))
        if resolved is None or len(shape.points) < 2:
            skipped += 1
            continue
        limit_kmh, source = resolved
        wkt = "LINESTRING(" + ",".join(f"{x} {y}" for x, y in shape.points) + ")"
        rows.append(
            {
                "osm_id": int(attrs.get("osm_id", 0) or 0),
                "wkt": wkt,
                "limit_kmh": limit_kmh,
                "limit_source": source,
                "fclass": str(attrs.get("fclass", ""))[:32],
            }
        )
    print(f"read {len(rows):,} roads, skipped {skipped:,} non-drivable")
    return rows


def _built_up_areas(shp_path: Path) -> list[dict[str, Any]]:
    """Built-up-area polygons from the places layer beside the roads shapefile."""
    import shapefile  # pyshp

    places = shp_path.parent / "gis_osm_places_a_free_1.shp"
    if not places.exists():
        print(f"no places layer at {places} - urban limits will stay at their class defaults")
        return []
    reader = shapefile.Reader(str(places))
    out: list[dict[str, Any]] = []
    for sr in reader.iterShapeRecords():
        if str(sr.record.as_dict().get("fclass", "")) in _BUILT_UP_FCLASS:
            # GeoJSON rather than hand-built WKT: these are multi-ring polygons,
            # and getting the ring winding wrong silently yields a shape that
            # intersects nothing.
            out.append({"gj": json.dumps(sr.shape.__geo_interface__)})
    print(f"read {len(out):,} built-up areas")
    return out


async def _apply_urban_limits(db: AsyncSession, areas: list[dict[str, Any]]) -> None:
    """Demote the ambiguous road classes to 50 km/h inside a built-up area."""
    if not areas:
        return
    await db.execute(
        text("CREATE TEMP TABLE built_up (geom geometry(Geometry, 2039)) ON COMMIT DROP")
    )
    await db.execute(
        # ST_SetSRID because GeoJSON without a crs member parses as SRID 0, and
        # ST_Transform on an unknown SRID errors rather than assuming lat/lng.
        text("INSERT INTO built_up (geom) VALUES (ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(:gj), 4326), 2039))"),
        areas,
    )
    await db.execute(text("CREATE INDEX ON built_up USING gist (geom)"))
    await db.execute(text("ANALYZE built_up"))
    result = await db.execute(
        text(
            """
            UPDATE road_segments r
               SET limit_kmh = :urban, limit_source = 'urban'
             WHERE r.limit_source = 'class'
               AND r.fclass = ANY(:classes)
               AND EXISTS (SELECT 1 FROM built_up b WHERE ST_Intersects(r.geom, b.geom))
            """
        ),
        {"urban": _URBAN_LIMIT_KMH, "classes": list(_URBAN_DEMOTED)},
    )
    print(f"demoted {result.rowcount:,} roads to {_URBAN_LIMIT_KMH} km/h inside built-up areas")


async def _load(rows: list[dict[str, Any]], areas: list[dict[str, Any]]) -> None:
    insert = text(
        """
        INSERT INTO road_segments (osm_id, geom, limit_kmh, limit_source, fclass)
        VALUES (:osm_id,
                ST_Transform(ST_GeomFromText(:wkt, 4326), 2039),
                :limit_kmh, :limit_source, :fclass)
        """
    )
    async with SessionLocal() as db:
        async with db.begin():
            await db.execute(text("DELETE FROM road_segments"))
            for start in range(0, len(rows), 2000):
                await db.execute(insert, rows[start : start + 2000])
                print(f"  inserted {min(start + 2000, len(rows)):,}/{len(rows):,}", end="\r")
            print(f"\ninserted {len(rows):,} road segments")
            # Inside the same transaction: a half-applied map, where a road's
            # limit depends on whether the loader reached it, is worse than none.
            await _apply_urban_limits(db, areas)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("shapefile", type=Path, help="gis_osm_roads_free_1.shp from a Geofabrik extract")
    args = parser.parse_args()
    shapefile_path = args.shapefile if args.shapefile.is_absolute() else _INVOKED_FROM / args.shapefile
    if not shapefile_path.exists():
        raise SystemExit(f"no such file: {shapefile_path}")
    asyncio.run(_load(_rows(shapefile_path), _built_up_areas(shapefile_path)))


if __name__ == "__main__":
    main()
