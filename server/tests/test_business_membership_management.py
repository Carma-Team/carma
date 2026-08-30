"""List members, change role, revoke access — OWNER only (CAR-117).

Builds on CAR-74's membership matrix (see `test_business_memberships.py`) and
CAR-76's revoke pattern; this file covers what CAR-117 adds — the three new
`/api/business/members` routes, cross-business isolation, the DB-resolved
"effective on next request" guarantee, and the last-OWNER invariant under
concurrency.

Needs a real database — see conftest.db_session — and skips without one.
"""

from __future__ import annotations

import asyncio
import uuid
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from httpx import AsyncClient
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings
from app.core.security import create_access_token
from app.models import Business, BusinessCategory, BusinessMembership, BusinessMembershipRole, User, UserRole
from app.services import business_memberships as membership_service

MEMBERS_URL = "/api/business/members"


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _make_user(db: AsyncSession, *, name: str = "Member Test User") -> User:
    user = User(name=name, role=UserRole.DRIVER, is_phone_verified=True)
    db.add(user)
    await db.commit()
    return user


async def _make_business(db: AsyncSession) -> Business:
    business = Business(
        name=f"Membership Mgmt Biz {uuid.uuid4().hex[:6]}",
        category=BusinessCategory.FOOD,
        location_lat=32.07,
        location_lng=34.78,
    )
    db.add(business)
    await db.commit()
    return business


async def _add_membership(
    db: AsyncSession, user: User, business: Business, role: BusinessMembershipRole
) -> BusinessMembership:
    membership = BusinessMembership(user_id=user.id, business_id=business.id, role=role)
    db.add(membership)
    await db.commit()
    await db.refresh(membership)
    return membership


def _token(user: User) -> str:
    return create_access_token(user_id=user.id, email=None, phone=None, role=user.role)


async def _cleanup(db: AsyncSession, *, users: tuple[User, ...] = (), businesses: tuple[Business, ...] = ()) -> None:
    if businesses:
        await db.execute(delete(Business).where(Business.id.in_([b.id for b in businesses])))
    if users:
        await db.execute(delete(User).where(User.id.in_([u.id for u in users])))
    await db.commit()


# ─── Listing ──────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_owner_lists_every_member(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    business = await _make_business(db_session)
    owner = await _make_user(db_session, name="Owner")
    manager = await _make_user(db_session, name="Manager")
    cashier = await _make_user(db_session, name="Cashier")
    await _add_membership(db_session, owner, business, BusinessMembershipRole.OWNER)
    await _add_membership(db_session, manager, business, BusinessMembershipRole.MANAGER)
    await _add_membership(db_session, cashier, business, BusinessMembershipRole.CASHIER)
    try:
        r = await db_api_client.get(MEMBERS_URL, headers=_auth(_token(owner)))
        assert r.status_code == 200, r.text
        members = r.json()["members"]
        assert {m["userId"] for m in members} == {owner.id, manager.id, cashier.id}
        by_user = {m["userId"]: m for m in members}
        assert by_user[owner.id]["role"] == "OWNER"
        assert by_user[manager.id]["role"] == "MANAGER"
        assert by_user[cashier.id]["role"] == "CASHIER"
        assert by_user[owner.id]["name"] == "Owner"
    finally:
        await _cleanup(db_session, users=(owner, manager, cashier), businesses=(business,))


