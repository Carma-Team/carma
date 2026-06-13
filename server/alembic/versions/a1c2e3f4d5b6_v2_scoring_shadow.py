"""v2 scoring shadow: add trips.score_v2, trips.scoring_version, users.driver_score

Revision ID: a1c2e3f4d5b6
Revises: f7a8b9c0d1e2
Create Date: 2026-06-13 10:00:00.000000

Shadow-mode columns for CARMA Scoring Algorithm v2 (docs/scoring-algorithm-v2.md).
v2 is computed alongside v1 and stored here; nothing user-facing reads it yet.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'a1c2e3f4d5b6'
down_revision: Union[str, None] = 'f7a8b9c0d1e2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('trips', sa.Column('score_v2', sa.Float(), nullable=True))
    op.add_column('trips', sa.Column('scoring_version', sa.String(length=16), server_default='1.0', nullable=False))
    op.add_column('users', sa.Column('driver_score', sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'driver_score')
    op.drop_column('trips', 'scoring_version')
    op.drop_column('trips', 'score_v2')
