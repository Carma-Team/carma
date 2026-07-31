"""Notifications: every trigger, the read endpoints, and per-user isolation.

Four kinds, written from two places: a level change (up or down) inside
trips.save, and a friend request being sent or answered inside the friends
service. All stage their row on the triggering action's transaction, so these
exercise the real services against Postgres rather than mocking the session.
What is worth proving needs a database: that RETURNING reports the level the
CASE and the demotion cap actually settled on, that a demoted driver is told
without being congratulated, and that each social notification reaches the
right side of the pair.

The auth guards at the bottom are pure in-process ASGI — no DB.
Skipped automatically when no Postgres is reachable (see conftest).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.main import app
from app.models import (
    NOTIFICATION_FRIEND_ACCEPTED,
    NOTIFICATION_FRIEND_REQUESTED,
    NOTIFICATION_LEVEL_DOWN,
    NOTIFICATION_LEVEL_UP,
    FriendStatus,
    Notification,
    Trip,
    TripStatus,
    User,
    UserFriend,
)
from app.models.enums import UserRole
from app.schemas.trip import SaveTripIn
from app.services import friends, levels
from app.services import notifications as svc
from app.services import trips as trips_service

# Read from the ladder rather than hardcoded — the thresholds moved once already
# (#62) and a stale constant here would silently stop testing the boundary.
_LEVEL_2_MIN_POINTS = next(pts for pts, lvl in levels.thresholds_desc() if lvl == 2)


def _long_clean_trip() -> SaveTripIn:
    """Earns points but is not enough to lift a poor rolling score off the floor."""
    return SaveTripIn(
        distanceKm=8.0,
        durationSeconds=1200,
        hardBrakes=0,
        aggressiveAccels=0,
        sharpTurns=0,
        touchEpochs=0,
        screenInteractionSeconds=0,
    )


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
    user = await _make_user(db_session, total_points=_LEVEL_2_MIN_POINTS - 1)
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
async def test_mark_all_read_is_not_scoped_to_the_returned_page(db_session: AsyncSession) -> None:
    """The client derives its unread indicator from one page, so this is what makes that safe.

    read-all sweeps every row, not just the MAX_LIMIT the list returns. If it were
    page-scoped, rows past the first page could stay unread out of sight forever.

    Note this proves the endpoint, not an invariant: `POST /{id}/read` also exists,
    so a caller marking individual rows could leave an older one unread beyond the
    page. No caller does that today — the tab only ever calls read-all — but a
    numeric unread badge would need a real COUNT rather than the page.
    """
    user = await _make_user(db_session)
    total = svc.MAX_LIMIT + 5
    try:
        for _ in range(total):
            svc.create(db_session, user.id, NOTIFICATION_LEVEL_UP, {"level": 2, "previousLevel": 1})
        await db_session.commit()

        # The page genuinely cannot show them all — otherwise the test proves nothing.
        assert len(await svc.list_for_user(db_session, user.id)) == svc.MAX_LIMIT

        assert await svc.mark_all_read(db_session, user.id) == total

        remaining_unread = await db_session.scalar(
            select(func.count())
            .select_from(Notification)
            .where(Notification.user_id == user.id, Notification.read_at.is_(None))
        )
        assert remaining_unread == 0, "rows beyond the first page must also be marked read"
    finally:
        await _cleanup(db_session, user)


# ── Level down ───────────────────────────────────────────────────────────────


async def _demotable_driver(db: AsyncSession, *, history_score: float) -> User:
    """A level-10 driver whose recent trips all scored `history_score`.

    The trip history is what matters, not the stored `driver_score` — save()
    recomputes the rolling score from trips in the window and writes the column
    as an output, so seeding the column alone would prove nothing. Long distances
    so the history reaches full credibility rather than blending toward the
    cold-start prior. Mirrors the setup in test_level_demotion.
    """
    user = User(
        email=f"_notif_dn_{uuid.uuid4().hex[:10]}@carma.test",
        password_hash="x",
        role=UserRole.DRIVER,
        name="Demotion Notif",
        points=80_000,
        total_points=80_000,
        level=10,
    )
    db.add(user)
    await db.commit()

    now = datetime.now(UTC)
    for day in range(1, 11):
        db.add(
            Trip(
                user_id=user.id,
                start_time=now - timedelta(days=day),
                end_time=now - timedelta(days=day) + timedelta(minutes=40),
                distance_km=40.0,
                duration_seconds=2400,
                score_v2=history_score,
                points=0,
                status=TripStatus.COMPLETED,
            )
        )
    await db.commit()
    await db.refresh(user)
    return user


@pytest.mark.asyncio
async def test_a_demotion_notifies_without_congratulating(db_session: AsyncSession) -> None:
    user = await _demotable_driver(db_session, history_score=45.0)
    try:
        await trips_service.save(db_session, user, _long_clean_trip(), idempotency_key=uuid.uuid4().hex)

        level_now = await db_session.scalar(select(User.level).where(User.id == user.id))
        assert level_now is not None and level_now < 10, "setup precondition: the driver should be capped down"

        rows = await _notifications_of(db_session, user)
        types = [r.type for r in rows]
        assert NOTIFICATION_LEVEL_DOWN in types
        assert NOTIFICATION_LEVEL_UP not in types, "a demoted driver must not be congratulated"
        assert len(rows) == 1
    finally:
        await _cleanup(db_session, user)


@pytest.mark.asyncio
async def test_a_demotion_notification_names_no_levels(db_session: AsyncSession) -> None:
    """Product decision: say the level was updated, not what it fell from or to."""
    user = await _demotable_driver(db_session, history_score=45.0)
    try:
        await trips_service.save(db_session, user, _long_clean_trip(), idempotency_key=uuid.uuid4().hex)

        row = next(r for r in await _notifications_of(db_session, user) if r.type == NOTIFICATION_LEVEL_DOWN)
        assert row.payload == {}
    finally:
        await _cleanup(db_session, user)


@pytest.mark.asyncio
async def test_a_promotion_sends_only_the_level_up(db_session: AsyncSession, clean_trip: SaveTripIn) -> None:
    user = await _make_user(db_session, total_points=_LEVEL_2_MIN_POINTS - 1)
    try:
        await trips_service.save(db_session, user, clean_trip, idempotency_key=uuid.uuid4().hex)

        types = [r.type for r in await _notifications_of(db_session, user)]
        assert types == [NOTIFICATION_LEVEL_UP]
    finally:
        await _cleanup(db_session, user)


# ── Friend triggers ──────────────────────────────────────────────────────────


async def _pending_edge_id(db: AsyncSession, requester: User, recipient: User) -> str:
    edge = await db.scalar(
        select(UserFriend).where(
            UserFriend.follower_id == requester.id,
            UserFriend.followee_id == recipient.id,
            UserFriend.status == FriendStatus.PENDING,
        )
    )
    assert edge is not None, "expected a pending request to exist"
    return edge.id


async def _drop_edges(db: AsyncSession, *users: User) -> None:
    ids = [u.id for u in users]
    await db.execute(delete(UserFriend).where(or_(UserFriend.follower_id.in_(ids), UserFriend.followee_id.in_(ids))))


@pytest.mark.asyncio
async def test_a_request_notifies_the_recipient_only(db_session: AsyncSession) -> None:
    requester = await _make_user(db_session)
    requester.name = "Yoni"
    recipient = await _make_user(db_session)
    await db_session.commit()

    try:
        assert (await friends.send_request(db_session, requester, recipient.id)).status == "pending"

        assert await _notifications_of(db_session, requester) == []
        rows = await _notifications_of(db_session, recipient)
        assert len(rows) == 1
        assert rows[0].type == NOTIFICATION_FRIEND_REQUESTED
        assert rows[0].payload == {"userId": requester.id, "userName": "Yoni"}
    finally:
        await _drop_edges(db_session, requester, recipient)
        await _cleanup(db_session, requester, recipient)


@pytest.mark.asyncio
async def test_accepting_notifies_the_requester_and_clears_the_request_row(db_session: AsyncSession) -> None:
    requester = await _make_user(db_session)
    recipient = await _make_user(db_session)
    recipient.name = "Dana"
    await db_session.commit()

    try:
        await friends.send_request(db_session, requester, recipient.id)
        request_id = await _pending_edge_id(db_session, requester, recipient)

        await friends.accept_request(db_session, recipient, request_id)

        rows = await _notifications_of(db_session, requester)
        assert len(rows) == 1
        assert rows[0].type == NOTIFICATION_FRIEND_ACCEPTED
        assert rows[0].payload == {"userId": recipient.id, "userName": "Dana"}

        # The accepter's own "wants to be friends" row is answered, so it goes.
        assert await _notifications_of(db_session, recipient) == []
    finally:
        await _drop_edges(db_session, requester, recipient)
        await _cleanup(db_session, requester, recipient)


@pytest.mark.asyncio
async def test_requesting_back_counts_as_accepting(db_session: AsyncSession) -> None:
    """send_request settles an incoming request instead of opening a second one."""
    first = await _make_user(db_session)
    second = await _make_user(db_session)
    second.name = "Maya"
    await db_session.commit()

    try:
        await friends.send_request(db_session, first, second.id)
        # Adding back rather than tapping accept — same outcome, so same notification.
        assert (await friends.send_request(db_session, second, first.id)).status == "accepted"

        rows = await _notifications_of(db_session, first)
        assert [r.type for r in rows] == [NOTIFICATION_FRIEND_ACCEPTED]
        assert rows[0].payload == {"userId": second.id, "userName": "Maya"}

        assert await _notifications_of(db_session, second) == []
    finally:
        await _drop_edges(db_session, first, second)
        await _cleanup(db_session, first, second)


@pytest.mark.asyncio
async def test_send_cancel_cycles_cannot_stack_requests(db_session: AsyncSession) -> None:
    """cancel_request deletes the edge, so without a guard each cycle stages a fresh row.

    This is the abuse path that matters — the notification list would itself
    become the way to harass someone.
    """
    requester = await _make_user(db_session)
    recipient = await _make_user(db_session)
    try:
        for _ in range(5):
            await friends.send_request(db_session, requester, recipient.id)
            await friends.cancel_request(db_session, requester, recipient.id)

        # Cancelling clears the row, so nothing accumulates.
        assert await _notifications_of(db_session, recipient) == []

        await friends.send_request(db_session, requester, recipient.id)
        assert len(await _notifications_of(db_session, recipient)) == 1
    finally:
        await _drop_edges(db_session, requester, recipient)
        await _cleanup(db_session, requester, recipient)


@pytest.mark.asyncio
async def test_rejecting_is_silent_and_clears_the_stale_row(db_session: AsyncSession) -> None:
    requester = await _make_user(db_session)
    recipient = await _make_user(db_session)
    try:
        await friends.send_request(db_session, requester, recipient.id)
        request_id = await _pending_edge_id(db_session, requester, recipient)
        assert len(await _notifications_of(db_session, recipient)) == 1

        await friends.reject_request(db_session, recipient, request_id)

        # Telling someone they were turned down is worse than saying nothing.
        assert await _notifications_of(db_session, requester) == []
        # But the rejecter's own row pointed at a request that no longer exists.
        assert await _notifications_of(db_session, recipient) == []
    finally:
        await _drop_edges(db_session, requester, recipient)
        await _cleanup(db_session, requester, recipient)


@pytest.mark.asyncio
async def test_a_duplicate_request_is_answered_not_a_500(db_session: AsyncSession) -> None:
    """The unread guard queries, which autoflushes — so ordering around db.add matters.

    Staging the edge before that query would surface a concurrent duplicate as an
    IntegrityError raised inside `has_unread_from`, outside the try that exists to
    absorb it, and the caller would get a 500 instead of the persisted state.
    """
    requester = await _make_user(db_session)
    recipient = await _make_user(db_session)
    try:
        assert (await friends.send_request(db_session, requester, recipient.id)).status == "pending"

        # Second send with the row already committed — the early return handles this.
        assert (await friends.send_request(db_session, requester, recipient.id)).status == "pending"

        # And the losing side of a genuine race: an edge inserted behind this
        # session's back, so the early return misses it and the unique constraint
        # is what actually stops the duplicate.
        await db_session.execute(delete(UserFriend).where(UserFriend.follower_id == requester.id))
        await db_session.commit()
        db_session.add(UserFriend(follower_id=requester.id, followee_id=recipient.id, status=FriendStatus.PENDING))
        await db_session.commit()
        db_session.expunge_all()

        result = await friends.send_request(db_session, requester, recipient.id)
        assert result.status == "pending", "a duplicate must report persisted state, not raise"
    finally:
        await _drop_edges(db_session, requester, recipient)
        await _cleanup(db_session, requester, recipient)


@pytest.mark.asyncio
async def test_a_second_requester_still_gets_through(db_session: AsyncSession) -> None:
    """The guard is per-actor — it must not suppress a different user's request."""
    first = await _make_user(db_session)
    second = await _make_user(db_session)
    recipient = await _make_user(db_session)
    try:
        await friends.send_request(db_session, first, recipient.id)
        await friends.send_request(db_session, second, recipient.id)

        actors = {r.payload["userId"] for r in await _notifications_of(db_session, recipient)}
        assert actors == {first.id, second.id}
    finally:
        await _drop_edges(db_session, first, second, recipient)
        await _cleanup(db_session, first, second, recipient)


