from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base
from app.models.enums import FriendStatus


def _new_id() -> str:
    return uuid.uuid4().hex


class UserFriend(Base):
    """
    Unidirectional social graph edge: follower_id → followee_id.

    status transitions:
      pending  → followee has is_private=True, awaiting acceptance
      accepted → active follow relationship
      blocked  → followee blocked follower; follower cannot re-follow until unblocked
    """

    __tablename__ = "user_friends"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_new_id)
    follower_id: Mapped[str] = mapped_column(String(32), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    followee_id: Mapped[str] = mapped_column(String(32), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    status: Mapped[FriendStatus] = mapped_column(
        Enum(FriendStatus, name="friend_status"), default=FriendStatus.ACCEPTED, nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("follower_id", "followee_id", name="uq_user_friends_pair"),
    )
