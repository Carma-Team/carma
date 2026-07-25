from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Index, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base

# Notification kinds. Plain strings, not a PG enum: every new kind would otherwise
# need an ALTER TYPE migration, and kinds are expected to be added often. The
# client maps `type` to an i18n key, so the wire values are part of the contract —
# rename one only alongside mobile/src/i18n.
NOTIFICATION_LEVEL_UP = "level_up"
NOTIFICATION_FOLLOW_ACCEPTED = "follow_accepted"
NOTIFICATION_FOLLOW_REQUESTED = "follow_requested"


class Notification(Base):
    """A single in-app notification for one user.

    Rows are written inside the transaction of whatever action triggered them
    (see `app.services.notifications.create`) so a notification can never
    outlive a rolled-back trigger. Delivery is pull-on-open — there is no push.

    `payload` holds the kind-specific data the client renders with; it is never
    pre-rendered text, so switching app language re-renders old rows correctly.
    """

    __tablename__ = "notifications"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: uuid.uuid4().hex)
    user_id: Mapped[str] = mapped_column(String(32), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    type: Mapped[str] = mapped_column(String(32), nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Covers the only read path: this user's rows, newest first. No DESC needed —
    # Postgres scans a btree index backwards for the reversed ORDER BY.
    __table_args__ = (Index("ix_notifications_user_created", "user_id", "created_at"),)
