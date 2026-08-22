"""trips.accel_available / accel_init_failed - store per-trip IMU health (CAR-228)

CAR-189 started sending accelerometer health with every trip save. `SaveTripIn`
inherits `CamelModel`, which sets no `extra=`, so pydantic's default `ignore`
applied: the fields arrived over the wire and were dropped without an error, a
warning, or a log line.

Both columns are nullable and have to stay that way. A trip saved before this
landed, or by a client too old to send the fields, is *unknown* - which is a
different claim from "the accelerometer was never live". CAR-190 is going to
weight trip confidence on these, and defaulting them to false would quietly
penalise every healthy trip already in the table.

Revision ID: 0018_trip_imu_health
Revises: 0017_redemption_points_cost
Create Date: 2026-08-22 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision: str = "0018_trip_imu_health"
down_revision: str | None = "0017_redemption_points_cost"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.add_column("trips", sa.Column("accel_available", sa.Boolean(), nullable=True))
    op.add_column("trips", sa.Column("accel_init_failed", sa.Boolean(), nullable=True))


def downgrade() -> None:
    op.drop_column("trips", "accel_init_failed")
    op.drop_column("trips", "accel_available")
