from __future__ import annotations

import hashlib
import hmac as _hmac
import json
import math
from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy import case, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.core.audit import audit
from app.models import Trip, TripStatus, User
from app.schemas.trip import SaveTripIn, TripOut

_MAX_POINTS_PER_TRIP = 10_000
_MAX_DISTANCE_KM = 2_000
_MAX_AVG_SPEED_KMH = 250
_MAX_HARD_BRAKES = 500
_RISK_MULTIPLIER_RANGE = (0.5, 3.0)
_STALE_THRESHOLD_S = 300  # 5 minutes

# Level thresholds — must stay in sync with the `levels` table (seed.py / migrations).
# Listed highest-first so the CASE expression short-circuits correctly.
_LEVEL_THRESHOLDS: list[tuple[int, int]] = [
    (75000, 10),
    (50000,  9),
    (32000,  8),
    (20000,  7),
    (12000,  6),
    ( 7000,  5),
    ( 3500,  4),
    ( 1500,  3),
    (  500,  2),
]


def _validate_plausibility(dto: SaveTripIn) -> None:
    if dto.avg_score is not None and not (0.0 <= dto.avg_score <= 100.0):
        raise HTTPException(422, f"avg_score={dto.avg_score} — must be in [0, 100]")
    # Skip client points check when digest is present — oracle overrides the value anyway.
    if dto.points is not None and dto.telemetry_digest is None and dto.points > _MAX_POINTS_PER_TRIP:
        raise HTTPException(422, f"points={dto.points} — implausible (max {_MAX_POINTS_PER_TRIP})")
    if dto.distance_km is not None and dto.distance_km < 0:
        raise HTTPException(422, "distance_km must be >= 0")
    if dto.distance_km is not None and dto.distance_km > _MAX_DISTANCE_KM:
        raise HTTPException(422, f"distance_km={dto.distance_km} — implausible")
    if dto.hard_brakes is not None and dto.hard_brakes < 0:
        raise HTTPException(422, "hard_brakes must be >= 0")
    if dto.hard_brakes is not None and dto.hard_brakes > _MAX_HARD_BRAKES:
        raise HTTPException(422, f"hard_brakes={dto.hard_brakes} — implausible")
    if dto.aggressive_accels is not None and dto.aggressive_accels < 0:
        raise HTTPException(422, "aggressive_accels must be >= 0")
    if dto.sharp_turns is not None and dto.sharp_turns < 0:
        raise HTTPException(422, "sharp_turns must be >= 0")
    if dto.phone_seconds is not None and dto.phone_seconds < 0:
        raise HTTPException(422, "phone_seconds must be >= 0")
    if dto.risk_multiplier is not None:
        lo, hi = _RISK_MULTIPLIER_RANGE
        if not (lo <= dto.risk_multiplier <= hi):
            raise HTTPException(422, f"risk_multiplier={dto.risk_multiplier} — out of [{lo}, {hi}]")
    if dto.distance_km and dto.duration_seconds:
        avg_speed = dto.distance_km / max(dto.duration_seconds / 3600, 0.001)
        if avg_speed > _MAX_AVG_SPEED_KMH:
            raise HTTPException(422, f"avg_speed={avg_speed:.1f} km/h — implausible")


def _verify_signature(digest: dict | None, signature: str | None, secret: str) -> None:
    if not signature:
        return

    # Replay protection — checked before ph: bypass so it applies to all signatures.
    if digest is not None:
        ts_ms = digest.get("timestamp")
        if ts_ms is not None:
            age_s = (datetime.now(UTC).timestamp() * 1000 - float(ts_ms)) / 1000
            if age_s > _STALE_THRESHOLD_S:
                audit("trips.signature.stale", age_s=round(age_s))
                raise HTTPException(401, f"Telemetry digest is stale ({int(age_s)}s old — max {_STALE_THRESHOLD_S}s)")

    if signature.startswith("ph:"):
        audit("trips.signature.bypass", reason="ph-placeholder-sprint1")
        return
    if not secret:
        return
    if digest is None:
        raise HTTPException(403, "payloadSignature sent but telemetryDigest is missing")
    canonical = json.dumps(digest, sort_keys=True, separators=(",", ":"))
    expected = _hmac.new(
        secret.encode(), f"{secret}:{canonical}".encode(), hashlib.sha256
    ).hexdigest()
    if not _hmac.compare_digest(expected, signature):
        audit("trips.signature.rejected", reason="digest-mismatch")
        raise HTTPException(403, "Invalid payload signature")


