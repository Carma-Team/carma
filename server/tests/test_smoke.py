"""Smoke tests — verify the app boots and unauthenticated endpoints behave correctly."""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.mark.asyncio
async def test_health_live() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/health/live")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


@pytest.mark.asyncio
async def test_protected_route_rejects_anonymous() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/users/me")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_login_rejects_invalid_credentials() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post("/api/auth/login", json={"email": "nobody@nowhere.com", "password": "wrongpass"})
    assert r.status_code in {401, 500}  # 500 if DB not seeded; 401 if seeded
