"""The three holes in #23, and the tests that keep them shut.

1. `otp/verify` answered 404 for an unknown phone and 400 for a known one with
   no pending code — a free directory of who holds a CARMA account, on an
   endpoint that needs no credential to reach.
2. CORS asked for a wildcard origin *and* credentials. That pair is forbidden by
   the spec, and the only reason it never hurt is that Starlette silently
   dropped the credentials.
3. Nothing but the global 30/minute stood in front of `otp/request`, and every
   call to it sends an SMS somebody pays for.

Section 7 covers CAR-51, which the fix for #23 made reachable: once password
login fed the account-wide counter, anyone who knew a driver's email could spend
ten wrong passwords and take that driver offline for fifteen minutes, over and
over. Failures are counted per (account, address) now.
"""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import Settings, settings
from app.core.security import hash_code, hash_password
from app.main import app
from app.models import LoginFailure, OtpCode, User
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


async def test_a_stale_code_is_not_charged_as_a_guess(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    """CAR-130: `_reserve_attempt` banks a row before the OTP lookup even runs.

    An expired code, or none at all, says nothing about whether the caller
    holds the phone — it must not cost the address a step of backoff, or five
    late submissions would lock out someone who never guessed wrong once.
    """
    phone = _phone()
    user = await _registered_driver(db_session, phone)
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

        rows = await db_session.scalar(
            select(func.count()).select_from(LoginFailure).where(LoginFailure.user_id == user.id)
        )
        assert rows == 0, "an expired code is not a wrong guess"
    finally:
        await _cleanup(db_session, phone)


async def test_a_missing_code_is_not_charged_as_a_guess(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    """Same trap, the other branch: nobody has requested a code at all yet."""
    phone = _phone()
    user = await _registered_driver(db_session, phone)
    try:
        r = await db_api_client.post("/api/auth/otp/verify", json={"phone": phone, "code": "123456"})
        assert r.status_code == 401

        rows = await db_session.scalar(
            select(func.count()).select_from(LoginFailure).where(LoginFailure.user_id == user.id)
        )
        assert rows == 0, "no active code is not a wrong guess"
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


# ─── 2b. the deployed browser origin (CAR-108) ───────────────────────────────
#
# Production names one origin, the business web app on Azure. What the browser
# then does with it is decided entirely by the middleware kwargs in `main.py`,
# so these drive real preflights through those exact kwargs with only the origin
# list swapped for a known one. Copying the kwargs instead would agree with
# whatever `main.py` said on the day the copy was made and never notice again.

DEPLOYED_ORIGIN = "https://carma-business.example.azurecontainerapps.io"
# The three headers `web/src/lib/api/client.ts` and `lib/auth/authApi.ts` send.
# Authorization carries the access token; X-Requested-With is the CSRF gate on
# /refresh and /logout (`core.deps.require_browser_header`), and being a custom
# header it is also what forces the preflight in the first place.
BROWSER_HEADERS = "authorization,content-type,x-requested-with"


def _probe_app(*origins: str) -> FastAPI:
    wired = next(m for m in app.user_middleware if "CORSMiddleware" in str(m.cls))
    kwargs = {**wired.kwargs, "allow_origins": list(origins), "allow_credentials": True}
    probe = FastAPI()
    probe.add_middleware(CORSMiddleware, **kwargs)

    @probe.post("/api/auth/refresh")
    async def _refresh() -> JSONResponse:
        return JSONResponse({"ok": True}, headers={"Retry-After": "30"})

    return probe


def _browser(probe: FastAPI) -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=probe), base_url="https://api.test")