def _server_score(digest: dict, start: datetime) -> tuple[float, int, float]:
    """
    Server-side scoring oracle — mirrors mobile scoring.ts exactly.
    Returns (avg_score, points, risk_multiplier).
    Uses phone_seconds as a conservative proxy for phoneWeightedSeconds
    (server lacks per-frame velocity data for the kinetic-weighted version).
    """
    hard_brakes       = max(0, int(digest.get("hardBrakes", 0) or 0))
    aggressive_accels = max(0, int(digest.get("aggressiveAccels", 0) or 0))
    sharp_turns       = max(0, int(digest.get("sharpTurns", 0) or 0))
    phone_seconds     = max(0.0, float(digest.get("phoneSeconds", 0) or 0))
    duration_seconds  = max(float(digest.get("durationSeconds", 1) or 1), 1.0)
    distance_km       = max(0.0, float(digest.get("distanceKm", 0.0) or 0.0))

    # Risk multiplier computed from actual start time — not trusted from client.
    # Python weekday: Mon=0 … Sun=6; Israeli weekend nights: Thu(3), Fri(4), Sat(5).
    hour = start.hour
    day  = start.weekday()
    is_night = hour >= 23 or hour < 4
    if is_night and day in (3, 4, 5):
        risk_multiplier = 2.0
    elif is_night:
        risk_multiplier = 1.5
    else:
        risk_multiplier = 1.0

    penalties = (
        hard_brakes * 5.0
        + aggressive_accels * 3.0
        + sharp_turns * 2.0
        + (phone_seconds / duration_seconds) * 40.0
    )
    score = round(max(0.0, min(100.0, 100.0 - penalties)) * 10) / 10

    distance_factor = math.log(distance_km + 1) / math.log(11) if distance_km > 0 else 0.0
    points = max(0, round(score * distance_factor * risk_multiplier))

    return score, points, risk_multiplier


async def list_for_user(db: AsyncSession, user_id: str) -> list[TripOut]:
    rows = await db.scalars(select(Trip).where(Trip.user_id == user_id).order_by(Trip.start_time.desc()).limit(100))
    return [TripOut.from_orm_trip(t) for t in rows.all()]


async def get_by_id(db: AsyncSession, user_id: str, trip_id: str) -> Trip:
    trip = await db.scalar(
        select(Trip).where(Trip.id == trip_id, Trip.user_id == user_id).options(selectinload(Trip.events))
    )
    if trip is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Trip not found")
    return trip


async def save(
    db: AsyncSession,
    user: User,
    dto: SaveTripIn,
    idempotency_key: str | None = None,
) -> TripOut:
    # Fast-path deduplication: return the already-committed trip if key is known.
    if idempotency_key:
        existing = await db.scalar(select(Trip).where(Trip.idempotency_key == idempotency_key))
        if existing:
            return TripOut.from_orm_trip(existing)

    _validate_plausibility(dto)
    _verify_signature(dto.telemetry_digest, dto.payload_signature, settings.trip_signing_secret)

    start = dto.start_time or datetime.now(UTC)
    end = dto.end_time
    duration = dto.duration_seconds
    if duration is None and end is not None:
        duration = max(0, int((end - start).total_seconds()))
    distance = dto.distance_km or 0.0

    # Oracle: when a telemetry digest is present, compute score/points/rm server-side
    # and discard the client-provided values entirely (anti-fraud).
    if dto.telemetry_digest:
        avg_score, computed_points, risk_mult = _server_score(dto.telemetry_digest, start)
    else:
        avg_score      = dto.avg_score or 0.0
        computed_points = dto.points or 0
        risk_mult      = dto.risk_multiplier if dto.risk_multiplier is not None else 1.0

    trip = Trip(
        user_id=user.id,
        idempotency_key=idempotency_key,
        start_time=start,
        end_time=end,
        duration_seconds=duration or 0,
        distance_km=distance,
        avg_score=avg_score,
        points=computed_points,
        risk_multiplier=risk_mult,
        hard_brakes=dto.hard_brakes or 0,
        aggressive_accels=dto.aggressive_accels or 0,
        sharp_turns=dto.sharp_turns or 0,
        phone_seconds=dto.phone_seconds or 0,
        start_location=dto.start_location,
        end_location=dto.end_location,
        ai_insight=dto.ai_insight,
        telemetry_digest=dto.telemetry_digest,
        payload_signature=dto.payload_signature,
        status=TripStatus.COMPLETED if end else TripStatus.ACTIVE,
        synced_at=datetime.now(UTC),
    )
    db.add(trip)

    if trip.points > 0 or trip.distance_km > 0:
        new_total = User.total_points + trip.points
        level_expr = case(
            *((new_total >= pts, lvl) for pts, lvl in _LEVEL_THRESHOLDS),
            else_=1,
        )
        await db.execute(
            update(User)
            .where(User.id == user.id)
            .values(
                points=User.points + trip.points,
                total_points=new_total,
                total_distance=User.total_distance + trip.distance_km,
                level=level_expr,
            )
        )

    try:
        await db.commit()
        await db.refresh(trip)
    except IntegrityError as exc:
        # Race condition: a concurrent request with the same key already committed.
        await db.rollback()
        if idempotency_key:
            existing = await db.scalar(select(Trip).where(Trip.idempotency_key == idempotency_key))
            if existing:
                return TripOut.from_orm_trip(existing)
        raise HTTPException(status.HTTP_409_CONFLICT, "Duplicate trip") from exc

    audit(
        "trips.saved",
        user_id=user.id,
        trip_id=trip.id,
        distance_km=trip.distance_km,
        points=trip.points,
        avg_score=trip.avg_score,
    )
    return TripOut.from_orm_trip(trip)
