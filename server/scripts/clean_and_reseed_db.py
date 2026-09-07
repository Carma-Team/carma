"""One-time cleanup for the investor-demo database (CAR-190 follow-up).

Dan's account carried 18 fake `seed-trip-dan-*` trips injected by every run of
`app.seed`, on top of his real trips recorded live from the app. This strips
the fake trips, recomputes Dan's stats from what is left, and replaces the old
English-named mock leaderboard with the 4 Hebrew users `app.seed` now seeds —
so the judges see Dan's real account next to a credible, below-him field.

Safe to run more than once: every step is a no-op once the DB matches the
target state.

Usage (from server/):
    DATABASE_URL=postgresql+asyncpg://... python -m scripts.clean_and_reseed_db
"""

from __future__ import annotations

import asyncio
from collections import defaultdict
from datetime import UTC, datetime
from typing import Any

from dotenv import load_dotenv

# Local dev convenience only: `app.config.Settings` reads ".env" relative to
# the process's cwd. `override=False` means a DATABASE_URL already exported
# into the environment — the remote-run case — always wins over this file.
load_dotenv(override=False)

from sqlalchemy import delete as sql_delete  # noqa: E402
from sqlalchemy import func, select  # noqa: E402
from sqlalchemy.engine import CursorResult  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession  # noqa: E402

from app.database import SessionLocal  # noqa: E402
from app.models import Redemption, RedemptionStatus, Trip, User, UserFriend  # noqa: E402
from app.seed import DAN_FRIEND_EMAILS, LEADERBOARD_USERS  # noqa: E402
from app.services import scoring  # noqa: E402
from app.services.levels import level_for_points  # noqa: E402

DAN_EMAIL = "ofridan@gmail.com"

# The old seed.py gave Dan one fixed, already-used demo voucher with this
# exact code (git history: "Real voucher format... last place that should
# contain an 0 or a 1"). It predates Dan being a real account and nothing
# currently seeds it, so it is named once here rather than matched by pattern.
DAN_SEEDED_VOUCHER_QR = "SEEDPAZ234"

# Old English-named mock leaderboard, replaced by LEADERBOARD_USERS in app.seed.
STALE_MOCK_EMAILS = ["yoav@carma.app", "noa@carma.app", "michal@carma.app", "uri@carma.app", "shira@carma.app"]

# Ad-hoc test accounts left behind in the shared DB, never part of any seed.
NOISE_NAMES = ["Cloud Test", "Verify"]

# Noise accounts confirmed by a human to carry only synthetic trips (e.g. a
# smoke-test run), so the "has real trips" guard below must not protect them.
# Each entry here was checked individually — this is not a pattern to extend
# on suspicion alone.
FORCE_DELETE_EMAILS = ["verify_898899204@carma.app"]

# Real team members who may have a leftover zero-point duplicate account from
# an earlier signup. Bounded on purpose — a name-collision sweep over every
# user would just as happily delete a genuine new driver who shares a common
# name with someone else and hasn't driven yet.
TEAM_NAMES = ["דן עופרי", "נווה צוויג", "שון פבר", "מאי חג'בי"]

# Confirmed by Dan: registered, never drove, no points, no trips — noise for
# the demo the same way verify_898899204@carma.app was. Not hidden via
# is_private (PR #343 review): a driver with zero trips ranking at the
# cold-start prior is CAR-19's own intended design, reviewed by @mayh and
# pinned by test_a_null_driver_score_ranks_at_the_prior_it_displays — these
# three just have no reason to exist in the demo dataset at all. Matched by
# id, not name — "eran34567"/"galgryn8" are email local-parts, not display
# names, and the third account has no email.
FORCE_DELETE_USER_IDS = [
    "31f9cceacaee481db8e3f114e0b87425",  # eran34567@gmail.com — ערן
    "4050bac28e59448e9a93affe7694b658",  # galgryn8@gmail.com — גל גרין
    "da688e4bc7514d9086a5db42d11986b8",  # no email — שון
]


async def _trip_count(db: AsyncSession, user_id: str) -> int:
    return await db.scalar(select(func.count(Trip.id)).where(Trip.user_id == user_id)) or 0


async def clean_dan(db: AsyncSession) -> None:
    dan = await db.scalar(select(User).where(User.email == DAN_EMAIL))
    if dan is None:
        print(f"  Dan ({DAN_EMAIL}) not found — nothing to clean")
        return

    # `execute` is typed as returning a plain Result, which has no rowcount.
    # A DML statement always yields a CursorResult at runtime — the annotation
    # tells mypy that, it does not change behaviour. Same pattern as notifications.py.
    deleted: CursorResult[Any] = await db.execute(  # type: ignore[assignment]
        sql_delete(Trip).where(Trip.user_id == dan.id, Trip.idempotency_key.like("seed-trip-dan-%"))
    )
    print(f"  Removed {deleted.rowcount} seeded trip(s) from Dan's account")

    deleted_voucher: CursorResult[Any] = await db.execute(  # type: ignore[assignment]
        sql_delete(Redemption).where(Redemption.user_id == dan.id, Redemption.qr_code == DAN_SEEDED_VOUCHER_QR)
    )
    if deleted_voucher.rowcount:
        print(f"  Removed {deleted_voucher.rowcount} seeded voucher(s) from Dan's account")

    rows = (
        await db.execute(
            select(Trip.score_v2, Trip.avg_score, Trip.distance_km, Trip.start_time, Trip.points).where(
                Trip.user_id == dan.id
            )
        )
    ).all()

    now = datetime.now(UTC)
    history = []
    total_points = 0
    total_distance = 0.0
    for score_v2, avg_score, km, start, points in rows:
        total_points += points
        total_distance += km or 0.0
        score = score_v2 if score_v2 is not None else avg_score
        if score is None:
            continue
        aware_start = start if start.tzinfo else start.replace(tzinfo=UTC)
        history.append(
            scoring.TripHistoryPoint(
                trip_score=score,
                distance_km=km or 0.0,
                age_days=max(0.0, (now - aware_start).total_seconds() / 86400.0),
            )
        )

    # `points` is the spendable balance (business.py's `consume_voucher`
    # decrements it, never total_points), so it must exclude whatever Dan has
    # already redeemed — recomputed from live USED redemptions on every run,
    # not adjusted incrementally, so a second run can never double-charge it.
    used_cost = (
        await db.scalar(
            select(func.coalesce(func.sum(Redemption.points_cost), 0)).where(
                Redemption.user_id == dan.id, Redemption.status == RedemptionStatus.USED
            )
        )
        or 0
    )

    dan.total_points = total_points
    dan.points = total_points - used_cost
    dan.total_distance = round(total_distance, 1)
    dan.driver_score = scoring.compute_driver_score(history)
    dan.level = level_for_points(total_points)
    print(
        f"  Dan recalculated: {len(rows)} real trips, {total_points} pts ({dan.points} spendable), "
        f"{dan.total_distance} km, driver_score={dan.driver_score:.1f}, level={dan.level}"
    )


