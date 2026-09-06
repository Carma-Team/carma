"""redemptions: restore business_id NOT NULL and the settled_at CHECK (CAR-287)

0029 relaxed both for the length of the CAR-283 mixed-version rollout: a
still-running previous image, which predated CAR-120 and wrote neither
column, would otherwise 500 on every voucher write. Every write path
(rewards.py issue/expire/cancel, business.py consume) has set both columns
unconditionally since CAR-120, so the only rows left non-conforming are ones
written before that — or, in principle, by whatever wrote through the
relaxed window this migration is closing.

This re-derives what 0029's own downgrade already knew how to backfill
(business_id from rewards.business_id, settled_at from used_at/expires_at
for USED/EXPIRED) and then, before touching any DDL, checks for rows that
backfill cannot fix. CANCELLED rows with no settled_at are the one case with
no honest source to backfill from (same reasoning CAR-120 and CAR-283 both
give) — if any exist, restoring the constraints would either corrupt them
with a guessed timestamp or fail on Postgres's own generic constraint-
violation error. Neither is acceptable, so upgrade() raises a clear,
specific error instead and leaves the schema untouched.

Revision ID: 0031_redemption_settled_restore
Revises: 0027_city_reference
Create Date: 2026-09-03 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0031_redemption_settled_restore"
down_revision: str | None = "0027_city_reference"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CONSTRAINT_NAME = "ck_redemptions_settled_at_matches_status"

# Identical to 0029's downgrade backfill — same source columns, same
# CANCELLED exclusion. Kept as a literal copy rather than importing 0029:
# alembic version files are not a stable import surface, and each migration
# owning its own SQL means a later edit to 0029 can't silently change what
# 0031 runs.
BUSINESS_ID_BACKFILL_SQL = """
    UPDATE redemptions SET business_id = rewards.business_id
    FROM rewards WHERE rewards.id = redemptions.reward_id AND redemptions.business_id IS NULL
"""
SETTLED_AT_BACKFILL_SQL = (
    "UPDATE redemptions SET settled_at = used_at WHERE status = 'USED' AND settled_at IS NULL",
    "UPDATE redemptions SET settled_at = expires_at WHERE status = 'EXPIRED' AND settled_at IS NULL",
)


def upgrade() -> None:
    op.execute(BUSINESS_ID_BACKFILL_SQL)
    for statement in SETTLED_AT_BACKFILL_SQL:
        op.execute(statement)

    connection = op.get_bind()

    missing_business_id = connection.exec_driver_sql(
        "SELECT count(*) FROM redemptions WHERE business_id IS NULL"
    ).scalar_one()
    missing_settled_at = connection.exec_driver_sql(
        "SELECT count(*) FROM redemptions WHERE status != 'PENDING' AND settled_at IS NULL"
    ).scalar_one()

    if missing_business_id or missing_settled_at:
        raise RuntimeError(
            "CAR-287 cannot restore redemptions constraints: "
            f"{missing_business_id} row(s) still have a NULL business_id and "
            f"{missing_settled_at} terminal-status row(s) still have a NULL settled_at "
            "after backfill. These cannot be derived from used_at/expires_at/rewards.business_id "
            "(most likely pre-CAR-120 CANCELLED rows) and must be resolved by hand before this "
            "migration can run — inventing a value for them is not safe."
        )

    op.alter_column("redemptions", "business_id", nullable=False)
    op.create_check_constraint(
        CONSTRAINT_NAME,
        "redemptions",
        "(status = 'PENDING') = (settled_at IS NULL)",
    )


def downgrade() -> None:
    op.drop_constraint(CONSTRAINT_NAME, "redemptions", type_="check")
    op.alter_column("redemptions", "business_id", nullable=True)
