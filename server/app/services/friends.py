"""The social graph: mutual friendships, requests, and blocks.

One `user_friends` row is one relationship, oriented requester → recipient:

    pending   the requester asked; the recipient has not answered yet
    accepted  friends — the row counts for BOTH users, whichever way it points
    blocked   `follower_id` blocked `followee_id`; not a friendship

Direction only carries meaning while a request is pending (who asked whom) and
for blocks (who blocked whom). Once accepted, both users are friends and every
read path treats the row symmetrically — that is why every lookup here goes
through `_edges_between`, which ignores orientation.
"""

from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import and_, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    NOTIFICATION_FRIEND_ACCEPTED,
    NOTIFICATION_FRIEND_REQUESTED,
    FriendStatus,
    User,
    UserFriend,
)
from app.schemas.friend import (
    FriendRequestOut,
    FriendRequestsOut,
    FriendshipStatus,
    FriendStatusOut,
)
from app.services import notifications

# A pair can hold at most one row per direction. When both exist, the stronger
# status is the one the caller cares about.
_PRECEDENCE: dict[FriendshipStatus, int] = {"none": 0, "pending": 1, "accepted": 2, "blocked": 3}

# Incoming-request list is capped: it is rendered in full by the client and an
# unbounded fan-in would be a cheap DoS.
_MAX_INCOMING = 50


def _wire(value: FriendStatus) -> FriendshipStatus:
    """DB enum → API literal. Stored labels are lowercase (migration 0006)."""
    return value.value.lower()  # type: ignore[return-value]


def _strongest(edges: list[UserFriend]) -> FriendshipStatus:
    best: FriendshipStatus = "none"
    for edge in edges:
        candidate = _wire(edge.status)
        if _PRECEDENCE[candidate] > _PRECEDENCE[best]:
            best = candidate
    return best


async def _edges_between(db: AsyncSession, a_id: str, b_id: str) -> list[UserFriend]:
    """Every edge connecting the two users, in either direction."""
    rows = await db.scalars(
        select(UserFriend).where(
            or_(
                and_(UserFriend.follower_id == a_id, UserFriend.followee_id == b_id),
                and_(UserFriend.follower_id == b_id, UserFriend.followee_id == a_id),
            )
        )
    )
    return list(rows)


# ── Requests ──────────────────────────────────────────────────────────────────


async def send_request(db: AsyncSession, current: User, target_id: str) -> FriendStatusOut:
    if target_id == current.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cannot send a friend request to yourself")

    target = await db.get(User, target_id)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")

    edges = await _edges_between(db, current.id, target_id)

    if any(e.status == FriendStatus.BLOCKED for e in edges):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Cannot send a friend request to this user")
    if any(e.status == FriendStatus.ACCEPTED for e in edges):
        return FriendStatusOut(status="accepted")

    incoming = next(
        (e for e in edges if e.followee_id == current.id and e.status == FriendStatus.PENDING),
        None,
    )
    if incoming is not None:
        # They asked first — adding them back is an acceptance, not a second request.
        incoming.status = FriendStatus.ACCEPTED
        # Same outcome as tapping accept, so the original asker hears about it the
        # same way. Their stale "X wants to be friends" row goes too: the request
        # it points at has been settled, not left waiting.
        await notifications.delete_from_actor(db, current.id, NOTIFICATION_FRIEND_REQUESTED, target_id)
        notifications.create(
            db,
            target_id,
            NOTIFICATION_FRIEND_ACCEPTED,
            {"userId": current.id, "userName": current.name},
        )
        await db.commit()
        return FriendStatusOut(status="accepted")

    if any(e.status == FriendStatus.PENDING for e in edges):
        return FriendStatusOut(status="pending")  # already sent — idempotent

    # Query before staging the edge, not after. `has_unread_from` autoflushes any
    # pending insert, so adding the edge first would surface a concurrent duplicate
    # as an IntegrityError raised *there* — outside the try below, and a 500 rather
    # than the idempotent answer that block already knows how to give.
    #
    # `cancel_request` deletes the edge, so send → cancel → send finds nothing and
    # would stage a fresh row every cycle. The unread guard bounds that; without it
    # the notification list is itself the harassment vector.
    already_notified = await notifications.has_unread_from(db, target_id, NOTIFICATION_FRIEND_REQUESTED, current.id)

    db.add(UserFriend(follower_id=current.id, followee_id=target_id, status=FriendStatus.PENDING))
    if not already_notified:
        notifications.create(
            db,
            target_id,
            NOTIFICATION_FRIEND_REQUESTED,
            {"userId": current.id, "userName": current.name},
        )
    try:
        await db.commit()
    except IntegrityError:
        # A concurrent identical request won the unique constraint — report what persisted.
        await db.rollback()
        return FriendStatusOut(status=_strongest(await _edges_between(db, current.id, target_id)))
    return FriendStatusOut(status="pending")


