"""One-time business-permission invitations (CAR-76).

Needs a real database — see conftest.db_session — and skips without one.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import HTTPException
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings
from app.core.security import create_access_token
from app.main import app as fastapi_app
from app.models import (
    Business,
    BusinessCategory,
    BusinessInvitation,
    BusinessMembership,
    BusinessMembershipRole,
    User,
    UserRole,
)
from app.schemas.business_invitation import BusinessInvitationIn
from app.services import business_invitations as svc

INVITATIONS_URL = "/api/business/invitations"


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _make_user(db: AsyncSession, *, role: UserRole = UserRole.DRIVER) -> User:
    user = User(name="Invitation Test User", role=role, is_phone_verified=True)
    db.add(user)
    await db.commit()
    return user


async def _make_business(db: AsyncSession) -> Business:
    business = Business(
        name=f"Invitation Biz {uuid.uuid4().hex[:6]}",
        category=BusinessCategory.FOOD,
        location_lat=32.07,
        location_lng=34.78,
    )
    db.add(business)
    await db.commit()
    return business


async def _add_membership(db: AsyncSession, user: User, business: Business, role: BusinessMembershipRole) -> None:
    db.add(BusinessMembership(user_id=user.id, business_id=business.id, role=role))
    await db.commit()


async def _setup_owner(db: AsyncSession) -> tuple[Business, User, str]:
    business = await _make_business(db)
    owner = await _make_user(db)
    await _add_membership(db, owner, business, BusinessMembershipRole.OWNER)
    return business, owner, _token(owner)


def _token(user: User) -> str:
    return create_access_token(user_id=user.id, email=None, phone=None, role=user.role)


async def _cleanup(db: AsyncSession, *, users: tuple[User, ...] = (), businesses: tuple[Business, ...] = ()) -> None:
    if businesses:
        await db.execute(delete(Business).where(Business.id.in_([b.id for b in businesses])))
    if users:
        await db.execute(delete(User).where(User.id.in_([u.id for u in users])))
    await db.commit()


@asynccontextmanager
async def _rival_session() -> AsyncIterator[AsyncSession]:
    """A second session on its own engine — see test_points_atomicity.py, which
    has this same helper for the same reason (a shared engine across event
    loops leaks connections)."""
    engine = create_async_engine(settings.database_url, pool_pre_ping=True)
    factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    try:
        async with factory() as session:
            yield session
    finally:
        await engine.dispose()


# ─── Creation: OWNER only, right role granted on redeem ──────────────────────


@pytest.mark.asyncio
@pytest.mark.parametrize("role", [BusinessMembershipRole.MANAGER, BusinessMembershipRole.CASHIER])
async def test_create_then_redeem_grants_exactly_that_role(
    role: BusinessMembershipRole, db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    business, owner, owner_token = await _setup_owner(db_session)
    recipient = await _make_user(db_session)
    try:
        created = await db_api_client.post(
            INVITATIONS_URL, json={"role": role.value.lower()}, headers=_auth(owner_token)
        )
        assert created.status_code == 201, created.text
        token = created.json()["invitation"]["token"]

        accepted = await db_api_client.post(f"/api/invitations/{token}/accept", headers=_auth(_token(recipient)))
        assert accepted.status_code == 200, accepted.text
        assert accepted.json()["membership"]["role"] == role.value.lower()

        membership = await db_session.scalar(
            select(BusinessMembership).where(
                BusinessMembership.user_id == recipient.id, BusinessMembership.business_id == business.id
            )
        )
        assert membership is not None
        assert membership.role == role
    finally:
        await _cleanup(db_session, users=(owner, recipient), businesses=(business,))


@pytest.mark.asyncio
@pytest.mark.parametrize("role", [BusinessMembershipRole.MANAGER, BusinessMembershipRole.CASHIER])
async def test_manager_and_cashier_cannot_create_invitation(
    role: BusinessMembershipRole, db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    business = await _make_business(db_session)
    user = await _make_user(db_session)
    await _add_membership(db_session, user, business, role)
    try:
        r = await db_api_client.post(INVITATIONS_URL, json={"role": "manager"}, headers=_auth(_token(user)))
        assert r.status_code == 403
    finally:
        await _cleanup(db_session, users=(user,), businesses=(business,))


# ─── Single use, enforced atomically ──────────────────────────────────────────


@pytest.mark.asyncio
async def test_second_redeem_of_the_same_token_fails(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    business, owner, owner_token = await _setup_owner(db_session)
    first_recipient = await _make_user(db_session)
    second_recipient = await _make_user(db_session)
    try:
        created = await db_api_client.post(INVITATIONS_URL, json={"role": "cashier"}, headers=_auth(owner_token))
        token = created.json()["invitation"]["token"]

        first = await db_api_client.post(f"/api/invitations/{token}/accept", headers=_auth(_token(first_recipient)))
        assert first.status_code == 200, first.text

        second = await db_api_client.post(f"/api/invitations/{token}/accept", headers=_auth(_token(second_recipient)))
        assert second.status_code == 404, second.text
    finally:
        await _cleanup(db_session, users=(owner, first_recipient, second_recipient), businesses=(business,))


@pytest.mark.asyncio
async def test_concurrent_redeems_of_one_token_produce_exactly_one_membership(db_session: AsyncSession) -> None:
    business, owner, _owner_token = await _setup_owner(db_session)
    racer_a = await _make_user(db_session)
    racer_b = await _make_user(db_session)
    try:
        invitation_dto = BusinessInvitationIn(role="cashier")
        invitation_out = await svc.create_invitation(db_session, business, owner, invitation_dto)

        async with _rival_session() as rival_db:
            rival_b = await rival_db.get(User, racer_b.id)
            assert rival_b is not None

            results = await asyncio.gather(
                svc.accept_invitation(db_session, racer_a, invitation_out.token),
                svc.accept_invitation(rival_db, rival_b, invitation_out.token),
                return_exceptions=True,
            )

        failures = [r for r in results if isinstance(r, BaseException)]
        assert len(failures) == 1, f"exactly one racer must be refused, got {results}"
        assert isinstance(failures[0], HTTPException)
        assert failures[0].status_code == 404

        memberships = (
            await db_session.scalars(
                select(BusinessMembership).where(
                    BusinessMembership.business_id == business.id,
                    BusinessMembership.role == BusinessMembershipRole.CASHIER,
                )
            )
        ).all()
        assert len(memberships) == 1, "exactly one membership must exist after the race, whoever won it"
    finally:
        await _cleanup(db_session, users=(owner, racer_a, racer_b), businesses=(business,))


# ─── 72h expiry, indistinguishable from unknown ──────────────────────────────


@pytest.mark.asyncio
async def test_expired_and_unknown_tokens_answer_identically(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    business, owner, owner_token = await _setup_owner(db_session)
    recipient = await _make_user(db_session)
    try:
        created = await db_api_client.post(INVITATIONS_URL, json={"role": "cashier"}, headers=_auth(owner_token))
        token = created.json()["invitation"]["token"]
        invitation_id = created.json()["invitation"]["id"]

        await db_session.execute(
            update(BusinessInvitation)
            .where(BusinessInvitation.id == invitation_id)
            .values(expires_at=datetime.now(UTC) - timedelta(hours=1))
        )
        await db_session.commit()

        expired = await db_api_client.get(f"/api/invitations/{token}", headers=_auth(_token(recipient)))
        unknown = await db_api_client.get(
            f"/api/invitations/{uuid.uuid4().hex[:10].upper()}", headers=_auth(_token(recipient))
        )

        assert expired.status_code == 404
        assert unknown.status_code == 404
        assert expired.json() == unknown.json()

        accept_expired = await db_api_client.post(f"/api/invitations/{token}/accept", headers=_auth(_token(recipient)))
        assert accept_expired.status_code == 404
        assert accept_expired.json() == unknown.json()
    finally:
        await _cleanup(db_session, users=(owner, recipient), businesses=(business,))


# ─── Revocation is immediate ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_revoking_a_pending_invitation_makes_it_unusable_at_once(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    business, owner, owner_token = await _setup_owner(db_session)
    recipient = await _make_user(db_session)
    try:
        created = await db_api_client.post(INVITATIONS_URL, json={"role": "manager"}, headers=_auth(owner_token))
        invitation_id = created.json()["invitation"]["id"]
        token = created.json()["invitation"]["token"]

        revoked = await db_api_client.delete(f"{INVITATIONS_URL}/{invitation_id}", headers=_auth(owner_token))
        assert revoked.status_code == 204, revoked.text

        accepted = await db_api_client.post(f"/api/invitations/{token}/accept", headers=_auth(_token(recipient)))
        assert accepted.status_code == 404, "a revoked invitation must be unusable immediately"
    finally:
        await _cleanup(db_session, users=(owner, recipient), businesses=(business,))


# ─── Listing pending invitations: OWNER only, pending state only (CAR-118) ───


@pytest.mark.asyncio
async def test_listing_returns_only_pending_invitations_with_their_expiry(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    business, owner, owner_token = await _setup_owner(db_session)
    recipient = await _make_user(db_session)
    try:
        pending = await db_api_client.post(INVITATIONS_URL, json={"role": "manager"}, headers=_auth(owner_token))
        pending_id = pending.json()["invitation"]["id"]

        redeemed = await db_api_client.post(INVITATIONS_URL, json={"role": "cashier"}, headers=_auth(owner_token))
        redeemed_token = redeemed.json()["invitation"]["token"]
        redeemed_id = redeemed.json()["invitation"]["id"]
        accept = await db_api_client.post(f"/api/invitations/{redeemed_token}/accept", headers=_auth(_token(recipient)))
        assert accept.status_code == 200, accept.text

        revoked = await db_api_client.post(INVITATIONS_URL, json={"role": "cashier"}, headers=_auth(owner_token))
        revoked_id = revoked.json()["invitation"]["id"]
        revoke = await db_api_client.delete(f"{INVITATIONS_URL}/{revoked_id}", headers=_auth(owner_token))
        assert revoke.status_code == 204

        listed = await db_api_client.get(INVITATIONS_URL, headers=_auth(owner_token))
        assert listed.status_code == 200, listed.text
        invitations = listed.json()["invitations"]

        ids = {item["id"] for item in invitations}
        assert ids == {pending_id}, "only the still-pending invitation belongs in the list"
        assert redeemed_id not in ids
        assert revoked_id not in ids

        item = next(item for item in invitations if item["id"] == pending_id)
        assert item["role"] == "manager"
        assert "expiresAt" in item
        assert "token" not in item and "url" not in item, "a listed invitation must never re-expose its credential"
    finally:
        await _cleanup(db_session, users=(owner, recipient), businesses=(business,))


@pytest.mark.asyncio
async def test_listing_is_scoped_to_the_caller_own_business(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    business_a, owner_a, owner_a_token = await _setup_owner(db_session)
    business_b, owner_b, owner_b_token = await _setup_owner(db_session)
    try:
        created = await db_api_client.post(INVITATIONS_URL, json={"role": "manager"}, headers=_auth(owner_a_token))
        assert created.status_code == 201

        listed_b = await db_api_client.get(INVITATIONS_URL, headers=_auth(owner_b_token))
        assert listed_b.status_code == 200
        assert listed_b.json()["invitations"] == [], "another business's pending invitation must never be visible"
    finally:
        await _cleanup(db_session, users=(owner_a, owner_b), businesses=(business_a, business_b))


@pytest.mark.asyncio
@pytest.mark.parametrize("role", [BusinessMembershipRole.MANAGER, BusinessMembershipRole.CASHIER])
async def test_listing_is_refused_for_manager_and_cashier(
    role: BusinessMembershipRole, db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    business = await _make_business(db_session)
    member = await _make_user(db_session)
    await _add_membership(db_session, member, business, role)
    try:
        listed = await db_api_client.get(INVITATIONS_URL, headers=_auth(_token(member)))
        assert listed.status_code == 403
    finally:
        await _cleanup(db_session, users=(member,), businesses=(business,))


@pytest.mark.asyncio
async def test_listing_is_refused_with_no_bearer_token(db_api_client: AsyncClient) -> None:
    listed = await db_api_client.get(INVITATIONS_URL)
    assert listed.status_code == 401


# ─── Already a member: rejected without touching membership or invitation ────


@pytest.mark.asyncio
async def test_already_a_member_is_rejected_without_consuming_the_invitation(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    business, owner, owner_token = await _setup_owner(db_session)
    recipient = await _make_user(db_session)
    await _add_membership(db_session, recipient, business, BusinessMembershipRole.CASHIER)
    try:
        created = await db_api_client.post(INVITATIONS_URL, json={"role": "manager"}, headers=_auth(owner_token))
        invitation_id = created.json()["invitation"]["id"]
        token = created.json()["invitation"]["token"]

        accepted = await db_api_client.post(f"/api/invitations/{token}/accept", headers=_auth(_token(recipient)))
        assert accepted.status_code == 409, accepted.text
        assert accepted.json()["detail"]["code"] == "ALREADY_MEMBER"

        membership = await db_session.scalar(
            select(BusinessMembership).where(
                BusinessMembership.user_id == recipient.id, BusinessMembership.business_id == business.id
            )
        )
        assert (
            membership is not None and membership.role == BusinessMembershipRole.CASHIER
        ), "the pre-existing membership must be untouched"

        invitation = await db_session.get(BusinessInvitation, invitation_id)
        assert invitation is not None
        assert invitation.redeemed_at is None, "the invitation must not be consumed by a rejected acceptance"
    finally:
        await _cleanup(db_session, users=(owner, recipient), businesses=(business,))


# ─── Redeeming with an elevated role in the payload cannot escalate ──────────


@pytest.mark.asyncio
async def test_role_in_the_accept_payload_is_ignored(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    business, owner, owner_token = await _setup_owner(db_session)
    recipient = await _make_user(db_session)
    try:
        created = await db_api_client.post(INVITATIONS_URL, json={"role": "cashier"}, headers=_auth(owner_token))
        token = created.json()["invitation"]["token"]

        accepted = await db_api_client.post(
            f"/api/invitations/{token}/accept",
            json={"role": "owner"},
            headers=_auth(_token(recipient)),
        )
        assert accepted.status_code == 200, accepted.text
        assert accepted.json()["membership"]["role"] == "cashier", "the accept route takes no role from the client"

        membership = await db_session.scalar(
            select(BusinessMembership).where(
                BusinessMembership.user_id == recipient.id, BusinessMembership.business_id == business.id
            )
        )
        assert membership is not None
        assert membership.role == BusinessMembershipRole.CASHIER
    finally:
        await _cleanup(db_session, users=(owner, recipient), businesses=(business,))


# ─── The token never leaks into logs, structured fields, or error responses ──


@pytest.mark.asyncio
async def test_invitation_token_never_appears_in_the_request_log(
    db_session: AsyncSession, db_api_client: AsyncClient, caplog: pytest.LogCaptureFixture
) -> None:
    business, owner, owner_token = await _setup_owner(db_session)
    try:
        created = await db_api_client.post(INVITATIONS_URL, json={"role": "cashier"}, headers=_auth(owner_token))
        token = created.json()["invitation"]["token"]

        with caplog.at_level(logging.INFO, logger="carma.http"):
            preview = await db_api_client.get(f"/api/invitations/{token}", headers=_auth(_token(owner)))
        assert preview.status_code == 200, preview.text

        request_logs = [r for r in caplog.records if r.name == "carma.http"]
        assert request_logs, "RequestLogMiddleware must have logged something for this request"
        for record in request_logs:
            assert token not in record.path, "the raw token must not reach the structured 'path' field"
            assert token not in record.getMessage()
    finally:
        await _cleanup(db_session, users=(owner,), businesses=(business,))


@pytest.mark.asyncio
async def test_invitation_token_never_appears_in_an_unhandled_exception_log_or_response(
    db_session: AsyncSession,
    db_api_client: AsyncClient,
    caplog: pytest.LogCaptureFixture,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Forces `preview_invitation` to blow up so the path reaches
    `unhandled_exception_handler` — the other place `request.url.path` used to
    be logged and echoed back verbatim, token and all."""
    business, owner, owner_token = await _setup_owner(db_session)
    try:
        created = await db_api_client.post(INVITATIONS_URL, json={"role": "cashier"}, headers=_auth(owner_token))
        token = created.json()["invitation"]["token"]

        async def _boom(*_args: object, **_kwargs: object) -> None:
            raise RuntimeError("boom")

        monkeypatch.setattr(svc, "preview_invitation", _boom)

        # Starlette's ServerErrorMiddleware re-raises after sending the 500
        # response (by design, so a real deployment still logs it); httpx's
        # default ASGITransport turns that into an exception on the client
        # side too, which would hide the very response this test inspects.
        # `db_api_client` already put the DB session override in place — this
        # client reuses it, just without re-raising.
        async with AsyncClient(
            transport=ASGITransport(app=fastapi_app, raise_app_exceptions=False), base_url="http://test"
        ) as no_raise_client:
            with caplog.at_level(logging.ERROR, logger="app.main"):
                response = await no_raise_client.get(f"/api/invitations/{token}", headers=_auth(_token(owner)))

        assert response.status_code == 500
        assert token not in response.text, "the 500 response body must not echo the raw token back"

        exception_logs = [r for r in caplog.records if r.name == "app.main"]
        assert exception_logs, "the unhandled-exception handler must have logged something"
        for record in exception_logs:
            assert token not in record.getMessage()
    finally:
        await _cleanup(db_session, users=(owner,), businesses=(business,))


