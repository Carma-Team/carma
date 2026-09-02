"""trip_occupancy table (CAR-220)

Eight of the eleven columns in driver-identification.md §3.4 M1:
trip_id, verdict, source, excluded_from_driver_score, evaluated_at, plus the
three nullable ones (likelihood, co_travel, reversal) — NULL is itself a
valid, spec-compliant state for those, so adding them now costs nothing.

calibration_version, enforcement_rung and signals are NOT NULL in the spec
and are real outputs of L1/L2/L3, none of which exist yet (L1 vehicle
binding is Phase 2). signals.binding has no default, so writing a value now
means fabricating one the CHECK constraint exists to keep honest. Those
three arrive as a Phase 2 migration once there is a writer for them.

Revision ID: 0027_trip_occupancy
Revises: 0026_business_invitations
Create Date: 2026-08-30 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision: str = "0027_trip_occupancy"
down_revision: str | None = "0030_scoring_version_flat_ids"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table(
        "trip_occupancy",
        sa.Column("trip_id", sa.String(length=32), primary_key=True),
        sa.Column("verdict", sa.String(length=16), nullable=False),
        sa.Column("source", sa.String(length=16), nullable=False),
        sa.Column("likelihood", sa.Float(), nullable=True),
        sa.Column("co_travel", JSONB(), nullable=True),
        sa.Column("reversal", JSONB(), nullable=True),
        sa.Column("excluded_from_driver_score", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("evaluated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["trip_id"], ["trips.id"], ondelete="CASCADE"),
    )


def downgrade() -> None:
    op.drop_table("trip_occupancy")