async def cancel_request(db: AsyncSession, current: User, target_id: str) -> None:
    """Drop the pending request between the two users, whoever sent it."""
    removed = False
    for edge in await _edges_between(db, current.id, target_id):
        if edge.status == FriendStatus.PENDING:
            await db.delete(edge)
            removed = True
    if removed:
        # Withdrawn, so the recipient should not be left with a notification for a
        # request their tab no longer lists. Either direction may have been the
        # pending one, so clear both rather than guessing who asked.
        await notifications.delete_from_actor(db, target_id, NOTIFICATION_FRIEND_REQUESTED, current.id)
        await notifications.delete_from_actor(db, current.id, NOTIFICATION_FRIEND_REQUESTED, target_id)
        await db.commit()


async def incoming_requests(db: AsyncSession, current: User) -> FriendRequestsOut:
    edges = (
        await db.scalars(
            select(UserFriend)
            .where(
                UserFriend.followee_id == current.id,
                UserFriend.status == FriendStatus.PENDING,
            )
            .order_by(UserFriend.created_at.desc())
            .limit(_MAX_INCOMING)
        )
    ).all()
    if not edges:
        return FriendRequestsOut(requests=[])

    senders = {u.id: u for u in await db.scalars(select(User).where(User.id.in_([e.follower_id for e in edges])))}
    return FriendRequestsOut(
        requests=[
            FriendRequestOut(
                id=e.id,
                from_user_id=e.follower_id,
                from_user_name=senders[e.follower_id].name,
                from_user_level=senders[e.follower_id].level,
                from_user_city=senders[e.follower_id].city,
                created_at=e.created_at,
            )
            for e in edges
            if e.follower_id in senders
        ]
    )


async def _pending_addressed_to(db: AsyncSession, current: User, request_id: str) -> UserFriend:
    edge = await db.get(UserFriend, request_id)
    if edge is None or edge.followee_id != current.id or edge.status != FriendStatus.PENDING:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No pending friend request with this id")
    return edge


async def accept_request(db: AsyncSession, current: User, request_id: str) -> FriendStatusOut:
    edge = await _pending_addressed_to(db, current, request_id)
    edge.status = FriendStatus.ACCEPTED
    # Tell the requester. Incoming requests already have their own tab, but being
    # accepted has no surface anywhere else. The accepter's name is denormalised
    # in: a notification is a point-in-time record and the client cannot resolve
    # a bare user id.
    requester_id = edge.follower_id  # orientation only means "who asked" while pending
    notifications.create(
        db,
        requester_id,
        NOTIFICATION_FRIEND_ACCEPTED,
        {"userId": current.id, "userName": current.name},
    )
    # The request is answered — leaving the row would point at a tab that no longer lists it.
    await notifications.delete_from_actor(db, current.id, NOTIFICATION_FRIEND_REQUESTED, requester_id)
    await db.commit()
    return FriendStatusOut(status="accepted")


async def reject_request(db: AsyncSession, current: User, request_id: str) -> None:
    edge = await _pending_addressed_to(db, current, request_id)
    requester_id = edge.follower_id
    await db.delete(edge)
    # Rejection stays silent toward the requester — telling someone they were
    # turned down is worse than saying nothing. Only the now-stale request
    # notification in the rejecter's own list is cleared.
    await notifications.delete_from_actor(db, current.id, NOTIFICATION_FRIEND_REQUESTED, requester_id)
    await db.commit()


# ── Friendships ───────────────────────────────────────────────────────────────


