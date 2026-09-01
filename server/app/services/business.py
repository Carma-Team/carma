from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import CursorResult, func, select, tuple_, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.audit import audit
from app.core.pagination import decode_cursor, encode_cursor
from app.core.security import normalise_voucher_code
from app.models import (
    Business,
    BusinessCategory,
    BusinessMembership,
    BusinessMembershipRole,
    Redemption,
    RedemptionStatus,
    Reward,
    User,
)
from app.schemas.redemption import BusinessRedemptionOut
from app.schemas.reward import BusinessRewardIn, BusinessRewardPatchIn, BusinessVoucherOut, RewardOut
from app.services import rewards as rewards_service

_CATEGORY_BY_STR = {c.value.lower(): c for c in BusinessCategory}

# CAR-118 review item 3 (and its follow-up bounded-correction round, item 2):
# until business switching exists, one account may hold a membership in at
# most one business — every path that creates a `BusinessMembership` shares
# this one code and this one check, so there is exactly one place that
# invariant can drift.
INCOMPATIBLE_BUSINESS = "INCOMPATIBLE_BUSINESS"


def _parse_category(value: str) -> BusinessCategory:
    category = _CATEGORY_BY_STR.get(value.lower())
    if category is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown category '{value}'")
    return category


async def lock_user_for_membership_change(db: AsyncSession, user_id: str) -> None:
    """Serializes every path that creates or gates on this user's business
    memberships against every other one — invitation acceptance
    (`business_invitations.py::accept_invitation`) and business-registration
    approval (`business_join_requests.py::approve_join_request`, via
    `ensure_owner_membership`) both call this first, before checking or
    writing `BusinessMembership`. Without it, two concurrent requests for the
    same user — one on each path — can each pass their own "no conflicting
    membership yet" check before either commits, landing the account in the
    two-business state CAR-118's own invariant exists to prevent. Always the
    same single resource (this user's own row, held only for the rest of the
    caller's transaction), so there is nothing for two callers to deadlock
    over.
    """
    await db.execute(select(User.id).where(User.id == user_id).with_for_update())


async def assert_membership_allowed(db: AsyncSession, user_id: str, business_id: str) -> BusinessMembership | None:
    """The one cross-business invariant every membership-creating path shares
    — `accept_invitation` and `ensure_owner_membership` alike call this right
    after `lock_user_for_membership_change`, never invent their own copy of
    the same query.

    Returns the existing row when this user is already a member of *this*
    business (the caller's own job to treat as idempotent — accept_invitation
    reports it as a named conflict, `ensure_owner_membership` silently no-ops),
    or `None` when there is nothing yet and creating a fresh membership is
    safe. Raises when a membership exists for a *different* business — a
    structured 409 the caller does not need to build itself, since every
    caller reacts to it the same way: refuse, touch nothing else.

    Rolls back before raising: `ensure_owner_membership` runs after its
    caller's own `db.flush()` (CAR-77's new `Business` row, not yet
    committed) — this must undo that half-created row rather than leave it
    dangling once the exception propagates past the caller with no commit of
    its own to land it.
    """
    memberships = (await db.scalars(select(BusinessMembership).where(BusinessMembership.user_id == user_id))).all()
    existing = next((m for m in memberships if m.business_id == business_id), None)
    if existing is not None:
        return existing
    if memberships:
        await db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            {"code": INCOMPATIBLE_BUSINESS, "message": "This account already belongs to a different business"},
        )
    return None


async def list_memberships(db: AsyncSession, user_id: str) -> list[BusinessMembership]:
    """Every `business_memberships` row for this user, business eager-loaded.

    The one query definition for "what does this account belong to" — both
    `core.deps.current_business` (authorization: fails closed on zero/many)
    and `services.users.profile_out` (the read-only session/profile contract,
    CAR-258: flags many rather than failing) resolve off this, so the two can
    never read the table differently.
    """
    return list(
        (
            await db.scalars(
                select(BusinessMembership)
                .where(BusinessMembership.user_id == user_id)
                .options(selectinload(BusinessMembership.business))
            )
        ).all()
    )


