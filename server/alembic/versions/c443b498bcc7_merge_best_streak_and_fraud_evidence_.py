"""merge best_streak and fraud_evidence heads

Two migrations were numbered 0014 on separate branches and both point at
0013_reward_stock_nullable, so merging them left alembic with two heads and
`alembic upgrade head` refusing to run. Nothing to migrate — this only rejoins
the graph.

Revision ID: c443b498bcc7
Revises: 0014_user_best_streak, 0014_fraud_detection_evidence
Create Date: 2026-08-07

"""

from __future__ import annotations

revision: str = "c443b498bcc7"
down_revision: tuple[str, str] = ("0014_user_best_streak", "0014_fraud_detection_evidence")
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