@pytest.mark.asyncio
@pytest.mark.parametrize("role", [BusinessMembershipRole.MANAGER, BusinessMembershipRole.CASHIER])
async def test_manager_and_cashier_cannot_list_members(
    role: BusinessMembershipRole, db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    business = await _make_business(db_session)
    user = await _make_user(db_session)
    await _add_membership(db_session, user, business, role)
    try:
        r = await db_api_client.get(MEMBERS_URL, headers=_auth(_token(user)))
        assert r.status_code == 403
    finally:
        await _cleanup(db_session, users=(user,), businesses=(business,))


@pytest.mark.asyncio
async def test_listing_is_scoped_to_the_caller_business_only(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    business_a = await _make_business(db_session)
    business_b = await _make_business(db_session)
    owner_a = await _make_user(db_session, name="Owner A")
    owner_b = await _make_user(db_session, name="Owner B")
    await _add_membership(db_session, owner_a, business_a, BusinessMembershipRole.OWNER)
    await _add_membership(db_session, owner_b, business_b, BusinessMembershipRole.OWNER)
    try:
        r = await db_api_client.get(MEMBERS_URL, headers=_auth(_token(owner_a)))
        assert r.status_code == 200, r.text
        seen = {m["userId"] for m in r.json()["members"]}
        assert seen == {owner_a.id}, "must never see another business's members"
    finally:
        await _cleanup(db_session, users=(owner_a, owner_b), businesses=(business_a, business_b))


# ─── Role change ──────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_owner_changes_a_managers_role(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    business = await _make_business(db_session)
    owner = await _make_user(db_session, name="Owner")
    manager = await _make_user(db_session, name="Manager")
    await _add_membership(db_session, owner, business, BusinessMembershipRole.OWNER)
    membership = await _add_membership(db_session, manager, business, BusinessMembershipRole.MANAGER)
    try:
        r = await db_api_client.patch(
            f"{MEMBERS_URL}/{membership.id}", json={"role": "CASHIER"}, headers=_auth(_token(owner))
        )
        assert r.status_code == 200, r.text
        assert r.json()["member"]["role"] == "CASHIER"

        refreshed = await db_session.get(BusinessMembership, membership.id)
        assert refreshed is not None
        assert refreshed.role == BusinessMembershipRole.CASHIER
    finally:
        await _cleanup(db_session, users=(owner, manager), businesses=(business,))


@pytest.mark.asyncio
async def test_role_change_takes_effect_on_the_very_next_request(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    business = await _make_business(db_session)
    owner = await _make_user(db_session, name="Owner")
    cashier_user = await _make_user(db_session, name="Cashier")
    await _add_membership(db_session, owner, business, BusinessMembershipRole.OWNER)
    membership = await _add_membership(db_session, cashier_user, business, BusinessMembershipRole.CASHIER)
    cashier_token = _token(cashier_user)
    try:
        # CASHIER cannot list rewards management-side endpoints that require MANAGER — use the members
        # list itself (OWNER-only) as the before/after probe instead.
        before = await db_api_client.get(MEMBERS_URL, headers=_auth(cashier_token))
        assert before.status_code == 403

        promote = await db_api_client.patch(
            f"{MEMBERS_URL}/{membership.id}", json={"role": "OWNER"}, headers=_auth(_token(owner))
        )
        assert promote.status_code == 200, promote.text

        after = await db_api_client.get(MEMBERS_URL, headers=_auth(cashier_token))
        assert after.status_code == 200, "the same still-valid token must gain access on the very next request"
    finally:
        await _cleanup(db_session, users=(owner, cashier_user), businesses=(business,))


@pytest.mark.asyncio
@pytest.mark.parametrize("role", [BusinessMembershipRole.MANAGER, BusinessMembershipRole.CASHIER])
async def test_manager_and_cashier_cannot_change_roles(
    role: BusinessMembershipRole, db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    business = await _make_business(db_session)
    owner = await _make_user(db_session, name="Owner")
    actor = await _make_user(db_session, name="Actor")
    await _add_membership(db_session, owner, business, BusinessMembershipRole.OWNER)
    actor_membership = await _add_membership(db_session, actor, business, role)
    try:
        r = await db_api_client.patch(
            f"{MEMBERS_URL}/{actor_membership.id}", json={"role": "OWNER"}, headers=_auth(_token(actor))
        )
        assert r.status_code == 403
    finally:
        await _cleanup(db_session, users=(owner, actor), businesses=(business,))


@pytest.mark.asyncio
async def test_role_change_is_scoped_to_the_caller_business(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    business_a = await _make_business(db_session)
    business_b = await _make_business(db_session)
    owner_a = await _make_user(db_session, name="Owner A")
    other_member = await _make_user(db_session, name="Other Biz Member")
    await _add_membership(db_session, owner_a, business_a, BusinessMembershipRole.OWNER)
    foreign_membership = await _add_membership(db_session, other_member, business_b, BusinessMembershipRole.MANAGER)
    try:
        r = await db_api_client.patch(
            f"{MEMBERS_URL}/{foreign_membership.id}", json={"role": "CASHIER"}, headers=_auth(_token(owner_a))
        )
        assert r.status_code == 404, "a membership id from another business must not be reachable"

        refreshed = await db_session.get(BusinessMembership, foreign_membership.id)
        assert refreshed is not None
        assert refreshed.role == BusinessMembershipRole.MANAGER, "must be untouched"
    finally:
        await _cleanup(db_session, users=(owner_a, other_member), businesses=(business_a, business_b))


# ─── Revocation ───────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_owner_revokes_a_members_access(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    business = await _make_business(db_session)
    owner = await _make_user(db_session, name="Owner")
    cashier = await _make_user(db_session, name="Cashier")
    await _add_membership(db_session, owner, business, BusinessMembershipRole.OWNER)
    membership = await _add_membership(db_session, cashier, business, BusinessMembershipRole.CASHIER)
    try:
        r = await db_api_client.delete(f"{MEMBERS_URL}/{membership.id}", headers=_auth(_token(owner)))
        assert r.status_code == 204, r.text

        refreshed = await db_session.get(BusinessMembership, membership.id)
        assert refreshed is None
    finally:
        await _cleanup(db_session, users=(owner, cashier), businesses=(business,))


@pytest.mark.asyncio
async def test_revocation_blocks_the_very_next_request_with_the_still_valid_token(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    business = await _make_business(db_session)
    owner = await _make_user(db_session, name="Owner")
    manager_user = await _make_user(db_session, name="Manager")
    await _add_membership(db_session, owner, business, BusinessMembershipRole.OWNER)
    membership = await _add_membership(db_session, manager_user, business, BusinessMembershipRole.MANAGER)
    manager_token = _token(manager_user)
    try:
        ok = await db_api_client.get("/api/business/rewards", headers=_auth(manager_token))
        assert ok.status_code == 200, ok.text

        revoke = await db_api_client.delete(f"{MEMBERS_URL}/{membership.id}", headers=_auth(_token(owner)))
        assert revoke.status_code == 204, revoke.text

        blocked = await db_api_client.get("/api/business/rewards", headers=_auth(manager_token))
        assert blocked.status_code == 403, "the same still-valid token must be refused on the very next request"
    finally:
        await _cleanup(db_session, users=(owner, manager_user), businesses=(business,))


@pytest.mark.asyncio
async def test_revoking_an_unknown_membership_id_is_404(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    business = await _make_business(db_session)
    owner = await _make_user(db_session, name="Owner")
    await _add_membership(db_session, owner, business, BusinessMembershipRole.OWNER)
    try:
        r = await db_api_client.delete(f"{MEMBERS_URL}/{uuid.uuid4().hex}", headers=_auth(_token(owner)))
        assert r.status_code == 404
    finally:
        await _cleanup(db_session, users=(owner,), businesses=(business,))


@pytest.mark.asyncio
@pytest.mark.parametrize("role", [BusinessMembershipRole.MANAGER, BusinessMembershipRole.CASHIER])
async def test_manager_and_cashier_cannot_revoke_access(
    role: BusinessMembershipRole, db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    business = await _make_business(db_session)
    owner = await _make_user(db_session, name="Owner")
    actor = await _make_user(db_session, name="Actor")
    target = await _make_user(db_session, name="Target")
    await _add_membership(db_session, owner, business, BusinessMembershipRole.OWNER)
    await _add_membership(db_session, actor, business, role)
    target_membership = await _add_membership(db_session, target, business, BusinessMembershipRole.CASHIER)
    try:
        r = await db_api_client.delete(f"{MEMBERS_URL}/{target_membership.id}", headers=_auth(_token(actor)))
        assert r.status_code == 403
    finally:
        await _cleanup(db_session, users=(owner, actor, target), businesses=(business,))


# ─── Last-OWNER invariant ─────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_revoking_the_only_owner_is_refused(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    business = await _make_business(db_session)
    owner = await _make_user(db_session, name="Sole Owner")
    membership = await _add_membership(db_session, owner, business, BusinessMembershipRole.OWNER)
    # `db_api_client` and `db_session` share one AsyncSession (see conftest).
    # The service's `db.rollback()` on the 409 path below expires every object
    # loaded on it, including these locals — captured as plain values first so
    # `_cleanup` never triggers a lazy-load outside the async context.
    business_id, owner_id, membership_id = business.id, owner.id, membership.id
    try:
        r = await db_api_client.delete(f"{MEMBERS_URL}/{membership_id}", headers=_auth(_token(owner)))
        assert r.status_code == 409, r.text
        assert r.json()["detail"]["code"] == "LAST_OWNER"

        refreshed = await db_session.get(BusinessMembership, membership_id)
        assert refreshed is not None, "the membership must not have been removed"
    finally:
        await db_session.execute(delete(Business).where(Business.id == business_id))
        await db_session.execute(delete(User).where(User.id == owner_id))
        await db_session.commit()


@pytest.mark.asyncio
async def test_demoting_the_only_owner_is_refused(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    business = await _make_business(db_session)
    owner = await _make_user(db_session, name="Sole Owner")
    membership = await _add_membership(db_session, owner, business, BusinessMembershipRole.OWNER)
    business_id, owner_id, membership_id = business.id, owner.id, membership.id
    try:
        r = await db_api_client.patch(
            f"{MEMBERS_URL}/{membership_id}", json={"role": "MANAGER"}, headers=_auth(_token(owner))
        )
        assert r.status_code == 409, r.text
        assert r.json()["detail"]["code"] == "LAST_OWNER"

        refreshed = await db_session.get(BusinessMembership, membership_id)
        assert refreshed is not None
        assert refreshed.role == BusinessMembershipRole.OWNER
    finally:
        await db_session.execute(delete(Business).where(Business.id == business_id))
        await db_session.execute(delete(User).where(User.id == owner_id))
        await db_session.commit()


@pytest.mark.asyncio
async def test_revoking_one_of_two_owners_succeeds(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    business = await _make_business(db_session)
    owner_a = await _make_user(db_session, name="Owner A")
    owner_b = await _make_user(db_session, name="Owner B")
    await _add_membership(db_session, owner_a, business, BusinessMembershipRole.OWNER)
    membership_b = await _add_membership(db_session, owner_b, business, BusinessMembershipRole.OWNER)
    try:
        r = await db_api_client.delete(f"{MEMBERS_URL}/{membership_b.id}", headers=_auth(_token(owner_a)))
        assert r.status_code == 204, r.text
    finally:
        await _cleanup(db_session, users=(owner_a, owner_b), businesses=(business,))


@pytest.mark.asyncio
async def test_self_demotion_when_another_owner_exists_succeeds(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    business = await _make_business(db_session)
    owner_a = await _make_user(db_session, name="Owner A")
    owner_b = await _make_user(db_session, name="Owner B")
    await _add_membership(db_session, owner_b, business, BusinessMembershipRole.OWNER)
    membership_a = await _add_membership(db_session, owner_a, business, BusinessMembershipRole.OWNER)
    try:
        r = await db_api_client.patch(
            f"{MEMBERS_URL}/{membership_a.id}", json={"role": "MANAGER"}, headers=_auth(_token(owner_a))
        )
        assert r.status_code == 200, r.text

        blocked = await db_api_client.get(MEMBERS_URL, headers=_auth(_token(owner_a)))
        assert blocked.status_code == 403, "the acting owner's own demotion must be effective immediately too"
    finally:
        await _cleanup(db_session, users=(owner_a, owner_b), businesses=(business,))


@pytest.mark.asyncio
async def test_concurrent_revokes_of_both_owners_leave_exactly_one(db_session: AsyncSession) -> None:
    """Two OWNERs, each revoking the other at the same moment, must not both
    succeed — that would leave the business with none.

    `db_api_client` shares a single `AsyncSession` across every request (see
    conftest's own docstring on why), which makes it structurally unable to
    exercise two transactions racing each other — there would only ever be
    one. This test opens two independent engine connections instead — the
    same shape `conftest.db_session` builds, doubled — so the `Business` row
    lock in `_locked_business` has two real, concurrent transactions to
    actually serialize.
    """
    business = await _make_business(db_session)
    owner_a = await _make_user(db_session, name="Owner A")
    owner_b = await _make_user(db_session, name="Owner B")
    membership_a = await _add_membership(db_session, owner_a, business, BusinessMembershipRole.OWNER)
    membership_b = await _add_membership(db_session, owner_b, business, BusinessMembershipRole.OWNER)

    engine_1 = create_async_engine(settings.database_url, pool_pre_ping=True)
    engine_2 = create_async_engine(settings.database_url, pool_pre_ping=True)
    factory_1 = async_sessionmaker(engine_1, expire_on_commit=False, class_=AsyncSession)
    factory_2 = async_sessionmaker(engine_2, expire_on_commit=False, class_=AsyncSession)
    try:

        async def _revoke(factory: async_sessionmaker[AsyncSession], target_id: str) -> str:
            async with factory() as session:
                biz = await session.get(Business, business.id)
                assert biz is not None
                try:
                    await membership_service.revoke_access(session, biz, target_id)
                    return "ok"
                except HTTPException as exc:
                    assert exc.status_code == 409
                    assert exc.detail["code"] == membership_service.LAST_OWNER
                    return "conflict"

        outcomes = await asyncio.gather(
            _revoke(factory_1, membership_b.id),
            _revoke(factory_2, membership_a.id),
        )
        # With exactly two OWNERs mutually revoking each other, ["ok", "ok"]
        # would mean *both* deletions succeeded — i.e. the business ends up
        # with zero OWNERs, which is the exact violation this test exists to
        # catch. Whichever transaction's lock acquisition wins goes first and
        # always finds one other OWNER (itself excluded); the loser, once
        # unblocked, re-reads the now-shrunk OWNER set and must find none
        # left besides its own target. Exactly one "ok" and one "conflict" is
        # the only outcome a correct implementation can produce here.
        assert sorted(outcomes) == [
            "conflict",
            "ok",
        ], f"unexpected outcome combination {outcomes} — expected exactly one success and one LAST_OWNER conflict"

        remaining = (
            await db_session.scalars(
                select(BusinessMembership).where(
                    BusinessMembership.business_id == business.id,
                    BusinessMembership.role == BusinessMembershipRole.OWNER,
                )
            )
        ).all()
        assert len(remaining) == 1, "the business must be left with exactly the one OWNER that survived the race"
    finally:
        await engine_1.dispose()
        await engine_2.dispose()
        await _cleanup(db_session, users=(owner_a, owner_b), businesses=(business,))


@pytest.mark.asyncio
async def test_revoke_holds_the_business_lock_so_a_concurrent_mutation_blocks_then_sees_authoritative_state(
    db_session: AsyncSession,
) -> None:
    """Proves the Business-row lock itself, not just its outcome: R1's revoke
    is paused *mid-transaction*, after it has read the target but while it
    still holds `_locked_business`'s lock. R2 — a fully independent
    connection — then attempts a competing mutation on the same business and
    must be unable to cross that lock at all: a bounded wait for R2 to finish
    must time out while R1 is still paused. Only once R1 is allowed to finish
    (and its transaction closes, releasing the lock) does R2 proceed — and
    when it does, it must see the state R1 left behind, not anything from
    before.

    `target` is genuinely MANAGER throughout R1's transaction (R2 never got
    the chance to change it — that's exactly what the timeout proves), so
    R1's revoke succeeds. R2, once unblocked, tries to promote that same
    (now-deleted) membership and gets a 404 — the only way that's possible is
    if R2's own read, taken after R1 released the lock, is genuinely fresh.
    """
    business = await _make_business(db_session)
    original_owner = await _make_user(db_session, name="Original Owner")
    target = await _make_user(db_session, name="Target")
    await _add_membership(db_session, original_owner, business, BusinessMembershipRole.OWNER)
    target_membership = await _add_membership(db_session, target, business, BusinessMembershipRole.MANAGER)

    engine_1 = create_async_engine(settings.database_url, pool_pre_ping=True)
    engine_2 = create_async_engine(settings.database_url, pool_pre_ping=True)
    factory_1 = async_sessionmaker(engine_1, expire_on_commit=False, class_=AsyncSession)
    factory_2 = async_sessionmaker(engine_2, expire_on_commit=False, class_=AsyncSession)

    r1_has_read_the_target = asyncio.Event()
    r1_may_finish = asyncio.Event()
    real_membership_or_404 = membership_service._membership_or_404
    intercepted = False

    async def _membership_or_404_pausing_after_first_call(db: AsyncSession, business_id: str, membership_id: str):
        nonlocal intercepted
        result = await real_membership_or_404(db, business_id, membership_id)
        if not intercepted:
            intercepted = True
            r1_has_read_the_target.set()
            await r1_may_finish.wait()
        return result

    async def _r1_revoke() -> None:
        async with factory_1() as session:
            biz = await session.get(Business, business.id)
            assert biz is not None
            await membership_service.revoke_access(session, biz, target_membership.id)

    async def _r2_attempt_to_promote_the_same_target() -> str:
        async with factory_2() as session:
            biz = await session.get(Business, business.id)
            assert biz is not None
            try:
                await membership_service.change_role(session, biz, target_membership.id, BusinessMembershipRole.OWNER)
                return "ok"
            except HTTPException as exc:
                assert exc.status_code == 404
                return "not_found"

    try:
        with patch.object(membership_service, "_membership_or_404", _membership_or_404_pausing_after_first_call):
            r1_task = asyncio.create_task(_r1_revoke())
            await r1_has_read_the_target.wait()

            r2_task = asyncio.create_task(_r2_attempt_to_promote_the_same_target())
            with pytest.raises(asyncio.TimeoutError):
                await asyncio.wait_for(asyncio.shield(r2_task), timeout=0.5)

            r1_may_finish.set()
            await r1_task
            r2_outcome = await r2_task

        assert r2_outcome == "not_found", (
            f"got {r2_outcome!r} — R2's own read, taken after R1's lock released, must see R1's deletion, "
            "not a snapshot from before it"
        )

        refreshed = await db_session.scalar(
            select(BusinessMembership)
            .where(BusinessMembership.id == target_membership.id)
            .execution_options(populate_existing=True)
        )
        assert refreshed is None, "R1's revoke must have actually deleted the membership"
    finally:
        await engine_1.dispose()
        await engine_2.dispose()
        await _cleanup(db_session, users=(original_owner, target), businesses=(business,))


@pytest.mark.asyncio
async def test_change_role_matching_a_stale_belief_is_not_treated_as_a_no_op(db_session: AsyncSession) -> None:
    """Regression test for the review finding: a role-change request whose
    `new_role` happens to match a role the caller observed *before* a
    concurrent change could run must not be treated as a no-op on the
    strength of that stale belief — the no-op decision has to come from a
    read taken *under* the same lock that guards the last-OWNER decision.

    R1 (`change_role`, asking for MANAGER — the role it already believes the
    target holds) is paused immediately after its own read, but *while still
    holding* `_locked_business`'s lock. R2, an independent connection,
    attempts to promote that same target to OWNER concurrently:

    - Against the corrected Business-lock implementation, R2 cannot cross
      R1's lock at all — a bounded wait for R2 proves it hasn't run. R1
      therefore reads truthfully (the target really is MANAGER for the
      entirety of R1's transaction) and its no-op response is genuinely
      correct. R2 only proceeds once R1's transaction closes.
    - Against the previously vulnerable implementation — where this same
      read happens *before* any lock is taken — R2 is never blocked at all:
      it promotes the target to OWNER immediately, and R1, resuming with its
      now-stale pre-lock read, still reports "MANAGER" without ever
      re-checking. The bounded wait below does not time out in that case,
      which is exactly the discriminator: this test fails against the old
      implementation and passes against the corrected one.
    """
    business = await _make_business(db_session)
    original_owner = await _make_user(db_session, name="Original Owner")
    target = await _make_user(db_session, name="Target")
    original_owner_membership = await _add_membership(
        db_session, original_owner, business, BusinessMembershipRole.OWNER
    )
    target_membership = await _add_membership(db_session, target, business, BusinessMembershipRole.MANAGER)

    engine_1 = create_async_engine(settings.database_url, pool_pre_ping=True)
    engine_2 = create_async_engine(settings.database_url, pool_pre_ping=True)
    factory_1 = async_sessionmaker(engine_1, expire_on_commit=False, class_=AsyncSession)
    factory_2 = async_sessionmaker(engine_2, expire_on_commit=False, class_=AsyncSession)

    r1_has_read_the_target = asyncio.Event()
    r1_may_finish = asyncio.Event()
    real_membership_or_404 = membership_service._membership_or_404
    intercepted = False

    async def _membership_or_404_pausing_after_first_call(db: AsyncSession, business_id: str, membership_id: str):
        nonlocal intercepted
        result = await real_membership_or_404(db, business_id, membership_id)
        if not intercepted:
            intercepted = True
            r1_has_read_the_target.set()
            await r1_may_finish.wait()
        return result

    async def _r1_reassert_the_stale_role() -> str:
        async with factory_1() as session:
            biz = await session.get(Business, business.id)
            assert biz is not None
            try:
                result = await membership_service.change_role(
                    session, biz, target_membership.id, BusinessMembershipRole.MANAGER
                )
                return f"ok:{result.role.value}"
            except HTTPException as exc:
                assert exc.status_code == 409
                assert exc.detail["code"] == membership_service.LAST_OWNER
                return "conflict"

    async def _r2_promote_target_then_demote_the_original_owner() -> None:
        async with factory_2() as session:
            biz = await session.get(Business, business.id)
            assert biz is not None
            await membership_service.change_role(session, biz, target_membership.id, BusinessMembershipRole.OWNER)
            await membership_service.change_role(
                session, biz, original_owner_membership.id, BusinessMembershipRole.MANAGER
            )

    try:
        with patch.object(membership_service, "_membership_or_404", _membership_or_404_pausing_after_first_call):
            r1_task = asyncio.create_task(_r1_reassert_the_stale_role())
            await r1_has_read_the_target.wait()

            r2_task = asyncio.create_task(_r2_promote_target_then_demote_the_original_owner())
            with pytest.raises(asyncio.TimeoutError):
                await asyncio.wait_for(asyncio.shield(r2_task), timeout=0.5)

            r1_may_finish.set()
            outcome = await r1_task
            await r2_task

        assert outcome == "ok:MANAGER", (
            f"got {outcome!r} — R2 was proven blocked for the whole of R1's transaction, so R1's read of "
            "MANAGER was genuinely accurate and its no-op response is correct, not stale"
        )

        # `populate_existing()` — a plain SELECT still leaves an already-loaded
        # identity-mapped object's attributes untouched by default.
        refreshed = await db_session.scalar(
            select(BusinessMembership)
            .where(BusinessMembership.id == target_membership.id)
            .execution_options(populate_existing=True)
        )
        assert refreshed is not None
        assert refreshed.role == BusinessMembershipRole.OWNER, "R2's swap must have completed once unblocked"
    finally:
        await engine_1.dispose()
        await engine_2.dispose()
        await _cleanup(db_session, users=(original_owner, target), businesses=(business,))
