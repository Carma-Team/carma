"""Auth guards on the voucher endpoints.

Both endpoints expose a user's redeemed vouchers / spend their points, so a
missing auth dependency would leak or mutate another user's data. These assert
the endpoints reject unauthenticated calls before any handler logic runs.

In-process and no DB — the auth gate fires first, so `api_client` is enough.
"""

from __future__ import annotations

from httpx import AsyncClient


async def test_list_vouchers_requires_auth(api_client: AsyncClient) -> None:
    r = await api_client.get("/api/vouchers")
    assert r.status_code == 401


async def test_redeem_requires_auth(api_client: AsyncClient) -> None:
    # auth runs before the reward lookup, so any id yields 401 (not 404)
    r = await api_client.post("/api/rewards/any-reward-id/redeem")
    assert r.status_code == 401
