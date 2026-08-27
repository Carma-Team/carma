"""CAR-42 — accept a business join request and store it PENDING.

The endpoint trusts exactly one thing about a phone: `User.is_phone_verified`,
set only by `services.auth.verify_otp`. Everything here proves that boundary
end to end through the real `/api/auth/otp/*` routes rather than faking a
verified flag directly, plus the two duplicate-prevention rules (one live
request per applicant, one live request per business) and the read-only status
endpoint that must never leak into business access.

Needs a real database — see conftest.db_session — and skips without one.
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from httpx import AsyncClient, Response
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings
from app.core.security import create_access_token, hash_code
from app.models import Business, BusinessJoinRequest, BusinessJoinRequestStatus, OtpCode, User
from app.models.enums import UserRole
from app.schemas.business_join_request import BusinessJoinRequestIn
from app.services import business_join_requests as svc
from app.services.auth import OTP_PURPOSE

JOIN_URL = "/api/business/join-requests"
STATUS_URL = "/api/business/join-requests/me"


def _phone() -> str:
    return f"+9725{uuid.uuid4().int % 10**8:08d}"


def _reg_number() -> str:
    return f"REG-{uuid.uuid4().hex[:10]}"


def _payload(**overrides: object) -> dict[str, object]:
    body: dict[str, object] = {
        "name": "Test Cafe",
        "nameHe": "בית קפה בדיקה",
        "category": "food",
        "locationLat": 32.07,
        "locationLng": 34.78,
        "address": "1 Test St",
        "registrationNumber": _reg_number(),
        "contactPerson": "Dana Test",
    }
    body.update(overrides)
    return body


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


async def _verified_token(db: AsyncSession, client: AsyncClient, phone: str, *, code: str = "445566") -> str:
    """Real two-step flow: otp/register then otp/verify, exactly what CAR-203's
    web form will call before it ever reaches CAR-42's endpoint."""
    r = await client.post("/api/auth/otp/register", json={"phone": phone, "name": "Applicant"})
    assert r.status_code == 200, r.text
    await _seed_code(db, phone, code)
    r = await client.post("/api/auth/otp/verify", json={"phone": phone, "code": code})
    assert r.status_code == 200, r.text
    token: str = r.json()["token"]
    return token


async def _relogin_token(db: AsyncSession, client: AsyncClient, phone: str, *, code: str = "778899") -> str:
    """A second OTP round-trip for an already-verified phone — proves reuse of
    the existing user rather than minting a token by hand."""
    r = await client.post("/api/auth/otp/request", json={"phone": phone})
    assert r.status_code == 200, r.text
    await _seed_code(db, phone, code)
    r = await client.post("/api/auth/otp/verify", json={"phone": phone, "code": code})
    assert r.status_code == 200, r.text
    token: str = r.json()["token"]
    return token


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _submit(client: AsyncClient, token: str, **overrides: object) -> Response:
    return await client.post(JOIN_URL, json=_payload(**overrides), headers=_auth(token))


async def _cleanup(db: AsyncSession, *phones: str) -> None:
    await db.execute(delete(BusinessJoinRequest).where(BusinessJoinRequest.phone.in_(phones)))
    await db.execute(delete(OtpCode).where(OtpCode.phone.in_(phones)))
    await db.execute(delete(User).where(User.phone.in_(phones)))
    await db.commit()


# ── Auth gate (no DB) ───────────────────────────────────────────────────────


@pytest.mark.asyncio
@pytest.mark.parametrize(("method", "path"), [("POST", JOIN_URL), ("GET", STATUS_URL)])
async def test_join_request_endpoints_require_auth(api_client: AsyncClient, method: str, path: str) -> None:
    r = await api_client.request(method, path, json=_payload() if method == "POST" else None)
    assert r.status_code == 401, f"{method} {path} must reject anonymous callers"


# ── Phone verification is the only trusted signal ───────────────────────────