# ─── Revocation competes safely with a concurrent acceptance ─────────────────


@pytest.mark.asyncio
async def test_concurrent_accept_and_revoke_produce_exactly_one_outcome(db_session: AsyncSession) -> None:
    """Whichever transaction's UPDATE lands first must be the only one that
    changes anything — never a membership created *and* the invitation marked
    revoked, and never neither."""
    business, owner, _owner_token = await _setup_owner(db_session)
    recipient = await _make_user(db_session)
    # Captured now, not read off the ORM objects after the race: whichever
    # side loses calls `db.rollback()`, which expires every object `db_session`
    # holds, and re-reading `.id` off an expired object outside an awaited DB
    # call raises MissingGreenlet.
    business_id, recipient_id = business.id, recipient.id
    try:
        invitation_out = await svc.create_invitation(db_session, business, owner, BusinessInvitationIn(role="cashier"))

        async with _rival_session() as rival_db:
            rival_business = await rival_db.get(Business, business_id)
            assert rival_business is not None

            results = await asyncio.gather(
                svc.accept_invitation(db_session, recipient, invitation_out.token),
                svc.revoke_invitation(rival_db, rival_business, invitation_out.id),
                return_exceptions=True,
            )

        membership = await db_session.scalar(
            select(BusinessMembership).where(
                BusinessMembership.user_id == recipient_id, BusinessMembership.business_id == business_id
            )
        )
        invitation = await db_session.get(BusinessInvitation, invitation_out.id)
        assert invitation is not None

        if membership is not None:
            # Accept won the race — the invitation must be redeemed, not revoked.
            assert invitation.redeemed_at is not None
            assert invitation.revoked_at is None
            assert isinstance(results[1], Exception), "revoke must have lost and reported it"
        else:
            # Revoke won — the invitation must be revoked, never redeemed, and
            # accept must have failed rather than silently doing nothing.
            assert invitation.revoked_at is not None
            assert invitation.redeemed_at is None
            assert isinstance(results[0], Exception), "accept must have lost and reported it"
    finally:
        # Whichever side of the race lost called `db.rollback()`, which
        # expires every object still held on `db_session` — refresh before
        # `_cleanup` touches `.id` on them, or the lazy reload it triggers
        # raises MissingGreenlet outside of an awaited DB call.
        await db_session.refresh(business)
        await db_session.refresh(owner)
        await db_session.refresh(recipient)
        await _cleanup(db_session, users=(owner, recipient), businesses=(business,))