async def ensure_owner_membership(db: AsyncSession, business_id: str, user_id: str) -> None:
    """Grant OWNER access to a business's owner, if it does not already exist.

    Every path that sets `Business.owner_user_id` outside of the one-time
    migration backfill (CAR-77's approve flow, `seed.py`) must call this too —
    otherwise the owner it just created has no membership row and
    `current_business` refuses them with a 403 on their very first request.
    Idempotent so a re-run (e.g. `seed.py` against an already-seeded database)
    does not trip the table's `UNIQUE(user_id, business_id)`. Locks the user
    row first (see `lock_user_for_membership_change`) and shares
    `assert_membership_allowed` with `accept_invitation` — the same guard, so
    this and an invitation acceptance racing for the same user cannot both
    pass their own pre-check before either commits, and an applicant who
    already belongs to a business via an accepted invitation cannot also be
    approved to own a second one (CAR-118 review's bounded-correction round,
    item 2).
    """
    await lock_user_for_membership_change(db, user_id)
    existing = await assert_membership_allowed(db, user_id, business_id)
    if existing is None:
        db.add(BusinessMembership(business_id=business_id, user_id=user_id, role=BusinessMembershipRole.OWNER))


async def _owned_reward(db: AsyncSession, business: Business, reward_id: str) -> Reward:
    """Load a reward that belongs to this business, or 404.

    A reward owned by *another* business also yields 404 rather than 403 — a 403
    would confirm the id exists and leak the catalog of a competitor.
    """
    reward = await db.scalar(
        select(Reward)
        .where(Reward.id == reward_id, Reward.business_id == business.id)
        .options(selectinload(Reward.business))
    )
    if reward is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Reward not found")
    return reward


async def list_rewards(db: AsyncSession, business: Business, role: BusinessMembershipRole) -> dict[str, object]:
    """Every reward of this business — inactive ones included, unlike the driver-facing list.

    A CASHIER is the one role CAR-74 caps at "view active rewards": the query
    gets `rewards_service.active_reward_where`, the exact predicate the
    driver-facing catalog filters on (CAR-131's campaign-expiry leg included),
    rather than a second definition of "active" invented for this endpoint.
    OWNER and MANAGER are unchanged — they manage the catalog, so they still
    see everything.
    """
    query = select(Reward).where(Reward.business_id == business.id).options(selectinload(Reward.business))
    if role == BusinessMembershipRole.CASHIER:
        query = query.where(*rewards_service.active_reward_where(datetime.now(UTC)))
    rewards = (await db.scalars(query.order_by(Reward.created_at.desc()))).all()
    claimed = await rewards_service.claimed_by_reward(db, [r.id for r in rewards])
    return {
        "rewards": [
            RewardOut.from_orm_reward(r, rewards_service.available_units(r.stock, claimed.get(r.id, 0)))
            for r in rewards
        ]
    }


async def create_reward(db: AsyncSession, business: Business, dto: BusinessRewardIn) -> RewardOut:
    category = _parse_category(dto.category) if dto.category else business.category

    reward = Reward(
        business_id=business.id,
        title_he=dto.title_he,
        title_en=dto.title_en,
        description_he=dto.description_he,
        description_en=dto.description_en,
        category=category,
        cost_points=dto.cost_points,
        image_icon=dto.image_icon,
        is_active=dto.is_active,
        stock=dto.stock,
        expires_at=dto.expires_at,
    )
    db.add(reward)
    await db.commit()
    await db.refresh(reward)
    reward.business = business  # already loaded — spares RewardOut a lazy load
    audit("business.reward.created", business_id=business.id, reward_id=reward.id, cost_points=reward.cost_points)
    # Brand new, so nothing can be claimed against it yet — the whole cap is free.
    return RewardOut.from_orm_reward(reward, reward.stock)


async def update_reward(db: AsyncSession, business: Business, reward_id: str, dto: BusinessRewardPatchIn) -> RewardOut:
    reward = await _owned_reward(db, business, reward_id)

    changes = dto.model_dump(exclude_unset=True)
    if "category" in changes and changes["category"] is not None:
        changes["category"] = _parse_category(changes["category"])
    for field, value in changes.items():
        setattr(reward, field, value)

    # No refresh(): the session is expire_on_commit=False, so `reward.business`
    # stays loaded from _owned_reward. A refresh would expire it and RewardOut
    # would trip a lazy load on the async session.
    await db.commit()
    audit("business.reward.updated", business_id=business.id, reward_id=reward.id, fields=sorted(changes))
    claimed = await rewards_service.claimed_by_reward(db, [reward.id])
    return RewardOut.from_orm_reward(reward, rewards_service.available_units(reward.stock, claimed.get(reward.id, 0)))