class TestDeployedBrowserOrigin:
    async def test_the_deployed_origin_passes_preflight_with_the_headers_it_sends(self) -> None:
        async with _browser(_probe_app(DEPLOYED_ORIGIN)) as client:
            r = await client.options(
                "/api/auth/refresh",
                headers={
                    "Origin": DEPLOYED_ORIGIN,
                    "Access-Control-Request-Method": "POST",
                    "Access-Control-Request-Headers": BROWSER_HEADERS,
                },
            )

        assert r.status_code == 200
        # Named back exactly, never "*": a credentialed request is dropped by the
        # browser if the wildcard comes back, however permissive it looks.
        assert r.headers["access-control-allow-origin"] == DEPLOYED_ORIGIN
        assert r.headers["access-control-allow-credentials"] == "true"
        allowed = r.headers["access-control-allow-headers"].lower()
        assert "authorization" in allowed
        assert "x-requested-with" in allowed

    async def test_the_cookie_comes_back_named_to_that_origin(self) -> None:
        async with _browser(_probe_app(DEPLOYED_ORIGIN)) as client:
            r = await client.post("/api/auth/refresh", headers={"Origin": DEPLOYED_ORIGIN})

        assert r.headers["access-control-allow-origin"] == DEPLOYED_ORIGIN
        assert r.headers["access-control-allow-credentials"] == "true"

    async def test_an_unlisted_origin_gets_no_credentialed_access(self) -> None:
        async with _browser(_probe_app(DEPLOYED_ORIGIN)) as client:
            preflight = await client.options(
                "/api/auth/refresh",
                headers={
                    "Origin": "https://attacker.example",
                    "Access-Control-Request-Method": "POST",
                    "Access-Control-Request-Headers": BROWSER_HEADERS,
                },
            )
            simple = await client.post("/api/auth/refresh", headers={"Origin": "https://attacker.example"})

        assert preflight.status_code == 400
        assert "access-control-allow-origin" not in preflight.headers
        # The body still comes back - CORS is enforced in the browser, not here -
        # but with no allow-origin header the browser never hands it to the page.
        assert "access-control-allow-origin" not in simple.headers

    async def test_retry_after_survives_the_trip_to_a_cross_origin_page(self) -> None:
        # Without expose_headers the browser hides it and every 429 the web app
        # shows loses its countdown (`ApiError.retryAfterSeconds`).
        async with _browser(_probe_app(DEPLOYED_ORIGIN)) as client:
            r = await client.post("/api/auth/refresh", headers={"Origin": DEPLOYED_ORIGIN})

        assert "Retry-After" in r.headers["access-control-expose-headers"]


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

        # Refused, but not out loud. This used to raise a 429, and that reply was
        # itself a directory lookup: only a registered number can spend the cap,
        # so an unregistered one answers 200 forever (CAR-60). What this test is
        # actually about is the bill, and that is unchanged — no sixth row.
        over = await auth_service.request_login_otp(db_session, phone)
        assert over.expires_in_seconds == settings.otp_ttl_seconds, "the answer must not change at the cap"

        issued = await db_session.scalar(
            select(OtpCode).where(OtpCode.phone == phone).order_by(OtpCode.created_at.desc())
        )
        assert issued is not None
        count = len((await db_session.scalars(select(OtpCode).where(OtpCode.phone == phone))).all())
        assert count == settings.otp_max_per_hour, "answering politely is not a licence to keep sending"
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


async def test_a_throttled_caller_is_answered_like_a_person(rate_limited: None, db_api_client: AsyncClient) -> None:
    """SlowAPI's own reply reached the user as-is, and it is not written for one.

    The mobile client renders `detail` verbatim, so the default
    "Rate limit exceeded: 5 per 1 minute" appeared on screen — developer wording,
    in English, in an app that is otherwise Hebrew. `Retry-After` also lets the
    client name the wait instead of guessing at it.
    """
    for _ in range(6):
        r = await db_api_client.post("/api/auth/otp/request", json={"phone": _phone()})

    assert r.status_code == 429
    assert "detail" in r.json(), "the client reads `detail`; `error` never reaches the screen"
    assert "Rate limit exceeded" not in r.json()["detail"]
    assert int(r.headers["retry-after"]) > 0


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


async def _spend_failures(client: AsyncClient, email: str, count: int) -> None:
    for _ in range(count):
        await client.post("/api/auth/login", json={"email": email, "password": "wrongpass"})


