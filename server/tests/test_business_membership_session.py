"""CAR-258 — DB-resolved business membership context on the web session.

`profile_out` (services/users.py) resolves the caller's business identity and
role from `business_memberships` now, via `business_service.list_memberships`
— the same query `core.deps.current_business` authorizes `/api/business/*`
off (CAR-74) — never from the legacy `Business.owner_user_id` lookup,
`User.role`, or the JWT's `role` claim. These tests hold the contract login,
refresh and `/api/auth/me` all share as a result.

Needs a real database — see conftest.db_session — and skips without one.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_access_token, hash_password
from app.models import Business, BusinessCategory, BusinessMembership, BusinessMembershipRole, User, UserRole

ME_URL = "/api/auth/me"
PASSWORD = "CorrectHorse1"
BROWSER_HEADERS = {"X-Requested-With": "XMLHttpRequest"}


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _token(user: User, *, role: UserRole | None = None) -> str:
    """`role` overrides what the JWT's global-role claim says, independent of
    `user.role` in the DB — the only way to build "token over-claims, the
    membership disagrees"."""
    return create_access_token(user_id=user.id, email=None, phone=None, role=role or user.role)


async def _make_user(db: AsyncSession, *, role: UserRole = UserRole.DRIVER, email: str | None = None) -> User:
    user = User(
        name="Membership Session Test",
        role=role,
        is_phone_verified=True,
        email=email,
        password_hash=hash_password(PASSWORD) if email else None,
    )
    db.add(user)
    await db.commit()
    return user


