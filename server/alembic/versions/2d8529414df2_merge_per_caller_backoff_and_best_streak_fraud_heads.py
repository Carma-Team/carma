"""merge per-caller backoff and best-streak/fraud heads

`0014_per_caller_login_backoff` was cut off `0013_reward_stock_nullable` while
that was still develop's head. Two other migrations landed off the same parent
in the meantime and were rejoined by `c443b498bcc7`, so merging CAR-51 in left
alembic with two heads and `alembic upgrade head` refusing to run. Nothing to
migrate — this only rejoins the graph, the same way `c443b498bcc7` did.

Revision ID: 2d8529414df2
Revises: c443b498bcc7, 0014_per_caller_backoff
Create Date: 2026-08-10

"""

from __future__ import annotations

revision: str = "2d8529414df2"
down_revision: tuple[str, str] = ("c443b498bcc7", "0014_per_caller_backoff")
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
