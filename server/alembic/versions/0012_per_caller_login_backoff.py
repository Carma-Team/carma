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

Revision ID: 0012_per_caller_backoff
Revises: 0011_drop_levels_table
Create Date: 2026-07-31 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision: str = "0012_per_caller_backoff"
down_revision: str | None = "0011_drop_levels_table"
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
    op.drop_column("users", "failed_otp_count")


def downgrade() -> None:
    # `0001` created this NOT NULL with no default. Rows exist by now, so coming
    # back needs one — otherwise the ADD COLUMN fails on a non-empty table.
    op.add_column("users", sa.Column("failed_otp_count", sa.Integer(), server_default="0", nullable=False))
    op.drop_index("ix_login_failures_user_ip_created", table_name="login_failures")
    op.drop_table("login_failures")
