"""rewards.archived_at — archive instead of hard-deleting a reward (CAR-111)

Deleting a reward used to fail once any voucher had been issued against it, and
succeed by removing the row when none had. Neither outcome is right: a business
still needs to retire a reward with history, and a hard delete of one with none
was one edit away from breaking `Redemption.reward_id`, which has no cascade.

Separate from `is_active` on purpose — that flag is a pause a business can flip
back; this is a one-way remove-from-catalog. NULL means still in the catalog, so
every existing reward is unaffected until something sets it.

Revision ID: 0015_reward_archived_at
Revises: 2d8529414df2
Create Date: 2026-08-21 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision: str = "0015_reward_archived_at"
down_revision: str | None = "2d8529414df2"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.add_column("rewards", sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("rewards", "archived_at")
