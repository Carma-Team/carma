"""RequestLogMiddleware never writes a voucher code to a log line (CAR-129).

No DB needed — the auth guard on both voucher routes answers 401 before the
handler runs, and `redact_path` only needs the route Starlette already
resolved by then. See conftest.api_client.
"""

from __future__ import annotations

import logging

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("method", "path", "masked"),
    [
        ("GET", "/api/business/vouchers/ABC123XYZ", "/api/business/vouchers/***"),
        ("POST", "/api/business/vouchers/ABC123XYZ/redeem", "/api/business/vouchers/***/redeem"),
    ],
)
async def test_voucher_code_masked_in_request_log(
    api_client: AsyncClient,
    caplog: pytest.LogCaptureFixture,
    method: str,
    path: str,
    masked: str,
) -> None:
    with caplog.at_level(logging.INFO, logger="carma.http"):
        await api_client.request(method, path)

    records = [r for r in caplog.records if r.name == "carma.http"]
    assert records, "expected an http.request log line"
    assert "ABC123XYZ" not in records[-1].path
    assert records[-1].path == masked


@pytest.mark.asyncio
async def test_unrelated_route_logs_unchanged(api_client: AsyncClient, caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.INFO, logger="carma.http"):
        await api_client.get("/api/business/rewards")

    records = [r for r in caplog.records if r.name == "carma.http"]
    assert records
    assert records[-1].path == "/api/business/rewards"
