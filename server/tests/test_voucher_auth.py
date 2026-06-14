"""Auth guards on the voucher endpoints.

Both endpoints expose a user's redeemed vouchers / spend their points, so a
missing auth dependency would leak or mutate another user's data. These assert
the endpoints reject unauthenticated calls before any handler logic runs.

In-process via ASGITransport — no DB, no live server.
"""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.mark.asyncio
async def test_list_vouchers_requires_auth() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/vouchers")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_redeem_requires_auth() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # auth runs before the reward lookup, so any id yields 401 (not 404)
        r = await ac.post("/api/rewards/any-reward-id/redeem")
    assert r.status_code == 401
