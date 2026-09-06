"""business_branches table (CAR-341 continuation)

Businesses had exactly one location, stored on `businesses` itself. The
approved Business Profile & Branches design needs more than one, deactivated
rather than deleted (a branch may carry reward-availability history later).

`businesses.location_lat/location_lng/address` are left standing — dropping a
NOT NULL column has to outlive a full deploy cycle, the same hazard
0033_drop_users_city's own note describes, and application code stops reading
them as of this revision regardless. The backfill below gives every existing
business exactly one branch, copied from those three columns, so nothing
loses its location. `services.business_join_requests.approve` creates the
matching branch for every business approved after this migration; this
INSERT only ever needs to run once, but is written `WHERE NOT EXISTS` rather
than relying on a UNIQUE constraint, since a business is allowed more than
one branch afterwards.

Revision ID: 0034_business_branches
Revises: 0033_drop_users_city
Create Date: 2026-09-06 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision: str = "0034_business_branches"
down_revision: str | None = "0033_drop_users_city"
branch_labels: str | None = None
depends_on: str | None = None

# Same 32-char-hex id shape `uuid.uuid4().hex` produces elsewhere, and the
# same `gen_random_uuid()` cast `0024_business_memberships` uses — no
# pgcrypto extension needed, core Postgres since v13.
BACKFILL_SQL = """
    INSERT INTO business_branches
        (id, business_id, name, address, location_lat, location_lng, is_active, created_at)
    SELECT
        replace(gen_random_uuid()::text, '-', ''), b.id, NULL, b.address, b.location_lat, b.location_lng,
        true, b.created_at
    FROM businesses b
    WHERE NOT EXISTS (SELECT 1 FROM business_branches bb WHERE bb.business_id = b.id)
"""


def upgrade() -> None:
    op.create_table(
        "business_branches",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("business_id", sa.String(32), sa.ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(120), nullable=True),
        sa.Column("address", sa.String(200), nullable=True),
        sa.Column("location_lat", sa.Float, nullable=False),
        sa.Column("location_lng", sa.Float, nullable=False),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_business_branches_business", "business_branches", ["business_id"])

    op.execute(BACKFILL_SQL)


def downgrade() -> None:
    op.drop_table("business_branches")
