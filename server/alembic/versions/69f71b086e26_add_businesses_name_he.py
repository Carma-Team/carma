"""add businesses.name_he

Revision ID: 69f71b086e26
Revises: d3f49f647184
Create Date: 2026-06-13 16:49:23.836208

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "69f71b086e26"
down_revision: str | None = "d3f49f647184"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("businesses", sa.Column("name_he", sa.String(length=120), nullable=True))


def downgrade() -> None:
    op.drop_column("businesses", "name_he")
