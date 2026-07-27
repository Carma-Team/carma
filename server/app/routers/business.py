from __future__ import annotations

from fastapi import APIRouter, Response, status

from app.core.deps import CurrentBusiness, DbSession
from app.schemas.reward import (
    BusinessRewardIn,
    BusinessRewardListOut,
    BusinessRewardPatchIn,
    BusinessRewardResponse,
    VoucherResponse,
)
from app.services import business as business_service

router = APIRouter(prefix="/api/business", tags=["business"])


@router.get(
    "/rewards",
    response_model=BusinessRewardListOut,
    response_model_by_alias=True,
    summary="List every reward owned by the authenticated business, inactive included",
)
async def list_rewards(business: CurrentBusiness, db: DbSession) -> dict[str, object]:
    return await business_service.list_rewards(db, business)


@router.post(
    "/rewards",
    response_model=BusinessRewardResponse,
    response_model_by_alias=True,
    status_code=status.HTTP_201_CREATED,
    summary="Create a reward in the authenticated business's catalog",
)
async def create_reward(dto: BusinessRewardIn, business: CurrentBusiness, db: DbSession) -> BusinessRewardResponse:
    reward = await business_service.create_reward(db, business, dto)
    return BusinessRewardResponse(reward=reward)


@router.patch(
    "/rewards/{reward_id}",
    response_model=BusinessRewardResponse,
    response_model_by_alias=True,
    summary="Update fields of an owned reward",
)
async def update_reward(
    reward_id: str, dto: BusinessRewardPatchIn, business: CurrentBusiness, db: DbSession
) -> BusinessRewardResponse:
    reward = await business_service.update_reward(db, business, reward_id, dto)
    return BusinessRewardResponse(reward=reward)


@router.delete(
    "/rewards/{reward_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Delete an owned reward. 409 once any voucher has been issued for it.",
)
async def delete_reward(reward_id: str, business: CurrentBusiness, db: DbSession) -> Response:
    await business_service.delete_reward(db, business, reward_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── Vouchers ─────────────────────────────────────────────────────────────────


@router.get(
    "/vouchers/{code}",
    response_model=VoucherResponse,
    response_model_by_alias=True,
    summary="Inspect a scanned voucher without consuming it. 404 unless it is this business's.",
)
async def peek_voucher(code: str, business: CurrentBusiness, db: DbSession) -> VoucherResponse:
    return VoucherResponse(voucher=await business_service.peek_voucher(db, business, code))


@router.post(
    "/vouchers/{code}/redeem",
    response_model=VoucherResponse,
    response_model_by_alias=True,
    summary="Consume a voucher. 409 if it was already used or has expired.",
)
async def consume_voucher(code: str, business: CurrentBusiness, db: DbSession) -> VoucherResponse:
    return VoucherResponse(voucher=await business_service.consume_voucher(db, business, code))
