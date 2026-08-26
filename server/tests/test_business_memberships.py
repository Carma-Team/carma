"""Business-scoped authorization (CAR-74).

`business_memberships` replaced `Business.owner_user_id` as the *authorization*
source: `current_business` (`core/deps.py`) resolves both the business and the
caller's role from this table on every request, never from `User.role` and
never from the JWT's `role` claim. `test_business_rewards.py` and
`test_business_vouchers.py` cover ownership and the reward/voucher state
machines; this file covers what changed — the permission matrix across
OWNER/MANAGER/CASHIER, the backfill migration, the no-membership and
multiple-membership edge cases, CASHIER's narrower reward visibility, and the
DB-vs-JWT guarantee.

Needs a real database — see conftest.db_session — and skips without one.
"""

from __future__ import annotations

import importlib.util
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi import HTTPException
from httpx import AsyncClient
from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import require_business_role
from app.core.security import create_access_token
from app.models import (
    Business,
    BusinessCategory,
    BusinessMembership,
    BusinessMembershipRole,
    Redemption,
    RedemptionStatus,
    Reward,
    User,
    UserRole,
)
from app.schemas.reward import BusinessRewardIn
from app.services import business as business_service

REWARDS_URL = "/api/business/rewards"


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _unknown_code() -> str:
    return uuid.uuid4().hex[:10].upper()


def _reward_payload(**overrides: object) -> BusinessRewardIn:
    data: dict[str, object] = {"titleHe": "פרס בדיקה", "descriptionHe": "תיאור בדיקה", "costPoints": 10}
    data.update(overrides)
    return BusinessRewardIn.model_validate(data)


async def _make_user(db: AsyncSession, *, role: UserRole = UserRole.DRIVER) -> User:
    user = User(name="Membership Test User", role=role, is_phone_verified=True)
    db.add(user)
    await db.commit()
    return user


