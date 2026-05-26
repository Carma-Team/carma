"""privacy_model

Revision ID: e6f7a8b9c0d1
Revises: d5e6f7a8b9c0
Create Date: 2026-05-26 01:00:00.000000

Adds:
  users.is_private          BOOLEAN DEFAULT FALSE
  user_friends.status       friend_status enum DEFAULT 'accepted'
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "e6f7a8b9c0d1"
down_revision: str | None = "d5e6f7a8b9c0"
branch_labels: str | None = None
depends_on: str | None = None

_STATUS_ENUM = sa.Enum("pending", "accepted", "blocked", name="friend_status")


def upgrade() -> None:
    _STATUS_ENUM.create(op.get_bind(), checkfirst=True)

    op.add_column("users", sa.Column("is_private", sa.Boolean(), nullable=False, server_default="false"))
    op.add_column(
        "user_friends",
        sa.Column(
            "status",
            sa.Enum("pending", "accepted", "blocked", name="friend_status", create_type=False),
            nullable=False,
            server_default="accepted",
        ),
    )
    op.create_index("ix_user_friends_status", "user_friends", ["status"])


def downgrade() -> None:
    op.drop_index("ix_user_friends_status", table_name="user_friends")
    op.drop_column("user_friends", "status")
    op.drop_column("users", "is_private")
    _STATUS_ENUM.drop(op.get_bind(), checkfirst=True)
