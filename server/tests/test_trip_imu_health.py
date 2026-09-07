"""Per-trip accelerometer health survives the round trip (CAR-228).

CAR-189 started sending `accelAvailable` / `accelInitFailed` with every save.
`SaveTripIn` inherits `CamelModel`, which sets no `extra=`, so pydantic's default
`ignore` applied and both fields were dropped in silence. These tests are what
notices if that ever happens again: the schema has to accept them, the service
has to persist them, and the read path has to hand them back.

The distinction the whole ticket rests on is three-way, not boolean. A healthy
drive, a device with no accelerometer, and a sensor whose registration threw are
three different states, and a trip nobody measured is a fourth. NULL carries that
fourth one, which is why nothing here defaults to False.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import UserRole
from app.models.trip import Trip
from app.models.user import User
from app.schemas.trip import SaveTripIn, TripOut
from app.services import scoring
from app.services import trips as trips_service

_TZ_IL = ZoneInfo("Asia/Jerusalem")


# ─── the schema accepts what the SDK sends ────────────────────────────────────


def test_camel_case_from_the_wire_is_accepted() -> None:
    dto = SaveTripIn(accelAvailable=True, accelInitFailed=False)
    assert dto.accel_available is True
    assert dto.accel_init_failed is False


def test_snake_case_is_accepted_too() -> None:
    """The rest of SaveTripIn takes both spellings; these must not be the exception."""
    dto = SaveTripIn(accel_available=False, accel_init_failed=True)
    assert dto.accel_available is False
    assert dto.accel_init_failed is True


def test_a_client_that_says_nothing_yields_none_not_false() -> None:
    """The bug this ticket fixes was silence being read as an answer.

    False is a claim: the accelerometer was never live. An old client saying
    nothing has made no claim at all.
    """
    dto = SaveTripIn()
    assert dto.accel_available is None
    assert dto.accel_init_failed is None


# ─── persisted, and read back ─────────────────────────────────────────────────


async def _driver(db: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4().hex,
        phone=f"+9725{uuid.uuid4().int % 10**8:08d}",
        name="IMU Health Test",
        role=UserRole.DRIVER,
    )
    db.add(user)
    await db.commit()
    return user


def _trip(**imu: bool) -> SaveTripIn:
    """A plain midday drive; noon pins the risk multiplier so nothing else varies."""
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
        **imu,
    )


@pytest.mark.asyncio
async def test_the_three_sensor_states_are_distinguishable_in_the_database(
    db_session: AsyncSession,
) -> None:
    """The ticket's acceptance criterion, read straight off the stored rows."""
    driver = await _driver(db_session)

    healthy = await trips_service.save(db_session, driver, _trip(accelAvailable=True, accelInitFailed=False))
    no_hardware = await trips_service.save(db_session, driver, _trip(accelAvailable=False, accelInitFailed=False))
    init_threw = await trips_service.save(db_session, driver, _trip(accelAvailable=False, accelInitFailed=True))

    stored = {
        t.id: (t.accel_available, t.accel_init_failed)
        for t in (
            await db_session.scalars(select(Trip).where(Trip.id.in_([healthy.id, no_hardware.id, init_threw.id])))
        ).all()
    }

    assert stored[healthy.id] == (True, False)
    assert stored[no_hardware.id] == (False, False)
    assert stored[init_threw.id] == (False, True)
    # Three distinct rows, not three copies of the same shrug.
    assert len(set(stored.values())) == 3


@pytest.mark.asyncio
async def test_a_signed_digest_wins_over_the_top_level_copy(db_session: AsyncSession) -> None:
    """The top-level fields are unsigned; the digest carries the same two signed.

    Trusting the top-level copy would let a client sign an honest "the sensor was
    dead" and assert healthy hardware beside it, which is the one claim anything
    weighting a trip by sensor health must not accept from the client.
    """
    driver = await _driver(db_session)
    dto = _trip(accelAvailable=True, accelInitFailed=False)
    dto.telemetry_digest = {"accelAvailable": False, "accelInitFailed": True}

    saved = await trips_service.save(db_session, driver, dto)
    row = await db_session.scalar(select(Trip).where(Trip.id == saved.id))

    assert row is not None
    assert row.accel_available is False, "the signed digest is the only source"
    assert row.accel_init_failed is True


@pytest.mark.asyncio
async def test_a_digest_predating_the_fields_leaves_them_unknown(db_session: AsyncSession) -> None:
    """An older SDK signs a digest with neither key. That is unknown, not false."""
    driver = await _driver(db_session)
    dto = _trip(accelAvailable=True, accelInitFailed=False)
    dto.telemetry_digest = {"hardBrakes": 0, "distanceKm": 4.0, "durationSeconds": 1800}

    saved = await trips_service.save(db_session, driver, dto)
    row = await db_session.scalar(select(Trip).where(Trip.id == saved.id))

    assert row is not None
    assert row.accel_available is None
    assert row.accel_init_failed is None


