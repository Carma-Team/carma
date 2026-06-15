"""merge reward-icon and v2-shadow heads

Revision ID: d3f49f647184
Revises: 0009_rename_reward_image_icon, a1c2e3f4d5b6
Create Date: 2026-06-13 16:21:07.035007

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd3f49f647184'
down_revision: Union[str, None] = ('0009_rename_reward_image_icon', 'a1c2e3f4d5b6')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
