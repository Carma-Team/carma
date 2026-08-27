"""redemptions.settled_at + business_id — one timestamp for every terminal state (CAR-120)

A voucher had no single "when did this finish" column. `used_at` is written
only on consume, so EXPIRED and CANCELLED rows had no way to order the
lifecycle by when it ended — the problem CAR-79's history pagination runs into.

`settled_at` is written in the same statement as the status on every terminal
transition, so the two can never disagree. `business_id` is a snapshot of the
owning reward's business at issue time (a reward never changes owner), added
so CAR-79 can page a business's history on `(settled_at, id)` as a single
indexed scan instead of joining through `rewards` for every row.

Backfill: USED rows take `used_at`. EXPIRED rows take `expires_at` — the TTL
sweep settles a row shortly after it lapses, so the boundary it already lapsed
at is the closest honest value to a settle time never actually recorded.

CANCELLED is deliberately left alone. No row has ever held that status — no
code path writes it yet — and unlike EXPIRED, `expires_at` is not a defensible
stand-in for it: a cancellation is a driver action that can happen at any
point before expiry, so backfilling one from `expires_at` would fabricate a
settle time that could be days off, not approximate a real one. If a CANCELLED
row without `settled_at` ever does turn up, the CHECK constraint added below
makes this migration fail loudly on it rather than silently inventing a value —
that failure is the correct outcome, surfacing data nobody expects to exist
instead of hiding it behind a plausible-looking timestamp.

Revision ID: 0019_redemption_settled_at
Revises: 0018_severity_axis_backfill
Create Date: 2026-08-24 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision: str = "0019_redemption_settled_at"
down_revision: str | None = "0018_severity_axis_backfill"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.add_column("redemptions", sa.Column("settled_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("redemptions", sa.Column("business_id", sa.String(length=32), nullable=True))

    op.execute(
        "UPDATE redemptions SET business_id = rewards.business_id "
        "FROM rewards WHERE rewards.id = redemptions.reward_id"
    )
    op.execute("UPDATE redemptions SET settled_at = used_at WHERE status = 'USED'")
    op.execute("UPDATE redemptions SET settled_at = expires_at WHERE status = 'EXPIRED'")

    op.alter_column("redemptions", "business_id", nullable=False)
    op.create_foreign_key("fk_redemptions_business_id_businesses", "redemptions", "businesses", ["business_id"], ["id"])
    op.create_check_constraint(
        "ck_redemptions_settled_at_matches_status",
        "redemptions",
        "(status = 'PENDING') = (settled_at IS NULL)",
    )
    op.create_index("ix_redemptions_business_settled_id", "redemptions", ["business_id", "settled_at", "id"])


def downgrade() -> None:
    op.drop_index("ix_redemptions_business_settled_id", table_name="redemptions")
    op.drop_constraint("ck_redemptions_settled_at_matches_status", "redemptions", type_="check")
    op.drop_constraint("fk_redemptions_business_id_businesses", "redemptions", type_="foreignkey")
    op.drop_column("redemptions", "business_id")
    op.drop_column("redemptions", "settled_at")
