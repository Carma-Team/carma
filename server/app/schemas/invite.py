from __future__ import annotations

from app.schemas._base import CamelModel
from app.schemas.friend import FriendshipStatus


class InviteLinkOut(CamelModel):
    """The caller's own invite link, to drop into a WhatsApp message."""

    code: str
    url: str


class InviterOut(CamelModel):
    id: str
    name: str | None = None
    city: str | None = None
    level: int


class RedeemInviteOut(CamelModel):
    inviter: InviterOut
    status: FriendshipStatus
