"""optimize_leaderboard_indexes

Revision ID: f7a8b9c0d1e2
Revises: e6f7a8b9c0d1
Create Date: 2026-05-26 02:00:00.000000

Changes:
  - DROP ix_user_friends_status (3-value enum, always skipped by planner)
  - ADD ix_user_friends_follower_status (follower_id, status) — friends tab query
  - ADD ix_user_friends_followee_status (followee_id, status) — incoming requests query
  - ADD ix_users_leaderboard_national — partial index for national leaderboard
  - ADD ix_users_leaderboard_city    — partial index for city leaderboard
"""

from __future__ import annotations

from alembic import op

revision: str = "f7a8b9c0d1e2"
down_revision: str | None = "e6f7a8b9c0d1"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    # Drop the useless single-column status index (3 values → planner ignores it)
    op.drop_index("ix_user_friends_status", table_name="user_friends")

    # Composite indexes matching the actual hot query patterns
    op.create_index(
        "ix_user_friends_follower_status",
        "user_friends",
        ["follower_id", "status"],
    )
    op.create_index(
        "ix_user_friends_followee_status",
        "user_friends",
        ["followee_id", "status"],
    )

    # Partial covering indexes for the two leaderboard ORDER BY paths.
    # PostgreSQL can satisfy WHERE + ORDER BY + LIMIT 100 with an index-only scan.
    op.execute(
        """
        CREATE INDEX ix_users_leaderboard_national
        ON users (total_points DESC, created_at ASC)
        WHERE role = 'DRIVER' AND is_private = false
        """
    )
    op.execute(
        """
        CREATE INDEX ix_users_leaderboard_city
        ON users (city, total_points DESC, created_at ASC)
        WHERE role = 'DRIVER' AND is_private = false
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_users_leaderboard_city")
    op.execute("DROP INDEX IF EXISTS ix_users_leaderboard_national")
    op.drop_index("ix_user_friends_followee_status", table_name="user_friends")
    op.drop_index("ix_user_friends_follower_status", table_name="user_friends")
    op.create_index("ix_user_friends_status", "user_friends", ["status"])
