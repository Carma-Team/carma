from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import DateTime, Enum, Float, ForeignKey, Index, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base
from app.models.enums import EventType

if TYPE_CHECKING:
    from app.models.trip import Trip


class Event(Base):
    __tablename__ = "events"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: uuid.uuid4().hex)
    trip_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("trips.id", ondelete="CASCADE"), nullable=False
    )
    type: Mapped[EventType] = mapped_column(Enum(EventType, name="event_type"), nullable=False)
    severity: Mapped[float] = mapped_column(Float, default=1.0, nullable=False)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    lat: Mapped[float | None] = mapped_column(Float)
    lng: Mapped[float | None] = mapped_column(Float)
    sensor_data: Mapped[dict[str, Any] | None] = mapped_column(JSONB)

    trip: Mapped["Trip"] = relationship(back_populates="events")

    __table_args__ = (
        Index("ix_events_trip_timestamp", "trip_id", "timestamp"),
        Index("ix_events_type", "type"),
    )
