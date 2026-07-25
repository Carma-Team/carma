"""Notifications: both triggers, the read endpoints, and per-user isolation.

Two writers today: a level-up inside trips.save, and a follow request being
accepted inside leaderboard.accept_request. Both stage their row
on the triggering action's transaction, so these exercise the real services
against Postgres rather than mocking the session — what is worth proving is
that RETURNING reports the level the CASE expression actually resolved to, and
that the follow notification reaches the follower rather than the accepter.
Neither is observable through a mock. Skipped automatically when no Postgres is
reachable (see conftest).

The auth guards at the bottom are pure in-process ASGI — no DB.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.main import app
from app.models import NOTIFICATION_FOLLOW_ACCEPTED, NOTIFICATION_LEVEL_UP, Notification, Trip, User, UserFriend
from app.models.enums import UserRole
from app.schemas.trip import SaveTripIn
from app.services import leaderboard as leaderboard_service
from app.services import notifications as svc
from app.services import trips as trips_service

# Level 2 starts at 500 total points (trips._LEVEL_THRESHOLDS).
_LEVEL_2_THRESHOLD = 500


@pytest.fixture
def clean_trip() -> SaveTripIn:
    """A short, event-free trip — scores well and always yields at least one point."""
    return SaveTripIn(
        distanceKm=6.2,
        durationSeconds=900,
        startTime="2026-06-14T08:00:00Z",
        endTime="2026-06-14T08:15:00Z",
    )


async def _make_user(db: AsyncSession, *, total_points: int = 0, level: int = 1) -> User:
    user = User(
        email=f"_notif_{uuid.uuid4().hex[:10]}@carma.test",
        password_hash="x",
        role=UserRole.DRIVER,
        name="Notif Test",
        points=total_points,
        total_points=total_points,
        level=level,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def _cleanup(db: AsyncSession, *users: User) -> None:
    for user in users:
        await db.execute(delete(Notification).where(Notification.user_id == user.id))
        await db.execute(delete(Trip).where(Trip.user_id == user.id))
        await db.delete(user)
    await db.commit()


async def _notifications_of(db: AsyncSession, user: User) -> list[Notification]:
    rows = await db.scalars(select(Notification).where(Notification.user_id == user.id))
    return list(rows)


@pytest.mark.asyncio
async def test_crossing_a_threshold_creates_one_level_up_notification(
    db_session: AsyncSession, clean_trip: SaveTripIn
) -> None:
    # One point short of level 2, so any scoring trip crosses the boundary.
    user = await _make_user(db_session, total_points=_LEVEL_2_THRESHOLD - 1)
    try:
        await trips_service.save(db_session, user, clean_trip, idempotency_key=uuid.uuid4().hex)

        await db_session.refresh(user)
        assert user.level == 2, "setup precondition: the trip should have crossed into level 2"

        rows = await _notifications_of(db_session, user)
        assert len(rows) == 1
        assert rows[0].type == NOTIFICATION_LEVEL_UP
        assert rows[0].payload == {"level": 2, "previousLevel": 1}
        assert rows[0].read_at is None, "a fresh notification must start unread"
    finally:
        await _cleanup(db_session, user)


@pytest.mark.asyncio
async def test_trip_without_a_level_change_creates_nothing(db_session: AsyncSession, clean_trip: SaveTripIn) -> None:
    user = await _make_user(db_session, total_points=0)
    try:
        await trips_service.save(db_session, user, clean_trip, idempotency_key=uuid.uuid4().hex)

        await db_session.refresh(user)
        assert user.level == 1, "setup precondition: one trip from zero must not reach level 2"
        assert await _notifications_of(db_session, user) == []
    finally:
        await _cleanup(db_session, user)


@pytest.mark.asyncio
async def test_mark_read_is_idempotent_and_preserves_the_first_timestamp(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    try:
        svc.create(db_session, user.id, NOTIFICATION_LEVEL_UP, {"level": 2, "previousLevel": 1})
        await db_session.commit()
        row = (await _notifications_of(db_session, user))[0]

        assert await svc.mark_read(db_session, user.id, row.id) is True
        await db_session.refresh(row)
        first_read_at = row.read_at
        assert first_read_at is not None

        # Replaying the call must stay truthy and must not move the timestamp.
        assert await svc.mark_read(db_session, user.id, row.id) is True
        await db_session.refresh(row)
        assert row.read_at == first_read_at
    finally:
        await _cleanup(db_session, user)


@pytest.mark.asyncio
async def test_one_user_cannot_read_or_mark_anothers_notifications(db_session: AsyncSession) -> None:
    owner = await _make_user(db_session)
    intruder = await _make_user(db_session)
    try:
        svc.create(db_session, owner.id, NOTIFICATION_LEVEL_UP, {"level": 2, "previousLevel": 1})
        await db_session.commit()
        row = (await _notifications_of(db_session, owner))[0]

        assert await svc.list_for_user(db_session, intruder.id) == []
        # A crafted id must not mark someone else's row read.
        assert await svc.mark_read(db_session, intruder.id, row.id) is False
        await db_session.refresh(row)
        assert row.read_at is None

        assert await svc.mark_all_read(db_session, intruder.id) == 0
        await db_session.refresh(row)
        assert row.read_at is None
    finally:
        await _cleanup(db_session, owner, intruder)


@pytest.mark.asyncio
async def test_mark_all_read_counts_only_the_unread(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    try:
        for _ in range(3):
            svc.create(db_session, user.id, NOTIFICATION_LEVEL_UP, {"level": 2, "previousLevel": 1})
        await db_session.commit()

        assert await svc.mark_all_read(db_session, user.id) == 3
        # Second sweep finds nothing left unread.
        assert await svc.mark_all_read(db_session, user.id) == 0

        count_unread = await db_session.scalar(
            select(func.count())
            .select_from(Notification)
            .where(Notification.user_id == user.id, Notification.read_at.is_(None))
        )
        assert count_unread == 0
    finally:
        await _cleanup(db_session, user)


@pytest.mark.asyncio
async def test_accepting_a_follow_request_notifies_the_follower(db_session: AsyncSession) -> None:
    follower = await _make_user(db_session)
    followee = await _make_user(db_session)
    followee.is_private = True
    followee.name = "Dana"
    await db_session.commit()

    try:
        # Private account → the follow lands as pending, not accepted.
        assert (await leaderboard_service.follow(db_session, follower, followee.id)).status == "pending"
        assert await _notifications_of(db_session, follower) == []

        await leaderboard_service.accept_request(db_session, followee, follower.id)

        # The notification goes to the follower, never to the accepter.
        assert await _notifications_of(db_session, followee) == []
        rows = await _notifications_of(db_session, follower)
        assert len(rows) == 1
        assert rows[0].type == NOTIFICATION_FOLLOW_ACCEPTED
        assert rows[0].payload == {"userId": followee.id, "userName": "Dana"}
    finally:
        await db_session.execute(delete(UserFriend).where(UserFriend.follower_id.in_([follower.id, followee.id])))
        await _cleanup(db_session, follower, followee)


@pytest.mark.asyncio
async def test_following_a_public_account_notifies_nobody(db_session: AsyncSession) -> None:
    follower = await _make_user(db_session)
    followee = await _make_user(db_session)  # is_private defaults to False
    try:
        # Auto-accepted, so there is no request to accept and nothing to announce.
        assert (await leaderboard_service.follow(db_session, follower, followee.id)).status == "accepted"
        assert await _notifications_of(db_session, follower) == []
        assert await _notifications_of(db_session, followee) == []
    finally:
        await db_session.execute(delete(UserFriend).where(UserFriend.follower_id.in_([follower.id, followee.id])))
        await _cleanup(db_session, follower, followee)


@pytest.mark.asyncio
async def test_rejecting_a_follow_request_notifies_nobody(db_session: AsyncSession) -> None:
    follower = await _make_user(db_session)
    followee = await _make_user(db_session)
    followee.is_private = True
    await db_session.commit()

    try:
        await leaderboard_service.follow(db_session, follower, followee.id)
        await leaderboard_service.reject_request(db_session, followee, follower.id)

        # A rejection is deliberately silent — telling someone they were turned
        # down is worse than saying nothing.
        assert await _notifications_of(db_session, follower) == []
    finally:
        await db_session.execute(delete(UserFriend).where(UserFriend.follower_id.in_([follower.id, followee.id])))
        await _cleanup(db_session, follower, followee)


# ── Auth guards (in-process ASGI, no DB) ─────────────────────────────────────


@pytest.mark.asyncio
async def test_notification_endpoints_require_auth() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        assert (await ac.get("/api/notifications")).status_code == 401
        assert (await ac.post("/api/notifications/read-all")).status_code == 401
        assert (await ac.post("/api/notifications/any-id/read")).status_code == 401
