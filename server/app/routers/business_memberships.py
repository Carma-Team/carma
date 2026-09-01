"""Voucher-redemption permission management — list members, change role, revoke
access (CAR-117).

OWNER only, all three routes: seeing who has access, and changing who has how
much of it, is a strictly higher trust level than the MANAGER ceiling CAR-74
draws around the reward/voucher routes in `business.py`.
"""

from __future__ import annotations

from fastapi import APIRouter, Response, status

from app.core.deps import CurrentBusinessOwner, DbSession
from app.schemas.business_membership import BusinessMemberResponse, BusinessMemberRoleIn, BusinessMembersOut
from app.services import business_memberships as svc

router = APIRouter(prefix="/api/business/members", tags=["business-members"])


@router.get(
    "",
    response_model=BusinessMembersOut,
    response_model_by_alias=True,
    summary="List everyone with voucher-redemption access to the authenticated business — OWNER only",
)
async def list_members(membership: CurrentBusinessOwner, db: DbSession) -> BusinessMembersOut:
    return BusinessMembersOut(members=await svc.list_members(db, membership.business))


@router.patch(
    "/{membership_id}",
    response_model=BusinessMemberResponse,
    response_model_by_alias=True,
    summary="Change a member's business-scoped role — OWNER only. 409 if it would leave no OWNER.",
)
async def change_role(
    membership_id: str, dto: BusinessMemberRoleIn, membership: CurrentBusinessOwner, db: DbSession
) -> BusinessMemberResponse:
    return BusinessMemberResponse(member=await svc.change_role(db, membership.business, membership_id, dto.role))


@router.delete(
    "/{membership_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Revoke a member's access — OWNER only. 409 if it would leave no OWNER.",
)
async def revoke_access(membership_id: str, membership: CurrentBusinessOwner, db: DbSession) -> Response:
    await svc.revoke_access(db, membership.business, membership_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
