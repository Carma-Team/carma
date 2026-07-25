"""Invite links — the referral half of "add friends" (issue #33).

A user has one code, minted the first time they open the share sheet and stable
afterwards, so the same link can go to a whole WhatsApp group. Redeeming it makes
the two users friends outright rather than opening a request: the inviter chose
to hand the link out, which is the same consent as tapping accept.

The flip side of a reusable code is that a forwarded link still works — anyone
holding it can befriend the inviter until we add rotation. That is the accepted
trade for a link you can paste anywhere, and unfriending undoes it.
"""

from __future__ import annotations

import secrets

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import User
from app.schemas.invite import InviteLinkOut, InviterOut, RedeemInviteOut
from app.services import friends

# No 0/O/1/I/L: these codes get read aloud and retyped off a phone screen.
_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
_CODE_LEN = 8


def _new_code() -> str:
    return "".join(secrets.choice(_ALPHABET) for _ in range(_CODE_LEN))


def _link(code: str) -> str:
    return f"{settings.invite_base_url.rstrip('/')}/i/{code}"


async def get_or_create_link(db: AsyncSession, current: User) -> InviteLinkOut:
    if current.invite_code:
        return InviteLinkOut(code=current.invite_code, url=_link(current.invite_code))

    # Collisions are vanishingly unlikely (31^8) but cheap to survive.
    for _ in range(5):
        current.invite_code = _new_code()
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
            continue
        return InviteLinkOut(code=current.invite_code, url=_link(current.invite_code))

    raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Could not allocate an invite code")


async def redeem(db: AsyncSession, current: User, code: str) -> RedeemInviteOut:
    """Befriend whoever owns `code`. Called after signup, once the user has a token."""
    inviter = await db.scalar(select(User).where(User.invite_code == code.strip().upper()))
    if inviter is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown invite code")
    if inviter.id == current.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cannot redeem your own invite")

    return RedeemInviteOut(
        inviter=InviterOut(id=inviter.id, name=inviter.name, city=inviter.city, level=inviter.level),
        status=await friends.befriend(db, inviter.id, current.id),
    )
