"""CAR-60 — a driver who forgets their password can get back in.

Before this there was no reset endpoint at all: the only route back into an
account was one of us editing the database. The tests here hold the three things
that make the new path worth having, and the two that stop it being a way in.

Worth having:
  * the code sets a new password, and the old one stops working;
  * a *locked* account can ask for a code and is unlocked by using it — waiting
    out the timer was the only exit before, and a locked-out driver is the most
    likely person to be here;
  * the code works once.

Not a way in:
  * a registered number and a stranger's get the same answer, on both halves;
  * a login code cannot reset a password, and a reset code cannot log you in.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_code, hash_password, verify_password
from app.models import OtpCode, User
from app.models.enums import UserRole
from app.services.auth import OTP_PURPOSE, RESET_PURPOSE

OLD_PASSWORD = "CorrectHorse1"
NEW_PASSWORD = "BatteryStaple9"

REQUEST_URL = "/api/auth/password/reset/request"
CONFIRM_URL = "/api/auth/password/reset/confirm"


def _phone() -> str:
    return f"+9725{uuid.uuid4().int % 10**8:08d}"


def _now() -> datetime:
    return datetime.now(UTC)


async def _driver(db: AsyncSession, phone: str) -> User:
    """A driver with both credentials — reset arrives by phone, login by email."""
    user = User(
        id=uuid.uuid4().hex,
        phone=phone,
        email=f"reset-{uuid.uuid4().hex[:8]}@carmatest.com",
        password_hash=hash_password(OLD_PASSWORD),
        name="Reset Test",
        role=UserRole.DRIVER,
        is_phone_verified=True,
    )
    db.add(user)
    await db.commit()
    return user


async def _seed_code(
    db: AsyncSession, phone: str, code: str, *, purpose: str = RESET_PURPOSE, ttl_minutes: int = 5
) -> None:
    """Plant a code we know the plaintext of — the real one is only ever hashed."""
    db.add(
        OtpCode(
            phone=phone,
            code_hash=hash_code(code),
            purpose=purpose,
            expires_at=_now() + timedelta(minutes=ttl_minutes),
        )
    )
    await db.commit()


async def _cleanup(db: AsyncSession, phone: str) -> None:
    await db.execute(delete(OtpCode).where(OtpCode.phone == phone))
    await db.execute(delete(User).where(User.phone == phone))  # login_failures cascade
    await db.commit()


async def _reload(db: AsyncSession, phone: str) -> User:
    await db.commit()  # drop this session's snapshot, re-read what the API wrote
    user = await db.scalar(select(User).where(User.phone == phone))
    assert user is not None
    return user


# ─── the path works ──────────────────────────────────────────────────────────


async def test_a_reset_code_replaces_the_password(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    phone = _phone()
    user = await _driver(db_session, phone)
    await _seed_code(db_session, phone, "654321")
    try:
        r = await db_api_client.post(CONFIRM_URL, json={"phone": phone, "code": "654321", "newPassword": NEW_PASSWORD})
        assert r.status_code == 200, r.text

        after = await _reload(db_session, phone)
        assert verify_password(NEW_PASSWORD, after.password_hash or "")
        assert not verify_password(OLD_PASSWORD, after.password_hash or "")

        signed_in = await db_api_client.post("/api/auth/login", json={"email": user.email, "password": NEW_PASSWORD})
        assert signed_in.status_code == 200, "the whole point is being able to sign in again"
    finally:
        await _cleanup(db_session, phone)


async def test_the_reset_does_not_hand_out_a_session(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    """Changing a password is not signing in.

    A token here would mean anyone holding the code is straight into the account
    without ever typing the password they just chose.
    """
    phone = _phone()
    await _driver(db_session, phone)
    await _seed_code(db_session, phone, "654321")
    try:
        r = await db_api_client.post(CONFIRM_URL, json={"phone": phone, "code": "654321", "newPassword": NEW_PASSWORD})
        assert r.status_code == 200
        assert "token" not in r.json()
    finally:
        await _cleanup(db_session, phone)


async def test_a_used_code_cannot_be_used_again(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    phone = _phone()
    await _driver(db_session, phone)
    await _seed_code(db_session, phone, "654321")
    try:
        first = await db_api_client.post(
            CONFIRM_URL, json={"phone": phone, "code": "654321", "newPassword": NEW_PASSWORD}
        )
        assert first.status_code == 200

        again = await db_api_client.post(
            CONFIRM_URL, json={"phone": phone, "code": "654321", "newPassword": "ThirdPassword3"}
        )
        assert again.status_code == 401

        after = await _reload(db_session, phone)
        assert verify_password(NEW_PASSWORD, after.password_hash or ""), "the replay must not have taken"
    finally:
        await _cleanup(db_session, phone)


async def test_an_expired_code_is_refused(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    phone = _phone()
    await _driver(db_session, phone)
    await _seed_code(db_session, phone, "654321", ttl_minutes=-1)
    try:
        r = await db_api_client.post(CONFIRM_URL, json={"phone": phone, "code": "654321", "newPassword": NEW_PASSWORD})
        assert r.status_code == 401

        after = await _reload(db_session, phone)
        assert verify_password(OLD_PASSWORD, after.password_hash or "")
    finally:
        await _cleanup(db_session, phone)


# ─── the lockout actually opens ──────────────────────────────────────────────


async def test_a_locked_account_can_still_ask_for_a_code(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    """The deliberate difference from `otp/request`, which stays silent when locked.

    Silence is right for a login code — a lockout is something a stranger can
    cause, so answering differently would leak. Here the lockout is the reason
    the caller came, and refusing them leaves no exit but the timer.
    """
    phone = _phone()
    user = await _driver(db_session, phone)
    user.locked_until = _now() + timedelta(minutes=10)
    await db_session.commit()
    try:
        r = await db_api_client.post(REQUEST_URL, json={"phone": phone})
        assert r.status_code == 200

        codes = (
            await db_session.scalars(select(OtpCode).where(OtpCode.phone == phone, OtpCode.purpose == RESET_PURPOSE))
        ).all()
        assert len(codes) == 1, "a locked driver must actually receive a reset code"
    finally:
        await _cleanup(db_session, phone)


async def test_completing_a_reset_unlocks_the_account(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    """A proper unlock, not a shorter wait.

    Without this the driver picks a new password and is still turned away for
    the rest of the fifteen minutes, with nothing on screen explaining why.
    """
    phone = _phone()
    user = await _driver(db_session, phone)
    user.locked_until = _now() + timedelta(minutes=10)
    await db_session.commit()
    await _seed_code(db_session, phone, "654321")
    try:
        r = await db_api_client.post(CONFIRM_URL, json={"phone": phone, "code": "654321", "newPassword": NEW_PASSWORD})
        assert r.status_code == 200

        after = await _reload(db_session, phone)
        assert after.locked_until is None

        signed_in = await db_api_client.post("/api/auth/login", json={"email": after.email, "password": NEW_PASSWORD})
        assert signed_in.status_code == 200, "the lock should be gone, not merely shortened"
    finally:
        await _cleanup(db_session, phone)


# ─── it does not name who is registered ──────────────────────────────────────


async def test_asking_for_a_stranger_looks_exactly_like_asking_for_a_driver(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    """Same status, same body — otherwise this is a directory of our users.

    It is also the one place a difference would be free to read: no credential
    is needed to reach it, and the reply arrives whether or not the caller holds
    the number.
    """
    known = _phone()
    unknown = _phone()
    await _driver(db_session, known)
    try:
        hit = await db_api_client.post(REQUEST_URL, json={"phone": known})
        miss = await db_api_client.post(REQUEST_URL, json={"phone": unknown})

        assert hit.status_code == miss.status_code == 200
        assert hit.json() == miss.json()

        rows = (await db_session.scalars(select(OtpCode).where(OtpCode.phone == unknown))).all()
        assert rows == [], "a code for an unregistered number is a paid message to a stranger"
    finally:
        await _cleanup(db_session, known)


async def test_a_wrong_code_and_an_unknown_number_answer_alike(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    known = _phone()
    unknown = _phone()
    await _driver(db_session, known)
    await _seed_code(db_session, known, "654321")
    try:
        wrong = await db_api_client.post(
            CONFIRM_URL, json={"phone": known, "code": "000000", "newPassword": NEW_PASSWORD}
        )
        stranger = await db_api_client.post(
            CONFIRM_URL, json={"phone": unknown, "code": "000000", "newPassword": NEW_PASSWORD}
        )

        assert wrong.status_code == stranger.status_code == 401
        assert wrong.json()["detail"] == stranger.json()["detail"]
    finally:
        await _cleanup(db_session, known)


# ─── the two kinds of code stay apart ────────────────────────────────────────


async def test_a_login_code_cannot_reset_a_password(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    """Otherwise a code phished as "confirm your login" is a password takeover."""
    phone = _phone()
    await _driver(db_session, phone)
    await _seed_code(db_session, phone, "654321", purpose=OTP_PURPOSE)
    try:
        r = await db_api_client.post(CONFIRM_URL, json={"phone": phone, "code": "654321", "newPassword": NEW_PASSWORD})
        assert r.status_code == 401

        after = await _reload(db_session, phone)
        assert verify_password(OLD_PASSWORD, after.password_hash or "")
    finally:
        await _cleanup(db_session, phone)


async def test_a_reset_code_cannot_log_you_in(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    phone = _phone()
    await _driver(db_session, phone)
    await _seed_code(db_session, phone, "654321")
    try:
        r = await db_api_client.post("/api/auth/otp/verify", json={"phone": phone, "code": "654321"})
        assert r.status_code == 401
    finally:
        await _cleanup(db_session, phone)


async def test_asking_to_reset_does_not_cancel_a_login_code(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    """The purposes are separate rows, so one request does not void the other.

    A driver mid-login who taps "forgot password" and then goes back should find
    the code already in their messages still works.
    """
    phone = _phone()
    await _driver(db_session, phone)
    await _seed_code(db_session, phone, "654321", purpose=OTP_PURPOSE)
    try:
        assert (await db_api_client.post(REQUEST_URL, json={"phone": phone})).status_code == 200

        r = await db_api_client.post("/api/auth/otp/verify", json={"phone": phone, "code": "654321"})
        assert r.status_code == 200, "the login code was still valid"
    finally:
        await _cleanup(db_session, phone)


# ─── the routes carry their own ceiling ──────────────────────────────────────


async def test_the_reset_request_route_has_its_own_limit(rate_limited: None, db_api_client: AsyncClient) -> None:
    """Every call here can send a billed SMS, so it gets the tight OTP ceiling.

    The global 30/minute does not apply on its own — nothing enforces it until
    CAR-126, so a route without a decorator has no limit at all.
    """
    codes = [(await db_api_client.post(REQUEST_URL, json={"phone": _phone()})).status_code for _ in range(6)]

    assert codes[5] == 429, f"expected the sixth attempt to be refused, got {codes}"


async def test_the_reset_confirm_route_has_its_own_limit(rate_limited: None, db_api_client: AsyncClient) -> None:
    codes = [
        (
            await db_api_client.post(
                CONFIRM_URL, json={"phone": _phone(), "code": "000000", "newPassword": NEW_PASSWORD}
            )
        ).status_code
        for _ in range(6)
    ]

    assert codes[5] == 429, f"expected the sixth attempt to be refused, got {codes}"