async def _make_business(db: AsyncSession, *, name_he: str | None = None) -> Business:
    business = Business(
        name=f"Session Ctx Biz {uuid.uuid4().hex[:6]}",
        name_he=name_he,
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


async def _cleanup(db: AsyncSession, *, users: tuple[User, ...] = (), businesses: tuple[Business, ...] = ()) -> None:
    if businesses:
        await db.execute(delete(Business).where(Business.id.in_([b.id for b in businesses])))
    if users:
        await db.execute(delete(User).where(User.id.in_([u.id for u in users])))
    await db.commit()


# ─── OWNER / MANAGER / CASHIER all get the same identity fields ─────────────


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "role", [BusinessMembershipRole.OWNER, BusinessMembershipRole.MANAGER, BusinessMembershipRole.CASHIER]
)
async def test_me_exposes_the_db_resolved_role_for_every_membership_role(
    role: BusinessMembershipRole, db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    business = await _make_business(db_session, name_he="שם בעברית")
    # Global role stays DRIVER throughout — proving the identity fields come
    # from the membership row, not from a BUSINESS-flavoured `User.role`.
    user = await _make_user(db_session, role=UserRole.DRIVER)
    await _add_membership(db_session, user, business, role)
    try:
        r = await db_api_client.get(ME_URL, headers=_auth(_token(user)))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["businessId"] == business.id
        assert body["businessCategory"] == business.category.value.lower()
        assert body["businessName"] == business.name
        assert body["businessNameHe"] == "שם בעברית"
        assert body["businessMembershipRole"] == role.value
        assert body["businessMembershipAmbiguous"] is False
    finally:
        await _cleanup(db_session, users=(user,), businesses=(business,))


# ─── No membership / ambiguous membership ────────────────────────────────────


async def test_me_has_no_business_context_with_no_membership(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    user = await _make_user(db_session)
    try:
        r = await db_api_client.get(ME_URL, headers=_auth(_token(user)))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["businessId"] is None
        assert body["businessMembershipRole"] is None
        assert body["businessMembershipAmbiguous"] is False
    finally:
        await _cleanup(db_session, users=(user,))


async def test_me_reports_the_explicit_ambiguous_state_for_two_memberships(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    user = await _make_user(db_session)
    business_a = await _make_business(db_session)
    business_b = await _make_business(db_session)
    await _add_membership(db_session, user, business_a, BusinessMembershipRole.OWNER)
    await _add_membership(db_session, user, business_b, BusinessMembershipRole.CASHIER)
    try:
        r = await db_api_client.get(ME_URL, headers=_auth(_token(user)))
        assert r.status_code == 200, "an ambiguous business context must not invalidate the driver session"
        body = r.json()
        assert body["businessMembershipAmbiguous"] is True
        assert body["businessId"] is None, "must never pick one of the two memberships arbitrarily"
        assert body["businessMembershipRole"] is None
    finally:
        await _cleanup(db_session, users=(user,), businesses=(business_a, business_b))


# ─── Revocation / role change is effective on the very next resolution ──────


async def test_revoked_membership_is_reflected_on_the_next_me_call_with_the_still_valid_token(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    business = await _make_business(db_session)
    user = await _make_user(db_session)
    await _add_membership(db_session, user, business, BusinessMembershipRole.OWNER)
    token = _token(user)
    try:
        before = await db_api_client.get(ME_URL, headers=_auth(token))
        assert before.json()["businessMembershipRole"] == "OWNER"

        await db_session.execute(delete(BusinessMembership).where(BusinessMembership.user_id == user.id))
        await db_session.commit()

        after = await db_api_client.get(ME_URL, headers=_auth(token))
        assert after.status_code == 200, "revocation must not break an otherwise valid session"
        assert after.json()["businessId"] is None
        assert after.json()["businessMembershipRole"] is None
    finally:
        await _cleanup(db_session, users=(user,), businesses=(business,))


async def test_role_change_is_reflected_on_the_next_me_call_with_the_still_valid_token(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    business = await _make_business(db_session)
    user = await _make_user(db_session)
    await _add_membership(db_session, user, business, BusinessMembershipRole.CASHIER)
    token = _token(user)
    try:
        before = await db_api_client.get(ME_URL, headers=_auth(token))
        assert before.json()["businessMembershipRole"] == "CASHIER"

        membership = await db_session.scalar(select(BusinessMembership).where(BusinessMembership.user_id == user.id))
        assert membership is not None
        membership.role = BusinessMembershipRole.MANAGER
        await db_session.commit()

        after = await db_api_client.get(ME_URL, headers=_auth(token))
        assert (
            after.json()["businessMembershipRole"] == "MANAGER"
        ), "the still-valid token must see the new role immediately"
    finally:
        await _cleanup(db_session, users=(user,), businesses=(business,))


# ─── JWT / global role is never trusted for the business role ───────────────


async def test_a_forged_jwt_role_does_not_influence_the_returned_business_role(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    business = await _make_business(db_session)
    user = await _make_user(db_session, role=UserRole.DRIVER)
    await _add_membership(db_session, user, business, BusinessMembershipRole.CASHIER)
    try:
        forged = _token(user, role=UserRole.ADMIN)  # token claims ADMIN; membership says CASHIER
        r = await db_api_client.get(ME_URL, headers=_auth(forged))
        assert r.status_code == 200
        body = r.json()
        assert body["businessMembershipRole"] == "CASHIER", "the DB row must win over an over-claiming token"
        assert body["role"] == "DRIVER", "the global User.role must stay exactly what the DB row says too"
    finally:
        await _cleanup(db_session, users=(user,), businesses=(business,))


async def test_global_user_role_is_preserved_and_unrelated_to_business_role(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    """CAR-74's guarantee, reasserted at the session-contract layer: a DRIVER can
    hold a business membership without ever being promoted to a global
    BUSINESS role."""
    business = await _make_business(db_session)
    user = await _make_user(db_session, role=UserRole.DRIVER)
    await _add_membership(db_session, user, business, BusinessMembershipRole.OWNER)
    try:
        r = await db_api_client.get(ME_URL, headers=_auth(_token(user)))
        body = r.json()
        assert body["role"] == "DRIVER"
        assert body["businessMembershipRole"] == "OWNER"
    finally:
        await _cleanup(db_session, users=(user,), businesses=(business,))


# ─── Login, refresh and /me return the same contract ────────────────────────


async def test_login_refresh_and_me_return_a_consistent_business_context(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    email = f"web-membership-{uuid.uuid4().hex[:8]}@carmatest.com"
    business = await _make_business(db_session, name_he="שם בעברית")
    user = await _make_user(db_session, role=UserRole.BUSINESS, email=email)
    await _add_membership(db_session, user, business, BusinessMembershipRole.MANAGER)
    try:
        login = await db_api_client.post(
            "/api/auth/login", json={"email": email, "password": PASSWORD}, headers=BROWSER_HEADERS
        )
        assert login.status_code == 200, login.text
        login_user = login.json()["user"]

        refresh = await db_api_client.post("/api/auth/refresh", headers=BROWSER_HEADERS)
        assert refresh.status_code == 200, refresh.text
        refresh_user = refresh.json()["user"]

        me = await db_api_client.get(ME_URL, headers=_auth(refresh.json()["token"]))
        assert me.status_code == 200, me.text
        me_user = me.json()

        for body in (login_user, refresh_user, me_user):
            assert body["businessId"] == business.id
            assert body["businessName"] == business.name
            assert body["businessNameHe"] == "שם בעברית"
            assert body["businessMembershipRole"] == "MANAGER"
            assert body["businessMembershipAmbiguous"] is False
    finally:
        await _cleanup(db_session, users=(user,), businesses=(business,))
