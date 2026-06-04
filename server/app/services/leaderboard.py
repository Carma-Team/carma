from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import FriendStatus, User, UserFriend, UserRole
from app.schemas.leaderboard import (
    FollowRequestOut,
    FollowStatus,
    FollowStatusOut,
    LeaderboardEntry,
    LeaderboardOut,
    LeaderboardType,
    LeaderboardUserSummary,
)


def _status_for(edge: UserFriend | None) -> FollowStatus:
    if edge is None:
        return "none"
    return edge.status.value.lower()  # type: ignore[return-value]


async def _edge(db: AsyncSession, follower_id: str, followee_id: str) -> UserFriend | None:
    return await db.scalar(
        select(UserFriend).where(
            UserFriend.follower_id == follower_id,
            UserFriend.followee_id == followee_id,
        )
    )


async def _status_map(db: AsyncSession, viewer_id: str, user_ids: list[str]) -> dict[str, FollowStatus]:
    """Return follow status from viewer → each user in user_ids."""
    if not user_ids:
        return {}
    edges = (
        await db.scalars(
            select(UserFriend).where(
                UserFriend.follower_id == viewer_id,
                UserFriend.followee_id.in_(user_ids),
            )
        )
    ).all()
    m: dict[str, FollowStatus] = {uid: "none" for uid in user_ids}
    for edge in edges:
        m[edge.followee_id] = edge.status.value.lower()  # type: ignore[assignment]
    return m


async def get(db: AsyncSession, current: User, type_: LeaderboardType) -> LeaderboardOut:
    if type_ == "friends":
        # One query covers both accepted-friend filtering AND per-user follow status —
        # eliminating the separate _accepted_followee_ids + _status_map round-trips.
        edges = (await db.scalars(select(UserFriend).where(UserFriend.follower_id == current.id))).all()
        accepted_ids: set[str] = {e.followee_id for e in edges if e.status == FriendStatus.ACCEPTED}
        accepted_ids.add(current.id)
        statuses: dict[str, FollowStatus] = {
            e.followee_id: e.status.value.lower()  # type: ignore[misc]
            for e in edges
        }
        users = (
            await db.scalars(
                select(User)
                .where(User.role == UserRole.DRIVER, User.id.in_(accepted_ids))
                .order_by(User.total_points.desc(), User.created_at.asc())
                .limit(100)
            )
        ).all()
    else:
        stmt = select(User).where(User.role == UserRole.DRIVER, User.is_private.is_(False))
        if type_ == "city" and current.city:
            stmt = stmt.where(User.city == current.city)
        users = (await db.scalars(stmt.order_by(User.total_points.desc(), User.created_at.asc()).limit(100))).all()
        statuses = await _status_map(db, current.id, [u.id for u in users])

    entries = [
        LeaderboardEntry(
            id=f"entry-{u.id}",
            user_id=u.id,
            rank=idx + 1,
            score=u.total_points,
            follow_status=statuses.get(u.id, "none"),
            user=LeaderboardUserSummary(
                id=u.id,
                name=u.name,
                city=u.city,
                level=u.level,
                avatar_url=u.avatar_url,
                is_private=u.is_private,
            ),
        )
        for idx, u in enumerate(users)
    ]

    # If current user didn't land in the visible window, compute their absolute rank.
    my_rank: int | None = None
    if not any(u.id == current.id for u in users) and type_ != "friends":
        above = await db.scalar(
            select(func.count())
            .select_from(User)
            .where(
                User.role == UserRole.DRIVER,
                User.is_private.is_(False),
                User.total_points > current.total_points,
            )
        )
        my_rank = (above or 0) + 1

    return LeaderboardOut(entries=entries, current_user_id=current.id, my_rank=my_rank)


