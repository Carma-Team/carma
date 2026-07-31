"""reward stock nullable — NULL means unlimited, 0 means sold out

`stock` was NOT NULL DEFAULT 0, which conflated three different states:
"unlimited", "sold out" and "never set". Nothing ever read the column, so the
default was harmless. It stops being harmless the moment availability is
enforced, because every reward created without an explicit stock would read as
sold out on the day this ships.

NULL is the SQL-native way to say "no cap". The CHECK keeps the remaining values
honest, and the redemptions index backs the availability count that replaces the
decrement that was never written (see services/rewards.py).

Revision ID: 0013_reward_stock_nullable
Revises: 0012_add_notifications
Create Date: 2026-07-30 00:00:00.000000
"""

from __future__ import annotations

from alembic import op

revision: str = "0013_reward_stock_nullable"
down_revision: str | None = "0012_add_notifications"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    # Metadata-only in Postgres — no table rewrite, no meaningful lock.
    op.alter_column("rewards", "stock", nullable=True, server_default=None)

    # Existing rows all sit at the old default of 0, which under the new meaning
    # reads as "sold out". None of them were ever meant to say that — nothing
    # enforced stock until now — so they become unlimited.
    op.execute("UPDATE rewards SET stock = NULL WHERE stock = 0")

    op.create_check_constraint("ck_rewards_stock_non_negative", "rewards", "stock IS NULL OR stock >= 0")

    # Availability is counted per reward over live PENDING + USED redemptions.
    op.create_index("ix_redemptions_reward_status_expires", "redemptions", ["reward_id", "status", "expires_at"])


def downgrade() -> None:
    op.drop_index("ix_redemptions_reward_status_expires", table_name="redemptions")
    op.drop_constraint("ck_rewards_stock_non_negative", "rewards", type_="check")
    # NULL meant unlimited; the old column cannot say that, and 0 is where those
    # rows came from. Any real cap set since is preserved.
    op.execute("UPDATE rewards SET stock = 0 WHERE stock IS NULL")
    op.alter_column("rewards", "stock", nullable=False, server_default="0")
