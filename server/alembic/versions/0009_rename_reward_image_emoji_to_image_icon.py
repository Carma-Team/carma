"""rename reward image_emoji to image_icon

Revision ID: 0009_rename_reward_image_icon
Revises: 0008_add_route_waypoints
Create Date: 2026-06-12 00:00:00.000000

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0009_rename_reward_image_icon"
down_revision: str | None = "0008_add_route_waypoints"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column("rewards", "image_emoji", new_column_name="image_icon")
    # Expand column length to accommodate Ionicon names (up to ~40 chars)
    op.alter_column("rewards", "image_icon", type_=sa.String(40), server_default="gift-outline")


def downgrade() -> None:
    op.alter_column("rewards", "image_icon", new_column_name="image_emoji")
    op.alter_column("rewards", "image_emoji", type_=sa.String(10), server_default="🎁")
