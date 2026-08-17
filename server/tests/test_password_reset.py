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

from app.config import settings
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


async def _phone_only_driver(db: AsyncSession, phone: str) -> User:
    """A driver who signed up by phone — no email, so no password login to restore."""
    user = User(
        id=uuid.uuid4().hex,
        phone=phone,
        name="Otp Only",
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


async def test_running_out_of_codes_does_not_name_the_number_either(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    """The hourly SMS cap was the same oracle, one step further along.

    Only a number with an account behind it ever gets a code, so only that number
    can spend the cap — a stranger's writes no rows and answers 200 all day. A 429
    on the sixth request therefore meant "yes, this one is ours". The cap still
    holds; it just stops announcing itself.
    """
    known = _phone()
    unknown = _phone()
    await _driver(db_session, known)
    try:
        for _ in range(settings.otp_max_per_hour + 1):
            spent = await db_api_client.post(REQUEST_URL, json={"phone": known})
        stranger = await db_api_client.post(REQUEST_URL, json={"phone": unknown})

        assert spent.status_code == stranger.status_code == 200
        assert spent.json() == stranger.json()

        codes = (await db_session.scalars(select(OtpCode).where(OtpCode.phone == known))).all()
        assert len(codes) == settings.otp_max_per_hour, "answering politely is not a licence to keep sending"
    finally:
        await _cleanup(db_session, known)


# ─── the number as the driver typed it at signup ─────────────────────────────


async def test_a_locally_spelled_phone_still_finds_its_account(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    """`0501234567` and `+972501234567` are the same driver.

    Email signup takes free-form input and stores it as typed, and an email is
    exactly what this endpoint requires — so an `==` lookup would fail for the one
    group allowed to use it, silently, with "a code has been sent" on screen. The
    permanent lockout this endpoint exists to end, rebuilt one layer down.
    """
    local = f"05{uuid.uuid4().int % 10**8:08d}"
    e164 = f"+972{local[1:]}"
    user = User(
        id=uuid.uuid4().hex,
        phone=local,  # as `register_with_password` would have stored it
        email=f"reset-{uuid.uuid4().hex[:8]}@carmatest.com",
        password_hash=hash_password(OLD_PASSWORD),
        name="Typed It Locally",
        role=UserRole.DRIVER,
    )
    db_session.add(user)
    await db_session.commit()
    try:
        asked = await db_api_client.post(REQUEST_URL, json={"phone": e164})
        assert asked.status_code == 200

        codes = (await db_session.scalars(select(OtpCode).where(OtpCode.phone == e164))).all()
        assert len(codes) == 1, "the request half must recognise the account and send"

        # A code we know the plaintext of, planted after the request above — which
        # voids anything unconsumed, its own earlier code included.
        await _seed_code(db_session, e164, "654321")
        r = await db_api_client.post(CONFIRM_URL, json={"phone": e164, "code": "654321", "newPassword": NEW_PASSWORD})
        assert r.status_code == 200, r.text

        after = await _reload(db_session, local)
        assert verify_password(NEW_PASSWORD, after.password_hash or "")
    finally:
        await _cleanup(db_session, local)
        await _cleanup(db_session, e164)


# ─── a password only where there is somewhere to type it ─────────────────────


async def test_a_phone_only_driver_is_not_offered_a_password(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    """Password login is by email, and this driver has none.

    Going through with it ends in "sign in with your new password" and a login
    screen that cannot take it — a dead end that looks like success. Their way
    back in is a login code, which needs no password at all.
    """
    phone = _phone()
    await _phone_only_driver(db_session, phone)
    try:
        r = await db_api_client.post(REQUEST_URL, json={"phone": phone})
        assert r.status_code == 200, "the answer stays the same — it must not name who has an email"

        codes = (await db_session.scalars(select(OtpCode).where(OtpCode.phone == phone))).all()
        assert codes == [], "a code that cannot lead anywhere is a paid message for nothing"
    finally:
        await _cleanup(db_session, phone)


async def test_a_phone_only_driver_cannot_be_given_a_password(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    """Checked on the confirm half too, not only where codes are handed out."""
    phone = _phone()
    await _phone_only_driver(db_session, phone)
    await _seed_code(db_session, phone, "654321")
    try:
        r = await db_api_client.post(CONFIRM_URL, json={"phone": phone, "code": "654321", "newPassword": NEW_PASSWORD})
        assert r.status_code == 401

        after = await _reload(db_session, phone)
        assert after.password_hash is None, "a password with no way to type it is worse than none"
    finally:
        await _cleanup(db_session, phone)


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

    The default 30/minute (live since CAR-126) would let six through — far too
    generous for a route that spends money on every call.
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
