from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Enum, Float, ForeignKey, Index, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base
from app.models.enums import BusinessCategory, BusinessJoinRequestStatus

if TYPE_CHECKING:
    from app.models.user import User


def _new_id() -> str:
    return uuid.uuid4().hex


class BusinessJoinRequest(Base):
    """A public business-registration submission, awaiting admin review (CAR-42).

    Creating one grants no business access — no `Business` row, no membership,
    no role change. `phone` is copied from `User.is_phone_verified`'s owner at
    submission time, never accepted from the client: see
    `services.business_join_requests.submit`. CAR-77 is the only path that turns
    a PENDING row into APPROVED or REJECTED.
    """

    __tablename__ = "business_join_requests"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_new_id)
    applicant_user_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    phone: Mapped[str] = mapped_column(String(32), nullable=False)

    name: Mapped[str] = mapped_column(String(120), nullable=False)
    name_he: Mapped[str | None] = mapped_column(String(120))
    category: Mapped[BusinessCategory] = mapped_column(Enum(BusinessCategory, name="business_category"), nullable=False)
    location_lat: Mapped[float] = mapped_column(Float, nullable=False)
    location_lng: Mapped[float] = mapped_column(Float, nullable=False)
    address: Mapped[str | None] = mapped_column(String(200))
    # Free text, stored as submitted — CAR-42 explicitly does not validate this
    # against a registry. It is the key duplicate pending-request detection uses
    # (see the migration's partial unique indexes), so it is stripped of
    # surrounding whitespace before saving; nothing else about it is checked.
    registration_number: Mapped[str] = mapped_column(String(64), nullable=False)
    contact_person: Mapped[str] = mapped_column(String(120), nullable=False)

    status: Mapped[BusinessJoinRequestStatus] = mapped_column(
        Enum(BusinessJoinRequestStatus, name="business_join_request_status"),
        default=BusinessJoinRequestStatus.PENDING,
        nullable=False,
    )
    reviewer_note: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    applicant: Mapped[User] = relationship()

    __table_args__ = (Index("ix_business_join_requests_applicant_created", "applicant_user_id", "created_at"),)