async def remove_friend(db: AsyncSession, current: User, user_id: str) -> None:
    """Unfriend. Either side can call it, and either can re-add afterwards."""
    removed = False
    for edge in await _edges_between(db, current.id, user_id):
        if edge.status == FriendStatus.ACCEPTED:
            await db.delete(edge)
            removed = True
    if removed:
        await db.commit()


async def befriend(db: AsyncSession, initiator_id: str, other_id: str) -> FriendshipStatus:
    """Make two users friends with no request step — for invite redemption.

    The inviter handed out the link, which is the same consent as tapping accept,
    so this skips `pending`. A block on either side still wins.
    """
    edges = await _edges_between(db, initiator_id, other_id)

    if any(e.status == FriendStatus.BLOCKED for e in edges):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Cannot befriend this user")
    if any(e.status == FriendStatus.ACCEPTED for e in edges):
        return "accepted"

    pending = next((e for e in edges if e.status == FriendStatus.PENDING), None)
    if pending is not None:
        pending.status = FriendStatus.ACCEPTED  # an open request between them — settle it
    else:
        db.add(UserFriend(follower_id=initiator_id, followee_id=other_id, status=FriendStatus.ACCEPTED))

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        return _strongest(await _edges_between(db, initiator_id, other_id))
    return "accepted"


async def friend_ids(db: AsyncSession, user_id: str) -> set[str]:
    """Ids of everyone `user_id` is actually friends with, both directions."""
    rows = await db.execute(
        select(UserFriend.follower_id, UserFriend.followee_id).where(
            UserFriend.status == FriendStatus.ACCEPTED,
            or_(UserFriend.follower_id == user_id, UserFriend.followee_id == user_id),
        )
    )
    return {followee if follower == user_id else follower for follower, followee in rows}


async def status_map(db: AsyncSession, viewer_id: str, user_ids: list[str]) -> dict[str, FriendshipStatus]:
    """Friendship status from `viewer_id` toward each id — one query."""
    if not user_ids:
        return {}

    edges = await db.scalars(
        select(UserFriend).where(
            or_(
                and_(UserFriend.follower_id == viewer_id, UserFriend.followee_id.in_(user_ids)),
                and_(UserFriend.followee_id == viewer_id, UserFriend.follower_id.in_(user_ids)),
            )
        )
    )

    statuses: dict[str, FriendshipStatus] = {uid: "none" for uid in user_ids}
    for edge in edges:
        other = edge.followee_id if edge.follower_id == viewer_id else edge.follower_id
        candidate = _wire(edge.status)
        if _PRECEDENCE[candidate] > _PRECEDENCE[statuses[other]]:
            statuses[other] = candidate
    return statuses


# ── Blocks ────────────────────────────────────────────────────────────────────


async def block_user(db: AsyncSession, current: User, target_id: str) -> FriendStatusOut:
    """Block: any friendship or pending request between the two is dropped first."""
    if target_id == current.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cannot block yourself")

    forward: UserFriend | None = None
    for edge in await _edges_between(db, current.id, target_id):
        if edge.follower_id == current.id:
            forward = edge
        else:
            await db.delete(edge)

    if forward is not None:
        forward.status = FriendStatus.BLOCKED
    else:
        db.add(UserFriend(follower_id=current.id, followee_id=target_id, status=FriendStatus.BLOCKED))

    # A block settles any pending request between the pair, in whichever direction
    # it ran: an incoming one is deleted above, an outgoing one turns BLOCKED. Both
    # leave a notification pointing at a request that can no longer be accepted or
    # rejected — and unlike a cancel, the blocker cannot clear it by acting on it,
    # so the name of the person they just blocked would sit in their list forever.
    await notifications.delete_from_actor(db, current.id, NOTIFICATION_FRIEND_REQUESTED, target_id)
    await notifications.delete_from_actor(db, target_id, NOTIFICATION_FRIEND_REQUESTED, current.id)

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
    return FriendStatusOut(status="blocked")


async def unblock_user(db: AsyncSession, current: User, target_id: str) -> FriendStatusOut:
    for edge in await _edges_between(db, current.id, target_id):
        if edge.follower_id == current.id and edge.status == FriendStatus.BLOCKED:
            await db.delete(edge)
            await db.commit()
    return FriendStatusOut(status="none")
