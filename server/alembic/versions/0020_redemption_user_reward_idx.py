"""redemptions: composite index on (user_id, reward_id, status) (CAR-72)

The CAR-72 reissue-cooldown lookup filters one (driver, reward) pair across
three different statuses (EXPIRED, CANCELLED, a lapsed PENDING) rather than a
single equality, so it cannot narrow past `user_id` on the existing
`ix_redemptions_user_status` index the way CAR-71's single-status cap query
does. Measured on a seeded 20k-row single-driver history: without this index
the planner reads the driver's entire redemption history on every redeem()
call (2432 buffer hits); with it, it seeks straight to this reward's rows
(52 buffer hits) regardless of how large the driver's history is elsewhere.

Revision ID: 0020_redemption_user_reward_idx
Revises: 0019_redemption_settled_at
Create Date: 2026-08-24 00:00:00.000000
"""

from __future__ import annotations

from alembic import op

revision: str = "0020_redemption_user_reward_idx"
down_revision: str | None = "0019_redemption_settled_at"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_index("ix_redemptions_user_reward_status", "redemptions", ["user_id", "reward_id", "status"])


def downgrade() -> None:
    op.drop_index("ix_redemptions_user_reward_status", table_name="redemptions")
