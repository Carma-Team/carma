"""add_idempotency_key_to_trips_add_fraud_reports

Revision ID: a1b2c3d4e5f6
Revises:
Create Date: 2026-05-19 00:00:00.000000
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── trips: add idempotency_key ───────────────────────────────────────────
    op.add_column("trips", sa.Column("idempotency_key", sa.String(64), nullable=True))
    op.create_unique_constraint("uq_trips_idempotency_key", "trips", ["idempotency_key"])
    op.create_index("ix_trips_idempotency_key", "trips", ["idempotency_key"])

    # ── fraud_reports: new table ─────────────────────────────────────────────
    op.create_table(
        "fraud_reports",
        sa.Column("id", sa.String(32), nullable=False),
        sa.Column("user_id", sa.String(32), nullable=False),
        sa.Column("idempotency_key", sa.String(64), nullable=True),
        sa.Column("trip_duration_seconds", sa.Integer(), nullable=True),
        sa.Column("distance_km", sa.Float(), nullable=True),
        sa.Column("avg_score", sa.Float(), nullable=True),
        sa.Column("anomaly_flags", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("raw_payload", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "reported_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_fraud_reports_user_id", "fraud_reports", ["user_id"])
    op.create_index("ix_fraud_reports_reported_at", "fraud_reports", ["reported_at"])


def downgrade() -> None:
    op.drop_index("ix_fraud_reports_reported_at", table_name="fraud_reports")
    op.drop_index("ix_fraud_reports_user_id", table_name="fraud_reports")
    op.drop_table("fraud_reports")

    op.drop_index("ix_trips_idempotency_key", table_name="trips")
    op.drop_constraint("uq_trips_idempotency_key", "trips", type_="unique")
    op.drop_column("trips", "idempotency_key")
