"""The ceiling on the two business voucher routes.

Both take a code from outside and answer questions about it, so both are worth
bounding. The interesting part is not the number — it is what the limit counts
against. Keyed on the address, a shopping centre behind one carrier NAT shares a
single budget and a busy shop is refused because of its neighbours; keyed on the
business, each shop spends its own.

These need real rows: the limit key comes from the Business the auth dependency
loads, so there is nothing to test without one.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_access_token
from app.models import Business, BusinessCategory, User, UserRole
from app.routers.business import PEEK_LIMIT, REDEEM_LIMIT

# Read off the route rather than repeated here, so tuning the ceiling does not
# quietly leave these tests asserting a number the app no longer uses.
PEEK_CEILING = int(PEEK_LIMIT.split("/")[0])
REDEEM_CEILING = int(REDEEM_LIMIT.split("/")[0])


async def _make_business(db: AsyncSession) -> tuple[Business, dict[str, str]]:
    """A business and the Authorization header its owner would send."""
    owner = User(
        email=f"_rl_{uuid.uuid4().hex[:10]}@carmatest.co.il",
        password_hash="x",
        role=UserRole.BUSINESS,
        name="Rate Limited Biz",
    )
    db.add(owner)
    await db.flush()

    business = Business(
        owner_user_id=owner.id,
        name=f"Rate Limited Biz {uuid.uuid4().hex[:6]}",
        category=BusinessCategory.FOOD,
        location_lat=32.07,
        location_lng=34.78,
    )
    db.add(business)
    await db.commit()
    await db.refresh(business)

    token = create_access_token(user_id=owner.id, email=owner.email, phone=None, role=UserRole.BUSINESS)
    return business, {"Authorization": f"Bearer {token}"}


async def _cleanup(db: AsyncSession, *businesses: Business) -> None:
    for business in businesses:
        owner_id = business.owner_user_id
        await db.delete(business)
        await db.commit()
        if owner_id:
            owner = await db.get(User, owner_id)
            if owner is not None:
                await db.delete(owner)
                await db.commit()


def _unknown_code() -> str:
    """A code no voucher carries — a miss is what a sweep looks like."""
    return uuid.uuid4().hex[:12].upper()


@pytest.mark.asyncio
async def test_a_business_sweeping_codes_is_cut_off(
    rate_limited: None, db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    """Every scan up to the ceiling is answered; the one past it is refused.

    The 404s matter as much as the 429: a counter working at a normal pace must
    never meet this limit, so the whole budget has to be spendable first.
    """
    shop, headers = await _make_business(db_session)
    try:
        codes = [
            (await db_api_client.get(f"/api/business/vouchers/{_unknown_code()}", headers=headers)).status_code
            for _ in range(PEEK_CEILING)
        ]
        assert codes == [404] * PEEK_CEILING, f"a scan inside the budget must be answered, got {sorted(set(codes))}"

        refused = await db_api_client.get(f"/api/business/vouchers/{_unknown_code()}", headers=headers)
        assert refused.status_code == 429

        # The client renders `detail` and reads `Retry-After` to name the wait —
        # see `main.rate_limit_handler`, which SlowAPI's own reply would bypass.
        assert "Rate limit exceeded" not in refused.json()["detail"]
        assert int(refused.headers["retry-after"]) > 0

        # Auth is resolved before the limit is counted, so a spent budget must
        # never turn a missing token into a 429.
        anonymous = await db_api_client.get(f"/api/business/vouchers/{_unknown_code()}")
        assert anonymous.status_code == 401
    finally:
        await _cleanup(db_session, shop)


@pytest.mark.asyncio
async def test_one_shops_budget_is_not_another_shops(
    rate_limited: None, db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    """Both shops call from the same address — the limit must still tell them apart.

    This is the reason for the custom key. On the default address key the second
    shop would be refused for something the first one did.
    """
    noisy, noisy_headers = await _make_business(db_session)
    neighbour, neighbour_headers = await _make_business(db_session)
    try:
        for _ in range(PEEK_CEILING + 1):
            spent = await db_api_client.get(f"/api/business/vouchers/{_unknown_code()}", headers=noisy_headers)
        assert spent.status_code == 429, "the noisy shop was supposed to exhaust its own budget"

        answered = await db_api_client.get(f"/api/business/vouchers/{_unknown_code()}", headers=neighbour_headers)
        assert answered.status_code == 404, "an address-keyed limit would have refused the neighbour too"
    finally:
        await _cleanup(db_session, noisy, neighbour)


@pytest.mark.asyncio
async def test_redeem_carries_its_own_tighter_ceiling(
    rate_limited: None, db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    """Redeem is held tighter than peek, and the two budgets are separate.

    Separate matters: a shop that has spent its redeems must still be able to
    scan, or a till stops being able to tell a customer why it said no.
    """
    shop, headers = await _make_business(db_session)
    try:
        assert REDEEM_CEILING < PEEK_CEILING, "a redeem always follows a peek, so it cannot be the looser of the two"

        for _ in range(REDEEM_CEILING + 1):
            spent = await db_api_client.post(f"/api/business/vouchers/{_unknown_code()}/redeem", headers=headers)
        assert spent.status_code == 429

        peek = await db_api_client.get(f"/api/business/vouchers/{_unknown_code()}", headers=headers)
        assert peek.status_code == 404, "peek and redeem must count against separate budgets"
    finally:
        await _cleanup(db_session, shop)
