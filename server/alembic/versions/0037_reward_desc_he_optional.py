"""rewards.description_he - drop NOT NULL (CAR-339 follow-up)

The Business Web form required both description fields since 0001_initial_schema.
Product decided a reward's description is optional in either language, matching
title_en's existing treatment - description_he was the only reward text field
still enforced as required all the way down to the DB.

Revision ID: 0037_reward_desc_he_optional
Revises: 24b7ca343591
Create Date: 2026-09-07 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision: str = "0037_reward_desc_he_optional"
down_revision: str | None = "24b7ca343591"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.alter_column("rewards", "description_he", existing_type=sa.String(500), nullable=True)


def downgrade() -> None:
    op.execute(sa.text("UPDATE rewards SET description_he = '' WHERE description_he IS NULL"))
    op.alter_column("rewards", "description_he", existing_type=sa.String(500), nullable=False)
