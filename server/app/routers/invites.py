"""Invite links.

`/i/{code}` on the marketing site is expected to deep-link into the app, which
then calls redeem once the user has a token — so redemption works whether they
just signed up or already had an account.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.core.deps import CurrentUser, DbSession
from app.schemas.invite import InviteLinkOut, RedeemInviteOut
from app.services import invites as svc

router = APIRouter(tags=["invites"])


@router.get(
    "/api/users/me/invite",
    response_model=InviteLinkOut,
    response_model_by_alias=True,
    summary="The caller's invite link, minted on first request and stable after",
)
async def my_invite(user: CurrentUser, db: DbSession) -> InviteLinkOut:
    return await svc.get_or_create_link(db, user)


@router.post(
    "/api/invites/{code}/redeem",
    response_model=RedeemInviteOut,
    response_model_by_alias=True,
    summary="Redeem an invite code — befriends whoever shared it",
)
async def redeem_invite(code: str, user: CurrentUser, db: DbSession) -> RedeemInviteOut:
    return await svc.redeem(db, user, code)
