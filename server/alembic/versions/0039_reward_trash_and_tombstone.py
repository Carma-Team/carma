"""rewards.trashed_at / deleted_at — a trash bucket distinct from archive

archived_at (CAR-111) is a reversible pause on the catalog. This adds a second,
independent state for a reward the business no longer wants to see at all:
trashed_at marks it out of every business-facing view (Active, Archive,
marketplace), and is only recoverable back to Archive, never straight to
Active — a restore always lands in the same safe, non-public state a fresh
archive would.

deleted_at is the tombstone for "permanently delete" once a trashed reward has
redemption history: Redemption.reward_id has no cascade, so the row cannot be
dropped without breaking that FK and the historical joins built on it. A
trashed reward with no history at all is hard-deleted instead — nothing to
tombstone.

Both NULL for every existing reward, same as archived_at when it was added.

Rebased off `9b091ac0fd71`, the merge that rejoined this reward-lifecycle
branch's original parent (0037_reward_desc_he_optional) with the
0038_trip_weakest_factor head that landed on develop in the meantime — hence
0039, not 0038.

Revision ID: 0039_reward_trash_and_tombstone
Revises: 9b091ac0fd71
Create Date: 2026-09-08 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision: str = "0039_reward_trash_and_tombstone"
down_revision: str | None = "9b091ac0fd71"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.add_column("rewards", sa.Column("trashed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("rewards", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("rewards", "deleted_at")
    op.drop_column("rewards", "trashed_at")