async def _make_business(db: AsyncSession) -> Business:
    business = Business(
        name=f"Membership Biz {uuid.uuid4().hex[:6]}",
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


async def _setup(
    db: AsyncSession, role: BusinessMembershipRole, *, global_role: UserRole = UserRole.DRIVER
) -> tuple[Business, User, str]:
    """A business, a user holding exactly `role` on it, and their bearer token.

    `global_role` defaults to DRIVER — deliberately never BUSINESS — to prove
    business-route access comes from the membership row, not from `User.role`.
    """
    business = await _make_business(db)
    user = await _make_user(db, role=global_role)
    await _add_membership(db, user, business, role)
    token = _token(user)
    return business, user, token


def _token(user: User, *, role: UserRole | None = None) -> str:
    """`role` overrides what the JWT's global-role claim says, independent of
    `user.role` in the DB — the only way to build "token over-claims, the
    membership disagrees"."""
    return create_access_token(user_id=user.id, email=None, phone=None, role=role or user.role)


async def _cleanup(db: AsyncSession, *, users: tuple[User, ...] = (), businesses: tuple[Business, ...] = ()) -> None:
    # Businesses first: `Business.owner_user_id` has no ON DELETE clause, so a
    # user referenced by it must outlive the row until the business is gone.
    # Membership rows cascade off either side automatically.
    if businesses:
        await db.execute(delete(Business).where(Business.id.in_([b.id for b in businesses])))
    if users:
        await db.execute(delete(User).where(User.id.in_([u.id for u in users])))
    await db.commit()


# ─── Backfill migration (CAR-74's own required DB test) ──────────────────────


def _load_backfill_sql() -> str:
    """The exact SQL `0024_business_memberships.upgrade()` runs.

    Imported from the migration file itself — not retyped here — so a future
    edit to the real statement can't drift silently out of sync with what this
    test proves.
    """
    path = Path(__file__).resolve().parent.parent / "alembic" / "versions" / "0024_business_memberships.py"
    spec = importlib.util.spec_from_file_location("_car74_backfill_migration", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    sql: str = module.BACKFILL_SQL
    return sql


@pytest.mark.asyncio
async def test_backfill_produces_exactly_one_owner_per_business_with_an_owner(db_session: AsyncSession) -> None:
    """Exercised against a business built the way pre-CAR-74 code would have —
    `owner_user_id` set, no membership row yet — the shape every business in
    the database was in before this migration ran."""
    owner = await _make_user(db_session)
    business = Business(
        owner_user_id=owner.id,
        name=f"Legacy Biz {uuid.uuid4().hex[:6]}",
        category=BusinessCategory.FOOD,
        location_lat=32.07,
        location_lng=34.78,
    )
    db_session.add(business)
    await db_session.commit()
    try:
        backfill_sql = _load_backfill_sql()

        await db_session.execute(text(backfill_sql))
        await db_session.commit()
        rows = (
            await db_session.scalars(select(BusinessMembership).where(BusinessMembership.business_id == business.id))
        ).all()
        assert len(rows) == 1, "exactly one membership row must exist for this business after backfill"
        assert rows[0].role == BusinessMembershipRole.OWNER
        assert rows[0].user_id == owner.id

        # Idempotent — a migration that somehow ran twice must not duplicate the row.
        await db_session.execute(text(backfill_sql))
        await db_session.commit()
        rows_again = (
            await db_session.scalars(select(BusinessMembership).where(BusinessMembership.business_id == business.id))
        ).all()
        assert len(rows_again) == 1, "re-running the backfill must not create a second OWNER row"
    finally:
        await _cleanup(db_session, users=(owner,), businesses=(business,))


# ─── No membership / ambiguous membership ────────────────────────────────────


@pytest.mark.asyncio
async def test_user_with_no_membership_gets_403(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    user = await _make_user(db_session)
    try:
        r = await db_api_client.get(REWARDS_URL, headers=_auth(_token(user)))
        assert r.status_code == 403
    finally:
        await _cleanup(db_session, users=(user,))


@pytest.mark.asyncio
async def test_user_with_two_memberships_fails_closed_instead_of_picking_one(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    user = await _make_user(db_session)
    business_a = await _make_business(db_session)
    business_b = await _make_business(db_session)
    await _add_membership(db_session, user, business_a, BusinessMembershipRole.OWNER)
    await _add_membership(db_session, user, business_b, BusinessMembershipRole.CASHIER)
    try:
        r = await db_api_client.get(REWARDS_URL, headers=_auth(_token(user)))
        assert r.status_code == 409, r.text
        assert r.json()["detail"]["code"] == "AMBIGUOUS_BUSINESS_CONTEXT"
    finally:
        await _cleanup(db_session, users=(user,), businesses=(business_a, business_b))


# ─── Revocation is effective on the very next request ────────────────────────


@pytest.mark.asyncio
async def test_revoking_membership_blocks_the_next_request_with_the_still_valid_token(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    business, user, token = await _setup(db_session, BusinessMembershipRole.OWNER)
    try:
        ok = await db_api_client.get(REWARDS_URL, headers=_auth(token))
        assert ok.status_code == 200, ok.text

        await db_session.execute(delete(BusinessMembership).where(BusinessMembership.user_id == user.id))
        await db_session.commit()

        blocked = await db_api_client.get(REWARDS_URL, headers=_auth(token))
        assert blocked.status_code == 403, "the same still-valid token must be refused on the very next request"
    finally:
        await _cleanup(db_session, users=(user,), businesses=(business,))


# ─── Role matrix across the existing business routes ─────────────────────────


@pytest.mark.asyncio
@pytest.mark.parametrize("role", [BusinessMembershipRole.OWNER, BusinessMembershipRole.MANAGER])
async def test_owner_and_manager_can_manage_rewards(
    role: BusinessMembershipRole, db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    business, user, token = await _setup(db_session, role)
    try:
        created = await db_api_client.post(
            REWARDS_URL, json={"titleHe": "פרס", "descriptionHe": "תיאור", "costPoints": 10}, headers=_auth(token)
        )
        assert created.status_code == 201, created.text
        reward_id = created.json()["reward"]["id"]

        patched = await db_api_client.patch(f"{REWARDS_URL}/{reward_id}", json={"costPoints": 20}, headers=_auth(token))
        assert patched.status_code == 200, patched.text

        live = await db_api_client.get(f"{REWARDS_URL}/{reward_id}/live-vouchers", headers=_auth(token))
        assert live.status_code == 200, live.text

        archived = await db_api_client.delete(f"{REWARDS_URL}/{reward_id}", headers=_auth(token))
        assert archived.status_code == 204, archived.text
    finally:
        await _cleanup(db_session, users=(user,), businesses=(business,))


@pytest.mark.asyncio
async def test_cashier_cannot_touch_rewards(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    business, user, token = await _setup(db_session, BusinessMembershipRole.CASHIER)
    reward = await business_service.create_reward(db_session, business, _reward_payload())
    try:
        create = await db_api_client.post(
            REWARDS_URL, json={"titleHe": "x", "descriptionHe": "y", "costPoints": 5}, headers=_auth(token)
        )
        assert create.status_code == 403

        patch = await db_api_client.patch(f"{REWARDS_URL}/{reward.id}", json={"costPoints": 5}, headers=_auth(token))
        assert patch.status_code == 403

        live = await db_api_client.get(f"{REWARDS_URL}/{reward.id}/live-vouchers", headers=_auth(token))
        assert live.status_code == 403

        archive = await db_api_client.delete(f"{REWARDS_URL}/{reward.id}", headers=_auth(token))
        assert archive.status_code == 403
    finally:
        await _cleanup(db_session, users=(user,), businesses=(business,))


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "role", [BusinessMembershipRole.OWNER, BusinessMembershipRole.MANAGER, BusinessMembershipRole.CASHIER]
)
async def test_every_role_can_peek_and_redeem_vouchers(
    role: BusinessMembershipRole, db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    """An unknown code answers 404, not 403 — proving membership auth passed for
    all three roles before the voucher lookup itself ever ran."""
    business, user, token = await _setup(db_session, role)
    try:
        peek = await db_api_client.get(f"/api/business/vouchers/{_unknown_code()}", headers=_auth(token))
        assert peek.status_code == 404, peek.text

        redeem = await db_api_client.post(f"/api/business/vouchers/{_unknown_code()}/redeem", headers=_auth(token))
        assert redeem.status_code == 404, redeem.text
    finally:
        await _cleanup(db_session, users=(user,), businesses=(business,))


async def _issue_voucher(db: AsyncSession, business: Business, holder: User) -> Redemption:
    """A real, redeemable voucher issued against `business` — reward and all."""
    reward = Reward(
        business_id=business.id,
        title_he="שובר בדיקה",
        description_he="תיאור",
        category=business.category,
        cost_points=10,
        stock=5,
    )
    db.add(reward)
    await db.flush()

    code = uuid.uuid4().hex[:12].upper()
    voucher = Redemption(
        user_id=holder.id,
        reward_id=reward.id,
        business_id=business.id,
        points_cost=reward.cost_points,
        qr_code=code,
        qr_data=code,
        status=RedemptionStatus.PENDING,
        expires_at=datetime.now(UTC) + timedelta(minutes=5),
    )
    db.add(voucher)
    await db.commit()
    await db.refresh(voucher)
    return voucher


@pytest.mark.asyncio
async def test_cross_business_voucher_isolation_through_the_real_membership_path(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    """The HTTP-level counterpart to `test_business_vouchers.py`'s
    `test_another_businesss_voucher_is_not_found`, which calls
    `business_service` directly. This one goes through the actual router with
    a real OWNER token for Business A, resolved through `current_business` off
    a real membership row — proving the isolation holds through the whole
    CAR-74 auth path, not just inside `_owned_voucher`.
    """
    business_a, user_a, token_a = await _setup(db_session, BusinessMembershipRole.OWNER)
    business_b, user_b, _token_b = await _setup(db_session, BusinessMembershipRole.OWNER)
    voucher_holder = await _make_user(db_session)
    voucher = await _issue_voucher(db_session, business_b, voucher_holder)
    try:
        peek = await db_api_client.get(f"/api/business/vouchers/{voucher.qr_code}", headers=_auth(token_a))
        assert peek.status_code == 404, "Business A's own token must not reach Business B's voucher"
        assert voucher.qr_code not in peek.text, "the response must not confirm this code exists anywhere"
        assert business_b.id not in peek.text, "the response must not name the business the code actually belongs to"

        redeem = await db_api_client.post(f"/api/business/vouchers/{voucher.qr_code}/redeem", headers=_auth(token_a))
        assert redeem.status_code == 404, "redeem must answer identically to peek — no existence leak either way"
        assert voucher.qr_code not in redeem.text
        assert business_b.id not in redeem.text

        await db_session.refresh(voucher)
        assert voucher.status == RedemptionStatus.PENDING, "a cross-business redeem attempt must not consume it"
        assert voucher.used_at is None
    finally:
        # Redemption.reward_id and .business_id carry no ON DELETE clause, so
        # the voucher must go before the reward/business it cites can.
        await db_session.execute(delete(Redemption).where(Redemption.id == voucher.id))
        await db_session.commit()
        await _cleanup(db_session, users=(user_a, user_b, voucher_holder), businesses=(business_a, business_b))


# ─── CASHIER reward visibility ────────────────────────────────────────────────


async def _make_four_rewards(db: AsyncSession, business: Business) -> dict[str, str]:
    """One reward in each state CAR-131's "active" definition distinguishes.

    Returns a name -> reward id map so tests can assert on the exact set a
    caller should or should not see.
    """
    active = await business_service.create_reward(db, business, _reward_payload(titleHe="פעיל"))
    inactive = await business_service.create_reward(db, business, _reward_payload(titleHe="לא פעיל", isActive=False))
    archived = await business_service.create_reward(db, business, _reward_payload(titleHe="בארכיון"))
    await business_service.archive_reward(db, business, archived.id)
    expired = await business_service.create_reward(
        db,
        business,
        _reward_payload(titleHe="קמפיין שהסתיים", expiresAt=datetime.now(UTC) - timedelta(days=1)),
    )
    return {"active": active.id, "inactive": inactive.id, "archived": archived.id, "expired": expired.id}


@pytest.mark.asyncio
async def test_cashier_list_rewards_returns_active_only(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    """CAR-131 added a campaign-expiry leg to "active" — a CASHIER must not see
    a reward whose campaign already ended, on top of the inactive/archived
    cases CAR-74 explicitly names."""
    business, user, token = await _setup(db_session, BusinessMembershipRole.CASHIER)
    ids = await _make_four_rewards(db_session, business)
    try:
        r = await db_api_client.get(REWARDS_URL, headers=_auth(token))
        assert r.status_code == 200, r.text
        seen = {reward["id"] for reward in r.json()["rewards"]}
        assert seen == {ids["active"]}, "a CASHIER must see only the reward that is active, unarchived, and unexpired"
    finally:
        await _cleanup(db_session, users=(user,), businesses=(business,))


@pytest.mark.asyncio
@pytest.mark.parametrize("role", [BusinessMembershipRole.OWNER, BusinessMembershipRole.MANAGER])
async def test_owner_and_manager_list_rewards_still_includes_everything(
    role: BusinessMembershipRole, db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    business, user, token = await _setup(db_session, role)
    ids = await _make_four_rewards(db_session, business)
    try:
        r = await db_api_client.get(REWARDS_URL, headers=_auth(token))
        assert r.status_code == 200, r.text
        seen = {reward["id"] for reward in r.json()["rewards"]}
        assert seen == set(ids.values()), "OWNER/MANAGER must keep seeing the full catalog, exactly as before CAR-74"
    finally:
        await _cleanup(db_session, users=(user,), businesses=(business,))


# ─── A driver can be a business member at once, without conflict ────────────


@pytest.mark.asyncio
async def test_driver_with_cashier_membership_can_redeem_without_a_role_flip(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    business, user, token = await _setup(db_session, BusinessMembershipRole.CASHIER, global_role=UserRole.DRIVER)
    try:
        peek = await db_api_client.get(f"/api/business/vouchers/{_unknown_code()}", headers=_auth(token))
        assert peek.status_code == 404, "CASHIER membership must work for a DRIVER-role account"

        refreshed = await db_session.get(User, user.id)
        assert refreshed is not None
        assert refreshed.role == UserRole.DRIVER, "CAR-74 must never flip the global UserRole"
    finally:
        await _cleanup(db_session, users=(user,), businesses=(business,))


# ─── JWT role claim is never trusted for business authorization ─────────────


@pytest.mark.asyncio
async def test_jwt_role_claim_is_never_trusted_for_business_authorization(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    """A token can claim whatever global `role` its issuer likes — business
    authorization must come from the membership row alone (CAR-74's DB-vs-JWT
    AC, the same guarantee CAR-77 proved for `CurrentAdmin`)."""
    business, user, _unused_token = await _setup(
        db_session, BusinessMembershipRole.CASHIER, global_role=UserRole.DRIVER
    )
    try:
        forged = _token(user, role=UserRole.ADMIN)  # JWT claims ADMIN; membership says CASHIER

        create = await db_api_client.post(
            REWARDS_URL, json={"titleHe": "x", "descriptionHe": "y", "costPoints": 5}, headers=_auth(forged)
        )
        assert create.status_code == 403, "a CASHIER membership must stay capped at CASHIER regardless of the JWT"

        peek = await db_api_client.get(f"/api/business/vouchers/{_unknown_code()}", headers=_auth(forged))
        assert peek.status_code == 404, "CASHIER-level access must still work even though the token over-claims"
    finally:
        await _cleanup(db_session, users=(user,), businesses=(business,))


# ─── Role hierarchy is an explicit table, not enum declaration order ────────


@pytest.mark.parametrize(
    ("actual", "minimum", "allowed"),
    [
        (BusinessMembershipRole.OWNER, BusinessMembershipRole.OWNER, True),
        (BusinessMembershipRole.OWNER, BusinessMembershipRole.MANAGER, True),
        (BusinessMembershipRole.OWNER, BusinessMembershipRole.CASHIER, True),
        (BusinessMembershipRole.MANAGER, BusinessMembershipRole.OWNER, False),
        (BusinessMembershipRole.MANAGER, BusinessMembershipRole.MANAGER, True),
        (BusinessMembershipRole.MANAGER, BusinessMembershipRole.CASHIER, True),
        (BusinessMembershipRole.CASHIER, BusinessMembershipRole.OWNER, False),
        (BusinessMembershipRole.CASHIER, BusinessMembershipRole.MANAGER, False),
        (BusinessMembershipRole.CASHIER, BusinessMembershipRole.CASHIER, True),
    ],
)
@pytest.mark.asyncio
async def test_role_hierarchy_is_pinned_down_for_every_pair(
    actual: BusinessMembershipRole, minimum: BusinessMembershipRole, allowed: bool
) -> None:
    """`require_business_role` ranks roles off `core.deps._ROLE_RANK`, an
    explicit table — not off `BusinessMembershipRole`'s declaration order or
    its `.value` strings, either of which a future edit to the enum could
    silently reorder. All nine (actual, minimum) pairs are pinned down here so
    such a reorder would fail this test rather than silently invert who
    outranks whom.

    Calls the dependency function directly, bypassing FastAPI's DI — it takes
    a plain `BusinessMembership` argument, so no request/DB is needed.
    """
    dependency = require_business_role(minimum)
    membership = BusinessMembership(role=actual)
    if allowed:
        assert await dependency(membership) is membership
    else:
        with pytest.raises(HTTPException) as exc:
            await dependency(membership)
        assert exc.value.status_code == 403
