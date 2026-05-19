"""add_index_fraud_reports_idempotency_key

Revision ID: c2d3e4f5a6b7
Revises: a1b2c3d4e5f6
Create Date: 2026-05-19 01:00:00.000000
"""

from __future__ import annotations

from alembic import op

revision: str = "c2d3e4f5a6b7"
down_revision: str | None = "a1b2c3d4e5f6"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_index("ix_fraud_reports_idempotency_key", "fraud_reports", ["idempotency_key"])


def downgrade() -> None:
    op.drop_index("ix_fraud_reports_idempotency_key", table_name="fraud_reports")
