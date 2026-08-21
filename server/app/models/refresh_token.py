from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class RefreshToken(Base):
    """A browser session's long-lived half — the httpOnly cookie identifies one of these.

    Exists because a stateless refresh JWT cannot give logout anything real to
    do: without a row to revoke, "sign out" can only ask the browser to forget
    a cookie, and a copy taken before that request still works until it
    expires on its own. `revoked_at` is what makes logout — and rotation on
    every `/api/auth/refresh` — an actual end to the session rather than a
    polite request. See `services/auth.py::refresh_session` for why a *revoked*
    row being presented again is treated as reuse, not a retry.
    """

    __tablename__ = "refresh_tokens"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: uuid.uuid4().hex)
    user_id: Mapped[str] = mapped_column(String(32), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    # SHA-256 of the cookie value, not bcrypt: the token is ~384 bits of its own
    # entropy (`core.security.random_refresh_token`), so slow hashing buys
    # nothing here — and unlike a password or OTP, the cookie carries no other
    # field to narrow the lookup by, so it has to be found by equality.
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Set only when this row was revoked *by rotation* — points at the row that
    # replaced it. Left null on a revoke-with-no-successor (logout, or a
    # reuse that got the whole account cut). Two tabs can legitimately present
    # the same not-yet-rotated cookie within the same instant — one wins the
    # rotation, and the other must not read the winner's `revoked_at` as
    # theft. This pointer is how `services.auth._resolve_current` tells "my
    # session moved on a heartbeat ago" from "someone replayed a dead token" —
    # see `refresh_session` for the grace window that uses it.
    replaced_by_id: Mapped[str | None] = mapped_column(String(32), ForeignKey("refresh_tokens.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("ix_refresh_tokens_token_hash", "token_hash", unique=True),
        Index("ix_refresh_tokens_user_id", "user_id"),
        # For the lazy sweep — see `services.auth._sweep_expired_refresh_tokens`.
        Index("ix_refresh_tokens_expires_at", "expires_at"),
        # `replaced_by_id`'s FK is ON DELETE SET NULL — without an index here,
        # every row the sweep deletes forces Postgres to scan this whole table
        # for rows pointing at it, to null them out.
        Index("ix_refresh_tokens_replaced_by_id", "replaced_by_id"),
    )
