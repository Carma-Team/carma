"""The ceiling that applies to a route which never asked for one.

This file is the point of CAR-126. The default limits had been declared since
the limiter was written and read as protection in review, but nothing counted
against them for months: FastAPI 0.137 changed the shape of `app.routes`, and
SlowAPI's middleware — which walks that list to find the handler it is about to
limit — quietly found nothing and exempted every request. Only the handful of
routes carrying a decorator stayed protected.

A limit nobody tests is a limit nobody has. Each test below fails outright
against the old middleware.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from app.core.limiter import BURST_LIMIT
from app.routers.auth import CREDENTIAL_LIMIT

# Read off the limiter rather than repeated here, so tuning a ceiling does not
# leave these tests asserting a number the app no longer uses.
BURST_CEILING = int(BURST_LIMIT.split("/")[0])
CREDENTIAL_CEILING = int(CREDENTIAL_LIMIT.split("/")[0])

# These routes answer 401 before they open a connection, so the limit can be
# exercised without a database. The limit is counted before authentication on
# purpose: an unauthenticated flood should cost a lookup, not a query.
UNCAPPED_ROUTE = "/api/leaderboard"


@pytest.mark.asyncio
async def test_a_route_that_never_opted_in_is_still_bounded(rate_limited: None, api_client: AsyncClient) -> None:
    """The whole budget is spendable, and the request after it is refused."""
    codes = [(await api_client.get(UNCAPPED_ROUTE)).status_code for _ in range(BURST_CEILING)]
    assert codes == [401] * BURST_CEILING, f"a caller inside the budget must be answered, got {sorted(set(codes))}"

    refused = await api_client.get(UNCAPPED_ROUTE)
    assert refused.status_code == 429
    assert int(refused.headers["retry-after"]) > 0


@pytest.mark.asyncio
async def test_a_path_parameter_does_not_hand_out_a_fresh_budget(rate_limited: None, api_client: AsyncClient) -> None:
    """Walking the ids is the sweep this ceiling exists to stop.

    Counted against the URL — SlowAPI's default — every id is its own counter
    and the sweep is never refused, however fast it runs. See `core.limiter`.
    """
    codes = [(await api_client.get(f"/api/trips/{i}")).status_code for i in range(BURST_CEILING + 1)]
    assert codes[-1] == 429, "each id was given its own budget, so the sweep was never refused"


@pytest.mark.asyncio
async def test_two_routes_do_not_share_one_budget(rate_limited: None, api_client: AsyncClient) -> None:
    """A spent route must not take the rest of the app down with it.

    One counter for the whole API would mean a single screen's worth of calls
    from one carrier NAT locking out everybody behind it.
    """
    for _ in range(BURST_CEILING + 1):
        spent = await api_client.get(UNCAPPED_ROUTE)
    assert spent.status_code == 429, "the budget was supposed to be spent by now"

    assert (await api_client.get("/api/users/me")).status_code == 401


@pytest.mark.asyncio
async def test_the_liveness_probe_is_never_refused(rate_limited: None, api_client: AsyncClient) -> None:
    """A 429 on the probe reads as a dead container and restarts it."""
    codes = [(await api_client.get("/health/live")).status_code for _ in range(BURST_CEILING + 10)]
    assert set(codes) == {200}


@pytest.mark.asyncio
async def test_a_route_with_its_own_ceiling_keeps_it(rate_limited: None, db_api_client: AsyncClient) -> None:
    """The tighter number a route declares must not be shadowed by the default.

    Login allows fewer attempts than the default does, so the request that is
    refused names which of the two is in charge.
    """
    assert CREDENTIAL_CEILING < BURST_CEILING, "this only tells the two apart while the route is the tighter one"

    body = {"email": "nobody@carmatest.co.il", "password": "not-the-password"}
    attempts = range(CREDENTIAL_CEILING + 1)
    codes = [(await db_api_client.post("/api/auth/login", json=body)).status_code for _ in attempts]
    assert codes[-1] == 429
    assert codes[:-1] == [401] * CREDENTIAL_CEILING, f"the route's own budget was cut short, got {sorted(set(codes))}"
