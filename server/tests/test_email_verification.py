"""Proving a driver can read the address on their account.

Registration accepts any email and returns a token, and `users.email` is unique,
so an address a stranger claimed is one its owner can never register with. These
tests hold the code path that closes that, and the boundaries that stop it being
a new way in.

Worth having:
  * a valid code sets `is_email_verified`, and only once;
  * a code minted for one address does not verify a different one;
  * the hourly cap holds, so the endpoint cannot be used to mail somebody
    repeatedly from our domain.

Not a way in:
  * both halves need a session — an address is never named by the caller;
  * wrong guesses are bounded, and a spent code stays spent.

What is deliberately *not* here: a test that registration refuses an unverified
address. Nothing refuses one yet, on purpose — see `User.is_email_verified`.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.security import create_access_token, hash_code, hash_password
from app.models import EmailVerificationCode, User
from app.models.enums import UserRole
from app.services.email_verification import _MAX_ATTEMPTS

REQUEST_URL = "/api/auth/email/verify/request"
CONFIRM_URL = "/api/auth/email/verify/confirm"

CODE = "123456"
PASSWORD = "CorrectHorse1"


def _now() -> datetime:
    return datetime.now(UTC)


def _auth(user: User) -> dict[str, str]:
    token = create_access_token(user_id=user.id, email=user.email, phone=None, role=UserRole.DRIVER)
    return {"Authorization": f"Bearer {token}"}


async def _driver(db: AsyncSession, *, email: str | None = None, verified: bool = False) -> User:
    user = User(
        id=uuid.uuid4().hex,
        email=email if email is not None else f"verify-{uuid.uuid4().hex[:8]}@carmatest.com",
        password_hash=hash_password(PASSWORD),
        name="Verify Test",
        role=UserRole.DRIVER,
        is_email_verified=verified,
    )
    db.add(user)
    await db.commit()
    return user


async def _live_code(
    db: AsyncSession, user: User, *, email: str | None = None, code: str = CODE
) -> EmailVerificationCode:
    row = EmailVerificationCode(
        id=uuid.uuid4().hex,
        user_id=user.id,
        email=email if email is not None else (user.email or ""),
        code_hash=hash_code(code),
        expires_at=_now() + timedelta(seconds=settings.otp_ttl_seconds),
    )
    db.add(row)
    await db.commit()
    return row


@pytest.mark.asyncio
async def test_valid_code_verifies_the_address(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    user = await _driver(db_session)
    await _live_code(db_session, user)

    r = await db_api_client.post(CONFIRM_URL, json={"code": CODE}, headers=_auth(user))

    assert r.status_code == 200
    await db_session.refresh(user)
    assert user.is_email_verified is True


@pytest.mark.asyncio
async def test_a_code_works_once(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    """The second use finds the row consumed, not a second verification."""
    user = await _driver(db_session)
    await _live_code(db_session, user)

    first = await db_api_client.post(CONFIRM_URL, json={"code": CODE}, headers=_auth(user))
    assert first.status_code == 200

    # Already verified, so the second call is a no-op rather than an error: the
    # caller owns the account and re-confirming is not a failure worth a 4xx.
    second = await db_api_client.post(CONFIRM_URL, json={"code": CODE}, headers=_auth(user))
    assert second.status_code == 200

    rows = (
        await db_session.scalars(select(EmailVerificationCode).where(EmailVerificationCode.user_id == user.id))
    ).all()
    assert all(row.consumed_at is not None for row in rows)


@pytest.mark.asyncio
async def test_a_code_does_not_verify_an_address_it_was_not_sent_to(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    """The driver changed their email while the code was in flight."""
    user = await _driver(db_session)
    await _live_code(db_session, user, email="old-address@carmatest.com")

    r = await db_api_client.post(CONFIRM_URL, json={"code": CODE}, headers=_auth(user))

    assert r.status_code == 400
    await db_session.refresh(user)
    assert user.is_email_verified is False


@pytest.mark.asyncio
async def test_an_expired_code_is_refused(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    user = await _driver(db_session)
    row = await _live_code(db_session, user)
    row.expires_at = _now() - timedelta(seconds=1)
    await db_session.commit()

    r = await db_api_client.post(CONFIRM_URL, json={"code": CODE}, headers=_auth(user))

    assert r.status_code == 400
    await db_session.refresh(user)
    assert user.is_email_verified is False


@pytest.mark.asyncio
async def test_wrong_guesses_are_bounded(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    """After the cap the code is spent, so the right one no longer works either."""
    user = await _driver(db_session)
    await _live_code(db_session, user)

    for _ in range(_MAX_ATTEMPTS):
        bad = await db_api_client.post(CONFIRM_URL, json={"code": "000000"}, headers=_auth(user))
        assert bad.status_code == 400

    r = await db_api_client.post(CONFIRM_URL, json={"code": CODE}, headers=_auth(user))
    assert r.status_code == 400
    await db_session.refresh(user)
    assert user.is_email_verified is False


@pytest.mark.asyncio
async def test_the_hourly_cap_holds(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    user = await _driver(db_session)

    for _ in range(settings.email_verification_max_per_hour):
        ok = await db_api_client.post(REQUEST_URL, headers=_auth(user))
        assert ok.status_code == 200

    r = await db_api_client.post(REQUEST_URL, headers=_auth(user))
    assert r.status_code == 429


@pytest.mark.asyncio
async def test_requesting_replaces_any_live_code(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    """Asking again invalidates the previous code rather than leaving two live."""
    user = await _driver(db_session)
    await _live_code(db_session, user)

    r = await db_api_client.post(REQUEST_URL, headers=_auth(user))
    assert r.status_code == 200

    stale = await db_api_client.post(CONFIRM_URL, json={"code": CODE}, headers=_auth(user))
    assert stale.status_code == 400


@pytest.mark.asyncio
async def test_an_already_verified_address_is_not_mailed_again(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    user = await _driver(db_session, verified=True)

    r = await db_api_client.post(REQUEST_URL, headers=_auth(user))

    assert r.status_code == 409


@pytest.mark.asyncio
async def test_an_account_with_no_email_has_nothing_to_verify(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    """A driver who signed up by phone. Refused rather than 500ing on a null."""
    user = User(
        id=uuid.uuid4().hex,
        phone=f"+9725{uuid.uuid4().int % 10**8:08d}",
        name="Otp Only",
        role=UserRole.DRIVER,
        is_phone_verified=True,
    )
    db_session.add(user)
    await db_session.commit()

    r = await db_api_client.post(REQUEST_URL, headers=_auth(user))

    assert r.status_code == 400


@pytest.mark.asyncio
async def test_both_halves_need_a_session(db_api_client: AsyncClient) -> None:
    """The address verified is the one on the session, never one the caller names."""
    assert (await db_api_client.post(REQUEST_URL)).status_code == 401
    assert (await db_api_client.post(CONFIRM_URL, json={"code": CODE})).status_code == 401
