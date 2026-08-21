"""Automatic trip detection survives a profile refresh (CAR-153).

`drive_mode_enabled` was readable but not writable, so the handset's choice never
reached the server — and because the client merges the server response over its
cached user, the server's permanent `false` silently switched the setting back on
the next refresh. These tests hold the round trip open: written by PATCH, read
back by GET, and left alone by a PATCH that does not mention it.

Driven through the router rather than the service: the wire names are half the
contract, and they come from the alias generator, not from the attribute names.

Needs real rows, so it skips without Postgres.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_access_token
from app.models import User, UserRole


async def _driver(db: AsyncSession, *, drive_mode: bool = False) -> User:
    user = User(
        email=f"_drivemode_{uuid.uuid4().hex[:10]}@carmatest.co.il",
        password_hash="x",
        name="Drive Mode Driver",
        role=UserRole.DRIVER,
        drive_mode_enabled=drive_mode,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


def _auth(user: User) -> dict[str, str]:
    token = create_access_token(user_id=user.id, email=user.email, phone=None, role=UserRole.DRIVER)
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_turning_drive_mode_on_reaches_the_database(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    driver = await _driver(db_session)
    try:
        r = await db_api_client.patch("/api/users/me", json={"driveModeEnabled": True}, headers=_auth(driver))

        assert r.status_code == 200
        assert r.json()["driveModeEnabled"] is True

        await db_session.refresh(driver)
        assert driver.drive_mode_enabled is True
    finally:
        await db_session.delete(driver)
        await db_session.commit()


@pytest.mark.asyncio
async def test_the_next_profile_read_returns_what_was_written(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    """The refresh path is where the bug actually bit the driver."""
    driver = await _driver(db_session)
    try:
        await db_api_client.patch("/api/users/me", json={"driveModeEnabled": True}, headers=_auth(driver))
        r = await db_api_client.get("/api/users/me", headers=_auth(driver))

        assert r.status_code == 200
        assert r.json()["driveModeEnabled"] is True
    finally:
        await db_session.delete(driver)
        await db_session.commit()


@pytest.mark.asyncio
async def test_it_can_be_turned_back_off(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    """`false` is a value, not an absence — a truthiness check here would eat it."""
    driver = await _driver(db_session, drive_mode=True)
    try:
        r = await db_api_client.patch("/api/users/me", json={"driveModeEnabled": False}, headers=_auth(driver))

        assert r.status_code == 200
        assert r.json()["driveModeEnabled"] is False

        await db_session.refresh(driver)
        assert driver.drive_mode_enabled is False
    finally:
        await db_session.delete(driver)
        await db_session.commit()


@pytest.mark.asyncio
async def test_a_patch_that_does_not_mention_it_leaves_it_alone(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    """Only what the client sent is written.

    Delete `exclude_unset=True` from update_profile and every name change would
    quietly switch automatic trip detection off — which is the bug, back again
    through the other door.
    """
    driver = await _driver(db_session, drive_mode=True)
    try:
        r = await db_api_client.patch("/api/users/me", json={"name": "Renamed"}, headers=_auth(driver))

        assert r.status_code == 200
        assert r.json()["driveModeEnabled"] is True

        await db_session.refresh(driver)
        assert driver.drive_mode_enabled is True
    finally:
        await db_session.delete(driver)
        await db_session.commit()
