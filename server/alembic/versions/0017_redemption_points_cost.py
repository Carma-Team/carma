"""redemptions.points_cost — snapshot the reward's price at issue time (CAR-70)

A voucher's price was read live off `rewards.cost_points` on every response,
so a business editing a reward's price repriced every voucher already handed
to a driver. `points_cost` is set once, at redeem, and never changes after.

Revision ID: 0017_redemption_points_cost
Revises: 0016_refresh_tokens
Create Date: 2026-08-22 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision: str = "0017_redemption_points_cost"
down_revision: str | None = "0016_refresh_tokens"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.add_column("redemptions", sa.Column("points_cost", sa.Integer(), nullable=True))
    op.execute(
        "UPDATE redemptions SET points_cost = rewards.cost_points "
        "FROM rewards WHERE rewards.id = redemptions.reward_id"
    )
    op.alter_column("redemptions", "points_cost", nullable=False)


def downgrade() -> None:
    op.drop_column("redemptions", "points_cost")
