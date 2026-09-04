"""redemptions: expand-phase relax of business_id/settled_at (CAR-283)

0019 added `business_id` and `settled_at`, backfilled them, then tightened
`business_id` to NOT NULL and added a CHECK tying `settled_at` to `status` —
all in the same migration. deploy.yml runs migrations before the rollout, so
for the length of the rollout the still-running previous image (main, which
predates CAR-120 and writes neither column) hits both: a NOT NULL violation
issuing a voucher, a CHECK violation on every terminal-status transition.

This is the expand half of the split 0019 should have been: it undoes only
the contract step, leaving the columns and their backfill in place. The
outgoing image can keep writing through the relaxed schema; the incoming
image already sets both columns on every write, so no row goes unbackfilled.
CAR-287 restores NOT NULL and the CHECK once CAR-286 confirms the expand
release has fully rolled out.

Revision ID: 0029_redemption_settled_relax
Revises: 0028_road_segments
Create Date: 2026-08-31 00:00:00.000000
"""

from __future__ import annotations

from alembic import op

revision: str = "0029_redemption_settled_relax"
down_revision: str | None = "0028_road_segments"
branch_labels: str | None = None
depends_on: str | None = None

# Re-backfill for downgrade: rows written by the outgoing image during this
# release's rollout window are exactly the ones the columns were relaxed for,
# and they are what would otherwise make restoring NOT NULL/CHECK fail. Same
# source columns 0019 used — CANCELLED is left alone for the same reason it
# was there: no defensible stand-in for a settle time on a status nothing here
# originates. Also exercised directly in tests/test_voucher_settled_at.py to
# prove the backfill leaves no row that would block re-adding the constraints.
BUSINESS_ID_BACKFILL_SQL = """
    UPDATE redemptions SET business_id = rewards.business_id
    FROM rewards WHERE rewards.id = redemptions.reward_id AND redemptions.business_id IS NULL
"""
SETTLED_AT_BACKFILL_SQL = (
    "UPDATE redemptions SET settled_at = used_at WHERE status = 'USED' AND settled_at IS NULL",
    "UPDATE redemptions SET settled_at = expires_at WHERE status = 'EXPIRED' AND settled_at IS NULL",
)


def upgrade() -> None:
    op.drop_constraint("ck_redemptions_settled_at_matches_status", "redemptions", type_="check")
    op.alter_column("redemptions", "business_id", nullable=True)


def downgrade() -> None:
    op.execute(BUSINESS_ID_BACKFILL_SQL)
    for statement in SETTLED_AT_BACKFILL_SQL:
        op.execute(statement)

    op.alter_column("redemptions", "business_id", nullable=False)
    op.create_check_constraint(
        "ck_redemptions_settled_at_matches_status",
        "redemptions",
        "(status = 'PENDING') = (settled_at IS NULL)",
    )
