"""business_invitations table (CAR-76)

One-time invitations that grant a MANAGER or CASHIER membership. The role
column reuses `business_membership_role` (CAR-74) rather than declaring a
second enum with the same three values — OWNER is simply never written here,
enforced in `services.business_invitations`, not by the schema.

`token_hash` is the only copy of the token this table ever holds — a SHA-256
digest, the same split `refresh_tokens` uses, so a database leak alone cannot
be redeemed.

Revision ID: 0026_business_invitations
Revises: 0025_redemption_consumed_by
Create Date: 2026-08-27 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0026_business_invitations"
down_revision: str | None = "0025_redemption_consumed_by"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table(
        "business_invitations",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("business_id", sa.String(32), sa.ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role", postgresql.ENUM(name="business_membership_role", create_type=False), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("created_by_user_id", sa.String(32), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("redeemed_at", sa.DateTime(timezone=True)),
        sa.Column("redeemed_by_user_id", sa.String(32), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_business_invitations_business", "business_invitations", ["business_id"])


def downgrade() -> None:
    op.drop_table("business_invitations")
