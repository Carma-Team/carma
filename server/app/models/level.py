from __future__ import annotations

import uuid

from sqlalchemy import Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Level(Base):
    __tablename__ = "levels"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: uuid.uuid4().hex)
    number: Mapped[int] = mapped_column(Integer, unique=True, nullable=False)
    name_he: Mapped[str] = mapped_column(String(80), nullable=False)
    name_en: Mapped[str] = mapped_column(String(80), nullable=False)
    min_points: Mapped[int] = mapped_column(Integer, nullable=False)
    discount_pct: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    bonus_multiplier: Mapped[float] = mapped_column(Float, default=1.0, nullable=False)
