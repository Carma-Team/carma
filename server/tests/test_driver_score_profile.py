"""`driver_score` on the wire (CAR-85) — never null, even for a brand-new driver.

Needs real rows, so it skips without Postgres.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_access_token
from app.models import Language, User, UserRole
from app.services import scoring


async def _driver(db: AsyncSession) -> User:
    user = User(
        email=f"_driverscore_{uuid.uuid4().hex[:10]}@carmatest.co.il",
        password_hash="x",
        name="Score Probe",
        role=UserRole.DRIVER,
        city="חיפה",
        language=Language.HE,
        is_private=True,
        drive_mode_enabled=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


def _auth(user: User) -> dict[str, str]:
    token = create_access_token(user_id=user.id, email=user.email, phone=None, role=UserRole.DRIVER)
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_a_driver_with_no_trips_gets_the_prior_score(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    driver = await _driver(db_session)
    assert driver.driver_score is None
    try:
        r = await db_api_client.get("/api/users/me", headers=_auth(driver))

        assert r.status_code == 200
        assert r.json()["driverScore"] == scoring.CONFIG.prior_score
    finally:
        await db_session.delete(driver)
        await db_session.commit()
