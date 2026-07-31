# No `from __future__ import annotations` here, unlike the other routers, for the
# same reason as `routers/auth.py`: SlowAPI's decorator re-exports the handler
# from its own module, so FastAPI would try to resolve string annotations like
# "VoucherResponse" against SlowAPI's namespace and fail at import.

from fastapi import APIRouter, Request, Response, status

from app.core.deps import CurrentBusiness, DbSession
from app.core.limiter import business_key, limiter
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

# The two routes that take a code from outside and answer questions about it, so
# the two worth putting a ceiling on. Both are keyed on the business rather than
# the caller's address — see `core.limiter.business_key`.
#
# Sixty is a counter's pace with room to spare: a scan plus handing the goods
# over is seconds of work, so even five tills at once stay far below it. A
# business sweeping codes does not.
PEEK_LIMIT = "60/minute"
# Half that, because a real redeem only ever follows a peek that came back
# valid. A burst of redeems with no peeks behind them is not a counter at work.
REDEEM_LIMIT = "30/minute"

# `shared_limit` only for its scope argument, which is what makes these work at
# all: SlowAPI buckets a counter by request URL, and the code is *in* the URL
# here, so a plain `limit` hands every code a fresh budget and never refuses a
# sweep — the one thing this ceiling exists to stop. A named scope pins a route
# to one counter whatever code is in the path.
PEEK_SCOPE = "business-voucher-peek"
REDEEM_SCOPE = "business-voucher-redeem"
# `request` goes unused in both handlers below, but SlowAPI reads the limit key
# off it — the decorator raises at import time if the parameter is missing.


@router.get(
    "/vouchers/{code}",
    response_model=VoucherResponse,
    response_model_by_alias=True,
    summary="Inspect a scanned voucher without consuming it. 404 unless it is this business's.",
)
@limiter.shared_limit(PEEK_LIMIT, scope=PEEK_SCOPE, key_func=business_key)
async def peek_voucher(request: Request, code: str, business: CurrentBusiness, db: DbSession) -> VoucherResponse:
    return VoucherResponse(voucher=await business_service.peek_voucher(db, business, code))


@router.post(
    "/vouchers/{code}/redeem",
    response_model=VoucherResponse,
    response_model_by_alias=True,
    summary="Consume a voucher. 409 if it was already used or has expired.",
)
@limiter.shared_limit(REDEEM_LIMIT, scope=REDEEM_SCOPE, key_func=business_key)
async def consume_voucher(request: Request, code: str, business: CurrentBusiness, db: DbSession) -> VoucherResponse:
    return VoucherResponse(voucher=await business_service.consume_voucher(db, business, code))
