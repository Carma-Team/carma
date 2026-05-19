"""initial_schema

Revision ID: b0e1d2c3f4a5
Revises:
Create Date: 2026-05-19 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "b0e1d2c3f4a5"
down_revision: str | None = None
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    # ── PostgreSQL enum types ────────────────────────────────────────────────
    op.execute(sa.text("CREATE TYPE IF NOT EXISTS user_role AS ENUM ('DRIVER', 'BUSINESS', 'ADMIN')"))
    op.execute(sa.text("CREATE TYPE IF NOT EXISTS language AS ENUM ('HE', 'EN')"))
    op.execute(sa.text("CREATE TYPE IF NOT EXISTS trip_status AS ENUM ('ACTIVE', 'COMPLETED', 'DISCARDED')"))
    op.execute(
        sa.text(
            "CREATE TYPE IF NOT EXISTS event_type AS ENUM "
            "('HARD_BRAKE', 'AGGRESSIVE_ACCEL', 'SHARP_TURN', 'SWERVE', 'PHONE_USE', 'SPEEDING')"
        )
    )
    op.execute(
        sa.text("CREATE TYPE IF NOT EXISTS redemption_status AS ENUM ('PENDING', 'USED', 'EXPIRED', 'CANCELLED')")
    )
    op.execute(
        sa.text(
            "CREATE TYPE IF NOT EXISTS business_category AS ENUM "
            "('FUEL', 'FOOD', 'ECO', 'ENTERTAINMENT', 'SHOPPING', 'OTHER')"
        )
    )

    # ── levels ───────────────────────────────────────────────────────────────
    op.create_table(
        "levels",
        sa.Column("id", sa.String(32), nullable=False),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("name_he", sa.String(80), nullable=False),
        sa.Column("name_en", sa.String(80), nullable=False),
        sa.Column("min_points", sa.Integer(), nullable=False),
        sa.Column("discount_pct", sa.Integer(), nullable=False),
        sa.Column("bonus_multiplier", sa.Float(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("number"),
    )

    # ── otp_codes ────────────────────────────────────────────────────────────
    op.create_table(
        "otp_codes",
        sa.Column("id", sa.String(32), nullable=False),
        sa.Column("phone", sa.String(32), nullable=False),
        sa.Column("code_hash", sa.String(255), nullable=False),
        sa.Column("purpose", sa.String(32), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_otp_codes_phone_purpose_consumed", "otp_codes", ["phone", "purpose", "consumed_at"])
    op.create_index("ix_otp_codes_expires_at", "otp_codes", ["expires_at"])

    # ── users ────────────────────────────────────────────────────────────────
    op.create_table(
        "users",
        sa.Column("id", sa.String(32), nullable=False),
        sa.Column("email", sa.String(255), nullable=True),
        sa.Column("password_hash", sa.String(255), nullable=True),
        sa.Column("phone", sa.String(32), nullable=True),
        sa.Column("name", sa.String(120), nullable=True),
        sa.Column("role", sa.Enum(name="user_role", create_type=False), nullable=False),
        sa.Column("language", sa.Enum(name="language", create_type=False), nullable=False),
        sa.Column("avatar_url", sa.String(500), nullable=True),
        sa.Column("age", sa.Integer(), nullable=True),
        sa.Column("city", sa.String(80), nullable=True),
        sa.Column("license_year", sa.Integer(), nullable=True),
        sa.Column("license_img_url", sa.String(500), nullable=True),
        sa.Column("points", sa.Integer(), nullable=False),
        sa.Column("total_points", sa.Integer(), nullable=False),
        sa.Column("total_distance", sa.Float(), nullable=False),
        sa.Column("level", sa.Integer(), nullable=False),
        sa.Column("drive_mode_enabled", sa.Boolean(), nullable=False),
        sa.Column("bluetooth_device_id", sa.String(120), nullable=True),
        sa.Column("bluetooth_device_name", sa.String(120), nullable=True),
        sa.Column("last_lat", sa.Float(), nullable=True),
        sa.Column("last_lng", sa.Float(), nullable=True),
        sa.Column("last_location_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_cleared_history", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_phone_verified", sa.Boolean(), nullable=False),
        sa.Column("failed_otp_count", sa.Integer(), nullable=False),
        sa.Column("locked_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_logged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email"),
        sa.UniqueConstraint("phone"),
    )
    op.create_index("ix_users_phone", "users", ["phone"])
    op.create_index("ix_users_email", "users", ["email"])
    op.create_index("ix_users_role", "users", ["role"])

    # ── businesses ───────────────────────────────────────────────────────────
    op.create_table(
        "businesses",
        sa.Column("id", sa.String(32), nullable=False),
        sa.Column("owner_user_id", sa.String(32), nullable=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("category", sa.Enum(name="business_category", create_type=False), nullable=False),
        sa.Column("location_lat", sa.Float(), nullable=False),
        sa.Column("location_lng", sa.Float(), nullable=False),
        sa.Column("address", sa.String(200), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["owner_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("owner_user_id"),
    )
    op.create_index("ix_businesses_category", "businesses", ["category"])
    op.create_index("ix_businesses_location", "businesses", ["location_lat", "location_lng"])

    # ── rewards ──────────────────────────────────────────────────────────────
    op.create_table(
        "rewards",
        sa.Column("id", sa.String(32), nullable=False),
        sa.Column("business_id", sa.String(32), nullable=False),
        sa.Column("title_he", sa.String(120), nullable=False),
        sa.Column("title_en", sa.String(120), nullable=True),
        sa.Column("description_he", sa.String(500), nullable=False),
        sa.Column("description_en", sa.String(500), nullable=True),
        sa.Column("category", sa.Enum(name="business_category", create_type=False), nullable=False),
        sa.Column("cost_points", sa.Integer(), nullable=False),
        sa.Column("image_emoji", sa.String(10), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("stock", sa.Integer(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["business_id"], ["businesses.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_rewards_business_active", "rewards", ["business_id", "is_active"])
    op.create_index("ix_rewards_category", "rewards", ["category"])

    # ── trips ────────────────────────────────────────────────────────────────
    op.create_table(
        "trips",
        sa.Column("id", sa.String(32), nullable=False),
        sa.Column("user_id", sa.String(32), nullable=False),
        sa.Column("start_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration_seconds", sa.Integer(), nullable=False),
        sa.Column("distance_km", sa.Float(), nullable=False),
        sa.Column("start_lat", sa.Float(), nullable=True),
        sa.Column("start_lng", sa.Float(), nullable=True),
        sa.Column("end_lat", sa.Float(), nullable=True),
        sa.Column("end_lng", sa.Float(), nullable=True),
        sa.Column("avg_score", sa.Float(), nullable=True),
        sa.Column("points", sa.Integer(), nullable=False),
        sa.Column("risk_multiplier", sa.Float(), nullable=False),
        sa.Column("status", sa.Enum(name="trip_status", create_type=False), nullable=False),
        sa.Column("hard_brakes", sa.Integer(), nullable=False),
        sa.Column("aggressive_accels", sa.Integer(), nullable=False),
        sa.Column("sharp_turns", sa.Integer(), nullable=False),
        sa.Column("phone_seconds", sa.Integer(), nullable=False),
        sa.Column("ai_insight", sa.String(500), nullable=True),
        sa.Column("start_location", sa.String(200), nullable=True),
        sa.Column("end_location", sa.String(200), nullable=True),
        sa.Column("synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_trips_user_start", "trips", ["user_id", "start_time"])
    op.create_index("ix_trips_status", "trips", ["status"])

    # ── events ───────────────────────────────────────────────────────────────
    op.create_table(
        "events",
        sa.Column("id", sa.String(32), nullable=False),
        sa.Column("trip_id", sa.String(32), nullable=False),
        sa.Column("type", sa.Enum(name="event_type", create_type=False), nullable=False),
        sa.Column("severity", sa.Float(), nullable=False),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("lat", sa.Float(), nullable=True),
        sa.Column("lng", sa.Float(), nullable=True),
        sa.Column("sensor_data", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.ForeignKeyConstraint(["trip_id"], ["trips.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_events_trip_timestamp", "events", ["trip_id", "timestamp"])
    op.create_index("ix_events_type", "events", ["type"])

    # ── redemptions ──────────────────────────────────────────────────────────
    op.create_table(
        "redemptions",
        sa.Column("id", sa.String(32), nullable=False),
        sa.Column("user_id", sa.String(32), nullable=False),
        sa.Column("reward_id", sa.String(32), nullable=False),
        sa.Column("qr_code", sa.String(64), nullable=False),
        sa.Column("qr_data", sa.String(64), nullable=True),
        sa.Column("status", sa.Enum(name="redemption_status", create_type=False), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["reward_id"], ["rewards.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("qr_code"),
    )
    op.create_index("ix_redemptions_user_status", "redemptions", ["user_id", "status"])
    op.create_index("ix_redemptions_qr_code", "redemptions", ["qr_code"])


def downgrade() -> None:
    op.drop_table("redemptions")
    op.drop_table("events")
    op.drop_table("trips")
    op.drop_table("rewards")
    op.drop_table("businesses")
    op.drop_table("users")
    op.drop_table("otp_codes")
    op.drop_table("levels")

    op.execute(sa.text("DROP TYPE IF EXISTS redemption_status"))
    op.execute(sa.text("DROP TYPE IF EXISTS event_type"))
    op.execute(sa.text("DROP TYPE IF EXISTS trip_status"))
    op.execute(sa.text("DROP TYPE IF EXISTS business_category"))
    op.execute(sa.text("DROP TYPE IF EXISTS language"))
    op.execute(sa.text("DROP TYPE IF EXISTS user_role"))
