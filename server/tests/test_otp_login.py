"""CAR-265 — phone + OTP sign-in for the business web app.

`POST /api/auth/otp/login` is the door an approved, phone-only business owner
(created by CAR-203, approved by CAR-77) actually has: `SignInPage` otherwise
only ever collected email + password. It shares its identity check with
CAR-203's existing `/api/auth/otp/verify` (`services.auth._verify_login_otp`)
and diverges only in what a correct code buys — a real CAR-217 browser
session (rotating httpOnly refresh cookie, short-lived access token) instead
of `otp/verify`'s bare JWT.

These tests hold:

  * a correct code establishes the identical CAR-217 session a password login
    does — httpOnly cookie, short web TTL for a browser caller, unchanged
    long TTL for a mobile-style caller;
  * the session it mints refreshes and logs out exactly like a password
    session, because it is one;
  * the identity check itself (locked account, backoff, expired/wrong code)
    answers exactly like `otp/verify`'s, since both run `_verify_login_otp`;
  * no second `User` row is ever created for a phone this door already knows —
    the one-account invariant CAR-203 relies on;
  * an approved business owner who signs in this way lands in the same
    business membership context (CAR-74) a password sign-in would.

Needs a real database — see conftest.db_session — and skips without one.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from httpx import AsyncClient
from jose import jwt
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.security import JWT_ALGO, hash_code
from app.models import Business, BusinessJoinRequest, BusinessMembership, OtpCode, RefreshToken, User
from app.models.enums import BusinessCategory, BusinessJoinRequestStatus, UserRole
from app.services import business_join_requests as join_requests_service
from app.services.auth import OTP_PURPOSE, REFRESH_COOKIE_NAME

LOGIN_URL = "/api/auth/otp/login"
BROWSER_HEADERS = {"X-Requested-With": "XMLHttpRequest"}


def _phone() -> str:
    return f"+9725{uuid.uuid4().int % 10**8:08d}"


def _reg_number() -> str:
    return f"REG-{uuid.uuid4().hex[:10]}"


async def _seed_user(db: AsyncSession, phone: str, **overrides: object) -> User:
    defaults: dict[str, object] = {
        "id": uuid.uuid4().hex,
        "phone": phone,
        "name": "Phone Owner",
        "role": UserRole.DRIVER,
        "is_phone_verified": True,
    }
    defaults.update(overrides)
    user = User(**defaults)
    db.add(user)
    await db.commit()
    return user


async def _seed_code(db: AsyncSession, phone: str, code: str, *, ttl_minutes: int = 5) -> None:
    db.add(
        OtpCode(
            phone=phone,
            code_hash=hash_code(code),
            purpose=OTP_PURPOSE,
            expires_at=datetime.now(UTC) + timedelta(minutes=ttl_minutes),
        )
    )
    await db.commit()


def _decode(token: str) -> dict:
    return jwt.decode(token, settings.jwt_secret, algorithms=[JWT_ALGO])


async def _cleanup(db: AsyncSession, *phones: str) -> None:
    users = (await db.scalars(select(User).where(User.phone.in_(phones)))).all()
    user_ids = [u.id for u in users]
    if user_ids:
        await db.execute(delete(BusinessMembership).where(BusinessMembership.user_id.in_(user_ids)))
        await db.execute(delete(Business).where(Business.owner_user_id.in_(user_ids)))
        await db.execute(delete(BusinessJoinRequest).where(BusinessJoinRequest.applicant_user_id.in_(user_ids)))
    await db.execute(delete(OtpCode).where(OtpCode.phone.in_(phones)))
    await db.execute(delete(User).where(User.phone.in_(phones)))
    await db.commit()


# ─── a correct code establishes the same CAR-217 session a password login does ─


async def test_correct_code_sets_an_httponly_refresh_cookie(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    phone = _phone()
    await _seed_user(db_session, phone)
    try:
        await _seed_code(db_session, phone, "112233")
        r = await db_api_client.post(LOGIN_URL, json={"phone": phone, "code": "112233"}, headers=BROWSER_HEADERS)
        assert r.status_code == 200, r.text

        set_cookie = r.headers.get("set-cookie", "")
        assert REFRESH_COOKIE_NAME in set_cookie
        assert "httponly" in set_cookie.lower()

        row = await db_session.scalar(select(RefreshToken).where(RefreshToken.user_id == r.json()["user"]["id"]))
        assert row is not None
        assert row.revoked_at is None
    finally:
        await _cleanup(db_session, phone)


async def test_browser_caller_gets_the_short_web_ttl_on_the_first_token(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    phone = _phone()
    await _seed_user(db_session, phone)
    try:
        await _seed_code(db_session, phone, "223344")
        r = await db_api_client.post(LOGIN_URL, json={"phone": phone, "code": "223344"}, headers=BROWSER_HEADERS)
        assert r.status_code == 200, r.text

        payload = _decode(r.json()["token"])
        lifetime = payload["exp"] - payload["iat"]
        assert lifetime == settings.web_access_token_expires_minutes * 60
    finally:
        await _cleanup(db_session, phone)


async def test_a_mobile_style_call_keeps_the_long_lived_token(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    """No `X-Requested-With` — exactly mobile's `client.ts`. This door must not
    change mobile's existing phone+OTP contract, unchanged `JWT_EXPIRES_MINUTES`."""
    phone = _phone()
    await _seed_user(db_session, phone)
    try:
        await _seed_code(db_session, phone, "334455")
        r = await db_api_client.post(LOGIN_URL, json={"phone": phone, "code": "334455"})
        assert r.status_code == 200, r.text

        payload = _decode(r.json()["token"])
        lifetime = payload["exp"] - payload["iat"]
        assert lifetime == settings.jwt_expires_minutes * 60
    finally:
        await _cleanup(db_session, phone)


