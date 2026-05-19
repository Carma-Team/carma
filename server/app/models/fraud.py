from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import DateTime, Float, ForeignKey, Index, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.user import User


class FraudReport(Base):
    __tablename__ = "fraud_reports"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: uuid.uuid4().hex)
    user_id: Mapped[str] = mapped_column(String(32), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    idempotency_key: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)

    trip_duration_seconds: Mapped[int | None] = mapped_column(Integer)
    distance_km: Mapped[float | None] = mapped_column(Float)
    avg_score: Mapped[float | None] = mapped_column(Float)

    anomaly_flags: Mapped[list[str] | None] = mapped_column(JSONB)
    raw_payload: Mapped[dict[str, Any] | None] = mapped_column(JSONB)

    reported_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    user: Mapped[User] = relationship(back_populates="fraud_reports")

    __table_args__ = (
        Index("ix_fraud_reports_user_id", "user_id"),
        Index("ix_fraud_reports_reported_at", "reported_at"),
    )
