"""trip_occupancy table (CAR-220)

Minimal columns only — trip_id, verdict, source, excluded_from_driver_score,
evaluated_at. driver-identification.md §3.4 M1 specifies eleven columns
(signals, co_travel, reversal, likelihood, calibration_version,
enforcement_rung), but OccupancySignals.binding has no default and nothing
populates it before Phase 2's vehicle binding lands — writing a full row
today means fabricating a value the CHECK constraint exists to keep honest.
The rest arrives as a Phase 2 migration once there is real data for them.

Revision ID: 0027_trip_occupancy
Revises: 0026_business_invitations
Create Date: 2026-08-30 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa

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
        sa.Column("excluded_from_driver_score", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("evaluated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["trip_id"], ["trips.id"], ondelete="CASCADE"),
    )


def downgrade() -> None:
    op.drop_table("trip_occupancy")
