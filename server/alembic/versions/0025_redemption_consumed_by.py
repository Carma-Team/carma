"""redemptions.consumed_by_user_id (CAR-75)

Nullable, and left that way for every existing row — the acting business
member did not exist as a concept before CAR-74's membership table, so there
is nothing to backfill this from. Only `business_service.consume_voucher`
ever writes it, in the same UPDATE as the PENDING -> USED flip.

`ON DELETE SET NULL` rather than `CASCADE`: this FK sits on the *driver's*
voucher row, incidentally naming which staff member scanned it. Deleting that
staff account must not take someone else's redemption history with it — only
the pointer to who scanned it should go.

Revision ID: 0025_redemption_consumed_by
Revises: 0024_business_memberships
Create Date: 2026-08-26 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision: str = "0025_redemption_consumed_by"
down_revision: str | None = "0024_business_memberships"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.add_column(
        "redemptions",
        sa.Column("consumed_by_user_id", sa.String(32), sa.ForeignKey("users.id", ondelete="SET NULL")),
    )
    op.create_index("ix_redemptions_consumed_by_user_id", "redemptions", ["consumed_by_user_id"])


def downgrade() -> None:
    op.drop_index("ix_redemptions_consumed_by_user_id", table_name="redemptions")
    op.drop_column("redemptions", "consumed_by_user_id")
