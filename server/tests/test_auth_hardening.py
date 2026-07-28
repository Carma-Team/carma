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
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, settings
from app.core.security import hash_code, hash_password
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


async def test_an_unknown_phone_is_indistinguishable_from_a_wrong_code(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    """The whole point of the change: one status, one body, both ways.

    Before, a stranger could post any phone number with a junk code and read the
    answer: 404 meant "not one of ours", 401 meant "yes, and now you know".
    """
    known = _phone()
    unknown = _phone()
    await _registered_driver(db_session, known)
    try:
        miss = await db_api_client.post("/api/auth/otp/verify", json={"phone": unknown, "code": "000000"})
        hit = await db_api_client.post("/api/auth/otp/verify", json={"phone": known, "code": "000000"})

        assert miss.status_code == hit.status_code == 401
        assert miss.json()["detail"] == hit.json()["detail"]
    finally:
        await _cleanup(db_session, known)


async def test_an_expired_code_reveals_nothing_a_wrong_one_would_not(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
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
    try:
        r = await db_api_client.post("/api/auth/otp/verify", json={"phone": phone, "code": "123456"})
        assert r.status_code == 401
        assert r.json()["detail"] == auth_service.OTP_REJECTED
    finally:
        await _cleanup(db_session, phone)


async def test_a_locked_account_does_not_announce_itself(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    """A 403 here would make five wrong guesses a test for "is this registered?"."""
    phone = _phone()
    user = await _registered_driver(db_session, phone)
    user.locked_until = _now() + timedelta(minutes=10)
    await db_session.commit()
    try:
        r = await db_api_client.post("/api/auth/otp/verify", json={"phone": phone, "code": "000000"})
        assert r.status_code == 401, "a locked account must answer like any other failure"
    finally:
        await _cleanup(db_session, phone)


async def test_a_correct_code_still_logs_you_in(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
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
    try:
        r = await db_api_client.post("/api/auth/otp/verify", json={"phone": phone, "code": "654321"})
        assert r.status_code == 200
        assert r.json()["token"]
    finally:
        await _cleanup(db_session, phone)


async def test_the_password_door_answers_the_same_either_way(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    # An unknown address and a wrong password must be indistinguishable, or the
    # endpoint is a directory of who has an account. Checked through the API
    # rather than by reading the source, so it holds however the code is spelled.
    email = f"generic-{uuid.uuid4().hex[:8]}@carmatest.com"
    await _password_driver(db_session, email, "CorrectHorse1")
    try:
        wrong_password = await db_api_client.post("/api/auth/login", json={"email": email, "password": "wrongpass"})
        no_such_user = await db_api_client.post(
            "/api/auth/login", json={"email": f"nobody-{uuid.uuid4().hex[:8]}@carmatest.com", "password": "wrongpass"}
        )

        assert wrong_password.status_code == no_such_user.status_code == 401
        assert wrong_password.json()["detail"] == no_such_user.json()["detail"]
    finally:
        await _cleanup_email(db_session, email)


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


async def test_the_otp_route_carries_its_own_ceiling(rate_limited: None, db_api_client: AsyncClient) -> None:
    """Six code requests from one address in a minute; the sixth is refused.

    Keyed on the address, so it is the blunt half of the defence — it bounds
    someone sweeping many different numbers, which the per-phone cap cannot see.
    Every one of these would have spent money on an SMS.
    """
    codes = [
        (await db_api_client.post("/api/auth/otp/request", json={"phone": _phone()})).status_code for _ in range(6)
    ]

    assert codes[5] == 429, f"expected the sixth attempt to be refused, got {codes}"


async def test_login_is_not_held_to_the_sms_ceiling(rate_limited: None, db_api_client: AsyncClient) -> None:
    """Login costs us nothing per attempt, and one address is not one person.

    Mobile carriers put thousands of subscribers behind a single address, so a
    5/minute cap here is a budget a household can exhaust between them. Guessing
    is stopped per account instead — see the lockout test below.
    """
    codes = [
        (
            await db_api_client.post("/api/auth/login", json={"email": "nobody@nowhere.com", "password": "wrongpass"})
        ).status_code
        for _ in range(6)
    ]

    assert codes == [401] * 6, f"a sixth attempt from one address must still be served, got {codes}"


# ─── 4. guessing a password now costs the guesser the account ────────────────


async def _password_driver(db: AsyncSession, email: str, password: str) -> User:
    user = User(
        id=uuid.uuid4().hex,
        email=email,
        password_hash=hash_password(password),
        name="Lockout Test",
        role=UserRole.DRIVER,
    )
    db.add(user)
    await db.commit()
    return user


async def _cleanup_email(db: AsyncSession, email: str) -> None:
    await db.execute(delete(User).where(User.email == email))
    await db.commit()


async def test_repeated_wrong_passwords_lock_the_account(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    """`_assert_not_locked` was checked on this path but nothing ever set the lock.

    The counter only ever moved on the OTP door, so a password guesser had no
    account-level limit at all — only the per-address one, which is the same
    address for everyone behind a carrier NAT and is gone entirely if the proxy
    depth is misconfigured. Two independent things had to be right for password
    login to be protected; now the account itself pushes back.
    """
    email = f"lock-{uuid.uuid4().hex[:8]}@carmatest.com"
    await _password_driver(db_session, email, "CorrectHorse1")
    try:
        for _ in range(settings.otp_max_attempts):
            r = await db_api_client.post("/api/auth/login", json={"email": email, "password": "wrongpass"})
            assert r.status_code == 401

        blocked = await db_api_client.post("/api/auth/login", json={"email": email, "password": "CorrectHorse1"})
        assert blocked.status_code == 401, "the right password must not open a locked account"
    finally:
        await _cleanup_email(db_session, email)


async def test_a_successful_login_clears_the_counter(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    """Otherwise four typos spread over a month would eventually lock a real user."""
    email = f"clear-{uuid.uuid4().hex[:8]}@carmatest.com"
    await _password_driver(db_session, email, "CorrectHorse1")
    try:
        for _ in range(settings.otp_max_attempts - 1):
            await db_api_client.post("/api/auth/login", json={"email": email, "password": "wrongpass"})

        ok = await db_api_client.post("/api/auth/login", json={"email": email, "password": "CorrectHorse1"})
        assert ok.status_code == 200

        await db_session.refresh(await db_session.scalar(select(User).where(User.email == email)))
        again = await db_api_client.post("/api/auth/login", json={"email": email, "password": "wrongpass"})
        assert again.status_code == 401, "the count should have restarted, not carried over into a lockout"
    finally:
        await _cleanup_email(db_session, email)


async def test_a_locked_email_is_indistinguishable_from_an_unknown_one(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    """Six requests used to be enough to tell whether an email is registered.

    The lockout answered 403 while every other failure answered 401, so an
    attacker guessed wrong five times and read the sixth reply. Both doors now
    answer identically — the account-level lock still holds, it just stops
    confirming that the account is there.
    """
    known = f"known-{uuid.uuid4().hex[:8]}@carmatest.com"
    unknown = f"nobody-{uuid.uuid4().hex[:8]}@carmatest.com"
    await _password_driver(db_session, known, "CorrectHorse1")
    try:
        for _ in range(settings.otp_max_attempts):
            await db_api_client.post("/api/auth/login", json={"email": known, "password": "wrongpass"})

        locked = await db_api_client.post("/api/auth/login", json={"email": known, "password": "wrongpass"})
        stranger = await db_api_client.post("/api/auth/login", json={"email": unknown, "password": "wrongpass"})

        assert locked.status_code == stranger.status_code
        assert locked.json()["detail"] == stranger.json()["detail"]
    finally:
        await _cleanup_email(db_session, known)


# ─── 5. a locked account is no longer a way to test a phone number ───────────


async def test_requesting_a_code_for_a_locked_account_looks_like_an_unknown_number(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    """The reasoning that left this open — "the caller holds the number" — was wrong.

    An attacker does not hold it; they are guessing it. And a lockout is
    something they can *cause*, with five wrong codes. A distinct answer here
    turned that into a two-step test for whether a number is registered.
    """
    locked = _phone()
    unknown = _phone()
    user = await _registered_driver(db_session, locked)
    user.locked_until = _now() + timedelta(minutes=10)
    await db_session.commit()
    try:
        hit = await db_api_client.post("/api/auth/otp/request", json={"phone": locked})
        miss = await db_api_client.post("/api/auth/otp/request", json={"phone": unknown})

        assert hit.status_code == miss.status_code == 200
        assert hit.json() == miss.json()

        rows = (await db_session.scalars(select(OtpCode).where(OtpCode.phone == locked))).all()
        assert rows == [], "a locked account must not trigger a billed SMS either"
    finally:
        await _cleanup(db_session, locked)


# ─── 6. being over the SMS quota changes nothing else ────────────────────────


async def test_a_throttled_registration_does_not_rewrite_the_profile(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    """The quota check used to run after the write, inside `_issue_otp`.

    So a caller past their hourly cap still got their name, age and city applied
    to an unverified account — repeatedly, at no cost, for as long as they liked.
    """
    phone = _phone()
    body = {"phone": phone, "name": "Original", "language": "HE", "age": 30, "city": "Tel Aviv"}
    try:
        # Spend the hour's whole allowance, sending the same name every time so
        # that anything different in the row afterwards can only be the refused
        # request talking.
        for _ in range(settings.otp_max_per_hour):
            allowed = await db_api_client.post("/api/auth/otp/register", json=body)
            assert allowed.status_code in (200, 201)

        refused = await db_api_client.post("/api/auth/otp/register", json={**body, "name": "Overwritten"})
        assert refused.status_code == 429, "the cap should already be spent"

        await db_session.commit()  # drop this session's snapshot, re-read what the API wrote
        user = await db_session.scalar(select(User).where(User.phone == phone))
        assert user is not None
        assert user.name == "Original", "a refused request must not have touched the row"
    finally:
        await _cleanup(db_session, phone)
