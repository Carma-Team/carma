"""business_memberships table (CAR-74)

Replaces `Business.owner_user_id` as the *authorization* source — every
`/api/business` route now resolves business and role from this table on every
request, never from the JWT. `owner_user_id` itself is untouched and stays the
FK it always was; retiring it is a deliberate follow-up (CAR-74's own scope
note), not this migration's job.

The backfill covers every `Business` that already has an `owner_user_id`,
whatever created it — seed data, a legacy direct insert, or CAR-77's approve
flow. `ON CONFLICT ... DO NOTHING` on the same unique constraint the table
declares makes it safe to run more than once, which matters because the same
statement (`BACKFILL_SQL`) is also exercised directly in
`tests/test_business_memberships.py` to prove the backfill produces exactly
one OWNER per business that has an owner.

Revision ID: 0024_business_memberships
Revises: 0023_business_reg_number
Create Date: 2026-08-26 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0024_business_memberships"
down_revision: str | None = "0023_business_reg_number"
branch_labels: str | None = None
depends_on: str | None = None

_MEMBERSHIP_ROLE = postgresql.ENUM("OWNER", "MANAGER", "CASHIER", name="business_membership_role")

# Generates a 32-char hex id in the same shape `uuid.uuid4().hex` produces
# elsewhere, so a backfilled row is indistinguishable from one the ORM wrote.
# `gen_random_uuid()` is core Postgres since v13 — no pgcrypto extension needed.
BACKFILL_SQL = """
    INSERT INTO business_memberships (id, user_id, business_id, role, created_at)
    SELECT replace(gen_random_uuid()::text, '-', ''), owner_user_id, id, 'OWNER', now()
    FROM businesses
    WHERE owner_user_id IS NOT NULL
    ON CONFLICT ON CONSTRAINT uq_business_memberships_user_business DO NOTHING
"""


def upgrade() -> None:
    _MEMBERSHIP_ROLE.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "business_memberships",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("user_id", sa.String(32), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("business_id", sa.String(32), sa.ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role", postgresql.ENUM(name="business_membership_role", create_type=False), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("user_id", "business_id", name="uq_business_memberships_user_business"),
    )
    op.create_index("ix_business_memberships_business", "business_memberships", ["business_id"])

    op.execute(BACKFILL_SQL)


def downgrade() -> None:
    op.drop_table("business_memberships")
    _MEMBERSHIP_ROLE.drop(op.get_bind(), checkfirst=True)
