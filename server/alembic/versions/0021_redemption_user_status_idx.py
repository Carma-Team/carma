"""redemptions: composite index on (user_id, status, expires_at) (CAR-73)

Supports the reserved-points sum — SUM(points_cost) over one driver's live
(PENDING and unexpired) vouchers, across every reward — which the existing
`ix_redemptions_user_reward_status` cannot serve past `user_id` since it is
scoped per-reward, not per-driver.

Revision ID: 0021_redemption_user_status_idx
Revises: 0020_redemption_user_reward_idx
Create Date: 2026-08-24 00:00:00.000000
"""

from __future__ import annotations

from alembic import op

revision: str = "0021_redemption_user_status_idx"
down_revision: str | None = "0020_redemption_user_reward_idx"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_index("ix_redemptions_user_status_expires", "redemptions", ["user_id", "status", "expires_at"])


def downgrade() -> None:
    op.drop_index("ix_redemptions_user_status_expires", table_name="redemptions")