async def _seed_failures(db: AsyncSession, user_id: str, caller_ip: str, count: int) -> None:
    """Put a caller `count` failures deep without going through the door.

    Necessary whenever a test needs the wait to still be running after something
    slow happens in between — see `_PAST_THE_THRESHOLD` for why sending the
    requests cannot get you there.
    """
    db.add_all(LoginFailure(user_id=user_id, caller_ip=caller_ip, created_at=_now()) for _ in range(count))
    await db.commit()


# Enough requests to prove the gate engages — but note what it does *not* buy.
# An attempt made while the caller is already backed off skips `_reserve_attempt`'s
# insert, so it is never counted: sending nine of these leaves the tally at
# exactly `login_backoff_after` and the wait at one second, not the sixteen
# the arithmetic suggests. Fine for a test that checks the very next
# request; any test with a bcrypt in between must seed the rows instead
# (`_seed_failures`), or it passes or fails on how loaded the box is.
_PAST_THE_THRESHOLD = settings.login_backoff_after + 4


async def test_failures_from_many_addresses_still_lock_the_account(
    db_session: AsyncSession, client_from_ip: Callable[[str], AsyncClient]
) -> None:
    """The account-wide ceiling is the backstop against a guesser who rotates addresses.

    One address can never reach it — that caller is refused long before, at five.
    So this drives the account to the ceiling the only way anything can: from
    many addresses at once. Held at NIST's maximum of 100 rather than at ten,
    because closing the account is exactly what a stranger must not be able to do
    cheaply (CAR-51).
    """
    email = f"lock-{uuid.uuid4().hex[:8]}@carmatest.com"
    user = await _password_driver(db_session, email, "CorrectHorse1")
    try:
        db_session.add_all(
            LoginFailure(user_id=user.id, caller_ip=f"198.51.100.{n}", created_at=_now())
            for n in range(settings.account_lockout_after - 1)
        )
        await db_session.commit()

        last = client_from_ip("203.0.113.1")
        r = await last.post("/api/auth/login", json={"email": email, "password": "wrongpass"})
        assert r.status_code == 401

        await db_session.refresh(user)
        assert user.locked_until is not None, "the account-wide ceiling must still close the account"

        elsewhere = client_from_ip("203.0.113.2")
        blocked = await elsewhere.post("/api/auth/login", json={"email": email, "password": "CorrectHorse1"})
        assert blocked.status_code == 401, "the right password must not open a locked account"
    finally:
        await _cleanup_email(db_session, email)


async def test_signing_in_rewinds_the_account_wide_tally(
    db_session: AsyncSession, client_from_ip: Callable[[str], AsyncClient]
) -> None:
    """Without this the march to 100 never rewinds, and a patient guesser always arrives.

    One address spends about 17 failures an hour once the wait is doubling, so six
    networks reach the ceiling inside the window — the driver signing in daily
    changed nothing, because clearing was scoped to the address that succeeded.
    NIST SP 800-63B §5.2.2 disregards prior failures on a success; the guesser's
    own wait is untouched, which is the point.
    """
    email = f"rewind-{uuid.uuid4().hex[:8]}@carmatest.com"
    user = await _password_driver(db_session, email, "CorrectHorse1")
    try:
        await _seed_failures(db_session, user.id, "198.51.100.7", settings.account_lockout_after - 1)

        owner = client_from_ip("203.0.113.9")
        ok = await owner.post("/api/auth/login", json={"email": email, "password": "CorrectHorse1"})
        assert ok.status_code == 200

        # One more failure would have been the hundredth before this change.
        closer = client_from_ip("192.0.2.44")
        await closer.post("/api/auth/login", json={"email": email, "password": "wrongpass"})

        await db_session.refresh(user)
        assert user.locked_until is None, "a successful sign-in must rewind the account tally"
    finally:
        await _cleanup_email(db_session, email)


