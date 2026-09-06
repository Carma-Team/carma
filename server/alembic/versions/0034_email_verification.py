"""email_verification_codes + users.is_email_verified

Registration hands out a token without ever proving the address belongs to the
person signing up, and users.email is unique, so an address someone else claimed
is one its owner can never register with.

Expand only. The table ships empty, the flag ships false for everyone, and
nothing reads either to allow or refuse anything - registration behaves exactly
as it does today. Making verification a requirement is a separate change, and
one that must not ship while no mail provider is configured.

Its own table rather than a nullable email column on otp_codes: that table is
keyed on a phone number because nobody is signed in when one is minted, and
relaxing its phone column to nullable would have touched the one table the
login, registration and reset doors all read.

Revision ID: 0034_email_verification
Revises: 0033_drop_users_city
Create Date: 2026-09-06 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision: str = "0034_email_verification"
down_revision: str | None = "0033_drop_users_city"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table(
        "email_verification_codes",
        sa.Column("id", sa.String(length=32), primary_key=True),
        sa.Column(
            "user_id",
            sa.String(length=32),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # The address the code went to, not a copy of users.email for reading
        # back: confirm compares the two, so changing an email mid-flight cannot
        # verify the new one with a code sent to the old.
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("code_hash", sa.String(length=255), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index(
        "ix_email_verification_codes_user_consumed",
        "email_verification_codes",
        ["user_id", "consumed_at"],
    )
    op.create_index(
        "ix_email_verification_codes_expires_at",
        "email_verification_codes",
        ["expires_at"],
    )

    op.add_column(
        "users",
        sa.Column("is_email_verified", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("users", "is_email_verified")
    op.drop_index("ix_email_verification_codes_expires_at", table_name="email_verification_codes")
    op.drop_index("ix_email_verification_codes_user_consumed", table_name="email_verification_codes")
    op.drop_table("email_verification_codes")
