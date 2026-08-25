"""business_join_requests table (CAR-42)

One row per public business-registration submission, reviewed by CAR-77.
Two partial unique indexes (Postgres `WHERE status = 'PENDING'`) enforce "one
open request" from both directions at once — one applicant cannot hold two
live requests, and one registration number cannot be claimed by two pending
requests at the same time — without blocking a resubmission once the earlier
row has moved to REJECTED and dropped out of the partial index.

`postgresql.ENUM(..., create_type=False)` is used rather than plain `sa.Enum`
for both enum columns: generic `sa.Enum` silently drops `create_type` when
adapting to the native PG type unless the source is already a native
instance, so it re-issues `CREATE TYPE` for `business_category` (defined back
in 0001) regardless of the flag. The native class honours it directly.

Revision ID: 0022_business_join_requests
Revises: 0021_redemption_user_status_idx
Create Date: 2026-08-25 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0022_business_join_requests"
down_revision: str | None = "0021_redemption_user_status_idx"
branch_labels: str | None = None
depends_on: str | None = None

_JOIN_REQUEST_STATUS = postgresql.ENUM("PENDING", "APPROVED", "REJECTED", name="business_join_request_status")


def upgrade() -> None:
    _JOIN_REQUEST_STATUS.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "business_join_requests",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column(
            "applicant_user_id",
            sa.String(32),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("phone", sa.String(32), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("name_he", sa.String(120)),
        sa.Column(
            "category",
            postgresql.ENUM(name="business_category", create_type=False),
            nullable=False,
        ),
        sa.Column("location_lat", sa.Float, nullable=False),
        sa.Column("location_lng", sa.Float, nullable=False),
        sa.Column("address", sa.String(200)),
        sa.Column("registration_number", sa.String(64), nullable=False),
        sa.Column("contact_person", sa.String(120), nullable=False),
        sa.Column(
            "status",
            postgresql.ENUM(name="business_join_request_status", create_type=False),
            nullable=False,
            server_default="PENDING",
        ),
        sa.Column("reviewer_note", sa.String(500)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("reviewed_at", sa.DateTime(timezone=True)),
    )

    op.create_index(
        "ix_business_join_requests_applicant_created",
        "business_join_requests",
        ["applicant_user_id", "created_at"],
    )
    op.create_index(
        "uq_business_join_requests_applicant_pending",
        "business_join_requests",
        ["applicant_user_id"],
        unique=True,
        postgresql_where=sa.text("status = 'PENDING'"),
    )
    op.create_index(
        "uq_business_join_requests_regnum_pending",
        "business_join_requests",
        ["registration_number"],
        unique=True,
        postgresql_where=sa.text("status = 'PENDING'"),
    )


def downgrade() -> None:
    op.drop_table("business_join_requests")
    _JOIN_REQUEST_STATUS.drop(op.get_bind(), checkfirst=True)
