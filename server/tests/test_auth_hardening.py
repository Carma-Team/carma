"""The three holes in #23, and the tests that keep them shut.

1. `otp/verify` answered 404 for an unknown phone and 400 for a known one with
   no pending code — a free directory of who holds a CARMA account, on an
   endpoint that needs no credential to reach.
2. CORS asked for a wildcard origin *and* credentials. That pair is forbidden by
   the spec, and the only reason it never hurt is that Starlette silently
   dropped the credentials.
3. Nothing but the global 30/minute stood in front of `otp/request`, and every
   call to it sends an SMS somebody pays for.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, settings
from app.core.security import hash_code
from app.database import get_db
from app.main import app
from app.models import OtpCode, User
from app.models.enums import UserRole
from app.services import auth as auth_service
from app.services.auth import OTP_PURPOSE


def _phone() -> str:
    return f"+9725{uuid.uuid4().int % 10**8:08d}"


def _now() -> datetime:
    return datetime.now(UTC)


async def _registered_driver(db: AsyncSession, phone: str) -> User:
    user = User(
        id=uuid.uuid4().hex,
        phone=phone,
        name="Hardening Test",
        role=UserRole.DRIVER,
        is_phone_verified=True,
    )
    db.add(user)
    await db.commit()
    return user


async def _cleanup(db: AsyncSession, phone: str) -> None:
    await db.execute(delete(OtpCode).where(OtpCode.phone == phone))
    await db.execute(delete(User).where(User.phone == phone))
    await db.commit()


# ─── 1. the endpoint stops naming who is registered ──────────────────────────


async def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _override_db(db_session: AsyncSession) -> None:
    """Point the app at the test's session.

    Without this the request runs on the app's module-level engine, whose
    asyncpg connections belong to a different event loop — see conftest.
    """

    async def _use_the_fixture_session() -> AsyncIterator[AsyncSession]:
        yield db_session

    app.dependency_overrides[get_db] = _use_the_fixture_session


async def test_an_unknown_phone_is_indistinguishable_from_a_wrong_code(db_session: AsyncSession) -> None:
    """The whole point of the change: one status, one body, both ways.

    Before, a stranger could post any phone number with a junk code and read the
    answer: 404 meant "not one of ours", 401 meant "yes, and now you know".
    """
    known = _phone()
    unknown = _phone()
    await _registered_driver(db_session, known)
    await _override_db(db_session)
    try:
        async with await _client() as ac:
            miss = await ac.post("/api/auth/otp/verify", json={"phone": unknown, "code": "000000"})
            hit = await ac.post("/api/auth/otp/verify", json={"phone": known, "code": "000000"})

        assert miss.status_code == hit.status_code == 401
        assert miss.json()["detail"] == hit.json()["detail"]
    finally:
        app.dependency_overrides.pop(get_db, None)
        await _cleanup(db_session, known)


async def test_an_expired_code_reveals_nothing_a_wrong_one_would_not(db_session: AsyncSession) -> None:
    """The second half of the oracle — a 400 here used to mean "this phone exists".

    Collapsing expiry into the same 401 costs the user nothing: whether the code
    was wrong or stale, the next step is to ask for another one.
    """
    phone = _phone()
    await _registered_driver(db_session, phone)
    db_session.add(
        OtpCode(
            phone=phone,
            code_hash=hash_code("123456"),
            purpose=OTP_PURPOSE,
            expires_at=_now() - timedelta(minutes=1),
        )
    )
    await db_session.commit()
    await _override_db(db_session)
    try:
        async with await _client() as ac:
            r = await ac.post("/api/auth/otp/verify", json={"phone": phone, "code": "123456"})
        assert r.status_code == 401
        assert r.json()["detail"] == auth_service.OTP_REJECTED
    finally:
        app.dependency_overrides.pop(get_db, None)
        await _cleanup(db_session, phone)


async def test_a_locked_account_does_not_announce_itself(db_session: AsyncSession) -> None:
    """A 403 here would make five wrong guesses a test for "is this registered?".

    The lockout is still explained on `otp/request`, where the caller has the
    number in hand and is almost certainly its owner.
    """
    phone = _phone()
    user = await _registered_driver(db_session, phone)
    user.locked_until = _now() + timedelta(minutes=10)
    await db_session.commit()
    await _override_db(db_session)
    try:
        async with await _client() as ac:
            r = await ac.post("/api/auth/otp/verify", json={"phone": phone, "code": "000000"})
        assert r.status_code == 401, "a locked account must answer like any other failure"
    finally:
        app.dependency_overrides.pop(get_db, None)
        await _cleanup(db_session, phone)


async def test_a_correct_code_still_logs_you_in(db_session: AsyncSession) -> None:
    # Hiding failures is only worth anything if the success path is untouched.
    phone = _phone()
    await _registered_driver(db_session, phone)
    db_session.add(
        OtpCode(
            phone=phone,
            code_hash=hash_code("654321"),
            purpose=OTP_PURPOSE,
            expires_at=_now() + timedelta(minutes=5),
        )
    )
    await db_session.commit()
    await _override_db(db_session)
    try:
        async with await _client() as ac:
            r = await ac.post("/api/auth/otp/verify", json={"phone": phone, "code": "654321"})
        assert r.status_code == 200
        assert r.json()["token"]
    finally:
        app.dependency_overrides.pop(get_db, None)
        await _cleanup(db_session, phone)


async def test_the_password_door_was_already_generic() -> None:
    # `login_with_password` answers "Invalid email or password" for both an
    # unknown address and a wrong password. Pinned so a future edit that splits
    # them into helpful messages fails here instead of in production.
    import inspect

    source = inspect.getsource(auth_service.login_with_password)
    assert source.count("Invalid email or password") == 2


# ─── 2. CORS ─────────────────────────────────────────────────────────────────


class TestCorsCredentials:
    def test_a_wildcard_origin_refuses_credentials(self) -> None:
        # Not a style preference: the CORS spec forbids the pair, and Starlette
        # was quietly saving us from it.
        s = Settings(database_url="postgresql+asyncpg://x/y", jwt_secret="x" * 16, cors_origins="*")
        assert s.cors_origin_list == ["*"]
        assert s.cors_allows_credentials is False

    def test_naming_the_origins_turns_credentials_back_on(self) -> None:
        s = Settings(
            database_url="postgresql+asyncpg://x/y",
            jwt_secret="x" * 16,
            cors_origins="https://carma.app, https://admin.carma.app",
        )
        assert s.cors_origin_list == ["https://carma.app", "https://admin.carma.app"]
        assert s.cors_allows_credentials is True

    def test_the_running_app_agrees_with_the_setting(self) -> None:
        # The middleware is configured once at import; this catches the two
        # drifting apart.
        cors = next(m for m in app.user_middleware if "CORSMiddleware" in str(m.cls))
        assert cors.kwargs["allow_credentials"] is settings.cors_allows_credentials


# ─── 3. the SMS bill ─────────────────────────────────────────────────────────


async def test_one_phone_cannot_drain_the_sms_budget(db_session: AsyncSession) -> None:
    """The cap that survives IP rotation.

    A caller who changes address every request still lands on the same
    destination number, and that is what is billed. Counted from `otp_codes`,
    which already records every code issued — no new table for this.
    """
    phone = _phone()
    await _registered_driver(db_session, phone)
    try:
        for _ in range(settings.otp_max_per_hour):
            await auth_service.request_login_otp(db_session, phone)

        with pytest.raises(Exception) as exc:
            await auth_service.request_login_otp(db_session, phone)
        assert "429" in str(exc.value) or "Too many" in str(exc.value)

        issued = await db_session.scalar(
            select(OtpCode).where(OtpCode.phone == phone).order_by(OtpCode.created_at.desc())
        )
        assert issued is not None
        count = len((await db_session.scalars(select(OtpCode).where(OtpCode.phone == phone))).all())
        assert count == settings.otp_max_per_hour, "the refused request must not have sent a sixth code"
    finally:
        await _cleanup(db_session, phone)


async def test_codes_from_last_week_do_not_count_against_you(db_session: AsyncSession) -> None:
    # The cap is a rolling hour, not a lifetime quota — a regular user who logs
    # in from a new device every month must never be locked out by history.
    phone = _phone()
    await _registered_driver(db_session, phone)
    try:
        for _ in range(settings.otp_max_per_hour + 3):
            db_session.add(
                OtpCode(
                    phone=phone,
                    code_hash=hash_code("111111"),
                    purpose=OTP_PURPOSE,
                    expires_at=_now() - timedelta(days=7),
                    created_at=_now() - timedelta(days=7),
                )
            )
        await db_session.commit()

        sent = await auth_service.request_login_otp(db_session, phone)
        assert sent.expires_in_seconds == settings.otp_ttl_seconds
    finally:
        await _cleanup(db_session, phone)


async def test_an_unregistered_phone_never_reaches_the_sms_sender(db_session: AsyncSession) -> None:
    # `request_login_otp` returns the same reassuring message for a stranger.
    # Confirm that it is only a message — no row, so no SMS, so no bill.
    phone = _phone()
    try:
        sent = await auth_service.request_login_otp(db_session, phone)
        assert sent.message

        rows = (await db_session.scalars(select(OtpCode).where(OtpCode.phone == phone))).all()
        assert rows == [], "a code for an unregistered number is a paid message to a stranger"
    finally:
        await _cleanup(db_session, phone)


async def test_the_sensitive_routes_carry_their_own_ceiling(rate_limited: None, db_session: AsyncSession) -> None:
    """Six logins from one address in a minute; the sixth is refused.

    Keyed on the address, so it is the blunt half of the defence — it bounds
    someone sweeping many different numbers, which the per-phone cap cannot see.
    """
    await _override_db(db_session)
    try:
        async with await _client() as ac:
            codes = [
                (
                    await ac.post("/api/auth/login", json={"email": "nobody@nowhere.com", "password": "wrongpass"})
                ).status_code
                for _ in range(6)
            ]
    finally:
        app.dependency_overrides.pop(get_db, None)

    assert codes[:5] == [401] * 5, f"the first five must reach the handler, got {codes}"
    assert codes[5] == 429, f"expected the sixth attempt to be refused, got {codes}"
