"""refresh_tokens — server-side session store for the web app's refresh cookie (CAR-217)

The web app needs logout to actually end a session, not just ask the browser
to forget a cookie — a stateless refresh JWT has nothing for logout to revoke,
so a copy taken beforehand would keep working until it expired on its own.
Shaped like `otp_codes`: a hashed secret, an expiry, and now a `revoked_at`
that marks a session dead early (logout) or rotated away (every refresh).

Revision ID: 0016_refresh_tokens
Revises: 0015_reward_archived_at
Create Date: 2026-08-21 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision: str = "0016_refresh_tokens"
down_revision: str | None = "0015_reward_archived_at"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table(
        "refresh_tokens",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("user_id", sa.String(32), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        # Points at the row a rotation replaced this one with; null on a
        # revoke with no successor (logout, or the cut from a detected
        # reuse). Lets a benign two-tabs-race be told apart from a replayed
        # dead token — see the model docstring and services/auth.py.
        sa.Column(
            "replaced_by_id",
            sa.String(32),
            sa.ForeignKey("refresh_tokens.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_refresh_tokens_token_hash", "refresh_tokens", ["token_hash"], unique=True)
    op.create_index("ix_refresh_tokens_user_id", "refresh_tokens", ["user_id"])
    op.create_index("ix_refresh_tokens_expires_at", "refresh_tokens", ["expires_at"])


def downgrade() -> None:
    op.drop_index("ix_refresh_tokens_expires_at", table_name="refresh_tokens")
    op.drop_index("ix_refresh_tokens_user_id", table_name="refresh_tokens")
    op.drop_index("ix_refresh_tokens_token_hash", table_name="refresh_tokens")
    op.drop_table("refresh_tokens")
