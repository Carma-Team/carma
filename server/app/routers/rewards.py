from __future__ import annotations

from fastapi import APIRouter

from app.core.deps import CurrentUser, DbSession
from app.schemas.reward import RewardListOut, VoucherListOut, VoucherResponse
from app.services import rewards as rewards_service

rewards_router = APIRouter(prefix="/api/rewards", tags=["rewards"])
vouchers_router = APIRouter(prefix="/api/vouchers", tags=["vouchers"])


@rewards_router.get(
    "",
    response_model=RewardListOut,
    response_model_by_alias=True,
    summary="List active rewards, optionally filtered by category",
)
async def list_rewards(user: CurrentUser, db: DbSession, category: str | None = None) -> dict[str, object]:
    return await rewards_service.list_rewards(db, user.id, category)


@rewards_router.post(
    "/{reward_id}/redeem",
    response_model=VoucherResponse,
    response_model_by_alias=True,
    summary="Redeem a reward — debits points and issues a 5-minute QR voucher",
)
async def redeem(reward_id: str, user: CurrentUser, db: DbSession) -> VoucherResponse:
    voucher = await rewards_service.redeem(db, user, reward_id)
    return VoucherResponse(voucher=voucher)


@vouchers_router.get(
    "",
    response_model=VoucherListOut,
    response_model_by_alias=True,
    summary="List vouchers owned by the authenticated user",
)
async def my_vouchers(user: CurrentUser, db: DbSession) -> dict[str, object]:
    return await rewards_service.list_my_vouchers(db, user.id)