@pytest.mark.asyncio
async def test_an_unknown_field_is_logged_rather_than_dropped_in_silence(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """The cause behind CAR-228, not just the two names it added.

    CAR-227 puts a coverage fraction into this same payload; without this it
    would arrive and vanish exactly as `accelAvailable` did.
    """
    with caplog.at_level("WARNING", logger="carma.trips"):
        SaveTripIn.model_validate({"distanceKm": 4.0, "accelCoverage": 0.42})

    assert "accelCoverage" in caplog.text
    assert "ignored unknown field" in caplog.text


@pytest.mark.asyncio
async def test_a_client_that_sends_nothing_stores_null(db_session: AsyncSession) -> None:
    """Trips already in the table, and apps too old to send the fields, stay unknown."""
    driver = await _driver(db_session)
    saved = await trips_service.save(db_session, driver, _trip())

    row = await db_session.scalar(select(Trip).where(Trip.id == saved.id))
    assert row is not None
    assert row.accel_available is None
    assert row.accel_init_failed is None


@pytest.mark.asyncio
async def test_the_save_response_carries_the_health_back(db_session: AsyncSession) -> None:
    driver = await _driver(db_session)
    out = await trips_service.save(db_session, driver, _trip(accelAvailable=False, accelInitFailed=True))
    assert out.accel_available is False
    assert out.accel_init_failed is True


@pytest.mark.asyncio
async def test_the_wire_shape_is_camel_case(db_session: AsyncSession) -> None:
    """generated.ts is built from this; the mobile app reads the camelCase keys."""
    driver = await _driver(db_session)
    out = await trips_service.save(db_session, driver, _trip(accelAvailable=True, accelInitFailed=False))
    dumped: dict = TripOut.model_validate(out).model_dump(by_alias=True)
    assert dumped["accelAvailable"] is True
    assert dumped["accelInitFailed"] is False


# ─── a dead accelerometer caps the score (CAR-190) ────────────────────────────

_CONF_TRIP_START = "2026-06-14T08:00:00Z"
_CONF_TRIP_START_MS = 1781510400000  # matches _CONF_TRIP_START


def _confident_waypoints() -> list[dict[str, Any]]:
    """Dense, steady 4 s-cadence trace: 6.2 km in 900 s at 24.8 km/h, straight
    line. Gives the server a clean GPS trace (confidence 1.0, no server-detected
    events of its own) so `apply_confidence` cannot be what caps the score below
    — the IMU cap has to be doing the work the assertions check for.
    """
    return [
        {"ts": _CONF_TRIP_START_MS + i * 4000, "speedKmh": 24.8, "lat": 32.07 + i * 0.0002, "lng": 34.78}
        for i in range(226)
    ]


def _imu_cap_trip(**imu: bool) -> SaveTripIn:
    return SaveTripIn(
        startTime=_CONF_TRIP_START,
        distanceKm=6.2,
        durationSeconds=900,
        hardBrakes=0,
        aggressiveAccels=0,
        sharpTurns=0,
        touchEpochs=0,
        screenInteractionSeconds=0,
        idempotencyKey=uuid.uuid4().hex,
        routeWaypoints=_confident_waypoints(),
        **imu,
    )


@pytest.mark.asyncio
async def test_a_dead_accelerometer_caps_a_zero_event_trip_at_the_ceiling(db_session: AsyncSession) -> None:
    """Zero events from a dead sensor is not evidence of clean driving.

    The driver's rolling standing is set above the ceiling, so the cap that
    engages here has to be the absolute one — the farm-proofing case the
    ticket calls out by name: a high-standing driver switching the
    accelerometer off must not coast at their existing standing.
    """
    driver = await _driver(db_session)
    driver.driver_score = 95.0
    await db_session.commit()

    capped = await trips_service.save(db_session, driver, _imu_cap_trip(accelAvailable=False, accelInitFailed=True))

    assert capped.avg_score == scoring.CONFIG.imu_dead_score_ceiling
    assert capped.imu_degraded is True


@pytest.mark.asyncio
async def test_a_live_accelerometer_is_not_capped(db_session: AsyncSession) -> None:
    """Companion to the cap test above — same trip, healthy sensor, no cap."""
    driver = await _driver(db_session)
    driver.driver_score = 95.0
    await db_session.commit()

    uncapped = await trips_service.save(db_session, driver, _imu_cap_trip(accelAvailable=True, accelInitFailed=False))

    assert uncapped.avg_score > scoring.CONFIG.imu_dead_score_ceiling
    assert uncapped.imu_degraded is False


@pytest.mark.asyncio
async def test_a_sparse_trace_does_not_let_a_dead_accelerometer_dodge_the_ceiling(
    db_session: AsyncSession,
) -> None:
    """The two caps have to compose, or a bad GPS trace hides the accelerometer
    being off.

    No waypoints floors `gps_confidence` at 0, which alone caps the trip at the
    rolling standing (95). If the IMU cap ran second it would see `raw <=
    rolling` and no-op, so the absolute ceiling below the rolling standing
    would never engage — the exact farm case this ticket names.
    """
    driver = await _driver(db_session)
    driver.driver_score = 95.0
    await db_session.commit()

    trip = _trip(accelAvailable=False, accelInitFailed=True)
    capped = await trips_service.save(db_session, driver, trip)

    assert capped.avg_score == scoring.CONFIG.imu_dead_score_ceiling
    assert capped.imu_degraded is True