async def live_voucher_count(db: AsyncSession, business: Business, reward_id: str) -> int:
    """Outstanding vouchers a business should know about before archiving this reward."""
    reward = await _owned_reward(db, business, reward_id)
    return await rewards_service.count_live_vouchers(db, reward.id)


async def archive_reward(db: AsyncSession, business: Business, reward_id: str) -> None:
    """Archive a reward — it leaves the catalog, but the row and its vouchers stay.

    Replaces the old hard delete, which `Redemption.reward_id` (NOT NULL, no
    cascade) made unsafe the moment a voucher existed — this used to 409 instead
    of risking that. Archiving sidesteps the FK entirely: nothing is removed, so
    a voucher already issued keeps working to its own expiry (CAR-111).
    """
    reward = await _owned_reward(db, business, reward_id)
    reward.archived_at = datetime.now(UTC)
    await db.commit()
    audit("business.reward.archived", business_id=business.id, reward_id=reward_id)


# ── Vouchers ─────────────────────────────────────────────────────────────────

# Same convention as `services.rewards`'s REWARD_* codes: a client branches on
# `detail["code"]`, never on `detail["message"]` — the two 409s below share a
# status code and used to share a bare-string detail too, which left "already
# used" and "expired" distinguishable only by sniffing English text (CAR-67).
VOUCHER_ALREADY_USED = "VOUCHER_ALREADY_USED"
VOUCHER_EXPIRED = "VOUCHER_EXPIRED"


async def _owned_voucher(db: AsyncSession, business: Business, code: str) -> Redemption:
    """Load a voucher issued against one of this business's rewards, or 404.

    Settles the TTL first, so a caller always sees a voucher's true current state
    rather than a PENDING row that lapsed minutes ago. A voucher belonging to
    another business is a 404 like an unknown code — a distinct error would let
    one business probe another's codes.
    """
    # Typed in at a counter as often as scanned, so it arrives in whatever case
    # and spacing the cashier used. Fold it once, here, and both the settle below
    # and the lookup see the form the database actually stores.
    code = normalise_voucher_code(code)

    # expire_overdue leaves the commit to its caller. Nothing else is in flight
    # here, so the settle is committed on its own before the row is read back.
    await rewards_service.expire_overdue(db, Redemption.qr_code == code)
    await db.commit()

    voucher = await db.scalar(
        select(Redemption)
        .where(Redemption.qr_code == code)
        .options(selectinload(Redemption.reward).selectinload(Reward.business))
    )
    if voucher is None or voucher.reward.business_id != business.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Voucher not found")
    return voucher


async def peek_voucher(db: AsyncSession, business: Business, code: str) -> BusinessVoucherOut:
    """What a scan shows before anyone commits to handing over the goods.

    Read-only on purpose: an employee scanning to check validity must not burn
    the voucher, and a scan that fails halfway must not leave it consumed.
    """
    voucher = await _owned_voucher(db, business, code)
    return await _voucher_out(db, voucher)


