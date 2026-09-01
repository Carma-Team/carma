"""businesses.registration_number (CAR-77)

Nullable so existing rows (seed data, anything created before an approval
ever ran through a join request) are unaffected — Postgres allows multiple
NULLs under a UNIQUE constraint. Every Business created via CAR-77's approve
path always sets it, copied verbatim from the BusinessJoinRequest that
produced it, and the UNIQUE constraint is the final guarantee against two
approved businesses sharing one registration number.

Revision ID: 0023_business_reg_number
Revises: 0022_business_join_requests
Create Date: 2026-08-26 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision: str = "0023_business_reg_number"
down_revision: str | None = "0022_business_join_requests"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.add_column("businesses", sa.Column("registration_number", sa.String(64), nullable=True))
    op.create_unique_constraint("uq_businesses_registration_number", "businesses", ["registration_number"])


def downgrade() -> None:
    op.drop_constraint("uq_businesses_registration_number", "businesses", type_="unique")
    op.drop_column("businesses", "registration_number")
