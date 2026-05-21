from __future__ import annotations

import hashlib
import hmac as _hmac
import json
from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.core.audit import audit
from app.models import Trip, TripStatus, User
from app.schemas.trip import SaveTripIn, TripOut
from app.services.scoring import calculate_score

_MAX_DISTANCE_KM = 2_000
_MAX_AVG_SPEED_KMH = 250
_MAX_HARD_BRAKES = 500
_RISK_MULTIPLIER_RANGE = (0.5, 3.0)
_DRIFT_WINDOW_MS = 300_000  # ±5 minutes


def _validate_plausibility(dto: SaveTripIn) -> None:
    if dto.distance_km is not None and dto.distance_km > _MAX_DISTANCE_KM:
        raise HTTPException(422, f"distance_km={dto.distance_km} — implausible")
    if dto.hard_brakes is not None and dto.hard_brakes > _MAX_HARD_BRAKES:
        raise HTTPException(422, f"hard_brakes={dto.hard_brakes} — implausible")
    if dto.risk_multiplier is not None:
        lo, hi = _RISK_MULTIPLIER_RANGE
        if not (lo <= dto.risk_multiplier <= hi):
            raise HTTPException(422, f"risk_multiplier={dto.risk_multiplier} — out of [{lo}, {hi}]")
    if dto.distance_km and dto.duration_seconds:
        avg_speed = dto.distance_km / max(dto.duration_seconds / 3600, 0.001)
        if avg_speed > _MAX_AVG_SPEED_KMH:
            raise HTTPException(422, f"avg_speed={avg_speed:.1f} km/h — implausible")


def _check_timestamp_drift(digest: dict | None) -> None:
    if not digest:
        return
    ts = digest.get("timestamp")
    if ts is None:
        return
    try:
        client_ms = int(ts)
    except (TypeError, ValueError):
        raise HTTPException(401, "Invalid timestamp in telemetryDigest")
    server_ms = int(datetime.now(UTC).timestamp() * 1000)
    if abs(server_ms - client_ms) > _DRIFT_WINDOW_MS:
        audit("trips.timestamp.stale", drift_ms=server_ms - client_ms)
        raise HTTPException(401, "Stale timestamp — possible replay attack")


def _verify_signature(digest: dict | None, signature: str | None, secret: str) -> None:
    if not signature:
        return
    if signature.startswith("ph:"):
        audit("trips.signature.bypass", reason="ph-placeholder-sprint1")
        return
    if not secret:
        return
    if digest is None:
        raise HTTPException(403, "payloadSignature sent but telemetryDigest is missing")
    canonical = json.dumps(digest, sort_keys=True, separators=(",", ":"))
    expected = _hmac.new(
        secret.encode(), canonical.encode(), hashlib.sha256
    ).hexdigest()
    if not _hmac.compare_digest(expected, signature):
        audit("trips.signature.rejected", reason="digest-mismatch")
        raise HTTPException(403, "Invalid payload signature")


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

    # Gate ordering: plausibility (422) → drift (401) → HMAC (403) → score → persist
    _validate_plausibility(dto)
    _check_timestamp_drift(dto.telemetry_digest)
    _verify_signature(dto.telemetry_digest, dto.payload_signature, settings.trip_signing_secret)

    start = dto.start_time or datetime.now(UTC)
    end = dto.end_time
    duration = dto.duration_seconds
    if duration is None and end is not None:
        duration = max(0, int((end - start).total_seconds()))
    distance = dto.distance_km or 0.0

    # Server is sole scoring oracle — client-sent avg_score and points are ignored
    avg_score, points_raw, risk_multiplier = calculate_score(
        hard_brakes=dto.hard_brakes or 0,
        aggressive_accels=dto.aggressive_accels or 0,
        sharp_turns=dto.sharp_turns or 0,
        phone_seconds=dto.phone_seconds or 0,
        duration_seconds=duration or 0,
        distance_km=distance,
        start_time=start,
    )

    trip = Trip(
        user_id=user.id,
        idempotency_key=idempotency_key,
        start_time=start,
        end_time=end,
        duration_seconds=duration or 0,
        distance_km=distance,
        avg_score=avg_score,
        points=round(points_raw),
        risk_multiplier=risk_multiplier,
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
        await db.execute(
            update(User)
            .where(User.id == user.id)
            .values(
                points=User.points + trip.points,
                total_points=User.total_points + trip.points,
                total_distance=User.total_distance + trip.distance_km,
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