@pytest.mark.asyncio
async def test_blocking_an_incoming_requester_clears_their_row(db_session: AsyncSession) -> None:
    """A asks B, B blocks A — B must not be left holding A's name.

    Worse than the cancel case: there is no request left to accept or reject, so
    the blocker has no way to clear the row by acting on it.
    """
    requester = await _make_user(db_session)
    blocker = await _make_user(db_session)
    try:
        await friends.send_request(db_session, requester, blocker.id)
        assert len(await _notifications_of(db_session, blocker)) == 1

        await friends.block_user(db_session, blocker, requester.id)

        assert await _notifications_of(db_session, blocker) == []
        # Blocking is not announced to the person blocked.
        assert await _notifications_of(db_session, requester) == []
    finally:
        await _drop_edges(db_session, requester, blocker)
        await _cleanup(db_session, requester, blocker)


@pytest.mark.asyncio
async def test_blocking_someone_you_asked_clears_their_row_too(db_session: AsyncSession) -> None:
    """The other direction: B asks A, then B blocks A.

    B's own outgoing request turns BLOCKED rather than being deleted, so it is
    just as gone — and A is the one left with a row that leads nowhere.
    """
    blocker = await _make_user(db_session)
    target = await _make_user(db_session)
    try:
        await friends.send_request(db_session, blocker, target.id)
        assert len(await _notifications_of(db_session, target)) == 1

        await friends.block_user(db_session, blocker, target.id)

        assert await _notifications_of(db_session, target) == []
        assert await _notifications_of(db_session, blocker) == []
    finally:
        await _drop_edges(db_session, blocker, target)
        await _cleanup(db_session, blocker, target)


@pytest.mark.asyncio
async def test_removing_a_friend_notifies_nobody(db_session: AsyncSession) -> None:
    first = await _make_user(db_session)
    second = await _make_user(db_session)
    try:
        await friends.send_request(db_session, first, second.id)
        request_id = await _pending_edge_id(db_session, first, second)
        await friends.accept_request(db_session, second, request_id)
        await svc.mark_all_read(db_session, first.id)

        await friends.remove_friend(db_session, second, first.id)

        # Unfriending is not an event either side gets told about.
        assert [r.type for r in await _notifications_of(db_session, first)] == [NOTIFICATION_FRIEND_ACCEPTED]
        assert await _notifications_of(db_session, second) == []
    finally:
        await _drop_edges(db_session, first, second)
        await _cleanup(db_session, first, second)


# ── Auth guards (in-process ASGI, no DB) ─────────────────────────────────────


@pytest.mark.asyncio
async def test_notification_endpoints_require_auth() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        assert (await ac.get("/api/notifications")).status_code == 401
        assert (await ac.post("/api/notifications/read-all")).status_code == 401
        assert (await ac.post("/api/notifications/any-id/read")).status_code == 401
