"""trips.accel_available / accel_init_failed - store per-trip IMU health (CAR-228)

CAR-189 started sending accelerometer health with every trip save. `SaveTripIn`
inherits `CamelModel`, which sets no `extra=`, so pydantic's default `ignore`
applied: the fields arrived over the wire and were dropped without an error, a
warning, or a log line.

Both columns are nullable and have to stay that way. A trip saved before this
landed, or by a client too old to send the fields, is *unknown* - which is a
different claim from "the accelerometer was never live". Defaulting them to
false would quietly relabel every healthy trip already in the table as one with
a dead sensor.

Revision ID: 0027_trip_imu_health
Revises: 0026_business_invitations
Create Date: 2026-08-22 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision: str = "0027_trip_imu_health"
# Re-pointed from 0026 after 0028_road_segments landed on develop. Both were
# written off 0026, which git cannot see as a conflict and which only breaks
# once both are merged - the "One alembic head" job in ci-server.yml is what
# catches it (CAR-160). The filename still says 0027 because alembic sequences
# on `revision`, not on the name.
down_revision: str | None = "0028_road_segments"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.add_column("trips", sa.Column("accel_available", sa.Boolean(), nullable=True))
    op.add_column("trips", sa.Column("accel_init_failed", sa.Boolean(), nullable=True))


def downgrade() -> None:
    op.drop_column("trips", "accel_init_failed")
    op.drop_column("trips", "accel_available")
