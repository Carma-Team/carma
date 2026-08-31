from __future__ import annotations

from typing import Any

from geoalchemy2 import Geometry
from sqlalchemy import BigInteger, Index, Integer, SmallInteger, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class RoadSegment(Base):
    """One drivable stretch of road, with the speed limit we score against it.

    Loaded offline from an OpenStreetMap extract by `scripts/load_speed_limits.py`;
    nothing in the request path ever writes here. The table is a lookup, not
    application state, which is why it carries no timestamps and no foreign keys.

    `limit_kmh` is always populated. Where OSM carries an explicit `maxspeed` tag
    we use it; everywhere else we derive the limit from the road class against
    Israel's statutory defaults. That derivation is only defensible here because
    Israeli law works by default rather than by sign - 50 built-up, 80 open road,
    90 with a central divider - so an untagged road genuinely does have a known
    limit. `limit_source` keeps the two apart so a later analysis can ask how much
    of the fleet's speeding was charged against a derived number.

    An empty table is a valid state, and the one every fresh database starts in.
    The scoring path reads that as "no limit known", which drops speeding out of
    the trip score rather than handing every driver a free component - see
    `telemetry._LIMIT_COVERAGE_MIN`.
    """

    __tablename__ = "road_segments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # Not unique: OSM ways are split at extract boundaries and by the shapefile
    # exporter, so one way id can arrive as several rows. Kept for forensics -
    # it is what lets someone paste a segment into openstreetmap.org and see the
    # road we charged a driver against.
    osm_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    # Stored in EPSG:2039, the Israeli TM Grid, rather than in lat/lng. Distance
    # is then plain planar arithmetic in metres, and the nearest-road lookup runs
    # about six times faster than the same query over a geography column, which
    # recomputes spheroid distances on every index recheck (measured on the full
    # 322k-road extract: 19 ms per waypoint against 4.7 ms). The cost is that this
    # table only describes Israel - which is the only country the app runs in, and
    # reversible by changing the SRID and reloading.
    geom: Mapped[Any] = mapped_column(
        Geometry(geometry_type="LINESTRING", srid=2039, spatial_index=False), nullable=False
    )
    limit_kmh: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    limit_source: Mapped[str] = mapped_column(String(8), nullable=False)  # "tagged" | "class"
    fclass: Mapped[str] = mapped_column(String(32), nullable=False)

    __table_args__ = (
        # The only read this table serves: every waypoint of every trip asks for
        # the roads within a few metres of a point.
        Index("ix_road_segments_geom", "geom", postgresql_using="gist"),
    )
