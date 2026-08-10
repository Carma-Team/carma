from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class LoginFailure(Base):
    """One rejected sign-in, keyed on the account *and* the address it came from.

    Counting failures on the account alone made the lockout a weapon against the
    account's owner: anyone who knew a driver's email could spend ten wrong
    passwords and take that driver offline for fifteen minutes, from one address,
    inside a minute (CAR-51). Keyed on the pair, the wait falls on whoever is
    guessing and the owner never notices.
    """

    __tablename__ = "login_failures"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: uuid.uuid4().hex)
    user_id: Mapped[str] = mapped_column(String(32), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    # Text rather than INET: nothing here does arithmetic on an address, and
    # asyncpg would hand back ipaddress objects to compare against a plain str.
    # 45 characters is a full IPv6 literal with an embedded IPv4 tail.
    caller_ip: Mapped[str] = mapped_column(String(45), nullable=False)
    # No Python-side default on purpose — that is what lets a test back-date a
    # row to prove the rolling window forgets it.
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        # Leading with user_id serves both reads: the per-address backoff matches
        # all three columns, the account-wide backstop matches the prefix.
        Index("ix_login_failures_user_ip_created", "user_id", "caller_ip", "created_at"),
        # For the sweep, which is by age across every account.
        Index("ix_login_failures_created_at", "created_at"),
    )
