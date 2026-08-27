from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Enum, ForeignKey, Index, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base
from app.models.enums import BusinessMembershipRole

if TYPE_CHECKING:
    from app.models.business import Business
    from app.models.user import User


def _new_id() -> str:
    return uuid.uuid4().hex


class BusinessInvitation(Base):
    """A one-time grant of business-scoped access (CAR-76).

    `token_hash` is what the table can be looked up by — the plaintext token is
    never stored, the same split `RefreshToken` uses (`core.security.hash_refresh_token`),
    so a database leak alone cannot be redeemed. `redeemed_at`, `redeemed_by_user_id`
    and `revoked_at` are only ever written by the conditional UPDATE in
    `services.business_invitations`, never by a plain read-then-write — see that
    module for why. `role` is restricted to MANAGER/CASHIER at the service layer,
    not by the column itself, which shares the enum `BusinessMembership.role` uses.
    """

    __tablename__ = "business_invitations"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_new_id)
    business_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[BusinessMembershipRole] = mapped_column(
        Enum(BusinessMembershipRole, name="business_membership_role"), nullable=False
    )
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    created_by_user_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    redeemed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    redeemed_by_user_id: Mapped[str | None] = mapped_column(String(32), ForeignKey("users.id", ondelete="SET NULL"))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    business: Mapped[Business] = relationship(foreign_keys=[business_id])
    created_by: Mapped[User] = relationship(foreign_keys=[created_by_user_id])
    redeemed_by: Mapped[User | None] = relationship(foreign_keys=[redeemed_by_user_id])

    __table_args__ = (Index("ix_business_invitations_business", "business_id"),)