@pytest.mark.asyncio
async def test_revoking_an_already_redeemed_invitation_is_refused_without_mutating_it(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    business, owner, owner_token = await _setup_owner(db_session)
    recipient = await _make_user(db_session)
    try:
        created = await db_api_client.post(INVITATIONS_URL, json={"role": "manager"}, headers=_auth(owner_token))
        invitation_id = created.json()["invitation"]["id"]
        token = created.json()["invitation"]["token"]

        accepted = await db_api_client.post(f"/api/invitations/{token}/accept", headers=_auth(_token(recipient)))
        assert accepted.status_code == 200, accepted.text

        revoked = await db_api_client.delete(f"{INVITATIONS_URL}/{invitation_id}", headers=_auth(owner_token))
        assert revoked.status_code == 409, revoked.text
        assert revoked.json()["detail"]["code"] == "ALREADY_REDEEMED"

        invitation = await db_session.get(BusinessInvitation, invitation_id)
        assert invitation is not None
        assert invitation.revoked_at is None, "an already-redeemed invitation must not be marked revoked too"
    finally:
        # See the same note in test_concurrent_accept_and_revoke... — the
        # failed revoke attempt above rolled back the shared session.
        await db_session.refresh(business)
        await db_session.refresh(owner)
        await db_session.refresh(recipient)
        await _cleanup(db_session, users=(owner, recipient), businesses=(business,))


@pytest.mark.asyncio
async def test_revoking_an_already_revoked_invitation_is_idempotent(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    business, owner, owner_token = await _setup_owner(db_session)
    try:
        created = await db_api_client.post(INVITATIONS_URL, json={"role": "manager"}, headers=_auth(owner_token))
        invitation_id = created.json()["invitation"]["id"]

        first = await db_api_client.delete(f"{INVITATIONS_URL}/{invitation_id}", headers=_auth(owner_token))
        assert first.status_code == 204, first.text

        second = await db_api_client.delete(f"{INVITATIONS_URL}/{invitation_id}", headers=_auth(owner_token))
        assert second.status_code == 204, second.text
    finally:
        # See the same note in test_concurrent_accept_and_revoke... — the
        # second (no-op) revoke rolled back the shared session.
        await db_session.refresh(business)
        await db_session.refresh(owner)
        await _cleanup(db_session, users=(owner,), businesses=(business,))


@pytest.mark.asyncio
async def test_revoking_an_expired_invitation_does_not_mutate_it(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    """An expired invitation is already unusable — the same reason an
    already-revoked one is a no-op. Revoke must not set `revoked_at` on it
    (that would fabricate a revocation event for an invitation nobody could
    ever have accepted anyway) and must not emit a second audit event."""
    business, owner, owner_token = await _setup_owner(db_session)
    try:
        created = await db_api_client.post(INVITATIONS_URL, json={"role": "manager"}, headers=_auth(owner_token))
        invitation_id = created.json()["invitation"]["id"]

        await db_session.execute(
            update(BusinessInvitation)
            .where(BusinessInvitation.id == invitation_id)
            .values(expires_at=datetime.now(UTC) - timedelta(hours=1))
        )
        await db_session.commit()

        revoked = await db_api_client.delete(f"{INVITATIONS_URL}/{invitation_id}", headers=_auth(owner_token))
        assert revoked.status_code == 204, revoked.text

        invitation = await db_session.get(BusinessInvitation, invitation_id)
        assert invitation is not None
        assert invitation.revoked_at is None, "an expired invitation must not be marked revoked by a revoke attempt"
    finally:
        await db_session.refresh(business)
        await db_session.refresh(owner)
        await _cleanup(db_session, users=(owner,), businesses=(business,))


# ─── `_unknown_invitation()` never reuses a single exception instance ────────


def test_unknown_invitation_builds_a_fresh_exception_every_call() -> None:
    """A shared module-level instance would accumulate tracebacks (and every
    frame's locals — a request's token, its DB session) across every
    invalid-token request the process ever handles."""
    first = svc._unknown_invitation()
    second = svc._unknown_invitation()
    assert first is not second


# ─── The stored hash needs the server's own secret, not just the token ───────


def test_token_hash_is_keyed_not_a_bare_digest() -> None:
    """A bare SHA-256 of this ~49-bit readable token would be offline-crackable
    from a database leak alone, well within the 72h window. Keying it on a
    value derived from the server's secret means the dump by itself gives an
    attacker no way to even test a guess."""
    token = "ABCDEFGHJK"
    bare_digest = hashlib.sha256(token.encode()).hexdigest()
    assert svc._hash(token) != bare_digest
