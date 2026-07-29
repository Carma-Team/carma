"""add route_waypoints to trips

Revision ID: 0008_add_route_waypoints
Revises: b2d136cfab8a
Create Date: 2026-06-12 00:00:00.000000

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision: str = "0008_add_route_waypoints"
down_revision: str | None = "b2d136cfab8a"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("trips", sa.Column("route_waypoints", JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("trips", "route_waypoints")
