"""trips.ai_insight_attempted_at — stop retrying a failed AI insight forever

Insight generation happens lazily on first view (CAR-186-adjacent work, see
insights.py). Without a marker for "we tried", a quota-exhausted or erroring
call re-fires on every later view of the same trip, spending the free Gemini
tier's daily budget on trips that already failed once. This column is set the
first time generation is attempted, whether or not it produced text, so a
failed attempt stays failed rather than being retried indefinitely.

Nullable, no backfill: every existing trip's insight state is unattempted.

Revision id shortened from the column name: `alembic_version.version_num` is
varchar(32), and the obvious `0040_trip_ai_insight_attempted_at` is 33 and
fails the UPDATE, not the CREATE — it looks like a fine migration until head.

Revision ID: 0040_trip_ai_insight_no_retry
Revises: 0039_reward_trash_and_tombstone
Create Date: 2026-09-08 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision: str = "0040_trip_ai_insight_no_retry"
down_revision: str | None = "0039_reward_trash_and_tombstone"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.add_column("trips", sa.Column("ai_insight_attempted_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("trips", "ai_insight_attempted_at")