async def follow(db: AsyncSession, current: User, target_id: str) -> FollowStatusOut:
    if target_id == current.id:
        raise HTTPException(400, "Cannot follow yourself")

    target = await db.scalar(select(User).where(User.id == target_id))
    if target is None:
        raise HTTPException(404, "User not found")

    edge = await _edge(db, current.id, target_id)

    if edge and edge.status == FriendStatus.BLOCKED:
        # Current user has blocked target — cannot re-follow without unblocking first
        return FollowStatusOut(status="none")

    # Check if target blocked current user
    reverse_block = await _edge(db, target_id, current.id)
    if reverse_block and reverse_block.status == FriendStatus.BLOCKED:
        return FollowStatusOut(status="none")

    if edge and edge.status in (FriendStatus.ACCEPTED, FriendStatus.PENDING):
        return FollowStatusOut(status=edge.status.value.lower())  # type: ignore[arg-type]

    new_status = FriendStatus.PENDING if target.is_private else FriendStatus.ACCEPTED
    if edge:
        edge.status = new_status
    else:
        db.add(UserFriend(follower_id=current.id, followee_id=target_id, status=new_status))
    try:
        await db.commit()
    except IntegrityError:
        # Concurrent identical request already committed — return the actual persisted state.
        await db.rollback()
        existing = await _edge(db, current.id, target_id)
        if existing:
            return FollowStatusOut(status=existing.status.value.lower())  # type: ignore[arg-type]
    return FollowStatusOut(status=new_status.value.lower())  # type: ignore[arg-type]


async def unfollow(db: AsyncSession, current: User, target_id: str) -> FollowStatusOut:
    edge = await _edge(db, current.id, target_id)
    if edge and edge.status != FriendStatus.BLOCKED:
        await db.delete(edge)
        await db.commit()
    return FollowStatusOut(status="none")


async def get_follow_status(db: AsyncSession, current: User, target_id: str) -> FollowStatusOut:
    edge = await _edge(db, current.id, target_id)
    return FollowStatusOut(status=_status_for(edge))


async def incoming_requests(db: AsyncSession, current: User) -> list[FollowRequestOut]:
    edges = (
        await db.scalars(
            select(UserFriend)
            .where(
                UserFriend.followee_id == current.id,
                UserFriend.status == FriendStatus.PENDING,
            )
            .limit(50)
        )
    ).all()
    if not edges:
        return []

    follower_ids = [e.follower_id for e in edges]
    users = (await db.scalars(select(User).where(User.id.in_(follower_ids)))).all()
    user_map = {u.id: u for u in users}

    return [
        FollowRequestOut(
            follower_id=e.follower_id,
            follower_name=user_map[e.follower_id].name if e.follower_id in user_map else None,
            follower_level=user_map[e.follower_id].level if e.follower_id in user_map else 1,
            follower_city=user_map[e.follower_id].city if e.follower_id in user_map else None,
            requested_at=e.created_at,
        )
        for e in edges
        if e.follower_id in user_map
    ]


async def accept_request(db: AsyncSession, current: User, follower_id: str) -> FollowStatusOut:
    edge = await _edge(db, follower_id, current.id)
    if edge is None or edge.status != FriendStatus.PENDING:
        raise HTTPException(404, "No pending request from this user")
    edge.status = FriendStatus.ACCEPTED
    await db.commit()
    return FollowStatusOut(status="accepted")


async def reject_request(db: AsyncSession, current: User, follower_id: str) -> FollowStatusOut:
    edge = await _edge(db, follower_id, current.id)
    if edge and edge.status == FriendStatus.PENDING:
        await db.delete(edge)
        await db.commit()
    return FollowStatusOut(status="none")


async def block_user(db: AsyncSession, current: User, target_id: str) -> FollowStatusOut:
    if target_id == current.id:
        raise HTTPException(400, "Cannot block yourself")

    # Remove any existing edge target → current (unfollow current from target's perspective)
    reverse = await _edge(db, target_id, current.id)
    if reverse:
        await db.delete(reverse)

    # Upsert block edge current → target
    edge = await _edge(db, current.id, target_id)
    if edge:
        edge.status = FriendStatus.BLOCKED
    else:
        db.add(UserFriend(follower_id=current.id, followee_id=target_id, status=FriendStatus.BLOCKED))
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
    return FollowStatusOut(status="blocked")


async def unblock_user(db: AsyncSession, current: User, target_id: str) -> FollowStatusOut:
    edge = await _edge(db, current.id, target_id)
    if edge and edge.status == FriendStatus.BLOCKED:
        await db.delete(edge)
        await db.commit()
    return FollowStatusOut(status="none")