async def consume_voucher(
    db: AsyncSession, business: Business, code: str, *, consumed_by_user_id: str
) -> BusinessVoucherOut:
    """Mark a voucher USED — the step that finally closes the redemption loop.

    `consumed_by_user_id` is the acting business member's own user id (CAR-75)
    — required, not defaulted: every new consume must name who did it, and a
    caller with no member to name has no business calling this at all. The
    router always passes `CurrentBusinessMembership.user_id`. Written in the
    same UPDATE as the status flip below, never a separate write, so a voucher
    can never end up USED with no member recorded or vice versa; a losing race
    or a rejected (already-used, expired) attempt never reaches this UPDATE at
    all, so it records nothing either way.
    """
    voucher = await _owned_voucher(db, business, code)

    # Conditional UPDATE rather than a read-then-write: two tills scanning the
    # same QR at once must not both come back "valid, serve the customer".
    now = datetime.now(UTC)
    # Held as a plain value: the rollback below expires every instance in the
    # session, and reading voucher.id afterwards would trigger a lazy load.
    voucher_id = voucher.id
    # See the note in rewards.py: a DML execute returns a CursorResult at
    # runtime, but `execute` is typed as returning a plain Result.
    used: CursorResult[Any] = await db.execute(  # type: ignore[assignment]
        update(Redemption)
        .where(Redemption.id == voucher_id, *rewards_service.live_voucher_where(now))
        .values(status=RedemptionStatus.USED, used_at=now, settled_at=now, consumed_by_user_id=consumed_by_user_id)
    )
    if used.rowcount == 0:
        await db.rollback()
        # Re-read rather than trusting the status loaded a moment ago: whoever won
        # the race is the reason this lost, and the client deserves the real one.
        current = await db.scalar(select(Redemption.status).where(Redemption.id == voucher_id))
        if current == RedemptionStatus.USED:
            raise HTTPException(
                status.HTTP_409_CONFLICT, {"code": VOUCHER_ALREADY_USED, "message": "Voucher already used"}
            )
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": VOUCHER_EXPIRED, "message": "Voucher expired"})

    # CAR-109: unconditional — CAR-73's reservation invariant (available =
    # points - reserved, enforced on the issue path) guarantees the points are
    # there. Gating this on balance would strand a voucher USED-but-unpaid
    # after the goods already left the till, which is worse than a negative
    # balance. Joins the conditional UPDATE above in the same transaction, so a
    # failure here rolls back the status flip too.
    new_points = await db.scalar(
        update(User)
        .where(User.id == voucher.user_id)
        .values(points=User.points - voucher.points_cost)
        .returning(User.points)
    )
    assert new_points is not None, "the voucher's user must still exist"
    if new_points < 0:
        audit(
            "rewards.points.negative_after_debit",
            user_id=voucher.user_id,
            voucher_id=voucher.id,
            points_cost=voucher.points_cost,
            resulting_points=new_points,
        )

    await db.commit()
    await db.refresh(voucher, attribute_names=["status", "used_at", "settled_at"])
    audit(
        "business.voucher.consumed",
        business_id=business.id,
        voucher_id=voucher.id,
        reward_id=voucher.reward_id,
        user_id=voucher.user_id,
        consumed_by_user_id=consumed_by_user_id,
    )
    return await _voucher_out(db, voucher)


async def _voucher_out(db: AsyncSession, voucher: Redemption) -> BusinessVoucherOut:
    """BusinessVoucherOut with the reward's availability counted for it."""
    claimed = await rewards_service.claimed_by_reward(db, [voucher.reward_id])
    available = rewards_service.available_units(voucher.reward.stock, claimed.get(voucher.reward_id, 0))
    return BusinessVoucherOut.from_orm_redemption(voucher, available)


# ── Redemption history (CAR-79) ─────────────────────────────────────────────

# Bounded and server-capped: a business scrolling its own history has no
# reason to pull more than this in one page, and an unbounded `limit` would
# turn one request into a full-table pull.
REDEMPTION_HISTORY_MAX_LIMIT = 100
REDEMPTION_HISTORY_DEFAULT_LIMIT = 20

# PENDING is deliberately excluded — a live voucher is in flight, not history,
# and CAR-79 exposes its count separately rather than as a filterable status.
_HISTORY_STATUSES = (RedemptionStatus.USED, RedemptionStatus.EXPIRED, RedemptionStatus.CANCELLED)
_HISTORY_STATUS_BY_STR = {s.value.lower(): s for s in _HISTORY_STATUSES}


def parse_redemption_status_filter(value: str | None) -> set[RedemptionStatus]:
    """Comma-separated `status` query value into the set of statuses to show.

    Defaults to `{USED}` alone — that is what "history" means to a shop owner
    (CAR-79). Any value outside USED/EXPIRED/CANCELLED, PENDING included, is a
    400: live vouchers are never a valid history filter.
    """
    if value is None:
        return {RedemptionStatus.USED}
    statuses: set[RedemptionStatus] = set()
    for part in value.split(","):
        part = part.strip().lower()
        if not part:
            continue
        parsed = _HISTORY_STATUS_BY_STR.get(part)
        if parsed is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown status '{part}'")
        statuses.add(parsed)
    if not statuses:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "At least one status is required")
    return statuses


