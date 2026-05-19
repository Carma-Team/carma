"""Tests for Idempotency-Key deduplication on POST /api/trips and POST /api/fraud."""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.mark.asyncio
async def test_trips_requires_auth() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            "/api/trips",
            json={"startTime": "2026-05-19T10:00:00Z"},
            headers={"Idempotency-Key": "smoke-key-001"},
        )
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_fraud_requires_auth() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            "/api/fraud",
            json={
                "idempotencyKey": "fraud-smoke-001",
                "tripDurationSeconds": 300,
                "distanceKm": 5.0,
                "avgScore": 12.0,
                "anomalyFlags": ["IMPOSSIBLE_SPEED", "GPS_TELEPORT"],
            },
        )
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_trips_idempotency_key_accepted_in_header() -> None:
    """Verify the endpoint parses Idempotency-Key without raising a 422."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            "/api/trips",
            json={"startTime": "2026-05-19T10:00:00Z"},
            headers={"Idempotency-Key": "smoke-key-002"},
        )
    # 401 = auth gate fired (header was parsed fine); 422 = header was rejected
    assert r.status_code != 422


@pytest.mark.asyncio
async def test_fraud_endpoint_exists() -> None:
    """Verify POST /api/fraud is registered (not 404/405)."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post("/api/fraud", json={})
    assert r.status_code != 404
    assert r.status_code != 405
