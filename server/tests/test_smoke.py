"""Smoke tests — verify the app boots and unauthenticated endpoints behave correctly."""

from __future__ import annotations

from httpx import AsyncClient


async def test_health_live(api_client: AsyncClient) -> None:
    r = await api_client.get("/health/live")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


async def test_protected_route_rejects_anonymous(api_client: AsyncClient) -> None:
    r = await api_client.get("/api/users/me")
    assert r.status_code == 401


async def test_login_rejects_invalid_credentials(db_api_client: AsyncClient) -> None:
    """This one reaches the users table, so it needs the DB-backed client.

    It used to build its own client, catch `OSError` and skip — which read as
    "no database here" but actually swallowed a broken connection from the app's
    module-level engine, on a loop that was already gone. The assertion then had
    to accept a 500 alongside the 401 to stay green. With a real session there is
    one right answer.
    """
    r = await db_api_client.post(
        "/api/auth/login",
        json={"email": "nobody@nowhere.com", "password": "wrongpass"},
    )
    assert r.status_code == 401
