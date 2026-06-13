"""add route_waypoints to trips

Revision ID: 0008_add_route_waypoints
Revises: b2d136cfab8a
Create Date: 2026-06-12 00:00:00.000000

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision: str = '0008_add_route_waypoints'
down_revision: Union[str, None] = 'b2d136cfab8a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('trips', sa.Column('route_waypoints', JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column('trips', 'route_waypoints')
