"""users.best_streak — the driver's longest run of good driving days

The live streak is derived from a 30-day slice of trips, so it needs no storage.
The record does: once a run falls out of that window it cannot be recomputed from
anything, which is the whole reason this column exists.

Backfilled to 0 rather than from history on purpose. The only history available
is the same 30-day window, so a backfill would invent a record for drivers whose
real one predates it and leave everyone else's looking arbitrary. Every driver
starts the record from here.

Revision ID: 0014_user_best_streak
Revises: 0013_reward_stock_nullable
Create Date: 2026-08-02 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision: str = "0014_user_best_streak"
down_revision: str | None = "0013_reward_stock_nullable"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    # server_default so the NOT NULL applies to existing rows without a rewrite;
    # kept afterwards, since a driver row is created by several paths and none of
    # them should have to know about this column.
    op.add_column("users", sa.Column("best_streak", sa.Integer(), nullable=False, server_default="0"))


def downgrade() -> None:
    op.drop_column("users", "best_streak")
