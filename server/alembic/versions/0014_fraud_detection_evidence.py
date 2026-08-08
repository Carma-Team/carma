"""fraud_reports: add detection evidence, drop the unpopulated avg_score

`detection` holds the evidence behind a classification — score, mode, which of
the three gates fired, and the window aggregates they were computed from. Until
now all of it landed in `raw_payload` as an unvalidated blob, or (for the gates)
was dropped on the device and never sent at all. A named column that always
holds a validated shape is queryable; `raw_payload` stays for what the schema
does not model yet.

`avg_score` goes because the client cannot ever supply it. A flagged session is
aborted before it reaches POST /api/trips, and the server is the only thing that
scores a trip — so nothing has ever written this column and nothing could. Every
row is NULL, hence no backfill and no data loss.

Revision ID: 0014_fraud_detection_evidence
Revises: 0013_reward_stock_nullable
Create Date: 2026-08-01 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision: str = "0014_fraud_detection_evidence"
down_revision: str | None = "0013_reward_stock_nullable"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.add_column("fraud_reports", sa.Column("detection", JSONB(), nullable=True))
    op.drop_column("fraud_reports", "avg_score")


def downgrade() -> None:
    op.add_column("fraud_reports", sa.Column("avg_score", sa.Float(), nullable=True))
    op.drop_column("fraud_reports", "detection")