@pytest.mark.asyncio
async def test_unverified_user_cannot_submit(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    phone = _phone()
    user = User(id=uuid.uuid4().hex, phone=phone, name="Unverified", role=UserRole.DRIVER, is_phone_verified=False)
    db_session.add(user)
    await db_session.commit()
    # A real JWT for a real account — the only thing missing is verification.
    token = create_access_token(user_id=user.id, email=None, phone=phone, role=UserRole.DRIVER)
    try:
        r = await db_api_client.post(JOIN_URL, json=_payload(), headers=_auth(token))
        assert r.status_code == 403, r.text

        rows = (await db_session.scalars(select(BusinessJoinRequest).where(BusinessJoinRequest.phone == phone))).all()
        assert rows == [], "no request may be stored for an unverified phone"
    finally:
        await _cleanup(db_session, phone)


# ── The flow the ticket is about ────────────────────────────────────────────


@pytest.mark.asyncio
async def test_verified_new_phone_creates_user_and_pending_request(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    phone = _phone()
    try:
        token = await _verified_token(db_session, db_api_client, phone)

        r = await db_api_client.post(JOIN_URL, json=_payload(), headers=_auth(token))
        assert r.status_code == 201, r.text
        assert r.json()["status"] == "pending"

        users = (await db_session.scalars(select(User).where(User.phone == phone))).all()
        assert len(users) == 1, "exactly one account for this phone"

        requests = (
            await db_session.scalars(
                select(BusinessJoinRequest).where(BusinessJoinRequest.applicant_user_id == users[0].id)
            )
        ).all()
        assert len(requests) == 1
        assert requests[0].status == BusinessJoinRequestStatus.PENDING
        assert requests[0].phone == phone, "phone is copied from the verified user, not re-typed by the client"

        businesses = (await db_session.scalars(select(Business).where(Business.owner_user_id == users[0].id))).all()
        assert businesses == [], "submitting a request must not create a Business row"
    finally:
        await _cleanup(db_session, phone)


@pytest.mark.asyncio
async def test_verified_existing_phone_reuses_the_same_user(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    phone = _phone()
    try:
        await _verified_token(db_session, db_api_client, phone)
        first_user_id = (await db_session.scalar(select(User).where(User.phone == phone))).id  # type: ignore[union-attr]

        # A second, independent OTP round-trip against the same, already-verified phone.
        second_token = await _relogin_token(db_session, db_api_client, phone)

        r = await db_api_client.post(JOIN_URL, json=_payload(), headers=_auth(second_token))
        assert r.status_code == 201, r.text

        users = (await db_session.scalars(select(User).where(User.phone == phone))).all()
        assert len(users) == 1, "a second verification round must not mint a duplicate account"
        assert users[0].id == first_user_id

        request = await db_session.scalar(
            select(BusinessJoinRequest).where(BusinessJoinRequest.applicant_user_id == first_user_id)
        )
        assert request is not None
        assert request.applicant_user_id == first_user_id

        # Proof that this was a genuine second round-trip rather than a reused
        # session: the server issues exactly one OtpCode row per `_issue_otp`
        # call — one from otp/register, one from otp/request — so 4 rows exist
        # total once the 2 this test seeded on top are counted. (Not
        # `first_token != second_token` — create_access_token's `iat`/`exp` are
        # second-granularity, so two round-trips completing within the same
        # wall-clock second mint a byte-identical JWT; that says nothing about
        # whether verification actually reran.)
        codes = (await db_session.scalars(select(OtpCode).where(OtpCode.phone == phone))).all()
        assert len(codes) == 4, "otp/register and otp/request must each have issued their own code"
    finally:
        await _cleanup(db_session, phone)


# ── Duplicate prevention, both directions ───────────────────────────────────


@pytest.mark.asyncio
async def test_duplicate_pending_request_from_same_applicant_is_refused(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    phone = _phone()
    try:
        token = await _verified_token(db_session, db_api_client, phone)

        first = await db_api_client.post(JOIN_URL, json=_payload(), headers=_auth(token))
        assert first.status_code == 201, first.text

        second = await _submit(db_api_client, token, registrationNumber=_reg_number())
        assert second.status_code == 409, second.text

        count = len(
            (await db_session.scalars(select(BusinessJoinRequest).where(BusinessJoinRequest.phone == phone))).all()
        )
        assert count == 1, "the second submission must not leave a row behind"
    finally:
        await _cleanup(db_session, phone)


@pytest.mark.asyncio
async def test_duplicate_pending_request_for_same_business_is_refused(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    """Two different applicants cannot both hold an open request for the same
    business — identified, in the absence of any Business row yet, by the
    submitted registration number."""
    phone_a, phone_b = _phone(), _phone()
    reg_number = _reg_number()
    try:
        token_a = await _verified_token(db_session, db_api_client, phone_a)
        token_b = await _verified_token(db_session, db_api_client, phone_b)

        first = await _submit(db_api_client, token_a, registrationNumber=reg_number)
        assert first.status_code == 201, first.text

        second = await _submit(db_api_client, token_b, registrationNumber=reg_number)
        assert second.status_code == 409, second.text

        count = len(
            (
                await db_session.scalars(
                    select(BusinessJoinRequest).where(BusinessJoinRequest.registration_number == reg_number)
                )
            ).all()
        )
        assert count == 1
    finally:
        await _cleanup(db_session, phone_a, phone_b)


@pytest.mark.asyncio
async def test_resubmission_after_rejection_is_allowed(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    phone = _phone()
    try:
        token = await _verified_token(db_session, db_api_client, phone)

        first = await db_api_client.post(JOIN_URL, json=_payload(), headers=_auth(token))
        assert first.status_code == 201, first.text

        request_id = first.json()["id"]
        await db_session.execute(
            BusinessJoinRequest.__table__.update()
            .where(BusinessJoinRequest.id == request_id)
            .values(status=BusinessJoinRequestStatus.REJECTED, reviewed_at=datetime.now(UTC))
        )
        await db_session.commit()

        second = await _submit(db_api_client, token, registrationNumber=_reg_number())
        assert second.status_code == 201, "a rejected request must not block a fresh submission"
    finally:
        await _cleanup(db_session, phone)


# ── DB-level race safety ─────────────────────────────────────────────────────
#
# The tests above all go through the app sequentially, so every duplicate is
# caught by svc.submit's pre-check queries — the `except IntegrityError` branch
# never actually runs. These two force two independent sessions to both clear
# the pre-check before either is allowed to commit, so the second one has no
# way to win except by hitting the real partial unique index at commit time,
# through `submit()` itself, unmodified.


async def _load_verified_user(db: AsyncSession, phone: str, *, name: str = "Race Test") -> User:
    user = User(id=uuid.uuid4().hex, phone=phone, name=name, role=UserRole.DRIVER, is_phone_verified=True)
    db.add(user)
    await db.commit()
    return user


async def _race(
    db_a: AsyncSession,
    user_a: User,
    dto_a: BusinessJoinRequestIn,
    db_b: AsyncSession,
    user_b: User,
    dto_b: BusinessJoinRequestIn,
):
    """Run two svc.submit() calls concurrently, on two independent sessions,
    with both forced to pass their pre-check before either is allowed to
    commit — a 2-party asyncio.Barrier patched onto AsyncSession.commit for
    the lifetime of this call only. Whichever loses meets the real unique
    index, not a shortcut.
    """
    barrier = asyncio.Barrier(2)
    real_commit = AsyncSession.commit

    async def _synced_commit(self: AsyncSession) -> None:
        await barrier.wait()
        await real_commit(self)

    async def _attempt(db: AsyncSession, user: User, dto: BusinessJoinRequestIn):
        try:
            return "ok", await svc.submit(db, user, dto)
        except HTTPException as e:
            return "error", e

    with patch.object(AsyncSession, "commit", _synced_commit):
        return await asyncio.gather(_attempt(db_a, user_a, dto_a), _attempt(db_b, user_b, dto_b))


@pytest.mark.asyncio
async def test_concurrent_submissions_from_same_applicant_hit_the_db_race(db_session: AsyncSession) -> None:
    phone = _phone()
    engine_b = create_async_engine(settings.database_url, pool_pre_ping=True)
    session_b_factory = async_sessionmaker(engine_b, expire_on_commit=False, class_=AsyncSession)
    try:
        seeded = await _load_verified_user(db_session, phone)
        async with session_b_factory() as db_b:
            user_a = await db_session.get(User, seeded.id)
            user_b = await db_b.get(User, seeded.id)
            assert user_a is not None
            assert user_b is not None

            dto_a = BusinessJoinRequestIn.model_validate(_payload(registrationNumber=_reg_number()))
            dto_b = BusinessJoinRequestIn.model_validate(_payload(registrationNumber=_reg_number()))

            (label_a, result_a), (label_b, result_b) = await _race(db_session, user_a, dto_a, db_b, user_b, dto_b)

            assert {label_a, label_b} == {"ok", "error"}, "exactly one of the two must win the race"
            loser = result_a if label_a == "error" else result_b
            assert isinstance(loser, HTTPException)
            assert loser.status_code == 409
            # This exact message only comes from the except IntegrityError branch —
            # the pre-check's message for this rule is "You already have a pending
            # business request". Getting this one proves the race branch ran.
            assert loser.detail == "A pending request already exists"

            # The losing session's rollback must leave it usable for a further query.
            losing_db = db_session if label_a == "error" else db_b
            still_usable = await losing_db.scalar(
                select(BusinessJoinRequest).where(BusinessJoinRequest.applicant_user_id == seeded.id)
            )
            assert still_usable is not None

            pending = (
                await db_session.scalars(
                    select(BusinessJoinRequest).where(
                        BusinessJoinRequest.applicant_user_id == seeded.id,
                        BusinessJoinRequest.status == BusinessJoinRequestStatus.PENDING,
                    )
                )
            ).all()
            assert len(pending) == 1, "exactly one PENDING request must survive the race"
    finally:
        await engine_b.dispose()
        await _cleanup(db_session, phone)


@pytest.mark.asyncio
async def test_concurrent_submissions_for_same_business_hit_the_db_race(db_session: AsyncSession) -> None:
    phone_a, phone_b = _phone(), _phone()
    reg_number = _reg_number()
    engine_b = create_async_engine(settings.database_url, pool_pre_ping=True)
    session_b_factory = async_sessionmaker(engine_b, expire_on_commit=False, class_=AsyncSession)
    try:
        user_a = await _load_verified_user(db_session, phone_a, name="Race Test A")
        async with session_b_factory() as db_b:
            user_b = User(
                id=uuid.uuid4().hex, phone=phone_b, name="Race Test B", role=UserRole.DRIVER, is_phone_verified=True
            )
            db_b.add(user_b)
            await db_b.commit()

            dto_a = BusinessJoinRequestIn.model_validate(_payload(registrationNumber=reg_number))
            dto_b = BusinessJoinRequestIn.model_validate(_payload(registrationNumber=reg_number))

            (label_a, result_a), (label_b, result_b) = await _race(db_session, user_a, dto_a, db_b, user_b, dto_b)

            assert {label_a, label_b} == {"ok", "error"}, "exactly one of the two must win the race"
            loser = result_a if label_a == "error" else result_b
            assert isinstance(loser, HTTPException)
            assert loser.status_code == 409
            # Same distinction as above: this message is only reachable from the
            # except IntegrityError branch, not the "This business already has a
            # pending request" pre-check message.
            assert loser.detail == "A pending request already exists"

            losing_db = db_session if label_a == "error" else db_b
            still_usable = await losing_db.scalar(
                select(BusinessJoinRequest).where(BusinessJoinRequest.registration_number == reg_number)
            )
            assert still_usable is not None

            pending = (
                await db_session.scalars(
                    select(BusinessJoinRequest).where(
                        BusinessJoinRequest.registration_number == reg_number,
                        BusinessJoinRequest.status == BusinessJoinRequestStatus.PENDING,
                    )
                )
            ).all()
            assert len(pending) == 1, "exactly one PENDING request must survive the race"
    finally:
        await engine_b.dispose()
        await _cleanup(db_session, phone_a, phone_b)


# ── Business access stays separate from the applicant account ──────────────


@pytest.mark.asyncio
async def test_submission_grants_no_business_access(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    phone = _phone()
    try:
        token = await _verified_token(db_session, db_api_client, phone)
        r = await db_api_client.post(JOIN_URL, json=_payload(), headers=_auth(token))
        assert r.status_code == 201, r.text

        user = await db_session.scalar(select(User).where(User.phone == phone))
        assert user is not None
        assert user.role == UserRole.DRIVER, "role must not change on submission"

        # Any CurrentBusiness-scoped route must still refuse this account.
        rewards = await db_api_client.get("/api/business/rewards", headers=_auth(token))
        assert rewards.status_code == 403
    finally:
        await _cleanup(db_session, phone)


@pytest.mark.asyncio
async def test_applicant_can_read_own_status(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    phone = _phone()
    try:
        token = await _verified_token(db_session, db_api_client, phone)

        before = await db_api_client.get(STATUS_URL, headers=_auth(token))
        assert before.status_code == 200
        assert before.json()["status"] == "none"

        submitted = await db_api_client.post(JOIN_URL, json=_payload(), headers=_auth(token))
        assert submitted.status_code == 201

        after = await db_api_client.get(STATUS_URL, headers=_auth(token))
        assert after.status_code == 200
        assert after.json()["status"] == "pending"
    finally:
        await _cleanup(db_session, phone)


@pytest.mark.asyncio
async def test_status_endpoint_never_leaks_another_applicants_request(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    phone_a, phone_b = _phone(), _phone()
    try:
        token_a = await _verified_token(db_session, db_api_client, phone_a)
        token_b = await _verified_token(db_session, db_api_client, phone_b)

        submitted = await db_api_client.post(JOIN_URL, json=_payload(), headers=_auth(token_a))
        assert submitted.status_code == 201

        # There is no request id in the URL at all — B can only ever read B's own status.
        r = await db_api_client.get(STATUS_URL, headers=_auth(token_b))
        assert r.status_code == 200
        assert r.json()["status"] == "none"
    finally:
        await _cleanup(db_session, phone_a, phone_b)


# ── Rate limiting ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_submission_is_rate_limited(
    db_session: AsyncSession, db_api_client: AsyncClient, rate_limited: None
) -> None:
    phone = _phone()
    try:
        token = await _verified_token(db_session, db_api_client, phone)
        last = None
        for _ in range(6):  # SENSITIVE_LIMIT is 5/minute
            last = await _submit(db_api_client, token, registrationNumber=_reg_number())
        assert last is not None
        assert last.status_code == 429, "the 6th submission in a minute must be refused"
    finally:
        await _cleanup(db_session, phone)
