"""Voucher-redemption permission management — list members, change role, revoke
access (CAR-117).

Builds on CAR-74's `business_memberships` table and reuses
`services/business_invitations.py`'s revoke shape where it still fits, but a
role change or a revoke here answers to a different invariant than that
module's one-time state flip: the business must never end up with zero
OWNERs. That can't be proven by reading and locking membership rows alone —
whatever rows a query locks, a second query naming a different predicate
(the target row here, the OWNER set there) can still lock a disjoint set and
deadlock against the first, and any decision built on a read taken before a
lock is a decision a concurrent commit can invalidate out from under it.

Every mutation instead takes one lock, first: `_locked_business` locks the
business's own `Business` row. Because that lock is the *only* thing every
CAR-117 mutation for a given business ever locks, and every mutation takes it
before reading or writing any membership row, only one such mutation for that
business can be mid-transaction at a time — a second blocks on the same row
until the first commits or rolls back. Everything read afterwards (the
target's current role, the full OWNER set) is read fresh, under that lock,
and is safe to trust with a plain `SELECT`: no concurrent mutation for this
business can be interleaved with it. Mutations for *different* businesses
lock different rows and stay fully independent.

This closes two related gaps a per-row locking scheme left open:

- A revoke or role change that read the target as non-OWNER, then acted on
  that stale read, could still be racing a concurrent promotion that made
  the target the business's only OWNER — the read and the decision have to
  be the same read, under the same lock, or the decision is only ever as
  good as a moment that's already passed.
- A role change whose requested role happens to match a role the caller
  observed earlier can look like a no-op from that stale read alone, even
  when a concurrent change already moved the target somewhere else — a
  "no-op" decision needs the same fresh, locked read as everything else, not
  an earlier one.
"""

from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.audit import audit
from app.models import Business, BusinessMembership, BusinessMembershipRole
from app.schemas.business_membership import BusinessMemberOut

LAST_OWNER = "LAST_OWNER"


def _member_out(membership: BusinessMembership) -> BusinessMemberOut:
    return BusinessMemberOut(
        id=membership.id,
        user_id=membership.user_id,
        name=membership.user.name,
        email=membership.user.email,
        role=membership.role,
        joined_at=membership.created_at,
    )


async def list_members(db: AsyncSession, business: Business) -> list[BusinessMemberOut]:
    memberships = (
        await db.scalars(
            select(BusinessMembership)
            .where(BusinessMembership.business_id == business.id)
            .options(selectinload(BusinessMembership.user))
            .order_by(BusinessMembership.created_at.asc())
        )
    ).all()
    return [_member_out(m) for m in memberships]


async def _locked_business(db: AsyncSession, business_id: str) -> None:
    """Lock the Business row for the rest of the caller's transaction.

    A single row locked by primary key has one, unambiguous lock order — two
    transactions racing this business's memberships either both get
    everything they need from this one acquisition, in turn, or the second
    blocks entirely until the first commits or rolls back. See the module
    docstring for why this replaced locking membership rows directly.
    """
    await db.execute(select(Business.id).where(Business.id == business_id).with_for_update())


async def _membership_or_404(db: AsyncSession, business_id: str, membership_id: str) -> BusinessMembership:
    """Load a membership scoped to this business, or 404.

    Always called *after* `_locked_business` — see the module docstring. A
    membership belonging to *another* business also yields 404 rather than
    403 — same reasoning as `business_service._owned_reward`: a 403 would
    confirm the id exists at all.
    """
    membership = await db.scalar(
        select(BusinessMembership)
        .where(BusinessMembership.id == membership_id, BusinessMembership.business_id == business_id)
        .options(selectinload(BusinessMembership.user))
    )
    if membership is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not found")
    return membership


async def _owner_rows(db: AsyncSession, business_id: str) -> list[BusinessMembership]:
    """Every OWNER row for this business. Always called after
    `_locked_business` — the business lock already serializes every CAR-117
    mutation for this business, so this plain read cannot race a concurrent
    one; it needs no lock of its own.
    """
    return list(
        (
            await db.scalars(
                select(BusinessMembership).where(
                    BusinessMembership.business_id == business_id,
                    BusinessMembership.role == BusinessMembershipRole.OWNER,
                )
            )
        ).all()
    )


def _last_owner_conflict() -> HTTPException:
    return HTTPException(
        status.HTTP_409_CONFLICT,
        {"code": LAST_OWNER, "message": "A business must keep at least one owner"},
    )


async def change_role(
    db: AsyncSession, business: Business, membership_id: str, new_role: BusinessMembershipRole
) -> BusinessMemberOut:
    await _locked_business(db, business.id)
    membership = await _membership_or_404(db, business.id, membership_id)

    # Read fresh, under the business lock — a caller's PATCH can name a role
    # that matches what it last observed even though the database has since
    # moved on; only this read decides whether it's actually a no-op.
    if membership.role == new_role:
        return _member_out(membership)

    owners = await _owner_rows(db, business.id)
    currently_owner = any(o.id == membership_id for o in owners)
    if currently_owner and new_role != BusinessMembershipRole.OWNER:
        if len([o for o in owners if o.id != membership_id]) == 0:
            await db.rollback()
            raise _last_owner_conflict()

    membership.role = new_role
    await db.commit()
    audit(
        "business.membership.role_changed",
        business_id=business.id,
        membership_id=membership.id,
        user_id=membership.user_id,
        role=new_role.value,
    )
    return _member_out(membership)


async def revoke_access(db: AsyncSession, business: Business, membership_id: str) -> None:
    await _locked_business(db, business.id)
    membership = await _membership_or_404(db, business.id, membership_id)

    owners = await _owner_rows(db, business.id)
    currently_owner = any(o.id == membership_id for o in owners)
    if currently_owner:
        if len([o for o in owners if o.id != membership_id]) == 0:
            await db.rollback()
            raise _last_owner_conflict()

    user_id = membership.user_id
    await db.execute(delete(BusinessMembership).where(BusinessMembership.id == membership_id))
    await db.commit()
    audit("business.membership.revoked", business_id=business.id, membership_id=membership_id, user_id=user_id)
