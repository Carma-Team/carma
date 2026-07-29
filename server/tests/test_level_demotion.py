"""Level demotion (#37).

`total_points` is cumulative and never falls, so the points ladder alone can
only climb. `_level_cap` bounds the *displayed* level by the driver's current
`driver_score`, and `save()` applies it with LEAST over the earned level.

The unit tests below are pure. The end-to-end case needs Postgres, because what
is worth proving is that LEAST resolves inside the UPDATE and that RETURNING
reports the capped value — neither is observable through a mock. It skips
automatically when no database is reachable (see conftest).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Trip, TripStatus, User
from app.models.enums import UserRole
from app.schemas.trip import SaveTripIn
from app.services import trips as trips_service
from app.services.trips import _LEVEL_CAP_FLOOR, _level_cap

# ─── _level_cap ───────────────────────────────────────────────────────────────


class TestLevelCap:
    def test_a_strong_driver_is_not_capped(self):
        # 10 is the top level, so this is "no effective cap".
        assert _level_cap(100.0) == 10
        assert _level_cap(80.0) == 10  # boundary, inclusive

    def test_the_cap_tightens_as_the_score_falls(self):
        assert _level_cap(79.9) == 8
        assert _level_cap(70.0) == 8
        assert _level_cap(69.9) == 6
        assert _level_cap(60.0) == 6
        assert _level_cap(59.9) == 4
        assert _level_cap(50.0) == 4

    def test_the_worst_score_still_leaves_level_2(self):
        # Demotion locks the ladder, it does not send anyone back to the start.
        assert _level_cap(49.9) == _LEVEL_CAP_FLOOR == 2
        assert _level_cap(0.0) == 2

    def test_the_cold_start_prior_permits_level_8(self):
        # A driver with no history scores the prior (75). They must be able to
        # climb without their unproven score holding them down.
        from app.services.scoring import CONFIG

        assert _level_cap(CONFIG.prior_score) == 8

    def test_the_cap_never_rises_as_the_score_falls(self):
        caps = [_level_cap(s / 10) for s in range(1000, -1, -1)]
        assert caps == sorted(caps, reverse=True)


# ─── end to end ───────────────────────────────────────────────────────────────


async def _make_user(db: AsyncSession, *, total_points: int, history_score: float | None) -> User:
    """A driver with `total_points` earned, and recent trips all scoring `history_score`.

    The history matters, not the stored `driver_score` column: `_compute_score`
    recomputes the rolling score from trips inside the window and writes the
    column as an output. Seeding the column alone would prove nothing — the
    first save would overwrite it with the recomputed value.

    Distances are large so the history reaches full credibility; otherwise
    `compute_driver_score` blends toward the cold-start prior of 75 and the cap
    lands at 8 no matter how badly the trips scored.
    """
    user = User(
        id=uuid.uuid4().hex,
        phone=f"+9725{uuid.uuid4().int % 10**8:08d}",
        name="Demotion Test",
        role=UserRole.DRIVER,
        points=total_points,
        total_points=total_points,
        level=10,
    )
    db.add(user)
    await db.commit()

    if history_score is not None:
        now = datetime.now(UTC)
        for day in range(1, 11):
            db.add(
                Trip(
                    id=uuid.uuid4().hex,
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
    return user


async def _cleanup(db: AsyncSession, user: User) -> None:
    await db.execute(delete(Trip).where(Trip.user_id == user.id))
    await db.execute(delete(User).where(User.id == user.id))
    await db.commit()


def _clean_trip() -> SaveTripIn:
    """A trip good enough to earn points but not to lift a poor rolling score."""
    return SaveTripIn(
        distanceKm=8.0,
        durationSeconds=1200,
        hardBrakes=0,
        aggressiveAccels=0,
        sharpTurns=0,
        touchEpochs=0,
        screenInteractionSeconds=0,
        idempotencyKey=uuid.uuid4().hex,
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("history_score", [60.0, 50.0, 40.0])
async def test_a_poor_driver_score_demotes_a_high_earner(db_session: AsyncSession, history_score: float) -> None:
    """80k lifetime points earns level 10. Recent driving decides what is shown.

    Asserted against `_level_cap` of the score the server actually resolved,
    rather than a hardcoded level — that pins the wiring (LEAST applied, over
    the recomputed score, written and read back) without also freezing the
    calibration table, which is expected to be re-fit.
    """
    user = await _make_user(db_session, total_points=80_000, history_score=history_score)
    try:
        await trips_service.save(db_session, user, _clean_trip())
        row = (await db_session.execute(select(User.level, User.driver_score).where(User.id == user.id))).one()
        level, driver_score = row
        assert level < 10, "a poor rolling score must not leave the earned level standing"
        assert level == _level_cap(driver_score)
    finally:
        await _cleanup(db_session, user)


@pytest.mark.asyncio
async def test_a_good_driver_score_leaves_the_earned_level_alone(db_session: AsyncSession) -> None:
    user = await _make_user(db_session, total_points=80_000, history_score=98.0)
    try:
        await trips_service.save(db_session, user, _clean_trip())
        row = (await db_session.execute(select(User.level, User.driver_score).where(User.id == user.id))).one()
        level, driver_score = row
        assert driver_score >= 80.0
        assert level == 10, "nothing to cap — the driver is still driving well"
    finally:
        await _cleanup(db_session, user)


@pytest.mark.asyncio
async def test_recovering_the_score_restores_the_earned_level(db_session: AsyncSession) -> None:
    """The point of a cap rather than a reset: nothing has to be re-earned."""
    user = await _make_user(db_session, total_points=80_000, history_score=45.0)
    try:
        await trips_service.save(db_session, user, _clean_trip())
        demoted = await db_session.scalar(select(User.level).where(User.id == user.id))
        assert demoted < 10

        # Wipe the bad history and drive well: the ladder is untouched, so the
        # earned level comes straight back with no points re-accumulated.
        await db_session.execute(delete(Trip).where(Trip.user_id == user.id))
        await db_session.commit()
        await db_session.refresh(user)
        for _ in range(3):
            await trips_service.save(db_session, user, _clean_trip())

        row = (await db_session.execute(select(User.level, User.driver_score).where(User.id == user.id))).one()
        level, driver_score = row
        assert level > demoted, f"level should recover with the score (now {driver_score})"
    finally:
        await _cleanup(db_session, user)


@pytest.mark.asyncio
async def test_the_cap_cannot_promote_beyond_what_was_earned(db_session: AsyncSession) -> None:
    # A spotless driver score does not buy a level the points have not reached.
    user = await _make_user(db_session, total_points=600, history_score=98.0)
    try:
        await trips_service.save(db_session, user, _clean_trip())
        level = await db_session.scalar(select(User.level).where(User.id == user.id))
        assert level == 2, "600 points is level 2 regardless of how well they drive"
    finally:
        await _cleanup(db_session, user)
