"""Live DB integration tests for trip → Event persistence.

The pure parser tests (test_trip_events.py) prove the validation contract; these
prove the other half — that save() actually writes the rows through the
Trip→Event cascade, that the type bridge survives a round-trip, and that the
idempotent re-save does not duplicate the timeline. Skipped automatically when
no Postgres is reachable (see conftest.db_session).
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Event, Trip, User
from app.models.enums import UserRole
from app.schemas.trip import SaveTripIn
from app.services import trips as trips_service


@pytest.fixture
def trip_dto_with_events() -> SaveTripIn:
    return SaveTripIn(
        distanceKm=6.2,
        durationSeconds=900,
        startTime="2026-06-14T08:00:00Z",
        endTime="2026-06-14T08:15:00Z",
        hardBrakes=2,
        sharpTurns=1,
        events=[
            {
                "type": "HARD_BRAKE",
                "severity": 0.7,
                "timestamp": "2026-06-14T08:03:00Z",
                "location": {"latitude": 32.07, "longitude": 34.78},
                "peakG": 0.52,
            },
            {"type": "PHONE_USAGE", "severity": 0.4, "timestamp": "2026-06-14T08:06:00Z"},
            {"type": "SHARP_TURN", "severity": 0.6, "lat": 32.08, "lng": 34.79},
            {"type": "TELEPORT"},  # unknown → dropped
            {"type": "HARD_BRAKE", "lat": 999.0},  # bad coord → kept, coord nulled
        ],
    )


async def _make_user(db: AsyncSession) -> User:
    user = User(
        email=f"_evt_{uuid.uuid4().hex[:10]}@carma.test",
        password_hash="x",
        role=UserRole.DRIVER,
        name="Evt Test",
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def _cleanup(db: AsyncSession, user: User) -> None:
    # Events cascade-delete with their trips; deleting the user removes the trips.
    await db.execute(delete(Trip).where(Trip.user_id == user.id))
    await db.delete(user)
    await db.commit()


@pytest.mark.asyncio
async def test_save_persists_event_rows(db_session: AsyncSession, trip_dto_with_events: SaveTripIn) -> None:
    user = await _make_user(db_session)
    try:
        out = await trips_service.save(db_session, user, trip_dto_with_events, idempotency_key=uuid.uuid4().hex)

        rows = (
            (await db_session.execute(select(Event).where(Event.trip_id == out.id).order_by(Event.timestamp)))
            .scalars()
            .all()
        )

        # 5 input events: TELEPORT dropped → 4 persisted.
        assert len(rows) == 4
        types = {e.type.value for e in rows}
        assert types == {"HARD_BRAKE", "PHONE_USE", "SHARP_TURN"}

        # PHONE_USAGE (SDK) must have been bridged to PHONE_USE (column) on the way in.
        assert any(e.type.value == "PHONE_USE" for e in rows)

        # The raw payload is retained for forensics — peak_g survives until v2 reads it.
        braked = next(e for e in rows if e.lat == 32.07)
        assert braked.sensor_data is not None and braked.sensor_data["peakG"] == 0.52

        # Out-of-range coordinate was nulled, but the event itself was kept.
        bad_coord = next(e for e in rows if e.type.value == "HARD_BRAKE" and e.lat is None)
        assert bad_coord.lng is None
    finally:
        await _cleanup(db_session, user)


_TRIP_START_MS = 1781510400000  # 2026-06-14T08:00:00Z


def _steady_waypoints() -> list[dict[str, Any]]:
    """A clean 4 s-cadence trace: straight line, constant 24.8 km/h, 6.2 km in 900 s.

    Present, and identical in both trips, for a reason that is easy to get wrong:
    with no trace `telemetry.analyze` returns zero confidence, and
    `apply_confidence` then pins *every* score above the rolling standing to
    exactly that standing. Both trips would come out equal no matter what
    severity did, and the test would pass against a real leak.

    Steady and straight so the server detects no events of its own — the trace
    raises confidence without adding a second source of severity.
    """
    return [
        {"ts": _TRIP_START_MS + i * 4000, "speedKmh": 24.8, "lat": 32.07 + i * 0.0002, "lng": 34.78} for i in range(226)
    ]


def _trip_dto(*, with_severity: bool, hard_brakes: int = 1) -> SaveTripIn:
    """The same trip twice, differing only in whether the client claims a severity.

    No `telemetryDigest`: counts then come from the DTO rather than the signed
    oracle, which is the weaker of the two paths and the one a leak would take.

    `hard_brakes` varies only for the sensitivity canary below.
    """
    event: dict[str, Any] = {"type": "HARD_BRAKE", "timestamp": "2026-06-14T08:03:00Z", "peakG": 0.52}
    turn: dict[str, Any] = {"type": "SHARP_TURN", "timestamp": "2026-06-14T08:07:00Z", "peakG": 0.41}
    if with_severity:
        event = {**event, "severity": 0.9}
        turn = {**turn, "severity": 0.9}
    return SaveTripIn(
        distanceKm=6.2,
        durationSeconds=900,
        startTime="2026-06-14T08:00:00Z",
        endTime="2026-06-14T08:15:00Z",
        hardBrakes=hard_brakes,
        sharpTurns=1,
        events=[event, turn],
        routeWaypoints=_steady_waypoints(),
    )


@pytest.mark.asyncio
async def test_client_event_severity_does_not_move_the_score(db_session: AsyncSession) -> None:
    """CAR-155: the events array is unsigned, so nothing in it may reach the score.

    A fresh user per trip — `_compute_score` reads the driver's own history, so
    saving both trips under one user would make the second differ for a reason
    that has nothing to do with severity.
    """
    plain_user = await _make_user(db_session)
    severe_user = await _make_user(db_session)
    canary_user = await _make_user(db_session)
    try:
        plain = await trips_service.save(
            db_session, plain_user, _trip_dto(with_severity=False), idempotency_key=uuid.uuid4().hex
        )
        severe = await trips_service.save(
            db_session, severe_user, _trip_dto(with_severity=True), idempotency_key=uuid.uuid4().hex
        )

        # Sensitivity canary, asserted before the equality below and not merely
        # once by hand at review time. The equality assertions only mean
        # something while this fixture can tell two scores apart at all: an
        # earlier version of this test compared two trips the scorer had already
        # flattened to the same number, and so passed against a deliberate
        # severity leak. If a scoring change ever flattens them again, this
        # fails and says the test has gone blind — rather than passing forever.
        canary = await trips_service.save(
            db_session, canary_user, _trip_dto(with_severity=False, hard_brakes=4), idempotency_key=uuid.uuid4().hex
        )
        assert canary.avg_score != plain.avg_score, (
            "the fixture no longer detects a change in event counts, so the equality "
            "assertions below cannot detect a severity leak either — fix the fixture, "
            "do not delete this line (CAR-155)"
        )

        assert plain.avg_score == severe.avg_score
        assert plain.points == severe.points

        plain_row = await db_session.get(Trip, plain.id)
        severe_row = await db_session.get(Trip, severe.id)
        assert plain_row is not None and severe_row is not None
        assert plain_row.score_v2 == severe_row.score_v2

        await db_session.refresh(plain_user)
        await db_session.refresh(severe_user)
        assert plain_user.driver_score == severe_user.driver_score

        # Criterion 2: still persisted for diagnostics. Also stops anyone
        # "fixing" the assertions above by dropping the field on ingest.
        severities = (
            (await db_session.execute(select(Event.severity).where(Event.trip_id == severe.id))).scalars().all()
        )
        assert set(severities) == {0.9}
        defaults = (await db_session.execute(select(Event.severity).where(Event.trip_id == plain.id))).scalars().all()
        assert set(defaults) == {1.0}

        raw = (await db_session.execute(select(Event).where(Event.trip_id == severe.id))).scalars().all()
        assert all(e.sensor_data is not None and e.sensor_data["severity"] == 0.9 for e in raw)
    finally:
        await _cleanup(db_session, plain_user)
        await _cleanup(db_session, severe_user)
        await _cleanup(db_session, canary_user)


@pytest.mark.asyncio
async def test_idempotent_resave_does_not_duplicate_events(
    db_session: AsyncSession, trip_dto_with_events: SaveTripIn
) -> None:
    user = await _make_user(db_session)
    key = uuid.uuid4().hex
    try:
        first = await trips_service.save(db_session, user, trip_dto_with_events, idempotency_key=key)
        # Same idempotency key → must return the existing trip without re-inserting events.
        second = await trips_service.save(db_session, user, trip_dto_with_events, idempotency_key=key)
        assert first.id == second.id

        count = await db_session.scalar(select(func.count()).select_from(Event).where(Event.trip_id == first.id))
        assert count == 4, "idempotent re-save must not duplicate the event timeline"
    finally:
        await _cleanup(db_session, user)
