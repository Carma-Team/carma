"""CAR-77 — admin approve/reject of business join requests created by CAR-42.

Every route requires `CurrentAdmin`, resolved from the caller's current DB
row — never a JWT claim — so a role change (grant or revoke) is effective on
the very next request. Approval is one transaction: create the `Business`,
copy the registration number, set `owner_user_id`, flip the applicant
`DRIVER -> BUSINESS`, and mark the request `APPROVED`. See
`services.business_join_requests` for the state-transition table this file
exercises directly.

Needs a real database — see conftest.db_session — and skips without one.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import UTC, datetime

import pytest
from fastapi import HTTPException
from httpx import AsyncClient
from sqlalchemy import delete, event, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings
from app.core.security import create_access_token
from app.models import Business, BusinessJoinRequest, BusinessJoinRequestStatus, BusinessMembership, User
from app.models.enums import BusinessCategory, BusinessMembershipRole, UserRole
from app.services import business as business_service
from app.services import business_join_requests as svc

LIST_URL = "/api/admin/business-requests"


def _reg_number() -> str:
    return f"REG-{uuid.uuid4().hex[:10]}"


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _make_user(db: AsyncSession, *, role: UserRole, name: str = "Test User") -> User:
    user = User(id=uuid.uuid4().hex, name=name, role=role, is_phone_verified=True)
    db.add(user)
    await db.commit()
    return user


async def _make_request(
    db: AsyncSession,
    applicant: User,
    *,
    status_: BusinessJoinRequestStatus = BusinessJoinRequestStatus.PENDING,
    registration_number: str | None = None,
) -> BusinessJoinRequest:
    request = BusinessJoinRequest(
        applicant_user_id=applicant.id,
        phone=applicant.phone or f"+9725{uuid.uuid4().int % 10**8:08d}",
        name="Test Cafe",
        name_he="בית קפה בדיקה",
        category=BusinessCategory.FOOD,
        location_lat=32.07,
        location_lng=34.78,
        address="1 Test St",
        registration_number=registration_number or _reg_number(),
        contact_person="Dana Test",
        status=status_,
    )
    db.add(request)
    await db.commit()
    await db.refresh(request)
    return request


def _token(user: User, *, role: UserRole | None = None) -> str:
    """`role` overrides what the JWT claims, independent of `user.role` in the
    DB — the only way to construct the "token says ADMIN, DB disagrees" case."""
    return create_access_token(user_id=user.id, email=None, phone=user.phone, role=role or user.role)


async def _cleanup(db: AsyncSession, *user_ids: str) -> None:
    await db.execute(delete(Business).where(Business.owner_user_id.in_(user_ids)))
    await db.execute(delete(BusinessJoinRequest).where(BusinessJoinRequest.applicant_user_id.in_(user_ids)))
    await db.execute(delete(User).where(User.id.in_(user_ids)))
    await db.commit()


# ── Admin gate ───────────────────────────────────────────────────────────────


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("method", "path"), [("GET", LIST_URL), ("POST", f"{LIST_URL}/x/approve"), ("POST", f"{LIST_URL}/x/reject")]
)
async def test_admin_routes_require_auth(api_client: AsyncClient, method: str, path: str) -> None:
    r = await api_client.request(method, path, json={"reviewerNote": "no"} if "reject" in path else None)
    assert r.status_code == 401


@pytest.mark.asyncio
@pytest.mark.parametrize("role", [UserRole.DRIVER, UserRole.BUSINESS])
async def test_admin_routes_reject_non_admin_callers(
    db_session: AsyncSession, db_api_client: AsyncClient, role: UserRole
) -> None:
    user = await _make_user(db_session, role=role)
    try:
        token = _token(user)
        r = await db_api_client.get(LIST_URL, headers=_auth(token))
        assert r.status_code == 403, r.text
        r = await db_api_client.post(f"{LIST_URL}/x/approve", headers=_auth(token))
        assert r.status_code == 403, r.text
        r = await db_api_client.post(f"{LIST_URL}/x/reject", json={"reviewerNote": "no"}, headers=_auth(token))
        assert r.status_code == 403, r.text
    finally:
        await _cleanup(db_session, user.id)


@pytest.mark.asyncio
async def test_admin_authorization_reads_the_db_role_not_the_jwt_claim(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    """A token can claim whatever `role` its issuer likes — `current_admin` must
    still refuse a caller whose DB row is not ADMIN (CAR-77's DB-vs-JWT AC)."""
    driver = await _make_user(db_session, role=UserRole.DRIVER)
    try:
        token = _token(driver, role=UserRole.ADMIN)  # JWT claims ADMIN; DB row says DRIVER
        r = await db_api_client.get(LIST_URL, headers=_auth(token))
        assert r.status_code == 403, r.text
    finally:
        await _cleanup(db_session, driver.id)


# ── Approve: the happy path ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_approve_creates_business_sets_owner_and_flips_role(
    db_session: AsyncSession, db_api_client: AsyncClient, caplog: pytest.LogCaptureFixture
) -> None:
    admin = await _make_user(db_session, role=UserRole.ADMIN)
    applicant = await _make_user(db_session, role=UserRole.DRIVER)
    reg_number = _reg_number()
    try:
        request = await _make_request(db_session, applicant, registration_number=reg_number)

        with caplog.at_level(logging.INFO, logger="carma.audit"):
            r = await db_api_client.post(f"{LIST_URL}/{request.id}/approve", headers=_auth(_token(admin)))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "approved"
        assert body["registrationNumber"] == reg_number

        business = await db_session.scalar(select(Business).where(Business.registration_number == reg_number))
        assert business is not None
        assert business.owner_user_id == applicant.id
        assert business.name == "Test Cafe"

        refreshed_applicant = await db_session.get(User, applicant.id)
        assert refreshed_applicant is not None
        assert refreshed_applicant.role == UserRole.BUSINESS

        # CAR-74: the same transaction must also mint the OWNER membership that
        # `current_business` now authorizes against — not a follow-up write.
        membership = await db_session.scalar(
            select(BusinessMembership).where(
                BusinessMembership.business_id == business.id, BusinessMembership.user_id == applicant.id
            )
        )
        assert membership is not None, "approval must create the OWNER membership, not just owner_user_id"
        assert membership.role == BusinessMembershipRole.OWNER

        refreshed_request = await db_session.get(BusinessJoinRequest, request.id)
        assert refreshed_request is not None
        assert refreshed_request.status == BusinessJoinRequestStatus.APPROVED
        assert refreshed_request.reviewed_at is not None

        assert any(getattr(rec, "event", None) == "business.join_request.approved" for rec in caplog.records)
        assert any(getattr(rec, "admin_id", None) == admin.id for rec in caplog.records)
    finally:
        await _cleanup(db_session, admin.id, applicant.id)


