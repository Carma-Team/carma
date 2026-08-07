"""per_caller_login_backoff

Failed sign-ins were counted on the user row, so ten wrong passwords from a
stranger locked the account's owner out for fifteen minutes — repeatedly, from
one address, inside a minute (CAR-51). They are counted per (account, caller
address) now, which puts the wait on whoever is guessing.

`users.failed_otp_count` goes with them. The account-wide backstop is the same
rows counted without the address, so there is nothing left for the column to
hold — and keeping it would mean two counters that disagree in kind, one
lifetime-consecutive and one rolling-window. `users.locked_until` stays: it is
read on every authenticated request and must not become a join.

`users.lockout_reset_at` is where the account-wide tally restarts after a lock.
It exists so that reopening the account does not have to delete the per-address
rows — deleting them would hand every address that caused the lock a fresh
allowance, which is precisely the guesser's interest.

Revision ID: 0014_per_caller_backoff
Revises: 0013_reward_stock_nullable
Create Date: 2026-07-31 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision: str = "0014_per_caller_backoff"
down_revision: str | None = "0013_reward_stock_nullable"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table(
        "login_failures",
        sa.Column("id", sa.String(32), nullable=False),
        sa.Column("user_id", sa.String(32), nullable=False),
        sa.Column("caller_ip", sa.String(45), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_login_failures_user_ip_created", "login_failures", ["user_id", "caller_ip", "created_at"])
    op.create_index("ix_login_failures_created_at", "login_failures", ["created_at"])
    op.add_column("users", sa.Column("lockout_reset_at", sa.DateTime(timezone=True), nullable=True))
    op.drop_column("users", "failed_otp_count")


def downgrade() -> None:
    # `0001` created this NOT NULL with no default. Rows exist by now, so coming
    # back needs one — otherwise the ADD COLUMN fails on a non-empty table.
    op.add_column("users", sa.Column("failed_otp_count", sa.Integer(), server_default="0", nullable=False))
    op.drop_column("users", "lockout_reset_at")
    op.drop_index("ix_login_failures_created_at", table_name="login_failures")
    op.drop_index("ix_login_failures_user_ip_created", table_name="login_failures")
    op.drop_table("login_failures")
