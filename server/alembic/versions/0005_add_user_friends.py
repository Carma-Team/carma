"""add_user_friends

Revision ID: d5e6f7a8b9c0
Revises: c4d5e6f7a8b9
Create Date: 2026-05-26 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "d5e6f7a8b9c0"
down_revision: str | None = "c4d5e6f7a8b9"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table(
        "user_friends",
        sa.Column("id", sa.String(32), nullable=False),
        sa.Column("follower_id", sa.String(32), nullable=False),
        sa.Column("followee_id", sa.String(32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["follower_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["followee_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("follower_id", "followee_id", name="uq_user_friends_pair"),
    )
    op.create_index("ix_user_friends_follower", "user_friends", ["follower_id"])
    op.create_index("ix_user_friends_followee", "user_friends", ["followee_id"])


def downgrade() -> None:
    op.drop_index("ix_user_friends_followee", table_name="user_friends")
    op.drop_index("ix_user_friends_follower", table_name="user_friends")
    op.drop_table("user_friends")
