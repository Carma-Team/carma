"""add users.invite_code

Revision ID: a9b8c7d6e5f4
Revises: 69f71b086e26
Create Date: 2026-07-25 19:40:00.000000

Backs the invite links users share (issue #33). Nullable: codes are minted on
first use, so existing rows need no backfill.
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision: str = "a9b8c7d6e5f4"
down_revision: str | None = "69f71b086e26"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("invite_code", sa.String(12), nullable=True))
    op.create_unique_constraint("uq_users_invite_code", "users", ["invite_code"])


def downgrade() -> None:
    op.drop_constraint("uq_users_invite_code", "users", type_="unique")
    op.drop_column("users", "invite_code")
