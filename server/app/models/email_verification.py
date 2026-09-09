from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class EmailVerificationCode(Base):
    """A code proving a driver can read the address on their account.

    Its own table rather than a nullable `email` column on `otp_codes`, which is
    where this started. `otp_codes` is keyed on a phone number because nobody is
    signed in yet when one is minted; here the caller already holds a session, so
    the account is the key. Sharing the table would have meant relaxing
    `otp_codes.phone` to nullable and adding a check constraint to the one table
    the login, registration and reset doors all read - for no gain beyond
    avoiding these twenty lines.

    `email` is stored rather than read off the user at confirm time: a code minted
    for one address must not verify a different one the driver switched to while
    it was in flight.
    """

    __tablename__ = "email_verification_codes"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: uuid.uuid4().hex)
    user_id: Mapped[str] = mapped_column(String(32), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    code_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        # Serves both reads: the live-code lookup matches both columns, the
        # hourly quota count matches the user_id prefix.
        Index("ix_email_verification_codes_user_consumed", "user_id", "consumed_at"),
        Index("ix_email_verification_codes_expires_at", "expires_at"),
    )
