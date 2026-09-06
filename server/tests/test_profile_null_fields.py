"""A profile field that cannot be null answers 422, not 500.

`language`, `is_private` and `drive_mode_enabled` are NOT NULL columns exposed on
the PATCH body as `X | None`, where the `None` means "not sent". An explicit null
was indistinguishable from that, so it reached the column and came back as an
unhandled IntegrityError. Found while adding `drive_mode_enabled` (CAR-153); the
other two had carried it since the endpoint was written.

`name`, `age` and `city` are nullable on purpose — clearing them is a real edit,
and the last test here is what keeps the guard off them.

Needs real rows, so it skips without Postgres.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_access_token
from app.models import Language, User, UserRole

_HAIFA = "4000"  # CBS settlement code; cities are reference rows now (CAR-218).


async def _driver(db: AsyncSession) -> User:
    user = User(
        email=f"_nulls_{uuid.uuid4().hex[:10]}@carmatest.co.il",
        password_hash="x",
        name="Null Probe",
        role=UserRole.DRIVER,
        city_code=_HAIFA,
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
@pytest.mark.parametrize(
    ("wire_name", "column"),
    [("language", "language"), ("isPrivate", "is_private"), ("driveModeEnabled", "drive_mode_enabled")],
)
async def test_an_explicit_null_is_refused(
    db_session: AsyncSession, db_api_client: AsyncClient, wire_name: str, column: str
) -> None:
    driver = await _driver(db_session)
    before = getattr(driver, column)
    try:
        r = await db_api_client.patch("/api/users/me", json={wire_name: None}, headers=_auth(driver))

        assert r.status_code == 422, f"{wire_name} answered {r.status_code}"

        await db_session.refresh(driver)
        assert getattr(driver, column) == before
    finally:
        await db_session.delete(driver)
        await db_session.commit()


@pytest.mark.asyncio
async def test_a_nullable_field_can_still_be_cleared(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    """The guard covers three fields, not the whole body — dropping your city is an edit."""
    driver = await _driver(db_session)
    try:
        r = await db_api_client.patch("/api/users/me", json={"city": None}, headers=_auth(driver))

        assert r.status_code == 200
        assert r.json()["city"] is None

        await db_session.refresh(driver)
        assert driver.city is None
    finally:
        await db_session.delete(driver)
        await db_session.commit()
