"""drop_levels_table

The level ladder is product configuration, not data: nothing in this table was
per-user, nothing was written at runtime, and it existed only as a second copy
of numbers that also lived in code. The two disagreed at level 5 (5,500 here
against 7,000 in `trips.py`), which is the drift issue #61 was filed for.

The ladder now lives solely in `app/services/levels.py`, and `/api/levels`
serves it directly with no database read.

The downgrade recreates the table *and* repopulates it from a copy of the ladder
frozen below, so rolling back leaves a working `/api/levels` rather than an empty
table. Thresholds are the consolidated ones, so a roll-forward/roll-back cycle is
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


# The ladder frozen as of this revision, rather than read from
# `app.services.levels`. Importing it was the original approach and it broke the
# moment `discount_pct` left `LevelDef`: the downgrade raised AttributeError and
# rolled back, which made this revision irreversible (CAR-107). A migration has
# to run against whatever code is deployed when someone rolls back, so it can
# carry no reference to code that is free to change.
#
# discount_pct is 0 on every rung on purpose. Levels 3-10 once advertised 5%-25%
# off and nothing ever charged less, so it was dropped from the product (#83);
# re-seeding the old values here would restore a promise on rollback that the
# product no longer makes.
_LEVELS: tuple[tuple[int, str, str, int, float], ...] = (
    # number, name_he, name_en, min_points, bonus_multiplier
    (1, "מתחיל", "Beginner", 0, 1.00),
    (2, "זהיר", "Cautious", 500, 1.00),
    (3, "מרוכז", "Focused", 1_500, 1.25),
    (4, "מיומן", "Skilled", 3_500, 1.25),
    (5, "חד", "Sharp", 7_000, 1.50),
    (6, "מומחה", "Expert", 12_000, 1.50),
    (7, "אשף", "Wizard", 20_000, 1.50),
    (8, "מאסטר", "Master", 32_000, 1.75),
    (9, "גנרל הכביש", "Road General", 50_000, 1.75),
    (10, "אגדה", "Legend", 75_000, 2.00),
)


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

    # multiinsert=False so the rows also emit under `alembic downgrade --sql`,
    # which is how this path gets checked without a database.
    op.bulk_insert(
        levels,
        [
            {
                "id": f"level-{number:02d}",
                "number": number,
                "name_he": name_he,
                "name_en": name_en,
                "min_points": min_points,
                "discount_pct": 0,
                "bonus_multiplier": bonus_multiplier,
            }
            for number, name_he, name_en, min_points, bonus_multiplier in _LEVELS
        ],
        multiinsert=False,
    )