@pytest.mark.asyncio
async def test_approved_owner_can_immediately_use_a_business_route(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    admin = await _make_user(db_session, role=UserRole.ADMIN)
    applicant = await _make_user(db_session, role=UserRole.DRIVER)
    try:
        request = await _make_request(db_session, applicant)
        r = await db_api_client.post(f"{LIST_URL}/{request.id}/approve", headers=_auth(_token(admin)))
        assert r.status_code == 200, r.text

        # Same token minted before approval — proves the DB role change, not a
        # fresh login, is what unlocks the route.
        owner_token = _token(applicant, role=UserRole.DRIVER)
        r = await db_api_client.get("/api/business/rewards", headers=_auth(owner_token))
        assert r.status_code == 200, r.text
    finally:
        await _cleanup(db_session, admin.id, applicant.id)


# ── Idempotency and invalid transitions ─────────────────────────────────────


@pytest.mark.asyncio
async def test_sequential_double_approve_is_idempotent(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    admin = await _make_user(db_session, role=UserRole.ADMIN)
    applicant = await _make_user(db_session, role=UserRole.DRIVER)
    reg_number = _reg_number()
    try:
        request = await _make_request(db_session, applicant, registration_number=reg_number)
        token = _auth(_token(admin))

        first = await db_api_client.post(f"{LIST_URL}/{request.id}/approve", headers=token)
        assert first.status_code == 200, first.text
        second = await db_api_client.post(f"{LIST_URL}/{request.id}/approve", headers=token)
        assert second.status_code == 200, second.text
        assert second.json() == first.json()

        businesses = (
            await db_session.scalars(select(Business).where(Business.registration_number == reg_number))
        ).all()
        assert len(businesses) == 1
    finally:
        await _cleanup(db_session, admin.id, applicant.id)


@pytest.mark.asyncio
async def test_double_reject_is_idempotent_and_keeps_the_first_note(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    admin = await _make_user(db_session, role=UserRole.ADMIN)
    applicant = await _make_user(db_session, role=UserRole.DRIVER)
    try:
        request = await _make_request(db_session, applicant)
        token = _auth(_token(admin))

        first = await db_api_client.post(
            f"{LIST_URL}/{request.id}/reject", json={"reviewerNote": "First reason"}, headers=token
        )
        assert first.status_code == 200, first.text
        second = await db_api_client.post(
            f"{LIST_URL}/{request.id}/reject", json={"reviewerNote": "Second reason"}, headers=token
        )
        assert second.status_code == 200, second.text
        assert second.json()["reviewerNote"] == "First reason", "a standing decision does not get overwritten"
    finally:
        await _cleanup(db_session, admin.id, applicant.id)


@pytest.mark.asyncio
async def test_rejected_request_cannot_be_approved(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    admin = await _make_user(db_session, role=UserRole.ADMIN)
    applicant = await _make_user(db_session, role=UserRole.DRIVER)
    try:
        request = await _make_request(db_session, applicant, status_=BusinessJoinRequestStatus.REJECTED)
        r = await db_api_client.post(f"{LIST_URL}/{request.id}/approve", headers=_auth(_token(admin)))
        assert r.status_code == 409, r.text
        assert r.json()["detail"]["code"] == svc.INVALID_STATE_TRANSITION

        refreshed = await db_session.get(BusinessJoinRequest, request.id)
        assert refreshed is not None
        assert refreshed.status == BusinessJoinRequestStatus.REJECTED
        businesses = (await db_session.scalars(select(Business).where(Business.owner_user_id == applicant.id))).all()
        assert businesses == []
    finally:
        await _cleanup(db_session, admin.id, applicant.id)


@pytest.mark.asyncio
async def test_approved_request_cannot_be_rejected(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    admin = await _make_user(db_session, role=UserRole.ADMIN)
    applicant = await _make_user(db_session, role=UserRole.DRIVER)
    reg_number = _reg_number()
    try:
        request = await _make_request(db_session, applicant, registration_number=reg_number)
        approve = await db_api_client.post(f"{LIST_URL}/{request.id}/approve", headers=_auth(_token(admin)))
        assert approve.status_code == 200, approve.text

        r = await db_api_client.post(
            f"{LIST_URL}/{request.id}/reject", json={"reviewerNote": "too late"}, headers=_auth(_token(admin))
        )
        assert r.status_code == 409, r.text
        assert r.json()["detail"]["code"] == svc.INVALID_STATE_TRANSITION

        refreshed = await db_session.get(BusinessJoinRequest, request.id)
        assert refreshed is not None
        assert refreshed.status == BusinessJoinRequestStatus.APPROVED
    finally:
        await _cleanup(db_session, admin.id, applicant.id)


# ── Ownership and registration-number integrity ─────────────────────────────


@pytest.mark.asyncio
async def test_applicant_already_owning_a_business_is_refused(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    admin = await _make_user(db_session, role=UserRole.ADMIN)
    applicant = await _make_user(db_session, role=UserRole.DRIVER)
    try:
        first_request = await _make_request(db_session, applicant)
        first = await db_api_client.post(f"{LIST_URL}/{first_request.id}/approve", headers=_auth(_token(admin)))
        assert first.status_code == 200, first.text

        second_request = await _make_request(db_session, applicant)
        r = await db_api_client.post(f"{LIST_URL}/{second_request.id}/approve", headers=_auth(_token(admin)))
        assert r.status_code == 409, r.text
        assert r.json()["detail"]["code"] == svc.ALREADY_OWNS_BUSINESS

        refreshed = await db_session.get(BusinessJoinRequest, second_request.id)
        assert refreshed is not None
        assert refreshed.status == BusinessJoinRequestStatus.PENDING
        businesses = (await db_session.scalars(select(Business).where(Business.owner_user_id == applicant.id))).all()
        assert len(businesses) == 1, "the second approval must not create a second Business"
    finally:
        await _cleanup(db_session, admin.id, applicant.id)


@pytest.mark.asyncio
async def test_applicant_who_already_belongs_to_a_business_elsewhere_is_refused_and_creates_no_business(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    """CAR-118 review's bounded-correction round, item 2: an applicant who
    already holds a membership somewhere else — e.g. accepted a business
    invitation as MANAGER/CASHIER before ever submitting a registration —
    must be refused the same way `accept_invitation` refuses the reverse
    ordering. `test_applicant_already_owning_a_business_is_refused` above
    only catches the narrower case (`Business.owner_user_id`); this is the
    shared `business_service.assert_membership_allowed` invariant, which
    also catches a plain non-owner membership.
    """
    admin = await _make_user(db_session, role=UserRole.ADMIN)
    admin_id = admin.id
    admin_token = _token(admin)
    applicant = await _make_user(db_session, role=UserRole.DRIVER)
    applicant_id = applicant.id
    other_business = Business(
        name="Other Business", category=BusinessCategory.FOOD, location_lat=32.07, location_lng=34.78
    )
    db_session.add(other_business)
    await db_session.commit()
    other_business_id = other_business.id
    db_session.add(
        BusinessMembership(user_id=applicant_id, business_id=other_business_id, role=BusinessMembershipRole.CASHIER)
    )
    await db_session.commit()
    try:
        request = await _make_request(db_session, applicant)
        request_id = request.id
        r = await db_api_client.post(f"{LIST_URL}/{request_id}/approve", headers=_auth(admin_token))
        assert r.status_code == 409, r.text
        assert r.json()["detail"]["code"] == business_service.INCOMPATIBLE_BUSINESS

        # `assert_membership_allowed` rolled back the shared session inside
        # the request above, expiring every attribute on every object in it —
        # every id read from here on is one captured before that call, never
        # a live attribute, or this trips a lazy load outside the async
        # context that can service one (`MissingGreenlet`).
        refreshed = await db_session.get(BusinessJoinRequest, request_id)
        assert refreshed is not None
        assert refreshed.status == BusinessJoinRequestStatus.PENDING, "a refused approval must not be left APPROVED"

        businesses = (await db_session.scalars(select(Business).where(Business.owner_user_id == applicant_id))).all()
        assert businesses == [], "no Business row may survive a refused approval — the flush must have rolled back"

        memberships = (
            await db_session.scalars(select(BusinessMembership).where(BusinessMembership.user_id == applicant_id))
        ).all()
        assert len(memberships) == 1, "the applicant must end with exactly the one membership they already had"
    finally:
        await db_session.execute(delete(BusinessMembership).where(BusinessMembership.user_id == applicant_id))
        await db_session.execute(delete(Business).where(Business.id == other_business_id))
        await db_session.commit()
        await _cleanup(db_session, admin_id, applicant_id)


@pytest.mark.asyncio
async def test_registration_number_already_on_a_business_is_refused(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    admin = await _make_user(db_session, role=UserRole.ADMIN)
    owner = await _make_user(db_session, role=UserRole.DRIVER, name="First Owner")
    other_applicant = await _make_user(db_session, role=UserRole.DRIVER, name="Second Applicant")
    reg_number = _reg_number()
    try:
        first_request = await _make_request(db_session, owner, registration_number=reg_number)
        first = await db_api_client.post(f"{LIST_URL}/{first_request.id}/approve", headers=_auth(_token(admin)))
        assert first.status_code == 200, first.text

        # Bypasses services.business_join_requests.submit's own duplicate check
        # on purpose: this proves approve() enforces the invariant independently
        # of the submission-time guard, for data that guard did not exist to catch.
        second_request = await _make_request(db_session, other_applicant, registration_number=reg_number)
        r = await db_api_client.post(f"{LIST_URL}/{second_request.id}/approve", headers=_auth(_token(admin)))
        assert r.status_code == 409, r.text
        assert r.json()["detail"]["code"] == svc.REGISTRATION_NUMBER_TAKEN

        refreshed = await db_session.get(BusinessJoinRequest, second_request.id)
        assert refreshed is not None
        assert refreshed.status == BusinessJoinRequestStatus.PENDING
        businesses = (
            await db_session.scalars(select(Business).where(Business.registration_number == reg_number))
        ).all()
        assert len(businesses) == 1
    finally:
        await _cleanup(db_session, admin.id, owner.id, other_applicant.id)


@pytest.mark.asyncio
async def test_new_submission_for_an_already_approved_registration_number_is_refused(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    """CAR-42 submission integrity, extended by CAR-77: a registration number
    that already belongs to an approved Business can never be resubmitted —
    it could never be approved anyway."""
    admin = await _make_user(db_session, role=UserRole.ADMIN)
    owner = await _make_user(db_session, role=UserRole.DRIVER)
    reg_number = _reg_number()
    try:
        request = await _make_request(db_session, owner, registration_number=reg_number)
        approved = await db_api_client.post(f"{LIST_URL}/{request.id}/approve", headers=_auth(_token(admin)))
        assert approved.status_code == 200, approved.text

        applicant = await _make_user(db_session, role=UserRole.DRIVER, name="Yet Another Applicant")
        applicant_token = create_access_token(user_id=applicant.id, email=None, phone=None, role=UserRole.DRIVER)
        r = await db_api_client.post(
            "/api/business/join-requests",
            json={
                "name": "Copycat Cafe",
                "category": "food",
                "locationLat": 32.0,
                "locationLng": 34.0,
                "registrationNumber": reg_number,
                "contactPerson": "Someone",
            },
            headers=_auth(applicant_token),
        )
        assert r.status_code == 409, r.text

        await _cleanup(db_session, applicant.id)
    finally:
        await _cleanup(db_session, admin.id, owner.id)


# ── Reject ───────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_reject_stores_note_preserves_role_and_creates_nothing(
    db_session: AsyncSession, db_api_client: AsyncClient, caplog: pytest.LogCaptureFixture
) -> None:
    admin = await _make_user(db_session, role=UserRole.ADMIN)
    applicant = await _make_user(db_session, role=UserRole.DRIVER)
    try:
        request = await _make_request(db_session, applicant)

        with caplog.at_level(logging.INFO, logger="carma.audit"):
            r = await db_api_client.post(
                f"{LIST_URL}/{request.id}/reject",
                json={"reviewerNote": "Missing documentation"},
                headers=_auth(_token(admin)),
            )
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "rejected"
        assert r.json()["reviewerNote"] == "Missing documentation"

        refreshed_applicant = await db_session.get(User, applicant.id)
        assert refreshed_applicant is not None
        assert refreshed_applicant.role == UserRole.DRIVER, "reject must not touch the applicant's role"

        businesses = (await db_session.scalars(select(Business).where(Business.owner_user_id == applicant.id))).all()
        assert businesses == []

        assert any(getattr(rec, "event", None) == "business.join_request.rejected" for rec in caplog.records)

        status_r = await db_api_client.get("/api/business/join-requests/me", headers=_auth(_token(applicant)))
        assert status_r.status_code == 200, status_r.text
        assert status_r.json()["reviewerNote"] == "Missing documentation"
    finally:
        await _cleanup(db_session, admin.id, applicant.id)


# ── Concurrency: the real DB row lock, not a pre-check ──────────────────────


@pytest.mark.asyncio
async def test_concurrent_double_approve_creates_exactly_one_business(db_session: AsyncSession) -> None:
    """Two independent sessions call svc.approve() for the same request at
    once. `_locked_request`'s `SELECT ... FOR UPDATE` makes Postgres itself
    serialize them: the loser's SELECT blocks until the winner commits, then
    it re-reads APPROVED and takes the idempotent no-op path — no artificial
    barrier needed, unlike CAR-42's commit-timing race tests."""
    admin = await _make_user(db_session, role=UserRole.ADMIN)
    applicant = await _make_user(db_session, role=UserRole.DRIVER)
    reg_number = _reg_number()
    engine_b = create_async_engine(settings.database_url, pool_pre_ping=True)
    session_b_factory = async_sessionmaker(engine_b, expire_on_commit=False, class_=AsyncSession)
    try:
        request = await _make_request(db_session, applicant, registration_number=reg_number)
        async with session_b_factory() as db_b:
            admin_a = await db_session.get(User, admin.id)
            admin_b = await db_b.get(User, admin.id)
            assert admin_a is not None
            assert admin_b is not None

            results = await asyncio.gather(
                svc.approve(db_session, admin_a, request.id),
                svc.approve(db_b, admin_b, request.id),
                return_exceptions=True,
            )
            for result in results:
                if isinstance(result, Exception) and not isinstance(result, HTTPException):
                    raise result

            businesses = (
                await db_session.scalars(select(Business).where(Business.registration_number == reg_number))
            ).all()
            assert len(businesses) == 1, "concurrent double approve must create exactly one Business"

            refreshed_applicant = await db_session.get(User, applicant.id)
            assert refreshed_applicant is not None
            assert refreshed_applicant.role == UserRole.BUSINESS
    finally:
        await engine_b.dispose()
        await _cleanup(db_session, admin.id, applicant.id)


# ── Rollback on forced failure ───────────────────────────────────────────────


@pytest.mark.asyncio
async def test_forced_failure_during_approval_rolls_back_every_write(db_session: AsyncSession) -> None:
    """Raises from a real `before_commit` event — fired from inside the normal
    flush/commit machinery — rather than monkeypatching `AsyncSession.commit`
    itself, which fights the greenlet context SQLAlchemy's async layer needs
    for the connection-pool ping on the next query.

    All four writes (Business insert, OWNER membership insert, role change,
    status flip) are staged and flushed by this point; the event fires before
    the actual COMMIT is sent, so nothing crosses into a separate transaction
    to prove clean."""
    admin = await _make_user(db_session, role=UserRole.ADMIN)
    applicant = await _make_user(db_session, role=UserRole.DRIVER)
    admin_id, applicant_id = admin.id, applicant.id
    reg_number = _reg_number()
    try:
        request = await _make_request(db_session, applicant, registration_number=reg_number)
        request_id = request.id

        def _raise(*_args: object) -> None:
            raise RuntimeError("forced failure")

        event.listen(db_session.sync_session, "before_commit", _raise)
        try:
            with pytest.raises(RuntimeError):
                await svc.approve(db_session, admin, request_id)
        finally:
            event.remove(db_session.sync_session, "before_commit", _raise)

        await db_session.rollback()

        refreshed_request = await db_session.get(BusinessJoinRequest, request_id)
        assert refreshed_request is not None
        assert (
            refreshed_request.status == BusinessJoinRequestStatus.PENDING
        ), "the request must not flip without a commit"

        refreshed_applicant = await db_session.get(User, applicant_id)
        assert refreshed_applicant is not None
        assert refreshed_applicant.role == UserRole.DRIVER, "the role change must roll back with everything else"

        business = await db_session.scalar(select(Business).where(Business.registration_number == reg_number))
        assert business is None, "no Business may survive a forced failure mid-approval"

        # CAR-74: ensure_owner_membership() flushes to get business.id but must
        # never commit independently — the membership insert has to roll back
        # with everything else in the same transaction, not survive it.
        membership = await db_session.scalar(
            select(BusinessMembership).where(BusinessMembership.user_id == applicant_id)
        )
        assert membership is None, "no membership may survive a forced failure mid-approval"
    finally:
        await _cleanup(db_session, admin_id, applicant_id)


# ── IntegrityError fallback: constraint name -> the right structured code ──
#
# Both of approve()'s own pre-checks, plus CAR-42's partial unique indexes,
# make the real UNIQUE-constraint violations here effectively unreachable
# through legitimate concurrent use (verified separately) — this is the
# *last-resort* branch for whatever slips past every lock and pre-check. A
# genuine end-to-end DB race is impractical to construct for exactly that
# reason, so these raise a real `sqlalchemy.exc.IntegrityError` — carrying the
# same `.orig.__cause__.constraint_name` shape asyncpg actually produces —
# from a `before_commit` event, the same mechanism the forced-failure test
# above uses. This exercises the real `except IntegrityError` branch in
# `approve()`, not a mock of it.


def _integrity_error_for_constraint(constraint_name: str) -> IntegrityError:
    driver_error = Exception(f'duplicate key value violates unique constraint "{constraint_name}"')
    driver_error.constraint_name = constraint_name  # type: ignore[attr-defined]
    orig = Exception("<in memory DBAPI error>")
    orig.__cause__ = driver_error
    return IntegrityError("INSERT ...", {}, orig)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("constraint_name", "expected_code"),
    [
        ("businesses_owner_user_id_key", "ALREADY_OWNS_BUSINESS"),
        ("uq_businesses_registration_number", "REGISTRATION_NUMBER_TAKEN"),
    ],
)
async def test_integrity_error_fallback_maps_constraint_to_the_right_code(
    db_session: AsyncSession, db_api_client: AsyncClient, constraint_name: str, expected_code: str
) -> None:
    admin = await _make_user(db_session, role=UserRole.ADMIN)
    applicant = await _make_user(db_session, role=UserRole.DRIVER)
    admin_id, applicant_id = admin.id, applicant.id
    reg_number = _reg_number()
    try:
        request = await _make_request(db_session, applicant, registration_number=reg_number)
        request_id = request.id

        def _raise(*_args: object) -> None:
            raise _integrity_error_for_constraint(constraint_name)

        event.listen(db_session.sync_session, "before_commit", _raise)
        try:
            r = await db_api_client.post(f"{LIST_URL}/{request_id}/approve", headers=_auth(_token(admin)))
        finally:
            event.remove(db_session.sync_session, "before_commit", _raise)

        assert r.status_code == 409, r.text
        body = r.json()
        assert body["detail"]["code"] == expected_code
        # No raw DB error reaches the wire: only the two fields the structured
        # 409 contract promises, and nothing that names the constraint, the
        # table, or the driver.
        assert set(body["detail"].keys()) == {"code", "message"}
        raw_body = r.text.lower()
        for leak in (constraint_name.lower(), "asyncpg", "duplicate key", "dbapi", "traceback"):
            assert leak not in raw_body, f"raw DB detail leaked into the response: {leak!r}"

        # Session usability proof: the same session the route ran on (db_api_client
        # is wired to db_session — see conftest.db_api_client) answers a fresh query.
        await db_session.rollback()
        refreshed_request = await db_session.get(BusinessJoinRequest, request_id)
        assert refreshed_request is not None
        assert refreshed_request.status == BusinessJoinRequestStatus.PENDING, "no commit ever happened"

        refreshed_applicant = await db_session.get(User, applicant_id)
        assert refreshed_applicant is not None
        assert refreshed_applicant.role == UserRole.DRIVER

        business = await db_session.scalar(select(Business).where(Business.registration_number == reg_number))
        assert business is None
    finally:
        await _cleanup(db_session, admin_id, applicant_id)


@pytest.mark.asyncio
async def test_integrity_error_fallback_defaults_unrecognized_constraint_to_registration_number(
    db_session: AsyncSession,
) -> None:
    """Belt-and-braces: an unrecognized constraint name (schema drift, a typo
    in the mapping, a future migration) must still fail closed with *a*
    correct, structured 409 — never an unhandled 500 or a raw DB error."""
    admin = await _make_user(db_session, role=UserRole.ADMIN)
    applicant = await _make_user(db_session, role=UserRole.DRIVER)
    admin_id, applicant_id = admin.id, applicant.id
    try:
        request = await _make_request(db_session, applicant)
        request_id = request.id

        def _raise(*_args: object) -> None:
            raise _integrity_error_for_constraint("some_future_constraint_nobody_mapped_yet")

        event.listen(db_session.sync_session, "before_commit", _raise)
        try:
            with pytest.raises(HTTPException) as excinfo:
                await svc.approve(db_session, admin, request_id)
        finally:
            event.remove(db_session.sync_session, "before_commit", _raise)

        assert excinfo.value.status_code == 409
        assert excinfo.value.detail["code"] == svc.REGISTRATION_NUMBER_TAKEN  # type: ignore[index]

        await db_session.rollback()
        still_usable = await db_session.get(BusinessJoinRequest, request_id)
        assert still_usable is not None
    finally:
        await _cleanup(db_session, admin_id, applicant_id)


# ── List / filter ─────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_list_filters_by_status_and_orders_newest_first(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    admin = await _make_user(db_session, role=UserRole.ADMIN)
    applicant_a = await _make_user(db_session, role=UserRole.DRIVER, name="A")
    applicant_b = await _make_user(db_session, role=UserRole.DRIVER, name="B")
    try:
        older = await _make_request(db_session, applicant_a)
        await db_session.execute(
            BusinessJoinRequest.__table__.update()
            .where(BusinessJoinRequest.id == older.id)
            .values(created_at=datetime(2020, 1, 1, tzinfo=UTC))
        )
        newer = await _make_request(db_session, applicant_b, status_=BusinessJoinRequestStatus.REJECTED)
        await db_session.commit()

        # Membership and ordering only, not exact equality: the dev DB this
        # suite shares with everything else may hold other PENDING rows.
        r = await db_api_client.get(LIST_URL, params={"status": "pending"}, headers=_auth(_token(admin)))
        assert r.status_code == 200, r.text
        ids = [row["id"] for row in r.json()["requests"]]
        assert older.id in ids
        assert newer.id not in ids, "status filter must exclude the REJECTED request"

        r_all = await db_api_client.get(LIST_URL, headers=_auth(_token(admin)))
        ids_all = [row["id"] for row in r_all.json()["requests"]]
        assert ids_all.index(newer.id) < ids_all.index(older.id), "newest first"
    finally:
        await _cleanup(db_session, admin.id, applicant_a.id, applicant_b.id)
