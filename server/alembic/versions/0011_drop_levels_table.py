"""drop_levels_table

The level ladder is product configuration, not data: nothing in this table was
per-user, nothing was written at runtime, and it existed only as a second copy
of numbers that also lived in code. The two disagreed at level 5 (5,500 here
against 7,000 in `trips.py`), which is the drift issue #61 was filed for.

The ladder now lives solely in `app/services/levels.py`, and `/api/levels`
serves it directly with no database read.

The downgrade recreates the table *and* repopulates it from the same module,
so rolling back leaves a working `/api/levels` rather than an empty table.
Thresholds are the consolidated ones, so a roll-forward/roll-back cycle is
value-preserving.

Revision ID: 0011_drop_levels_table
Revises: a9b8c7d6e5f4
Create Date: 2026-07-26 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision: str = "0011_drop_levels_table"
down_revision: str | None = "a9b8c7d6e5f4"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.drop_table("levels")


def downgrade() -> None:
    levels = op.create_table(
        "levels",
        sa.Column("id", sa.String(32), nullable=False),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("name_he", sa.String(80), nullable=False),
        sa.Column("name_en", sa.String(80), nullable=False),
        sa.Column("min_points", sa.Integer(), nullable=False),
        sa.Column("discount_pct", sa.Integer(), server_default="0", nullable=False),
        sa.Column("bonus_multiplier", sa.Float(), server_default="1.0", nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("number"),
    )

    # Imported here rather than at module scope: a migration must not fail to
    # load because application code moved.
    import uuid

    from app.services.levels import LEVELS

    op.bulk_insert(
        levels,
        [
            {
                "id": uuid.uuid4().hex,
                "number": lv.number,
                "name_he": lv.name_he,
                "name_en": lv.name_en,
                "min_points": lv.min_points,
                "discount_pct": lv.discount_pct,
                "bonus_multiplier": lv.bonus_multiplier,
            }
            for lv in LEVELS
        ],
    )
