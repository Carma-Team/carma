"""The consolidated level ladder (#61).

The ladder used to exist in five disagreeing copies. Now there is one, in
`app.services.levels`, and everything else derives from it — so what is worth
testing is the derivation, not the numbers themselves. The invariant tests
below stay green through a re-calibration; only a genuinely broken ladder
(non-monotonic, gapped, a multiplier that punishes a promotion) fails them.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.main import app
from app.models import Trip, User
from app.models.enums import UserRole
from app.schemas.trip import SaveTripIn
from app.services import levels
from app.services import trips as trips_service

_TZ_IL = ZoneInfo("Asia/Jerusalem")

# ─── the ladder itself ────────────────────────────────────────────────────────


class TestLadderShape:
    def test_levels_are_numbered_one_to_ten_without_gaps(self):
        assert [lv.number for lv in levels.LEVELS] == list(range(1, 11))
        assert levels.MAX_LEVEL == 10

    def test_it_starts_at_zero_points(self):
        # Every driver must land on a level, including one with no points at all.
        assert levels.LEVELS[0].min_points == 0
        assert levels.level_for_points(0) == 1

    def test_thresholds_strictly_increase(self):
        mins = [lv.min_points for lv in levels.LEVELS]
        assert mins == sorted(mins)
        assert len(set(mins)) == len(mins), "two levels sharing a threshold makes one unreachable"

    def test_a_promotion_never_reduces_the_bonus(self):
        multipliers = [lv.bonus_multiplier for lv in levels.LEVELS]
        assert multipliers == sorted(multipliers)
        assert multipliers[0] == 1.0, "level 1 is the baseline, not a penalty"

    def test_the_reward_bands_stay_inside_the_range_that_motivates(self):
        # Tiered-loyalty practice is 3-5 bands. Fewer stops feeling like a
        # ladder; more turns every rung into noise.
        bands = sorted({lv.bonus_multiplier for lv in levels.LEVELS})
        assert 3 <= len(bands) <= 5

    def test_a_step_a_driver_cannot_feel_is_not_a_step(self):
        # The ladder used to rise 2% per level. Level 5 to 6 was worth nothing
        # anyone would notice, so it gave nobody a reason to climb.
        bands = sorted({lv.bonus_multiplier for lv in levels.LEVELS})
        for lower, higher in zip(bands, bands[1:], strict=False):
            assert higher / lower >= 1.10, f"{lower} -> {higher} is under 10%"

    def test_the_top_of_the_ladder_is_worth_reaching(self):
        assert levels.LEVELS[-1].bonus_multiplier >= 2.0

    def test_a_perk_line_only_appears_where_the_code_backs_it(self):
        # Levels used to promise discounts, leaderboard access and badges that
        # nothing enforced. A perk line is now built from the multiplier, so it
        # cannot claim more than the ladder actually does (#83).
        assert levels.perks_for(1) == ()
        for lv in levels.LEVELS:
            expected = () if lv.bonus_multiplier <= 1.0 else (f"מכפיל נקודות x{lv.bonus_multiplier:.2f}",)
            assert levels.perks_for(lv.number) == expected


class TestLevelForPoints:
    def test_each_threshold_is_inclusive(self):
        for lv in levels.LEVELS:
            assert levels.level_for_points(lv.min_points) == lv.number

    def test_one_point_short_stays_on_the_level_below(self):
        for lv in levels.LEVELS[1:]:
            assert levels.level_for_points(lv.min_points - 1) == lv.number - 1

    def test_bands_are_contiguous(self):
        for lv in levels.LEVELS[:-1]:
            assert levels.max_points_for(lv.number) + 1 == levels.by_number(lv.number + 1).min_points

    def test_the_top_band_is_open_ended(self):
        assert levels.level_for_points(10**9) == levels.MAX_LEVEL

    def test_by_number_clamps_rather_than_raising(self):
        assert levels.by_number(0).number == 1
        assert levels.by_number(99).number == levels.MAX_LEVEL

    def test_thresholds_desc_matches_the_ladder(self):
        desc = levels.thresholds_desc()
        assert desc == tuple(sorted(desc, reverse=True))
        # Level 1 is the CASE's else_ branch, so it is deliberately absent.
        assert len(desc) == len(levels.LEVELS) - 1


# ─── /api/levels ──────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_the_endpoint_serves_the_ladder_and_needs_no_database() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.get("/api/levels")

    assert r.status_code == 200
    rows = r.json()["levels"]
    assert len(rows) == len(levels.LEVELS)
    assert [row["level"] for row in rows] == [lv.number for lv in levels.LEVELS]
    assert [row["minPoints"] for row in rows] == [lv.min_points for lv in levels.LEVELS]
    # Exposed so the client can *display* what a level is worth — never apply it.
    assert [row["bonusMultiplier"] for row in rows] == [lv.bonus_multiplier for lv in levels.LEVELS]


# ─── the bonus, end to end ────────────────────────────────────────────────────


async def _driver_at(db: AsyncSession, *, total_points: int) -> User:
    user = User(
        id=uuid.uuid4().hex,
        phone=f"+9725{uuid.uuid4().int % 10**8:08d}",
        name="Bonus Test",
        role=UserRole.DRIVER,
        points=total_points,
        total_points=total_points,
        level=levels.level_for_points(total_points),
    )
    db.add(user)
    await db.commit()
    return user


def _trip() -> SaveTripIn:
    """A modest midday drive, sized so the level bonus is never what clips it.

    Both knobs matter. Noon pins the risk multiplier at 1.0 — left to the wall
    clock, an Israeli weekend night doubles the award and the daily cap, not the
    ladder, decides the result. 4 km keeps even a doubled award under that cap.
    The cap clipping the top of the ladder is deliberate and tested in
    `test_scoring.py`; here it would only get in the way.
    """
    noon = datetime.now(_TZ_IL).replace(hour=12, minute=0, second=0, microsecond=0)
    return SaveTripIn(
        startTime=noon,
        distanceKm=4.0,
        durationSeconds=1800,
        hardBrakes=0,
        aggressiveAccels=0,
        sharpTurns=0,
        touchEpochs=0,
        screenInteractionSeconds=0,
        idempotencyKey=uuid.uuid4().hex,
    )


@pytest.mark.asyncio
async def test_a_higher_level_earns_more_for_the_same_drive(db_session: AsyncSession) -> None:
    """Identical trips, different standing — the ladder has to be worth something."""
    beginner = await _driver_at(db_session, total_points=0)
    veteran = await _driver_at(db_session, total_points=75_000)
    try:
        low = await trips_service.save(db_session, beginner, _trip())
        high = await trips_service.save(db_session, veteran, _trip())

        ratio = levels.by_number(10).bonus_multiplier / levels.by_number(1).bonus_multiplier
        assert high.points > low.points
        assert high.points == pytest.approx(low.points * ratio, rel=0.02)
    finally:
        for u in (beginner, veteran):
            await db_session.execute(delete(Trip).where(Trip.user_id == u.id))
            await db_session.execute(delete(User).where(User.id == u.id))
        await db_session.commit()


@pytest.mark.asyncio
async def test_the_bonus_follows_the_level_entering_the_trip(db_session: AsyncSession) -> None:
    """One point short of a promotion still earns at the old rate.

    The trip that crosses a threshold is paid at the level it started from —
    otherwise the trip's own points would set the level that scales those same
    points, which is circular.
    """
    user = await _driver_at(db_session, total_points=levels.by_number(2).min_points - 1)
    try:
        trip = await trips_service.save(db_session, user, _trip())
        level_after = await db_session.scalar(select(User.level).where(User.id == user.id))

        assert level_after >= 2, "the trip should have carried them over the threshold"
        # Paid at level 1's multiplier (1.0), not level 2's.
        assert trip.points == round(trip.points / levels.by_number(1).bonus_multiplier)
    finally:
        await db_session.execute(delete(Trip).where(Trip.user_id == user.id))
        await db_session.execute(delete(User).where(User.id == user.id))
        await db_session.commit()
