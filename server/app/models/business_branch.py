from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.business import Business


class BusinessBranch(Base):
    """A business's own physical location (CAR-341 continuation).

    `name` is optional — the approved design shows the address alone when a
    business has only one branch, and a label only once there is more than
    one to tell apart. There is no `is_default`/`is_primary` flag: the
    earliest-created *active* branch is the canonical one wherever a single
    location is still needed (`services.business.get_profile`'s address/
    coordinate mirror) — the same "earliest row wins" convention
    `_owner_contact` already uses for OWNER memberships, rather than a second
    flag that could disagree with it.

    Deactivated, never deleted (the approved design's own note: a branch may
    carry reward-availability history later) — `is_active` is the only way a
    branch is "removed" through the API.
    """

    __tablename__ = "business_branches"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: uuid.uuid4().hex)
    business_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str | None] = mapped_column(String(120))
    address: Mapped[str | None] = mapped_column(String(200))
    location_lat: Mapped[float] = mapped_column(Float, nullable=False)
    location_lng: Mapped[float] = mapped_column(Float, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    business: Mapped[Business] = relationship(back_populates="branches")

    __table_args__ = (Index("ix_business_branches_business", "business_id"),)
