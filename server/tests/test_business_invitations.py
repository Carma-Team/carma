"""One-time business-permission invitations (CAR-76).

Needs a real database — see conftest.db_session — and skips without one.
"""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import HTTPException
from httpx import AsyncClient
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings
from app.core.security import create_access_token
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