async def _live_voucher_count(db: AsyncSession, business_id: str) -> int:
    """Vouchers this business has outstanding right now — CAR-79's separate counter.

    Shares `live_voucher_where` with `rewards_service.count_live_vouchers` so
    "live" can never mean something different here than it does when a reward
    is archived.
    """
    count = await db.scalar(
        select(func.count())
        .select_from(Redemption)
        .where(Redemption.business_id == business_id, *rewards_service.live_voucher_where(datetime.now(UTC)))
    )
    return count or 0


async def _consumer_names(db: AsyncSession, user_ids: set[str]) -> dict[str, str | None]:
    """Batch name lookup for the business members who consumed a page of vouchers.

    One query for the whole page, the same shape as `rewards_service.claimed_by_reward`
    — not a per-row lazy load on an async session, which would trip on the first row.
    """
    if not user_ids:
        return {}
    rows = (await db.execute(select(User.id, User.name).where(User.id.in_(user_ids)))).all()
    return {row.id: row.name for row in rows}


async def list_redemptions(
    db: AsyncSession,
    business: Business,
    *,
    statuses: set[RedemptionStatus],
    reward_id: str | None,
    settled_from: datetime | None,
    settled_to: datetime | None,
    cursor: str | None,
    limit: int,
) -> dict[str, object]:
    """This business's redemption history, newest settlement first (CAR-79).

    Settles any of this business's overdue-but-still-PENDING vouchers first —
    the same lazy-expiry step `_owned_voucher` runs before a peek — so a
    voucher that lapsed since the last read shows up as EXPIRED and drops out
    of the live count in the same response, rather than one page later.

    Keyset-paged on `(settled_at, id)` descending, matching index
    `ix_redemptions_business_settled_id`: `id` breaks ties between rows that
    settled in the same instant, which a timestamp alone cannot. The keyset
    predicate only ever looks *below* the cursor, so a new settlement — always
    newer than anything already paged past — can never be skipped past or
    re-shown to a client mid-page.
    """
    await rewards_service.expire_overdue(db, Redemption.business_id == business.id)
    await db.commit()

    query = (
        select(Redemption)
        .where(
            Redemption.business_id == business.id,
            Redemption.status.in_(statuses),
            # Defensive, not a fix for CAR-283/287: every write path that sets a
            # terminal status also sets settled_at in the same statement, but the
            # DB-level CHECK enforcing that is out for the expand window. This is
            # what keeps a row that somehow violates it from reading as history
            # instead of quietly having no sort key.
            Redemption.settled_at.is_not(None),
        )
        .options(selectinload(Redemption.reward))
    )
    if reward_id is not None:
        query = query.where(Redemption.reward_id == reward_id)
    if settled_from is not None:
        query = query.where(Redemption.settled_at >= settled_from)
    if settled_to is not None:
        query = query.where(Redemption.settled_at <= settled_to)
    if cursor is not None:
        cursor_settled_at, cursor_id = decode_cursor(cursor)
        query = query.where(tuple_(Redemption.settled_at, Redemption.id) < (cursor_settled_at, cursor_id))

    # One extra row fetched, never returned: its presence is what tells us
    # whether there is a next page, without a separate COUNT query.
    query = query.order_by(Redemption.settled_at.desc(), Redemption.id.desc()).limit(limit + 1)
    rows = list((await db.scalars(query)).all())

    next_cursor: str | None = None
    if len(rows) > limit:
        rows = rows[:limit]
        last = rows[-1]
        assert last.settled_at is not None  # guaranteed by the is_not(None) filter above
        next_cursor = encode_cursor(last.settled_at, last.id)

    names = await _consumer_names(db, {r.consumed_by_user_id for r in rows if r.consumed_by_user_id is not None})
    redemptions = [
        BusinessRedemptionOut.from_orm_redemption(
            r, names.get(r.consumed_by_user_id) if r.consumed_by_user_id else None
        )
        for r in rows
    ]
    live_voucher_count = await _live_voucher_count(db, business.id)
    return {
        "redemptions": redemptions,
        "live_voucher_count": live_voucher_count,
        "next_cursor": next_cursor,
    }
