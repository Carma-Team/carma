"""ensure_ai_insight generates once, on the trip-detail route only.

Naveh's review of #348 flagged two gaps: nothing exercised the actual Gemini
call (only the "no key configured" short-circuit ran in CI), and the first
version of this feature generated from `get_by_id`, which `occupancy.py` also
calls as a pure 404 guard — so viewing occupancy silently fired the same
provider call the lazy-generation design was meant to keep off the hot path.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import TripStatus, UserRole
from app.models.trip import Trip
from app.models.user import User
from app.schemas.occupancy import OccupancyDeclarationIn
from app.services import insights
from app.services import occupancy as occupancy_service
from app.services import trips as trips_service


async def _driver(db: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4().hex,
        phone=f"+9725{uuid.uuid4().int % 10**8:08d}",
        name="AI Insight Test",
        role=UserRole.DRIVER,
    )
    db.add(user)
    await db.commit()
    return user


async def _scored_trip(db: AsyncSession, user: User) -> Trip:
    trip = Trip(
        user_id=user.id,
        start_time=datetime.now(UTC),
        end_time=datetime.now(UTC),
        score_v2=72.0,
        avg_score=72.0,
        weakest_factor="braking",
        hard_brakes=3,
        status=TripStatus.COMPLETED,
    )
    db.add(trip)
    await db.commit()
    await db.refresh(trip)
    return trip


@pytest.mark.asyncio
async def test_generate_calls_the_configured_model(monkeypatch: pytest.MonkeyPatch) -> None:
    """The actual SDK call path, not just the missing-key short-circuit."""
    monkeypatch.setattr(insights.settings, "gemini_api_key", "test-key")
    insights._client.cache_clear()

    mock_response = SimpleNamespace(text="בלמת חזק שלוש פעמים, נסה/י לשמור מרחק גדול יותר.")
    mock_client = SimpleNamespace(
        aio=SimpleNamespace(models=SimpleNamespace(generate_content=AsyncMock(return_value=mock_response)))
    )
    monkeypatch.setattr(insights, "_client", lambda: mock_client)

    result = await insights.generate(72.0, "braking", occurrences=3)

    assert result == mock_response.text
    mock_client.aio.models.generate_content.assert_awaited_once()
    kwargs = mock_client.aio.models.generate_content.await_args.kwargs
    assert kwargs["model"] == insights._MODEL
    assert "3 מקרים" in kwargs["contents"]


@pytest.mark.asyncio
async def test_a_provider_error_is_swallowed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(insights.settings, "gemini_api_key", "test-key")
    insights._client.cache_clear()

    mock_client = SimpleNamespace(
        aio=SimpleNamespace(
            models=SimpleNamespace(generate_content=AsyncMock(side_effect=RuntimeError("quota exceeded")))
        )
    )
    monkeypatch.setattr(insights, "_client", lambda: mock_client)

    assert await insights.generate(50.0, "distraction") is None


@pytest.mark.asyncio
async def test_ensure_ai_insight_generates_once_and_caches(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    driver = await _driver(db_session)
    trip = await _scored_trip(db_session, driver)

    mock_generate = AsyncMock(return_value="נסה/י לבלום בעדינות רבה יותר.")
    monkeypatch.setattr(trips_service.insights, "generate", mock_generate)

    updated = await trips_service.ensure_ai_insight(db_session, trip)
    assert updated.ai_insight == "נסה/י לבלום בעדינות רבה יותר."
    assert updated.ai_insight_attempted_at is not None
    mock_generate.assert_awaited_once()

    # A second view must not call the provider again.
    again = await trips_service.ensure_ai_insight(db_session, updated)
    assert again.ai_insight == updated.ai_insight
    mock_generate.assert_awaited_once()


@pytest.mark.asyncio
async def test_a_failed_attempt_is_not_retried(db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch) -> None:
    """The bug itself: a quota-exhausted call used to re-fire on every future view."""
    driver = await _driver(db_session)
    trip = await _scored_trip(db_session, driver)

    mock_generate = AsyncMock(return_value=None)
    monkeypatch.setattr(trips_service.insights, "generate", mock_generate)

    first = await trips_service.ensure_ai_insight(db_session, trip)
    assert first.ai_insight is None
    assert first.ai_insight_attempted_at is not None
    mock_generate.assert_awaited_once()

    second = await trips_service.ensure_ai_insight(db_session, first)
    assert second.ai_insight is None
    mock_generate.assert_awaited_once()


@pytest.mark.asyncio
async def test_a_racing_second_request_does_not_double_call(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Two requests loading the same never-viewed trip must not both call Gemini.

    Simulates the race directly: a concurrent request claims the attempt in
    the database (`synchronize_session=False` keeps our in-memory `trip`
    stale, exactly as a second request that loaded the row before the first
    committed would see it) before this call's atomic claim runs.
    """
    driver = await _driver(db_session)
    trip = await _scored_trip(db_session, driver)

    mock_generate = AsyncMock(return_value="should never be called")
    monkeypatch.setattr(trips_service.insights, "generate", mock_generate)

    await db_session.execute(
        update(Trip).where(Trip.id == trip.id).values(ai_insight_attempted_at=datetime.now(UTC)),
        execution_options={"synchronize_session": False},
    )
    await db_session.commit()

    result = await trips_service.ensure_ai_insight(db_session, trip)

    mock_generate.assert_not_awaited()
    assert result.ai_insight is None