async def purge_noise_accounts(db: AsyncSession) -> None:
    for email in FORCE_DELETE_EMAILS:
        user = await db.scalar(select(User).where(User.email == email))
        if user is None:
            continue
        await db.delete(user)
        print(f"  Deleted confirmed-synthetic account {email}")

    for user_id in FORCE_DELETE_USER_IDS:
        user = await db.scalar(select(User).where(User.id == user_id))
        if user is None:
            continue
        await db.delete(user)
        print(f"  Deleted confirmed-synthetic account '{user.name}' ({user_id})")

    for name in NOISE_NAMES:
        user = await db.scalar(select(User).where(User.name == name))
        if user is None:
            continue
        if await _trip_count(db, user.id) > 0:
            print(f"  Skipping '{name}' — has real trips, not noise")
            continue
        await db.delete(user)
        print(f"  Deleted noise account '{name}'")

    # Duplicate rows sharing a name (e.g. two zero-point "Cloud Test" imports,
    # or a stray signup that duplicated a team member's name). Bounded to the
    # known noise/team names on purpose — sweeping every user in the table
    # would just as happily delete a genuine new driver who shares a common
    # name with someone else and hasn't driven yet.
    by_name: dict[str, list[User]] = defaultdict(list)
    for name in [*NOISE_NAMES, *TEAM_NAMES]:
        users = (await db.scalars(select(User).where(User.name == name))).all()
        if users:
            by_name[name] = list(users)

    for name, users in by_name.items():
        if len(users) < 2:
            continue
        users.sort(key=lambda u: u.total_points, reverse=True)
        for dup in users[1:]:
            if dup.total_points == 0 and dup.points == 0 and await _trip_count(db, dup.id) == 0:
                await db.delete(dup)
                print(f"  Deleted duplicate empty account for '{name}' ({dup.email})")


async def purge_stale_mock_users(db: AsyncSession) -> None:
    for email in STALE_MOCK_EMAILS:
        user = await db.scalar(select(User).where(User.email == email))
        if user is None:
            continue
        if await _trip_count(db, user.id) > 0:
            print(f"  Skipping '{email}' — has real trips, not a stale mock")
            continue
        await db.delete(user)
        print(f"  Deleted stale mock account {email}")


async def upsert_mock_leaderboard(db: AsyncSession) -> None:
    for lu in LEADERBOARD_USERS:
        user = await db.scalar(select(User).where(User.email == lu["email"]))
        if user is None:
            print(f"  {lu['email']} missing — run `python -m app.seed` first to create it")
            continue
        user.name = lu["name"]
        user.city_code = lu["city_code"]
        user.driver_score = lu["driver_score"]
        user.points = lu["total_points"]
        user.total_points = lu["total_points"]
        user.total_distance = lu["total_distance"]
        user.level = level_for_points(lu["total_points"])
    print(f"  Upserted {len(LEADERBOARD_USERS)} mock leaderboard users")


async def sync_dan_friends(db: AsyncSession) -> None:
    dan = await db.scalar(select(User).where(User.email == DAN_EMAIL))
    if dan is None:
        return
    for email in DAN_FRIEND_EMAILS:
        friend = await db.scalar(select(User).where(User.email == email))
        if friend is None:
            continue
        exists = await db.scalar(
            select(UserFriend.id).where(UserFriend.follower_id == dan.id, UserFriend.followee_id == friend.id)
        )
        if exists is None:
            db.add(UserFriend(follower_id=dan.id, followee_id=friend.id))
    print(f"  Dan now follows {len(DAN_FRIEND_EMAILS)} mock leaderboard users")


async def run() -> None:
    async with SessionLocal() as db:
        print("1. Cleaning Dan's account")
        await clean_dan(db)
        print("2. Purging test/noise accounts")
        await purge_noise_accounts(db)
        print("3. Purging stale English-named mock users")
        await purge_stale_mock_users(db)
        await db.flush()
        print("4. Upserting the 4 Hebrew mock leaderboard users")
        await upsert_mock_leaderboard(db)
        print("5. Syncing Dan's Friends list")
        await sync_dan_friends(db)
        await db.commit()
    print("Done.")


if __name__ == "__main__":
    asyncio.run(run())