async def test_the_session_it_mints_can_be_refreshed_and_logged_out(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    phone = _phone()
    await _seed_user(db_session, phone)
    try:
        await _seed_code(db_session, phone, "445566")
        login = await db_api_client.post(LOGIN_URL, json={"phone": phone, "code": "445566"}, headers=BROWSER_HEADERS)
        assert login.status_code == 200

        refreshed = await db_api_client.post("/api/auth/refresh", headers=BROWSER_HEADERS)
        assert refreshed.status_code == 200
        assert refreshed.json()["user"]["id"] == login.json()["user"]["id"]

        out = await db_api_client.post("/api/auth/logout", headers=BROWSER_HEADERS)
        assert out.status_code == 200

        again = await db_api_client.post("/api/auth/refresh", headers=BROWSER_HEADERS)
        assert again.status_code == 401, "logout must end the session this door minted, same as a password one"
    finally:
        await _cleanup(db_session, phone)


# ─── the identity check itself matches `otp/verify`'s ────────────────────────


async def test_unknown_phone_is_rejected(db_api_client: AsyncClient) -> None:
    r = await db_api_client.post(LOGIN_URL, json={"phone": _phone(), "code": "000000"}, headers=BROWSER_HEADERS)
    assert r.status_code == 401


async def test_wrong_code_is_rejected(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    phone = _phone()
    await _seed_user(db_session, phone)
    try:
        await _seed_code(db_session, phone, "556677")
        r = await db_api_client.post(LOGIN_URL, json={"phone": phone, "code": "000000"}, headers=BROWSER_HEADERS)
        assert r.status_code == 401
    finally:
        await _cleanup(db_session, phone)


async def test_expired_code_is_rejected(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    phone = _phone()
    await _seed_user(db_session, phone)
    try:
        await _seed_code(db_session, phone, "667788", ttl_minutes=-1)
        r = await db_api_client.post(LOGIN_URL, json={"phone": phone, "code": "667788"}, headers=BROWSER_HEADERS)
        assert r.status_code == 401
    finally:
        await _cleanup(db_session, phone)


async def test_a_locked_account_is_rejected_like_any_other_failure(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    phone = _phone()
    await _seed_user(db_session, phone, locked_until=datetime.now(UTC) + timedelta(minutes=30))
    try:
        await _seed_code(db_session, phone, "778899")
        r = await db_api_client.post(LOGIN_URL, json={"phone": phone, "code": "778899"}, headers=BROWSER_HEADERS)
        assert r.status_code == 401
    finally:
        await _cleanup(db_session, phone)


async def test_no_cookie_is_set_when_the_code_is_wrong(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    phone = _phone()
    await _seed_user(db_session, phone)
    try:
        await _seed_code(db_session, phone, "889900")
        r = await db_api_client.post(LOGIN_URL, json={"phone": phone, "code": "000000"}, headers=BROWSER_HEADERS)
        assert r.status_code == 401
        assert REFRESH_COOKIE_NAME not in r.headers.get("set-cookie", "")
    finally:
        await _cleanup(db_session, phone)


# ─── the one-account-per-phone invariant (CAR-203) holds through this door ───


async def test_signing_in_never_creates_a_second_user_for_the_same_phone(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    phone = _phone()
    original = await _seed_user(db_session, phone)
    try:
        await _seed_code(db_session, phone, "990011")
        r = await db_api_client.post(LOGIN_URL, json={"phone": phone, "code": "990011"}, headers=BROWSER_HEADERS)
        assert r.status_code == 200, r.text
        assert r.json()["user"]["id"] == original.id

        users = (await db_session.scalars(select(User).where(User.phone == phone))).all()
        assert len(users) == 1, "one code exchange must never mint a second User row for this phone"
    finally:
        await _cleanup(db_session, phone)


# ─── end to end: an approved business owner reaches business context ────────


async def test_an_approved_phone_only_owner_signs_in_and_reaches_owner_scoped_routes(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    """The gap CAR-265 exists to close: a `User` created by CAR-203's phone+OTP
    registration, approved by CAR-77 (owner_user_id set, role -> BUSINESS, an
    OWNER `BusinessMembership` row), now has a working way to sign in — and the
    session it gets resolves the exact same business context (CAR-74) a
    password sign-in would, because `current_business` reads
    `business_memberships`, never how the session was established."""
    phone = _phone()
    applicant = await _seed_user(db_session, phone, name="Approved Owner")
    admin = await _seed_user(db_session, _phone(), name="Admin", role=UserRole.ADMIN)
    try:
        request = BusinessJoinRequest(
            applicant_user_id=applicant.id,
            phone=phone,
            name="Test Cafe",
            name_he="בית קפה בדיקה",
            category=BusinessCategory.FOOD,
            location_lat=32.07,
            location_lng=34.78,
            address="1 Test St",
            registration_number=_reg_number(),
            contact_person="Dana Test",
            status=BusinessJoinRequestStatus.PENDING,
        )
        db_session.add(request)
        await db_session.commit()
        await db_session.refresh(request)

        await join_requests_service.approve(db_session, admin, request.id)

        await _seed_code(db_session, phone, "111222")
        signed_in = await db_api_client.post(
            LOGIN_URL, json={"phone": phone, "code": "111222"}, headers=BROWSER_HEADERS
        )
        assert signed_in.status_code == 200, signed_in.text
        assert signed_in.json()["user"]["role"] == "BUSINESS"

        access_token = signed_in.json()["token"]
        members = await db_api_client.get(
            "/api/business/members", headers={"Authorization": f"Bearer {access_token}", **BROWSER_HEADERS}
        )
        assert members.status_code == 200, members.text
        assert any(m["userId"] == applicant.id for m in members.json()["members"])
    finally:
        await _cleanup(db_session, phone, admin.phone)  # type: ignore[arg-type]
