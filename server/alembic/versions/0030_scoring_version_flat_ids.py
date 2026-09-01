"""scoring_version: flat date+subject identifiers instead of semver (CAR-199)

Revision ID: 0030_scoring_version_flat_ids
Revises: 0029_redemption_settled_relax
Create Date: 2026-09-01 00:00:00.000000

Semver's compatibility contract has no meaning for a scoring formula — v2.1
changed all five decay constants and moved the fleet median from 84.3 to
88.5, filed as a "minor" bump. Replace it with `<year>-<month>-<subject>`,
which says what changed instead of implying how compatible it is.

"1.0", "2.0.0-shadow" and "2.0.0" all predate the July 2026 telemetry
recalibration and collapse into one legacy bucket — none of the three
carries a public formula difference worth keeping distinct.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0030_scoring_version_flat_ids"
down_revision: str | None = "0029_redemption_settled_relax"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_UPGRADE_MAP = {
    "1.0": "2026-06-v1-legacy",
    "2.0.0-shadow": "2026-06-v1-legacy",
    "2.0.0": "2026-06-v1-legacy",
    "2.1.0": "2026-07-telemetry-recal",
    "2.2.0": "2026-08-distraction-hour",
    "2.3.0": "2026-08-posted-limit",
}

_DOWNGRADE_MAP = {
    "2026-06-v1-legacy": "1.0",
    "2026-07-telemetry-recal": "2.1.0",
    "2026-08-distraction-hour": "2.2.0",
    "2026-08-posted-limit": "2.3.0",
}


def upgrade() -> None:
    op.alter_column("trips", "scoring_version", type_=sa.String(length=32), server_default="2026-06-v1-legacy")
    trips = sa.table("trips", sa.column("scoring_version", sa.String))
    for old, new in _UPGRADE_MAP.items():
        op.execute(trips.update().where(trips.c.scoring_version == old).values(scoring_version=new))


def downgrade() -> None:
    trips = sa.table("trips", sa.column("scoring_version", sa.String))
    for new, old in _DOWNGRADE_MAP.items():
        op.execute(trips.update().where(trips.c.scoring_version == new).values(scoring_version=old))
    op.alter_column("trips", "scoring_version", type_=sa.String(length=16), server_default="1.0")
