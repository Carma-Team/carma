"""raw_recordings - index of staged calibration drives (CAR-213)

The NDJSON itself lives in the recording store (Azure Blob in the deployed
environments, a local directory in development); this table is the index that
makes the set queryable - CAR-31 asks for drives "somewhere the next person can
find it", and a container listing is not that.

The table ships empty and nothing reads it but the internal upload route, so a
database that never receives a drive behaves exactly as it does today.

Revision ID: 0031_raw_recordings
Revises: 0030_scoring_version_flat_ids
Create Date: 2026-08-31 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision: str = "0031_raw_recordings"
down_revision: str | None = "0030_scoring_version_flat_ids"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table(
        "raw_recordings",
        sa.Column("id", sa.String(length=32), primary_key=True),
        sa.Column("session_id", sa.String(length=64), nullable=False),
        sa.Column(
            "uploaded_by",
            sa.String(length=32),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("scenario", sa.String(length=40), nullable=False),
        sa.Column("platform", sa.String(length=20), nullable=False),
        sa.Column("device_model", sa.String(length=80), nullable=True),
        sa.Column("provenance", sa.String(length=20), nullable=False, server_default="staged"),
        sa.Column("format_version", sa.Integer(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("duration_s", sa.Integer(), nullable=False),
        sa.Column("sample_count", sa.Integer(), nullable=False),
        sa.Column("byte_size", sa.BigInteger(), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("object_path", sa.String(length=200), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    # Unique rather than merely indexed: it is the idempotency key a retrying
    # phone relies on, so two rows for one drive must be impossible even if two
    # uploads race.
    op.create_index("ix_raw_recordings_session_id", "raw_recordings", ["session_id"], unique=True)
    # The one query an analyst actually runs: "which mounted drives do we have
    # on iOS".
    op.create_index("ix_raw_recordings_scenario_platform", "raw_recordings", ["scenario", "platform"])


def downgrade() -> None:
    op.drop_index("ix_raw_recordings_scenario_platform", table_name="raw_recordings")
    op.drop_index("ix_raw_recordings_session_id", table_name="raw_recordings")
    op.drop_table("raw_recordings")