async def test_a_locked_account_does_not_eject_a_session_already_open(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    """The lock closes the doors; it must not throw out whoever is already inside.

    `locked_until` counts failed sign-ins, which say nothing about a session that
    was opened with the right credential. Honouring it on every authenticated
    request meant the residual attack logged a driver out mid-trip — losing the
    trip, which is the one thing this product exists to record.
    """
    email = f"session-{uuid.uuid4().hex[:8]}@carmatest.com"
    user = await _password_driver(db_session, email, "CorrectHorse1")
    try:
        signed_in = await db_api_client.post("/api/auth/login", json={"email": email, "password": "CorrectHorse1"})
        assert signed_in.status_code == 200
        token = signed_in.json()["token"]

        user.locked_until = _now() + timedelta(minutes=10)
        await db_session.commit()

        still = await db_api_client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert still.status_code == 200, "a lock on the front door must not end a live session"

        refused = await db_api_client.post("/api/auth/login", json={"email": email, "password": "CorrectHorse1"})
        assert refused.status_code == 401, "the door itself stays shut"
    finally:
        await _cleanup_email(db_session, email)


async def test_a_successful_login_clears_the_callers_count(
    db_session: AsyncSession, client_from_ip: Callable[[str], AsyncClient]
) -> None:
    """Otherwise four typos spread over a month would eventually hold a real driver back.

    Signing in twice with four misses either side is the discriminator: if the
    first four had carried over, the eight would put this caller inside a wait
    and the second success would be a 401 instead.
    """
    email = f"clear-{uuid.uuid4().hex[:8]}@carmatest.com"
    await _password_driver(db_session, email, "CorrectHorse1")
    driver = client_from_ip("203.0.113.9")
    try:
        await _spend_failures(driver, email, settings.login_backoff_after - 1)
        first = await driver.post("/api/auth/login", json={"email": email, "password": "CorrectHorse1"})
        assert first.status_code == 200

        await _spend_failures(driver, email, settings.login_backoff_after - 1)
        second = await driver.post("/api/auth/login", json={"email": email, "password": "CorrectHorse1"})
        assert second.status_code == 200, "the count should have restarted, not carried over into a wait"
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
    user = await _password_driver(db_session, known, "CorrectHorse1")
    try:
        user.locked_until = _now() + timedelta(minutes=10)
        await db_session.commit()

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


# ─── 7. the wait lands on the guesser, not on the driver ─────────────────────


def test_the_wait_doubles_and_stops_at_the_cap() -> None:
    """The arithmetic, pinned without a database or a clock.

    Also the only test in this section CI runs on `develop` — everything below
    needs Postgres and skips itself without one.
    """
    after = settings.login_backoff_after
    assert auth_service._backoff_seconds(0) == 0
    assert auth_service._backoff_seconds(after - 1) == 0, "below the threshold nobody waits"
    assert auth_service._backoff_seconds(after) == 1
    assert auth_service._backoff_seconds(after + 1) == 2
    assert auth_service._backoff_seconds(after + 2) == 4
    assert auth_service._backoff_seconds(after + 3) == 8
    assert auth_service._backoff_seconds(after + 60) == settings.login_backoff_max_seconds
    assert auth_service._backoff_seconds(500) == settings.login_backoff_max_seconds, "no runaway exponent"


@asynccontextmanager
async def _concurrent_sessions(n: int) -> AsyncIterator[list[AsyncSession]]:
    """`n` independent connections — real concurrency, not one connection queuing.

    Modeled on `test_points_atomicity._rival_session`: each racer needs its own
    engine, or overlapping coroutines on a shared connection just serialise on
    the connection itself and prove nothing about the row lock.
    """
    engines = [create_async_engine(settings.database_url, pool_pre_ping=True) for _ in range(n)]
    sessions = [async_sessionmaker(e, expire_on_commit=False, class_=AsyncSession)() for e in engines]
    try:
        yield sessions
    finally:
        for session in sessions:
            await session.close()
        for engine in engines:
            await engine.dispose()


@pytest.mark.asyncio
async def test_a_concurrent_pair_at_the_threshold_does_not_both_slip_through(db_session: AsyncSession) -> None:
    """CAR-130: two guesses landing at once must cost what two guesses landing apart would.

    Seeded one short of the threshold, so — sequentially — the next guess is the
    one that first sees a wait (`_backoff_seconds(after) == 1`), and the one
    after that is refused before it can add a row. The bug this guards: without
    a lock serialising them, two concurrent guesses at that exact boundary both
    read `failures == after - 1` before either commits, both compute the same
    "no wait yet", and both insert — the burst grows the tally by two instead of
    one, and both callers are told they may try again immediately. Deliberately
    only two racers, not a longer burst: `_backoff_seconds` doubles per miss, so
    a burst long enough to also test the second and third waits would need those
    waits to still be pending by the time real round trips for every racer have
    finished, which is exactly the kind of timing assumption `_seed_failures`
    exists to avoid (see `_PAST_THE_THRESHOLD`).
    """
    after = settings.login_backoff_after
    email = f"pair-{uuid.uuid4().hex[:8]}@carmatest.com"
    user = await _password_driver(db_session, email, "CorrectHorse1")
    caller_ip = "198.51.100.44"
    try:
        await _seed_failures(db_session, user.id, caller_ip, after - 1)

        async with _concurrent_sessions(2) as sessions:
            racer_users = [await session.get(User, user.id) for session in sessions]
            for racer in racer_users:
                assert racer is not None
            results = await asyncio.gather(
                *(
                    auth_service._reserve_attempt(session, racer, caller_ip)
                    for session, racer in zip(sessions, racer_users, strict=True)
                )
            )

        reserved = sum(1 for backed_off in results if not backed_off)
        assert reserved == 1, f"exactly one of the pair may cross the threshold and reserve, got {reserved}"

        rows = await db_session.scalar(
            select(func.count())
            .select_from(LoginFailure)
            .where(LoginFailure.user_id == user.id, LoginFailure.caller_ip == caller_ip)
        )
        assert rows == after, "the row lock must leave the same count two sequential guesses would"
    finally:
        await _cleanup_email(db_session, email)


async def test_the_owner_can_still_log_in_while_a_guesser_is_backed_off(
    db_session: AsyncSession, client_from_ip: Callable[[str], AsyncClient]
) -> None:
    """CAR-51, in one test.

    Before this, ten wrong passwords from a stranger shut the account for
    everyone — the owner included — for fifteen minutes, and the stranger only
    needed to know an email address. The wait belongs to whoever is guessing.
    """
    email = f"guessed-{uuid.uuid4().hex[:8]}@carmatest.com"
    await _password_driver(db_session, email, "CorrectHorse1")
    guesser = client_from_ip("198.51.100.7")
    owner = client_from_ip("203.0.113.9")
    try:
        await _spend_failures(guesser, email, _PAST_THE_THRESHOLD)

        refused = await guesser.post("/api/auth/login", json={"email": email, "password": "CorrectHorse1"})
        assert refused.status_code == 401, "the guesser is waiting, right password or not"

        allowed = await owner.post("/api/auth/login", json={"email": email, "password": "CorrectHorse1"})
        assert allowed.status_code == 200, "the owner must not pay for someone else's guessing"
        assert allowed.json()["token"]
    finally:
        await _cleanup_email(db_session, email)


async def test_the_backoff_refusal_is_indistinguishable_from_a_wrong_password(
    db_session: AsyncSession, client_from_ip: Callable[[str], AsyncClient]
) -> None:
    """A 429 or a Retry-After here would re-open the oracle #23 closed.

    Both would tell an unauthenticated caller that the account exists — the same
    two-step test the old 403 gave away, rebuilt out of a status code.
    """
    known = f"waited-{uuid.uuid4().hex[:8]}@carmatest.com"
    unknown = f"nobody-{uuid.uuid4().hex[:8]}@carmatest.com"
    await _password_driver(db_session, known, "CorrectHorse1")
    guesser = client_from_ip("198.51.100.7")
    fresh = client_from_ip("203.0.113.9")
    try:
        await _spend_failures(guesser, known, _PAST_THE_THRESHOLD)

        waited = await guesser.post("/api/auth/login", json={"email": known, "password": "wrongpass"})
        stranger = await fresh.post("/api/auth/login", json={"email": unknown, "password": "wrongpass"})

        assert waited.status_code == stranger.status_code == 401
        assert waited.json()["detail"] == stranger.json()["detail"]
        assert "retry-after" not in waited.headers, "a wait must not announce itself"
    finally:
        await _cleanup_email(db_session, known)


async def test_the_backoff_follows_the_account_and_the_address_together(
    db_session: AsyncSession, client_from_ip: Callable[[str], AsyncClient]
) -> None:
    """Keyed on the address alone, one guesser would hold back a whole carrier NAT.

    Thousands of real drivers share an address behind CGNAT, so the pair is what
    has to match — burning the budget on one account leaves the next one open.
    """
    victim = f"victim-{uuid.uuid4().hex[:8]}@carmatest.com"
    bystander = f"bystander-{uuid.uuid4().hex[:8]}@carmatest.com"
    await _password_driver(db_session, victim, "CorrectHorse1")
    await _password_driver(db_session, bystander, "CorrectHorse1")
    shared = client_from_ip("198.51.100.7")
    try:
        await _spend_failures(shared, victim, _PAST_THE_THRESHOLD)

        allowed = await shared.post("/api/auth/login", json={"email": bystander, "password": "CorrectHorse1"})
        assert allowed.status_code == 200, "a wait on one account must not reach the next"
    finally:
        await _cleanup_email(db_session, victim)
        await _cleanup_email(db_session, bystander)


async def test_a_success_from_one_address_leaves_another_address_waiting(
    db_session: AsyncSession, client_from_ip: Callable[[str], AsyncClient]
) -> None:
    """Clearing every address on success would hand the guesser a free reset.

    They would only have to wait for the real driver to sign in — which, for an
    app opened every drive, is not much of a wait at all.
    """
    email = f"scoped-{uuid.uuid4().hex[:8]}@carmatest.com"
    user = await _password_driver(db_session, email, "CorrectHorse1")
    guesser = client_from_ip("198.51.100.7")
    owner = client_from_ip("203.0.113.9")
    try:
        # Seeded, not sent: the owner's bcrypt sits between the guesser's last
        # failure and the check below, and a wait earned through the door is
        # only a second long.
        await _seed_failures(db_session, user.id, "198.51.100.7", _PAST_THE_THRESHOLD)

        ok = await owner.post("/api/auth/login", json={"email": email, "password": "CorrectHorse1"})
        assert ok.status_code == 200

        still = await guesser.post("/api/auth/login", json={"email": email, "password": "CorrectHorse1"})
        assert still.status_code == 401, "the owner signing in must not clear the guesser's slate"
    finally:
        await _cleanup_email(db_session, email)


async def test_failures_older_than_the_window_do_not_hold_a_caller_back(
    db_session: AsyncSession, client_from_ip: Callable[[str], AsyncClient]
) -> None:
    """The count rolls. A driver who fumbled last night starts today at zero."""
    email = f"window-{uuid.uuid4().hex[:8]}@carmatest.com"
    user = await _password_driver(db_session, email, "CorrectHorse1")
    driver = client_from_ip("203.0.113.9")
    try:
        db_session.add_all(
            LoginFailure(user_id=user.id, caller_ip="203.0.113.9", created_at=_now() - timedelta(hours=2))
            for _ in range(_PAST_THE_THRESHOLD)
        )
        await db_session.commit()

        ok = await driver.post("/api/auth/login", json={"email": email, "password": "CorrectHorse1"})
        assert ok.status_code == 200, "failures outside the window must not count"
    finally:
        await _cleanup_email(db_session, email)


async def test_stale_failure_rows_are_swept_on_the_next_failure(
    db_session: AsyncSession, client_from_ip: Callable[[str], AsyncClient]
) -> None:
    """Nothing runs on a timer here, so the sweep rides along with a write we make anyway.

    It is scoped to the account rather than to the address, so rows left behind
    by an attacker who has moved on still get cleared.
    """
    email = f"sweep-{uuid.uuid4().hex[:8]}@carmatest.com"
    user = await _password_driver(db_session, email, "CorrectHorse1")
    try:
        db_session.add_all(
            LoginFailure(user_id=user.id, caller_ip="198.51.100.7", created_at=_now() - timedelta(hours=2))
            for _ in range(3)
        )
        await db_session.commit()

        elsewhere = client_from_ip("203.0.113.9")
        await elsewhere.post("/api/auth/login", json={"email": email, "password": "wrongpass"})

        rows = await db_session.scalar(
            select(func.count()).select_from(LoginFailure).where(LoginFailure.user_id == user.id)
        )
        assert rows == 1, "the stale rows should be gone, the new one kept"
    finally:
        await _cleanup_email(db_session, email)


async def test_the_table_does_not_grow_forever(
    db_session: AsyncSession, client_from_ip: Callable[[str], AsyncClient]
) -> None:
    """Rows outlive their purpose by an hour at most, whoever they belong to.

    The sweep is not scoped to the account being signed into, and it rides the
    success path as well as the failure path. So an account that was attacked
    once and never touched again does not keep the attacker's addresses — some
    *other* driver signing in is enough to clear them. Without that, the only
    thing pruning the table would be more failures against the same account,
    which is exactly the case that stops happening.
    """
    attacked = f"gone-{uuid.uuid4().hex[:8]}@carmatest.com"
    unrelated = f"other-{uuid.uuid4().hex[:8]}@carmatest.com"
    victim = await _password_driver(db_session, attacked, "CorrectHorse1")
    await _password_driver(db_session, unrelated, "CorrectHorse1")
    try:
        db_session.add_all(
            LoginFailure(user_id=victim.id, caller_ip=f"198.51.100.{n}", created_at=_now() - timedelta(hours=2))
            for n in range(20)
        )
        await db_session.commit()

        # A different driver, a different address, and a *successful* sign-in.
        passerby = client_from_ip("203.0.113.9")
        ok = await passerby.post("/api/auth/login", json={"email": unrelated, "password": "CorrectHorse1"})
        assert ok.status_code == 200

        left = await db_session.scalar(
            select(func.count()).select_from(LoginFailure).where(LoginFailure.user_id == victim.id)
        )
        assert left == 0, "expired rows must not depend on their own account coming back"
    finally:
        await _cleanup_email(db_session, attacked)
        await _cleanup_email(db_session, unrelated)


async def test_the_otp_door_backs_off_the_same_caller(
    db_session: AsyncSession, client_from_ip: Callable[[str], AsyncClient]
) -> None:
    """Both doors, one control — and the OTP door's wording does not change either."""
    phone = _phone()
    await _registered_driver(db_session, phone)
    guesser = client_from_ip("198.51.100.7")
    owner = client_from_ip("203.0.113.9")
    try:
        db_session.add(
            OtpCode(
                phone=phone,
                code_hash=hash_code("123456"),
                purpose=OTP_PURPOSE,
                expires_at=_now() + timedelta(minutes=5),
            )
        )
        await db_session.commit()

        for _ in range(_PAST_THE_THRESHOLD):
            await guesser.post("/api/auth/otp/verify", json={"phone": phone, "code": "000000"})

        refused = await guesser.post("/api/auth/otp/verify", json={"phone": phone, "code": "123456"})
        assert refused.status_code == 401
        assert refused.json()["detail"] == auth_service.OTP_REJECTED

        allowed = await owner.post("/api/auth/otp/verify", json={"phone": phone, "code": "123456"})
        assert allowed.status_code == 200, "the owner's code still works from the owner's phone"
    finally:
        await _cleanup(db_session, phone)


async def test_locking_the_account_does_not_hand_the_guesser_a_fresh_allowance(
    db_session: AsyncSession, client_from_ip: Callable[[str], AsyncClient]
) -> None:
    """Reopening the account must not reopen every address that closed it.

    The account tally has to restart, or the first failure after the fifteen
    minutes re-locks on rows that are still inside the window. Doing that by
    deleting the rows would also clear each address's backoff — so a guesser
    holding twenty addresses would get five free guesses back every time they
    tripped the lock, and the wait would never engage at all.
    """
    email = f"relock-{uuid.uuid4().hex[:8]}@carmatest.com"
    user = await _password_driver(db_session, email, "CorrectHorse1")
    guesser = client_from_ip("198.51.100.7")
    try:
        # This address is already past its threshold, and the account is one
        # failure short of the ceiling.
        db_session.add_all(
            LoginFailure(user_id=user.id, caller_ip="198.51.100.7", created_at=_now())
            for _ in range(_PAST_THE_THRESHOLD)
        )
        db_session.add_all(
            LoginFailure(user_id=user.id, caller_ip=f"203.0.113.{n}", created_at=_now())
            for n in range(settings.account_lockout_after - _PAST_THE_THRESHOLD - 1)
        )
        await db_session.commit()

        closer = client_from_ip("192.0.2.44")
        await closer.post("/api/auth/login", json={"email": email, "password": "wrongpass"})

        await db_session.refresh(user)
        assert user.locked_until is not None, "the ceiling should have closed the account"
        assert user.lockout_reset_at is not None, "the tally needs a restart point"

        # Reopen the account the way waiting out the lock would.
        user.locked_until = None
        await db_session.commit()

        still = await guesser.post("/api/auth/login", json={"email": email, "password": "CorrectHorse1"})
        assert still.status_code == 401, "the lock must not have cleared the guesser's backoff"

        rows = await db_session.scalar(
            select(func.count()).select_from(LoginFailure).where(LoginFailure.user_id == user.id)
        )
        assert rows and rows >= _PAST_THE_THRESHOLD, "the per-address history must survive the lock"
    finally:
        await _cleanup_email(db_session, email)


async def test_one_ipv6_machine_cannot_rotate_out_of_its_backoff(
    db_session: AsyncSession, client_from_ip: Callable[[str], AsyncClient]
) -> None:
    """A routed /64 is one machine, not 2**64 callers.

    Counting the full address made the backoff free to walk away from — bind a
    new address, get a new allowance — and twenty of those reach the account
    ceiling in seconds, which is the CAR-51 lockout all over again.
    """
    email = f"sixer-{uuid.uuid4().hex[:8]}@carmatest.com"
    await _password_driver(db_session, email, "CorrectHorse1")
    try:
        for n in range(_PAST_THE_THRESHOLD):
            rotating = client_from_ip(f"2001:db8:abcd:1234::{n + 1:x}")
            await rotating.post("/api/auth/login", json={"email": email, "password": "wrongpass"})

        nextone = client_from_ip("2001:db8:abcd:1234::ffff")
        refused = await nextone.post("/api/auth/login", json={"email": email, "password": "CorrectHorse1"})
        assert refused.status_code == 401, "a new address in the same /64 is the same caller"

        elsewhere = client_from_ip("2001:db8:abcd:9999::1")
        allowed = await elsewhere.post("/api/auth/login", json={"email": email, "password": "CorrectHorse1"})
        assert allowed.status_code == 200, "a genuinely different network is a different caller"
    finally:
        await _cleanup_email(db_session, email)


async def test_the_forwarded_address_is_what_counts_behind_a_proxy(
    db_session: AsyncSession, client_from_ip: Callable[[str], AsyncClient], monkeypatch: pytest.MonkeyPatch
) -> None:
    """Reading the socket peer would put every driver in one bucket.

    Behind the Azure ingress every request arrives from the same address, so a
    backoff keyed on `request.client.host` would let any guesser lock out every
    driver at once — the original bug, made worse. `client_ip` walks
    `X-Forwarded-For` instead.
    """
    monkeypatch.setattr(settings, "trusted_proxy_count", 1)
    email = f"proxied-{uuid.uuid4().hex[:8]}@carmatest.com"
    await _password_driver(db_session, email, "CorrectHorse1")
    ingress = client_from_ip("10.0.0.9")
    try:
        for _ in range(_PAST_THE_THRESHOLD):
            await ingress.post(
                "/api/auth/login",
                json={"email": email, "password": "wrongpass"},
                headers={"X-Forwarded-For": "198.51.100.7"},
            )

        allowed = await ingress.post(
            "/api/auth/login",
            json={"email": email, "password": "CorrectHorse1"},
            headers={"X-Forwarded-For": "203.0.113.9"},
        )
        assert allowed.status_code == 200, "the same ingress, a different driver — not the same bucket"
    finally:
        await _cleanup_email(db_session, email)
