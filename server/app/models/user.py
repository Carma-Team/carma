from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, Enum, Float, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin
from app.models.enums import Language, UserRole

if TYPE_CHECKING:
    from app.models.business import Business
    from app.models.fraud import FraudReport
    from app.models.redemption import Redemption
    from app.models.trip import Trip


def _new_id() -> str:
    return uuid.uuid4().hex


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_new_id)

    email: Mapped[str | None] = mapped_column(String(255), unique=True)
    password_hash: Mapped[str | None] = mapped_column(String(255))
    phone: Mapped[str | None] = mapped_column(String(32), unique=True)

    name: Mapped[str | None] = mapped_column(String(120))
    role: Mapped[UserRole] = mapped_column(Enum(UserRole, name="user_role"), default=UserRole.DRIVER, nullable=False)
    language: Mapped[Language] = mapped_column(Enum(Language, name="language"), default=Language.HE, nullable=False)
    avatar_url: Mapped[str | None] = mapped_column(String(500))
    age: Mapped[int | None] = mapped_column(Integer)
    city: Mapped[str | None] = mapped_column(String(80))
    license_year: Mapped[int | None] = mapped_column(Integer)
    license_img_url: Mapped[str | None] = mapped_column(String(500))

    points: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_points: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_distance: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    level: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    # Persistent driver score (scoring.md "The driver's own score"). Caps the
    # level a driver is shown; no API schema exposes it yet — CAR-85.
    driver_score: Mapped[float | None] = mapped_column(Float)

    # Short code behind this user's invite link. Minted on first use, then stable.
    invite_code: Mapped[str | None] = mapped_column(String(12), unique=True)

    is_private: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    drive_mode_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    bluetooth_device_id: Mapped[str | None] = mapped_column(String(120))
    bluetooth_device_name: Mapped[str | None] = mapped_column(String(120))

    last_lat: Mapped[float | None] = mapped_column(Float)
    last_lng: Mapped[float | None] = mapped_column(Float)
    last_location_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_cleared_history: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    is_phone_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Failed sign-ins are `LoginFailure` rows, not a column here — see that model
    # for why the address they came from is part of the key.
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    last_logged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    trips: Mapped[list[Trip]] = relationship(back_populates="user", cascade="all, delete-orphan")
    redemptions: Mapped[list[Redemption]] = relationship(back_populates="user", cascade="all, delete-orphan")
    fraud_reports: Mapped[list[FraudReport]] = relationship(back_populates="user", cascade="all, delete-orphan")
    business: Mapped[Business | None] = relationship(back_populates="owner", uselist=False)

    __table_args__ = (
        Index("ix_users_phone", "phone"),
        Index("ix_users_email", "email"),
        Index("ix_users_role", "role"),
    )