@pytest.mark.asyncio
async def test_occupancy_reads_never_trigger_generation(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The regression this test is named after: get_by_id must stay pure.

    occupancy.get()/declare() call trips_service.get_by_id purely as an
    ownership check, and TripOccupancyControl fetches it from the post-trip
    summary modal — the exact hot path lazy generation was built to avoid.
    """
    driver = await _driver(db_session)
    trip = await _scored_trip(db_session, driver)

    mock_generate = AsyncMock(return_value="should never be called")
    monkeypatch.setattr(trips_service.insights, "generate", mock_generate)

    await occupancy_service.get(db_session, driver.id, trip.id)

    mock_generate.assert_not_awaited()
    refreshed = await trips_service.get_by_id(db_session, driver.id, trip.id)
    assert refreshed.ai_insight is None
    assert refreshed.ai_insight_attempted_at is None


@pytest.mark.asyncio
async def test_a_declared_passenger_trip_gets_no_insight(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Coaching a driver on a trip they said they didn't drive is wrong regardless of score."""
    driver = await _driver(db_session)
    trip = await _scored_trip(db_session, driver)

    mock_generate = AsyncMock(return_value="should never be called")
    monkeypatch.setattr(trips_service.insights, "generate", mock_generate)

    await occupancy_service.declare(
        db_session, driver.id, trip.id, OccupancyDeclarationIn(was_driving=False, prompted=False)
    )

    result = await trips_service.ensure_ai_insight(db_session, trip)

    mock_generate.assert_not_awaited()
    assert result.ai_insight is None
    # Skipped, not attempted — a later correction to DRIVER must still be free to generate.
    assert result.ai_insight_attempted_at is None


@pytest.mark.asyncio
async def test_declaring_passenger_clears_an_insight_already_generated(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The other ordering: the detail screen generates on mount, the driver declares after.

    The skip in ensure_ai_insight only covers declare-then-view. TripDetailScreen
    fetches the trip (generating) and renders TripOccupancyControl underneath it,
    so view-then-declare is at least as common, and left driver coaching sitting
    on a trip the driver had just said they did not drive.
    """
    driver = await _driver(db_session)
    trip = await _scored_trip(db_session, driver)

    mock_generate = AsyncMock(return_value="נסה/י לבלום בעדינות רבה יותר.")
    monkeypatch.setattr(trips_service.insights, "generate", mock_generate)

    generated = await trips_service.ensure_ai_insight(db_session, trip)
    assert generated.ai_insight is not None

    await occupancy_service.declare(
        db_session, driver.id, trip.id, OccupancyDeclarationIn(was_driving=False, prompted=False)
    )

    refreshed = await trips_service.get_by_id(db_session, driver.id, trip.id)
    assert refreshed.ai_insight is None
    # Cleared with the text, or correcting back to DRIVER would never regenerate.
    assert refreshed.ai_insight_attempted_at is None


@pytest.mark.asyncio
async def test_correcting_to_driver_regenerates_a_cleared_insight(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Undoing the passenger declaration brings the coaching back."""
    driver = await _driver(db_session)
    trip = await _scored_trip(db_session, driver)

    mock_generate = AsyncMock(return_value="נסה/י לבלום בעדינות רבה יותר.")
    monkeypatch.setattr(trips_service.insights, "generate", mock_generate)

    await trips_service.ensure_ai_insight(db_session, trip)
    await occupancy_service.declare(
        db_session, driver.id, trip.id, OccupancyDeclarationIn(was_driving=False, prompted=False)
    )
    await occupancy_service.declare(
        db_session, driver.id, trip.id, OccupancyDeclarationIn(was_driving=True, prompted=False)
    )

    refreshed = await trips_service.get_by_id(db_session, driver.id, trip.id)
    result = await trips_service.ensure_ai_insight(db_session, refreshed)

    assert result.ai_insight == "נסה/י לבלום בעדינות רבה יותר."


@pytest.mark.asyncio
async def test_correcting_to_driver_still_allows_generation(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A PASSENGER declaration later corrected to DRIVER must not be locked out forever."""
    driver = await _driver(db_session)
    trip = await _scored_trip(db_session, driver)

    mock_generate = AsyncMock(return_value="נסה/י לבלום בעדינות רבה יותר.")
    monkeypatch.setattr(trips_service.insights, "generate", mock_generate)

    await occupancy_service.declare(
        db_session, driver.id, trip.id, OccupancyDeclarationIn(was_driving=False, prompted=False)
    )
    await occupancy_service.declare(
        db_session, driver.id, trip.id, OccupancyDeclarationIn(was_driving=True, prompted=False)
    )

    result = await trips_service.ensure_ai_insight(db_session, trip)

    mock_generate.assert_awaited_once()
    assert result.ai_insight == "נסה/י לבלום בעדינות רבה יותר."
