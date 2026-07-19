"""rfc001_telemetry_digest

Revision ID: c4d5e6f7a8b9
Revises: c2d3e4f5a6b7
Create Date: 2026-05-21 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "c4d5e6f7a8b9"
down_revision: str | None = "c2d3e4f5a6b7"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.add_column(
        "trips",
        sa.Column("telemetry_digest", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.add_column(
        "trips",
        sa.Column("payload_signature", sa.String(128), nullable=True),
    )
    op.execute("CREATE INDEX ix_trips_has_telemetry ON trips (id) WHERE telemetry_digest IS NOT NULL")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_trips_has_telemetry")
    op.drop_column("trips", "payload_signature")
    op.drop_column("trips", "telemetry_digest")
