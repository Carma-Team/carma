# No `from __future__ import annotations` here, unlike the other routers, for the
# same reason as `routers/auth.py`: SlowAPI's decorator re-exports the handler
# from its own module, so FastAPI would try to resolve string annotations like
# "BusinessVoucherResponse" against SlowAPI's namespace and fail at import.

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Query, Request, Response, status

from app.core.deps import CurrentBusinessManager, CurrentBusinessMembership, DbSession
from app.core.limiter import business_key, limiter
from app.schemas.business_stats import BusinessStatsOut
from app.schemas.redemption import BusinessRedemptionListOut
from app.schemas.reward import (
    BusinessRewardIn,
    BusinessRewardListOut,
    BusinessRewardPatchIn,
    BusinessRewardResponse,
    BusinessVoucherResponse,
    LiveVoucherCountOut,
)
from app.services import business as business_service

router = APIRouter(prefix="/api/business", tags=["business"])


@router.get(
    "/rewards",
    response_model=BusinessRewardListOut,
    response_model_by_alias=True,
    summary="List every reward owned by the authenticated business, inactive included",
)
async def list_rewards(membership: CurrentBusinessMembership, db: DbSession) -> dict[str, object]:
    return await business_service.list_rewards(db, membership.business, membership.role)


@router.post(
    "/rewards",
    response_model=BusinessRewardResponse,
    response_model_by_alias=True,
    status_code=status.HTTP_201_CREATED,
    summary="Create a reward in the authenticated business's catalog",
)
async def create_reward(
    dto: BusinessRewardIn, membership: CurrentBusinessManager, db: DbSession
) -> BusinessRewardResponse:
    reward = await business_service.create_reward(db, membership.business, dto)
    return BusinessRewardResponse(reward=reward)


@router.patch(
    "/rewards/{reward_id}",
    response_model=BusinessRewardResponse,
    response_model_by_alias=True,
    summary="Update fields of an owned reward",
)
async def update_reward(
    reward_id: str, dto: BusinessRewardPatchIn, membership: CurrentBusinessManager, db: DbSession
) -> BusinessRewardResponse:
    reward = await business_service.update_reward(db, membership.business, reward_id, dto)
    return BusinessRewardResponse(reward=reward)


@router.get(
    "/rewards/{reward_id}/live-vouchers",
    response_model=LiveVoucherCountOut,
    response_model_by_alias=True,
    summary="Live (unused, unexpired) voucher count for an owned reward — check before archiving",
)
async def live_voucher_count(reward_id: str, membership: CurrentBusinessManager, db: DbSession) -> LiveVoucherCountOut:
    count = await business_service.live_voucher_count(db, membership.business, reward_id)
    return LiveVoucherCountOut(live_vouchers=count)


@router.delete(
    "/rewards/{reward_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Archive an owned reward — removed from the catalog, history and live vouchers untouched",
)
async def archive_reward(reward_id: str, membership: CurrentBusinessManager, db: DbSession) -> Response:
    await business_service.archive_reward(db, membership.business, reward_id)
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

# `shared_limit` only for its scope argument: it names the counter outright, so
# these two ceilings do not depend on how the app happens to bucket everything
# else. The code is *in* the URL here, and a counter keyed on the URL hands every
# scanned code a fresh budget — never refusing the sweep this ceiling exists to
# stop. `core.limiter` buckets by handler rather than by URL for that same
# reason (CAR-126); a named scope says it out loud and survives that changing.
PEEK_SCOPE = "business-voucher-peek"
REDEEM_SCOPE = "business-voucher-redeem"
# `request` goes unused in both handlers below, but SlowAPI reads the limit key
# off it — the decorator raises at import time if the parameter is missing.


@router.get(
    "/vouchers/{code}",
    response_model=BusinessVoucherResponse,
    response_model_by_alias=True,
    summary="Inspect a scanned voucher without consuming it. 404 unless it is this business's.",
)
@limiter.shared_limit(PEEK_LIMIT, scope=PEEK_SCOPE, key_func=business_key)
async def peek_voucher(
    request: Request, code: str, membership: CurrentBusinessMembership, db: DbSession
) -> BusinessVoucherResponse:
    return BusinessVoucherResponse(voucher=await business_service.peek_voucher(db, membership.business, code))


@router.post(
    "/vouchers/{code}/redeem",
    response_model=BusinessVoucherResponse,
    response_model_by_alias=True,
    summary="Consume a voucher. 409 if it was already used or has expired.",
)
@limiter.shared_limit(REDEEM_LIMIT, scope=REDEEM_SCOPE, key_func=business_key)
async def consume_voucher(
    request: Request, code: str, membership: CurrentBusinessMembership, db: DbSession
) -> BusinessVoucherResponse:
    voucher = await business_service.consume_voucher(
        db, membership.business, code, consumed_by_user_id=membership.user_id
    )
    return BusinessVoucherResponse(voucher=voucher)


# ── Redemption history (CAR-79) ─────────────────────────────────────────────


@router.get(
    "/redemptions",
    response_model=BusinessRedemptionListOut,
    response_model_by_alias=True,
    summary="Paged redemption history for the authenticated business — USED only by default",
)
async def list_redemptions(
    membership: CurrentBusinessManager,
    db: DbSession,
    status_filter: str | None = Query(default=None, alias="status"),
    reward_id: str | None = Query(default=None, alias="rewardId"),
    settled_from: datetime | None = Query(default=None, alias="from"),
    settled_to: datetime | None = Query(default=None, alias="to"),
    cursor: str | None = Query(default=None),
    limit: Annotated[int, Query(ge=1, le=business_service.REDEMPTION_HISTORY_MAX_LIMIT)] = (
        business_service.REDEMPTION_HISTORY_DEFAULT_LIMIT
    ),
) -> dict[str, object]:
    return await business_service.list_redemptions(
        db,
        membership.business,
        statuses=business_service.parse_redemption_status_filter(status_filter),
        reward_id=reward_id,
        settled_from=settled_from,
        settled_to=settled_to,
        cursor=cursor,
        limit=limit,
    )


# ── Redemption statistics (CAR-81) ──────────────────────────────────────────


@router.get(
    "/stats",
    response_model=BusinessStatsOut,
    response_model_by_alias=True,
    summary="Redemption performance snapshot for the authenticated business",
)
async def stats(membership: CurrentBusinessManager, db: DbSession) -> BusinessStatsOut:
    return await business_service.redemption_stats(db, membership.business)
