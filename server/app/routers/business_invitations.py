# No `from __future__ import annotations`, same reason as `routers/business.py`:
# SlowAPI's decorator breaks FastAPI's string-annotation resolution.

"""One-time business-permission invitations (CAR-76).

Two different trust boundaries share this feature, so two routers: creating
and cancelling an invitation is scoped to the issuing business and restricted
to its OWNER (`CurrentBusinessOwner`); inspecting and accepting one is scoped
to nothing but the recipient's own session (`CurrentUser`) — they hold no
membership yet, so this must never sit behind `current_business`.
"""

from fastapi import APIRouter, Request, Response, status

from app.core.deps import CurrentBusinessOwner, CurrentUser, DbSession
from app.core.limiter import business_key, limiter
from app.schemas.business_invitation import (
    BusinessInvitationAcceptResponse,
    BusinessInvitationCreateResponse,
    BusinessInvitationIn,
    BusinessInvitationListResponse,
    BusinessInvitationPreviewResponse,
    InvitationTokenIn,
)
from app.services import business_invitations as svc

router = APIRouter(prefix="/api/business/invitations", tags=["business-invitations"])
redeem_router = APIRouter(prefix="/api/invitations", tags=["business-invitations"])

# Business-scoped, like `business.py`'s voucher limits — a shop handing out a
# handful of logins a day is normal; a sweep minting dozens a minute is not.
CREATE_LIMIT = "20/hour"
CREATE_SCOPE = "business-invitation-create"


@router.post(
    "",
    response_model=BusinessInvitationCreateResponse,
    response_model_by_alias=True,
    status_code=status.HTTP_201_CREATED,
    summary="Invite a colleague at MANAGER or CASHIER — OWNER only",
)
@limiter.shared_limit(CREATE_LIMIT, scope=CREATE_SCOPE, key_func=business_key)
async def create_invitation(
    request: Request, dto: BusinessInvitationIn, membership: CurrentBusinessOwner, db: DbSession
) -> BusinessInvitationCreateResponse:
    invitation = await svc.create_invitation(db, membership.business, membership.user, dto)
    return BusinessInvitationCreateResponse(invitation=invitation)


@router.get(
    "",
    response_model=BusinessInvitationListResponse,
    response_model_by_alias=True,
    summary="List this business's pending invitations, with their expiry — OWNER only",
)
async def list_invitations(membership: CurrentBusinessOwner, db: DbSession) -> BusinessInvitationListResponse:
    return BusinessInvitationListResponse(invitations=await svc.list_pending_invitations(db, membership.business))


@router.delete(
    "/{invitation_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Cancel a pending invitation — unusable immediately. OWNER only.",
)
async def revoke_invitation(invitation_id: str, membership: CurrentBusinessOwner, db: DbSession) -> Response:
    await svc.revoke_invitation(db, membership.business, invitation_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@redeem_router.post(
    "/preview",
    response_model=BusinessInvitationPreviewResponse,
    response_model_by_alias=True,
    summary="Inspect an invitation before accepting it. 404 unless it is still valid.",
)
async def preview_invitation(
    dto: InvitationTokenIn, _user: CurrentUser, db: DbSession
) -> BusinessInvitationPreviewResponse:
    return BusinessInvitationPreviewResponse(invitation=await svc.preview_invitation(db, dto.token))


@redeem_router.post(
    "/accept",
    response_model=BusinessInvitationAcceptResponse,
    response_model_by_alias=True,
    summary=(
        "Accept an invitation — creates the membership it names. 409 if already a member, "
        "or if the account already belongs to a different business."
    ),
)
async def accept_invitation(
    dto: InvitationTokenIn, user: CurrentUser, db: DbSession
) -> BusinessInvitationAcceptResponse:
    return BusinessInvitationAcceptResponse(membership=await svc.accept_invitation(db, user, dto.token))
