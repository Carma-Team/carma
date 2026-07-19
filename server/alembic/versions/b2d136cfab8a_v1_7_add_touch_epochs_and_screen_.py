"""v1.7: add touch_epochs and screen_interaction_seconds to trips

Revision ID: b2d136cfab8a
Revises: c4d5e6f7a8b9
Create Date: 2026-05-21 17:35:17.714651

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "b2d136cfab8a"
down_revision: str | None = "c4d5e6f7a8b9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("trips", sa.Column("touch_epochs", sa.Integer(), server_default="0", nullable=False))
    op.add_column("trips", sa.Column("screen_interaction_seconds", sa.Integer(), server_default="0", nullable=False))
    op.drop_column("trips", "phone_seconds")


def downgrade() -> None:
    op.add_column("trips", sa.Column("phone_seconds", sa.Integer(), server_default="0", nullable=False))
    op.drop_column("trips", "screen_interaction_seconds")
    op.drop_column("trips", "touch_epochs")
