from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.trip import Trip


class TripOccupancy(Base):
    __tablename__ = "trip_occupancy"

    trip_id: Mapped[str] = mapped_column(String(32), ForeignKey("trips.id", ondelete="CASCADE"), primary_key=True)
    verdict: Mapped[str] = mapped_column(String(16), nullable=False)
    source: Mapped[str] = mapped_column(String(16), nullable=False)
    likelihood: Mapped[float | None] = mapped_column(Float, default=None)
    co_travel: Mapped[dict[str, Any] | None] = mapped_column(JSONB, default=None)
    reversal: Mapped[dict[str, Any] | None] = mapped_column(JSONB, default=None)
    excluded_from_driver_score: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    evaluated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    trip: Mapped[Trip] = relationship()
