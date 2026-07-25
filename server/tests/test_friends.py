"""Friend requests end to end (issue #32).

The graph tests need a real database: the whole point of the feature is that an
`accepted` row counts for *both* users, and that only shows up once the row is
actually persisted and read back from the other side. They skip automatically
when Postgres is unreachable (see conftest.db_session); CI always has one.

`phone_candidates` is pure, so it is tested without a database.
"""

from __future__ import annotations

import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import FriendStatus, User, UserFriend
from app.models.enums import UserRole
from app.services import friends as friends_service
from app.services import leaderboard as leaderboard_service
from app.services import users as users_service


async def _make_user(db: AsyncSession, *, name: str = "Friend Test", phone: str | None = None) -> User:
    user = User(
        email=f"_frnd_{uuid.uuid4().hex[:10]}@carma.test",
        password_hash="x",
        role=UserRole.DRIVER,
        name=name,
        phone=phone,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def _cleanup(db: AsyncSession, *users: User) -> None:
    ids = [u.id for u in users]
    await db.execute(delete(UserFriend).where(or_(UserFriend.follower_id.in_(ids), UserFriend.followee_id.in_(ids))))
    for user in users:
        await db.delete(user)
    await db.commit()


@pytest.fixture
async def pair(db_session: AsyncSession):
    """Two drivers, torn down with every edge between them."""
    alice = await _make_user(db_session, name="Alice")
    bob = await _make_user(db_session, name="Bob")
    try:
        yield alice, bob
    finally:
        await _cleanup(db_session, alice, bob)


# ── The flow the issue is about ───────────────────────────────────────────────


@pytest.mark.asyncio
async def test_request_is_pending_even_when_recipient_is_public(db_session: AsyncSession, pair) -> None:
    """The old follow model auto-accepted public targets, so no request ever
    reached the recipient's inbox. A request must stay pending until answered."""
    alice, bob = pair
    assert bob.is_private is False

    out = await friends_service.send_request(db_session, alice, bob.id)
    assert out.status == "pending"

    inbox = await friends_service.incoming_requests(db_session, bob)
    assert [r.from_user_id for r in inbox.requests] == [alice.id]
    assert inbox.requests[0].from_user_name == "Alice"

    # The sender does not see their own outgoing request as an inbox item.
    assert (await friends_service.incoming_requests(db_session, alice)).requests == []


@pytest.mark.asyncio
async def test_accept_makes_the_friendship_mutual(db_session: AsyncSession, pair) -> None:
    alice, bob = pair
    await friends_service.send_request(db_session, alice, bob.id)
    request_id = (await friends_service.incoming_requests(db_session, bob)).requests[0].id

    accepted = await friends_service.accept_request(db_session, bob, request_id)
    assert accepted.status == "accepted"

    # Both sides see each other — this is what the leaderboard Friends tab reads.
    assert await friends_service.friend_ids(db_session, alice.id) == {bob.id}
    assert await friends_service.friend_ids(db_session, bob.id) == {alice.id}

    assert (await friends_service.status_map(db_session, alice.id, [bob.id]))[bob.id] == "accepted"
    assert (await friends_service.status_map(db_session, bob.id, [alice.id]))[alice.id] == "accepted"

    assert (await friends_service.incoming_requests(db_session, bob)).requests == []


@pytest.mark.asyncio
async def test_friends_leaderboard_lists_the_friend_from_both_sides(db_session: AsyncSession, pair) -> None:
    alice, bob = pair
    await friends_service.send_request(db_session, alice, bob.id)
    request_id = (await friends_service.incoming_requests(db_session, bob)).requests[0].id
    await friends_service.accept_request(db_session, bob, request_id)

    for viewer, other in ((alice, bob), (bob, alice)):
        board = await leaderboard_service.get(db_session, viewer, "friends")
        listed = {e.user_id for e in board.entries}
        assert other.id in listed, "the accepted friend must appear regardless of who asked"
        assert viewer.id in listed, "the viewer themselves is always in their own friends board"
        assert next(e for e in board.entries if e.user_id == other.id).follow_status == "accepted"


@pytest.mark.asyncio
async def test_reject_clears_the_request(db_session: AsyncSession, pair) -> None:
    alice, bob = pair
    await friends_service.send_request(db_session, alice, bob.id)
    request_id = (await friends_service.incoming_requests(db_session, bob)).requests[0].id

    await friends_service.reject_request(db_session, bob, request_id)

    assert (await friends_service.incoming_requests(db_session, bob)).requests == []
    assert await friends_service.friend_ids(db_session, alice.id) == set()
    # Rejection is not a block — Alice may ask again.
    assert (await friends_service.send_request(db_session, alice, bob.id)).status == "pending"


@pytest.mark.asyncio
async def test_cancel_withdraws_a_sent_request(db_session: AsyncSession, pair) -> None:
    alice, bob = pair
    await friends_service.send_request(db_session, alice, bob.id)

    await friends_service.cancel_request(db_session, alice, bob.id)

    assert (await friends_service.incoming_requests(db_session, bob)).requests == []
    assert (await friends_service.status_map(db_session, alice.id, [bob.id]))[bob.id] == "none"


@pytest.mark.asyncio
async def test_remove_friend_works_from_the_side_that_did_not_ask(db_session: AsyncSession, pair) -> None:
    alice, bob = pair
    await friends_service.send_request(db_session, alice, bob.id)
    request_id = (await friends_service.incoming_requests(db_session, bob)).requests[0].id
    await friends_service.accept_request(db_session, bob, request_id)

    # Bob never created the row, but unfriending must still work for him.
    await friends_service.remove_friend(db_session, bob, alice.id)

    assert await friends_service.friend_ids(db_session, alice.id) == set()
    assert await friends_service.friend_ids(db_session, bob.id) == set()


# ── Edges around the flow ─────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_crossing_requests_become_a_friendship(db_session: AsyncSession, pair) -> None:
    alice, bob = pair
    await friends_service.send_request(db_session, alice, bob.id)

    # Bob adds Alice back instead of tapping accept — same intent, same result.
    out = await friends_service.send_request(db_session, bob, alice.id)

    assert out.status == "accepted"
    assert await friends_service.friend_ids(db_session, alice.id) == {bob.id}
    rows = (
        await db_session.scalars(
            select(UserFriend).where(or_(UserFriend.follower_id == alice.id, UserFriend.followee_id == alice.id))
        )
    ).all()
    assert len(rows) == 1, "a friendship is one row, not one per direction"


@pytest.mark.asyncio
async def test_resending_is_idempotent(db_session: AsyncSession, pair) -> None:
    alice, bob = pair
    first = await friends_service.send_request(db_session, alice, bob.id)
    second = await friends_service.send_request(db_session, alice, bob.id)

    assert (first.status, second.status) == ("pending", "pending")
    assert len((await friends_service.incoming_requests(db_session, bob)).requests) == 1


@pytest.mark.asyncio
async def test_cannot_request_yourself_or_a_stranger(db_session: AsyncSession, pair) -> None:
    alice, _bob = pair

    with pytest.raises(HTTPException) as self_add:
        await friends_service.send_request(db_session, alice, alice.id)
    assert self_add.value.status_code == 400

    with pytest.raises(HTTPException) as missing:
        await friends_service.send_request(db_session, alice, "does-not-exist")
    assert missing.value.status_code == 404


@pytest.mark.asyncio
async def test_accepting_someone_elses_request_is_rejected(db_session: AsyncSession) -> None:
    alice = await _make_user(db_session, name="Alice")
    bob = await _make_user(db_session, name="Bob")
    mallory = await _make_user(db_session, name="Mallory")
    try:
        await friends_service.send_request(db_session, alice, bob.id)
        request_id = (await friends_service.incoming_requests(db_session, bob)).requests[0].id

        with pytest.raises(HTTPException) as exc:
            await friends_service.accept_request(db_session, mallory, request_id)
        assert exc.value.status_code == 404

        with pytest.raises(HTTPException):
            await friends_service.reject_request(db_session, mallory, request_id)

        # Still Bob's to answer.
        assert len((await friends_service.incoming_requests(db_session, bob)).requests) == 1
    finally:
        await _cleanup(db_session, alice, bob, mallory)


@pytest.mark.asyncio
async def test_block_drops_the_friendship_and_bars_new_requests(db_session: AsyncSession, pair) -> None:
    alice, bob = pair
    await friends_service.send_request(db_session, alice, bob.id)
    request_id = (await friends_service.incoming_requests(db_session, bob)).requests[0].id
    await friends_service.accept_request(db_session, bob, request_id)

    await friends_service.block_user(db_session, bob, alice.id)

    assert await friends_service.friend_ids(db_session, bob.id) == set()
    assert await friends_service.friend_ids(db_session, alice.id) == set()
    assert (await friends_service.status_map(db_session, alice.id, [bob.id]))[bob.id] == "blocked"

    with pytest.raises(HTTPException) as exc:
        await friends_service.send_request(db_session, alice, bob.id)
    assert exc.value.status_code == 403

    await friends_service.unblock_user(db_session, bob, alice.id)
    assert (await friends_service.send_request(db_session, alice, bob.id)).status == "pending"


@pytest.mark.asyncio
async def test_status_map_reports_a_received_request_as_pending(db_session: AsyncSession, pair) -> None:
    alice, bob = pair
    await friends_service.send_request(db_session, alice, bob.id)

    # Alice sees "pending" because she asked; Bob sees "pending" because he was asked.
    assert (await friends_service.status_map(db_session, alice.id, [bob.id]))[bob.id] == "pending"
    assert (await friends_service.status_map(db_session, bob.id, [alice.id]))[alice.id] == "pending"


@pytest.mark.asyncio
async def test_enum_round_trips_as_lowercase(db_session: AsyncSession, pair) -> None:
    """Python members are uppercase, the Postgres labels are lowercase, and the
    wire format is lowercase (migration 0006). Guard the mapping in both directions."""
    alice, bob = pair
    await friends_service.send_request(db_session, alice, bob.id)

    edge = await db_session.scalar(
        select(UserFriend).where(UserFriend.follower_id == alice.id, UserFriend.followee_id == bob.id)
    )
    assert edge is not None
    assert edge.status is FriendStatus.PENDING
    assert edge.status.value == "PENDING"
    assert (await friends_service.status_map(db_session, alice.id, [bob.id]))[bob.id] == "pending"


# ── Phone search (the way friends are found in the app) ───────────────────────


@pytest.mark.parametrize(
    ("typed", "expected"),
    [
        ("0501234567", {"0501234567", "+972501234567"}),
        ("+972501234567", {"+972501234567", "0501234567"}),
        ("050-123-4567", {"0501234567", "+972501234567"}),
        ("+972 50 123 4567", {"+972501234567", "0501234567"}),
        ("", set()),
        ("---", set()),
    ],
)
def test_phone_candidates(typed: str, expected: set[str]) -> None:
    assert set(users_service.phone_candidates(typed)) == expected


@pytest.mark.asyncio
async def test_search_by_phone_matches_the_other_spelling(db_session: AsyncSession) -> None:
    suffix = uuid.uuid4().int % 10_000_000
    alice = await _make_user(db_session, name="Alice")
    bob = await _make_user(db_session, name="Bob", phone=f"+9725{suffix:07d}")
    try:
        found = await users_service.search_by_phone(db_session, alice, f"05{suffix:07d}")
        assert found.id == bob.id

        with pytest.raises(HTTPException) as exc:
            await users_service.search_by_phone(db_session, alice, "0500000000")
        assert exc.value.status_code == 404
    finally:
        await _cleanup(db_session, alice, bob)


@pytest.mark.asyncio
async def test_search_never_returns_the_caller(db_session: AsyncSession) -> None:
    phone = f"+9725{uuid.uuid4().int % 10_000_000:07d}"
    alice = await _make_user(db_session, name="Alice", phone=phone)
    try:
        with pytest.raises(HTTPException) as exc:
            await users_service.search_by_phone(db_session, alice, phone)
        assert exc.value.status_code == 404
    finally:
        await _cleanup(db_session, alice)


# ── Contact matching (issue #33) ──────────────────────────────────────────────


@pytest.mark.parametrize(
    ("typed", "expected"),
    [
        ("0501234567", "+972501234567"),
        ("+972501234567", "+972501234567"),
        ("050-123-4567", "+972501234567"),
        ("+972 50 123 4567", "+972501234567"),
        ("972501234567", "+972501234567"),
        ("+14155551234", "+14155551234"),  # already international, left alone
        ("", None),
        ("---", None),
        ("501234567", None),  # no country and no leading 0 — unreadable
    ],
)
def test_canonical_phone(typed: str, expected: str | None) -> None:
    assert users_service.canonical_phone(typed) == expected


def test_phone_hash_is_spelling_independent() -> None:
    """The client hashes what it reads from the address book; the server hashes
    what it stored at signup. Both must land on the same digest."""
    assert users_service.phone_hash("050-123-4567") == users_service.phone_hash("+972501234567")
    assert users_service.phone_hash("0501234567") != users_service.phone_hash("0501234568")
    assert users_service.phone_hash("---") is None


@pytest.mark.asyncio
async def test_match_contacts_finds_registered_numbers_only(db_session: AsyncSession) -> None:
    suffix = uuid.uuid4().int % 10_000_000
    alice = await _make_user(db_session, name="Alice")
    bob = await _make_user(db_session, name="Bob", phone=f"+9725{suffix:07d}")
    try:
        book = [
            users_service.phone_hash(f"05{suffix:07d}"),  # Bob, local spelling
            users_service.phone_hash("0509999999"),  # a contact who never signed up
        ]
        out = await users_service.match_contacts(db_session, alice, [h for h in book if h])

        assert [m.id for m in out.matches] == [bob.id]
        assert out.matches[0].phone_hash == users_service.phone_hash(f"+9725{suffix:07d}")
        assert out.matches[0].friend_status == "none"
    finally:
        await _cleanup(db_session, alice, bob)


@pytest.mark.asyncio
async def test_match_contacts_reports_existing_relationships(db_session: AsyncSession) -> None:
    """The list has to render the right button per row, so a match carries the
    friendship status alongside it."""
    suffix = uuid.uuid4().int % 10_000_000
    alice = await _make_user(db_session, name="Alice")
    bob = await _make_user(db_session, name="Bob", phone=f"+9725{suffix:07d}")
    try:
        await friends_service.send_request(db_session, alice, bob.id)
        digest = users_service.phone_hash(f"+9725{suffix:07d}")
        assert digest is not None

        out = await users_service.match_contacts(db_session, alice, [digest])
        assert [(m.id, m.friend_status) for m in out.matches] == [(bob.id, "pending")]
    finally:
        await _cleanup(db_session, alice, bob)


@pytest.mark.asyncio
async def test_match_contacts_never_returns_the_caller(db_session: AsyncSession) -> None:
    phone = f"+9725{uuid.uuid4().int % 10_000_000:07d}"
    alice = await _make_user(db_session, name="Alice", phone=phone)
    try:
        digest = users_service.phone_hash(phone)
        assert digest is not None
        assert (await users_service.match_contacts(db_session, alice, [digest])).matches == []
        assert (await users_service.match_contacts(db_session, alice, [])).matches == []
    finally:
        await _cleanup(db_session, alice)
