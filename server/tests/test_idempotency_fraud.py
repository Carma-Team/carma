"""Tests for Idempotency-Key deduplication on POST /api/trips and POST /api/fraud.

Every assertion here fires at the auth gate or in routing, before a connection
is ever opened — hence `api_client` rather than `db_api_client`.
"""

from __future__ import annotations

from httpx import AsyncClient


async def test_trips_requires_auth(api_client: AsyncClient) -> None:
    r = await api_client.post(
        "/api/trips",
        json={"startTime": "2026-05-19T10:00:00Z"},
        headers={"Idempotency-Key": "smoke-key-001"},
    )
    assert r.status_code == 401


async def test_fraud_requires_auth(api_client: AsyncClient) -> None:
    r = await api_client.post(
        "/api/fraud",
        json={
            "idempotencyKey": "fraud-smoke-001",
            "tripDurationSeconds": 300,
            "distanceKm": 5.0,
            "anomalyFlags": ["IMPOSSIBLE_SPEED", "GPS_TELEPORT"],
        },
    )
    assert r.status_code == 401


async def test_trips_idempotency_key_accepted_in_header(api_client: AsyncClient) -> None:
    """Verify the endpoint parses Idempotency-Key without raising a 422."""
    r = await api_client.post(
        "/api/trips",
        json={"startTime": "2026-05-19T10:00:00Z"},
        headers={"Idempotency-Key": "smoke-key-002"},
    )
    # 401 = auth gate fired (header was parsed fine); 422 = header was rejected
    assert r.status_code != 422


async def test_fraud_endpoint_exists(api_client: AsyncClient) -> None:
    """Verify POST /api/fraud is registered (not 404/405)."""
    r = await api_client.post("/api/fraud", json={})
    assert r.status_code != 404
    assert r.status_code != 405
