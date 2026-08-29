"""road_segments - posted speed limits to score speeding against (CAR-222)

Enables PostGIS. The extension has been in the local image (`postgis/postgis:16-3.4`)
and allowlisted on Azure (`azure.extensions=POSTGIS`) since the beginning; this is
the first migration that actually needs it.

The table ships empty. `scripts/load_speed_limits.py` fills it from an
OpenStreetMap extract, and an empty table scores exactly like no map data at all:
speeding drops out of the trip score. So a database that has never run the loader
is correct, only less precise - it is never wrong in the driver's disfavour.

Revision ID: 0028_road_segments
Revises: 0026_business_invitations
Create Date: 2026-08-29 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from geoalchemy2 import Geometry

from alembic import op

revision: str = "0028_road_segments"
# Numbered 0028 because PR #178 already holds 0027_city_reference, but still
# chained to 0026: pointing at a revision that lives only in an unmerged branch
# makes `alembic upgrade` unresolvable here and now. Whichever of the two lands
# on develop SECOND must re-point its own down_revision at the other, or the
# branch gains two heads - the failure that reads as ~78 missing-column errors
# in unrelated tests and never mentions migrations.
down_revision: str | None = "0026_business_invitations"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis")
    op.create_table(
        "road_segments",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("osm_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "geom",
            Geometry(geometry_type="LINESTRING", srid=2039, spatial_index=False),
            nullable=False,
        ),
        sa.Column("limit_kmh", sa.SmallInteger(), nullable=False),
        sa.Column("limit_source", sa.String(8), nullable=False),
        sa.Column("fclass", sa.String(32), nullable=False),
    )
    op.create_index("ix_road_segments_geom", "road_segments", ["geom"], postgresql_using="gist")


def downgrade() -> None:
    op.drop_index("ix_road_segments_geom", table_name="road_segments")
    op.drop_table("road_segments")
    # PostGIS itself is left installed. Dropping it would take out any other
    # geography column added since, and an unused extension costs nothing.
