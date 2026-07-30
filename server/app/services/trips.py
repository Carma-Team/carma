from __future__ import annotations

import hashlib
import hmac as _hmac
import json
import math
from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from sqlalchemy import case, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.core.audit import audit
from app.models import NOTIFICATION_LEVEL_UP, Event, EventType, Trip, TripStatus, User
from app.schemas.trip import SaveTripIn, TripOut
from app.services import levels, notifications, scoring, telemetry
from app.services.risk import get_risk_multiplier

_TZ_IL = ZoneInfo("Asia/Jerusalem")

# Driver-score aggregation window (scoring.md "The driver's own score") —
# ~28-day effective window from a 14-day half-life, matching CMT's rolling
# window; query a 30-day slice to cover the long tail.
_DRIVER_SCORE_WINDOW_DAYS = 30

_MAX_POINTS_PER_TRIP = 10_000
_MAX_DISTANCE_KM = 2_000
_MAX_AVG_SPEED_KMH = 250
_MAX_HARD_BRAKES = 500
_RISK_MULTIPLIER_RANGE = (0.5, 3.0)
_DRIFT_WINDOW_MS = 300_000  # ±5 minutes

# Slack allowed between the claimed distance and what the GPS trace witnesses
# (issue #56). Generous on purpose: a sampled trace cuts corners and misses
# segments, so it structurally under-reports. Tightening these without first
# reading the trips.distance.capped audit rate would reject honest trips.
_DISTANCE_TOLERANCE = 0.35  # +35% over the witnessed distance
_DISTANCE_GRACE_KM = 1.0  # absolute floor, for short trips and coarse sampling

# Level demotion (#37). `total_points` is cumulative and never falls, so the
# ladder above can only climb: a driver who earned level 8 and then started
# driving badly would display 8 forever. The ladder still records what was
# earned; this table caps what is *shown* by how the driver is behaving now.
#
# A cap rather than a separate ladder, so nothing is destroyed — the moment
# `driver_score` recovers, the earned level comes straight back with no points
# to re-accumulate.
#
# First calibration, not fitted to the fleet. `driver_score` starts at the
# prior (75, "good but unproven") and is credibility-weighted toward it until a
# driver has real distance, so a newcomer cannot be capped on thin evidence.
# Re-fit against the live distribution before treating these as settled —
# same caveat as the scoring constants (CAR-102).
# Listed highest-first, like the ladder above.
_LEVEL_CAP_BY_DRIVER_SCORE: list[tuple[float, int]] = [
    (80.0, 10),  # no effective cap — 10 is the top level
    (70.0, 8),
    (60.0, 6),
    (50.0, 4),
]
_LEVEL_CAP_FLOOR = 2  # worst case; demotion never takes a driver back to 1

# Per-trip cap on persisted event rows — bounds the INSERT a malformed or hostile
# client can trigger. A genuine 30-min trip yields tens of events, not thousands.
_MAX_EVENTS_PER_TRIP = 1000

# Client (SDK `DrivingEventType`) → server `EventType`. The SDK emits PHONE_USAGE
# while the column stores PHONE_USE, so the names must be bridged explicitly;
# unmapped/unknown strings are dropped, never coerced.
_EVENT_TYPE_ALIASES: dict[str, EventType] = {
    "HARD_BRAKE": EventType.HARD_BRAKE,
    "AGGRESSIVE_ACCEL": EventType.AGGRESSIVE_ACCEL,
    "SHARP_TURN": EventType.SHARP_TURN,
    "SWERVE": EventType.SWERVE,
    "PHONE_USAGE": EventType.PHONE_USE,  # SDK name → column name
    "PHONE_USE": EventType.PHONE_USE,
    "SPEEDING": EventType.SPEEDING,
}


def _coerce_event_timestamp(value: Any, fallback: datetime) -> datetime:
    """Parse a client event timestamp into a tz-aware UTC datetime.

    Accepts an ISO-8601 string, epoch milliseconds/seconds, or a datetime. Any
    unparseable value falls back to the trip start so an event is never dropped
    purely for a malformed timestamp.
    """
    if isinstance(value, bool):  # bool is an int subclass — reject before the numeric branch
        return fallback
    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, int | float):
        seconds = float(value)
        if math.isnan(seconds) or math.isinf(seconds):
            return fallback
        if seconds > 1e11:  # heuristic: that large can only be epoch-milliseconds
            seconds /= 1000.0
        try:
            dt = datetime.fromtimestamp(seconds, tz=UTC)
        except (OverflowError, OSError, ValueError):
            return fallback
    else:
        try:
            dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return fallback
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def _coerce_coord(value: Any, limit: float) -> float | None:
    """Coerce a coordinate to a float inside [-limit, limit]; junk/out-of-range → None."""
    try:
        coord = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(coord) or math.isinf(coord) or abs(coord) > limit:
        return None
    return coord


def _parse_event(raw: Any, trip_start: datetime) -> Event | None:
    """Validate one untrusted client event into an `Event` row, or `None` to drop it.

    The events array is unsigned, forensic display data — map markers plus the
    severity inputs the v2 engine will read once the SDK emits `peak_g`. It never
    feeds the score, which stays sourced from the signed digest. So parsing is
    strictly defensive: unknown types and junk coordinates are dropped rather than
    guessed, and the full raw payload is retained in `sensor_data` for forensics.
    """
    if not isinstance(raw, dict):
        return None
    event_type = _EVENT_TYPE_ALIASES.get(str(raw.get("type", "")).strip().upper())
    if event_type is None:
        return None

    try:
        severity = min(max(float(raw.get("severity", 1.0)), 0.0), 100.0)
    except (TypeError, ValueError):
        severity = 1.0

    loc = raw.get("location")
    location = loc if isinstance(loc, dict) else {}
    lat = _coerce_coord(raw.get("lat", location.get("latitude")), 90.0)
    lng = _coerce_coord(raw.get("lng", location.get("longitude")), 180.0)

    return Event(
        type=event_type,
        severity=severity,
        timestamp=_coerce_event_timestamp(raw.get("timestamp"), trip_start),
        lat=lat,
        lng=lng,
        sensor_data=raw,
    )


def _build_trip_events(raw_events: list[dict[str, Any]] | None, trip_start: datetime) -> list[Event]:
    """Parse the client events array into persistable `Event` rows.

    Capped at `_MAX_EVENTS_PER_TRIP`; individually invalid entries are skipped so
    one bad event never costs the whole timeline. `trip_id` is left unset — the
    Trip→Event relationship cascade stamps it on flush.
    """
    if not raw_events:
        return []
    parsed = (_parse_event(raw, trip_start) for raw in raw_events[:_MAX_EVENTS_PER_TRIP])
    return [event for event in parsed if event is not None]


def _server_events(gps: telemetry.TelemetryAnalysis, client_events: list[Event]) -> list[Event]:
    """Materialize server-GPS-detected events as `Event` rows (v2.1).

    Tagged `{"source": "server-gps"}` in sensor_data so forensics can tell them
    apart from client-reported events. A detection matching a client event of
    the same type within ±10 s is redundant and skipped, so one maneuver never
    gets two markers (matters once issue #12 lands and clients send events).
    """
    rows: list[Event] = []
    for ge in gps.events:
        ts = datetime.fromtimestamp(ge.ts_ms / 1000.0, tz=UTC)
        event_type = EventType[ge.type]
        if any(ce.type == event_type and abs((ce.timestamp - ts).total_seconds()) <= 10.0 for ce in client_events):
            continue
        rows.append(
            Event(
                type=event_type,
                severity=ge.severity,
                timestamp=ts,
                lat=ge.lat,
                lng=ge.lng,
                sensor_data={"source": "server-gps", **ge.detail},
            )
        )
    return rows


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
    if dto.touch_epochs is not None and dto.touch_epochs < 0:
        raise HTTPException(422, "touch_epochs must be >= 0")
    if dto.screen_interaction_seconds is not None and dto.screen_interaction_seconds < 0:
        raise HTTPException(422, "screen_interaction_seconds must be >= 0")
    if dto.risk_multiplier is not None:
        lo, hi = _RISK_MULTIPLIER_RANGE
        if not (lo <= dto.risk_multiplier <= hi):
            raise HTTPException(422, f"risk_multiplier={dto.risk_multiplier} — out of [{lo}, {hi}]")
    if dto.distance_km and dto.duration_seconds:
        avg_speed = dto.distance_km / max(dto.duration_seconds / 3600, 0.001)
        if avg_speed > _MAX_AVG_SPEED_KMH:
            raise HTTPException(422, f"avg_speed={avg_speed:.1f} km/h — implausible")
    # Physics-check the digest too: oracle uses digest values, not dto values.
    if dto.telemetry_digest is not None:
        d_km = max(0.0, float(dto.telemetry_digest.get("distanceKm", 0) or 0))
        d_s = max(float(dto.telemetry_digest.get("durationSeconds", 1) or 1), 1.0)
        if d_km > 0:
            digest_speed = d_km / max(d_s / 3600, 0.001)
            if digest_speed > _MAX_AVG_SPEED_KMH:
                raise HTTPException(422, f"digest avg_speed={digest_speed:.1f} km/h — implausible")


def _check_timestamp_drift(digest: dict[str, Any] | None) -> None:
    if not digest:
        return
    ts = digest.get("timestamp")
    if ts is None:
        return
    try:
        client_ms = int(ts)
    except (TypeError, ValueError):
        raise HTTPException(401, "Invalid timestamp in telemetryDigest") from None
    server_ms = int(datetime.now(UTC).timestamp() * 1000)
    if abs(server_ms - client_ms) > _DRIFT_WINDOW_MS:
        audit("trips.timestamp.stale", drift_ms=server_ms - client_ms)
        raise HTTPException(401, "Stale timestamp — possible replay attack")


def _verify_signature(digest: dict[str, Any] | None, signature: str | None, secret: str) -> None:
    """Verify the telemetry digest's HMAC.

    Three paths still accept an unverified payload (issue #24). Each is audited so
    the rate of unsigned traffic can be measured before enforcement is switched on
    — flipping any of these to a hard reject without that data would 403 every
    client already in the field.

    Note the ceiling on what enforcement buys: the mobile signing key is currently
    hardcoded in the app bundle, so a verified signature proves the payload came
    from *a* copy of the client, not from a trusted device. Per-device keys via
    app attestation are what make this a real control.
    """
    if not signature:
        audit("trips.signature.absent", reason="no-signature-sent")
        return
    if signature.startswith("ph:"):
        audit("trips.signature.bypass", reason="ph-placeholder-sprint1")
        return
    if not secret:
        audit("trips.signature.unenforced", reason="trip-signing-secret-unset")
        return
    if digest is None:
        raise HTTPException(403, "payloadSignature sent but telemetryDigest is missing")
    canonical = json.dumps(digest, sort_keys=True, separators=(",", ":"))
    expected = _hmac.new(secret.encode(), canonical.encode(), hashlib.sha256).hexdigest()
    if not _hmac.compare_digest(expected, signature):
        audit("trips.signature.rejected", reason="digest-mismatch")
        raise HTTPException(403, "Invalid payload signature")


def _level_cap(driver_score: float) -> int:
    """Highest level a driver may display at their current driver score (#37).

    Separate from what they earned: the cap is applied with LEAST() over the
    points ladder, so a demotion is a lock rather than a loss.
    """
    for threshold, cap in _LEVEL_CAP_BY_DRIVER_SCORE:
        if driver_score >= threshold:
            return cap
    return _LEVEL_CAP_FLOOR


def _witness_distance(claimed_km: float, gps_km: float) -> float:
    """Cap a claimed distance at what the GPS trace can witness (issue #56).

    Distance was the one scoring input with no independent check, and it multiplies
    points directly — event counts are already cross-checked upward against the
    trace, but a payload could inflate `distanceKm` freely.

    The bound is deliberately loose. A sampled trace cuts corners and drops
    segments, so it structurally under-reports true odometer distance; a tight cap
    would punish the sparse-sampling devices of issue #17 rather than fraud. Only
    claims the trace cannot come close to supporting are trimmed.

    A trip with no usable trace is not capped — that would break clients that send
    no waypoints at all — but it is audited, so the rate is measurable before
    anyone decides to tighten it.
    """
    if gps_km <= 0:
        if claimed_km > _DISTANCE_GRACE_KM:
            audit("trips.distance.unwitnessed", claimed_km=round(claimed_km, 2))
        return claimed_km

    cap = gps_km * (1.0 + _DISTANCE_TOLERANCE) + _DISTANCE_GRACE_KM
    if claimed_km <= cap:
        return claimed_km

    audit(
        "trips.distance.capped",
        claimed_km=round(claimed_km, 2),
        witnessed_km=round(gps_km, 2),
        capped_to_km=round(cap, 2),
    )
    return cap


async def _compute_score(
    db: AsyncSession,
    user: User,
    *,
    hard_brakes: int,
    aggressive_accels: int,
    sharp_turns: int,
    touch_epochs: int,
    screen_interaction_seconds: int,
    distance_km: float,
    duration_seconds: int,
    risk_multiplier: float,
    level_multiplier: float,
    now: datetime,
    gps: telemetry.TelemetryAnalysis,
) -> tuple[float, float, float, bool]:
    """Compute the v2 trip score, updated driver score, and points.

    v2 is the sole scoring engine (scoring.md). Pure-formula work
    lives in scoring; this only sources the inputs. Severity is unavailable
    (no SDK peak_g yet) so weighted counts equal raw counts. Speeding and the
    telemetry confidence come from the server-side GPS analysis (`gps`): the
    speeding weight is time-over-threshold against a conservative absolute
    limit, and the confidence caps how far above the rolling score a trip can
    land when the trace is too sparse to prove clean driving (v2.1).
    Returns (trip_score, driver_score, points, points_capped).
    """
    # Proxy for the distraction weight until the SDK emits per-epoch speed:
    # each touch epoch is weight 1, plus screen-on minutes (scoring.md "Phone distraction").
    w_distraction = touch_epochs + screen_interaction_seconds / 60.0
    rolling = user.driver_score if user.driver_score is not None else scoring.CONFIG.prior_score

    trip_v2 = scoring.compute_trip_score(
        w_brake=hard_brakes,
        w_accel=aggressive_accels,
        w_corner=sharp_turns,
        w_distraction=w_distraction,
        w_speed=gps.speeding_weight,
        distance_km=distance_km,
        duration_min=duration_seconds / 60.0,
        has_speed_data=gps.has_speed_data,
        rolling_score=rolling,
    )
    trip_score = scoring.apply_confidence(trip_v2.score, rolling, gps.confidence)

    # Serialise per driver before reading the day's history: the anti-grind caps
    # below are measured against committed trips, so concurrent saves would each
    # spend the same headroom (CAR-98).
    #
    # Not a new lock — the `UPDATE User` at the end of `save` takes this same row
    # lock anyway, only after each save has already scored off a stale read. So
    # it costs nothing, and it is per-driver: two drivers never block each other.
    await db.execute(select(User.id).where(User.id == user.id).with_for_update())

    cutoff = now - timedelta(days=_DRIVER_SCORE_WINDOW_DAYS)
    rows = (
        await db.execute(
            select(Trip.score_v2, Trip.distance_km, Trip.start_time, Trip.points).where(
                Trip.user_id == user.id,
                Trip.start_time >= cutoff,
            )
        )
    ).all()

    # Driver score: recency- and exposure-weighted history (only scored trips).
    history = [
        scoring.TripHistoryPoint(
            trip_score=score,
            distance_km=km,
            age_days=max(0.0, (now - start).total_seconds() / 86400.0),
        )
        for score, km, start, _pts in rows
        if score is not None
    ]
    # Include the trip being saved (age 0) so a first trip yields a real number.
    history.append(scoring.TripHistoryPoint(trip_score=trip_score, distance_km=distance_km, age_days=0.0))
    driver_score = scoring.compute_driver_score(history)

    # Same-day aggregates (Asia/Jerusalem) for the points anti-grind caps.
    today = now.astimezone(_TZ_IL).date()
    points_today = sum((pts or 0.0) for _s, _km, start, pts in rows if start.astimezone(_TZ_IL).date() == today)
    distance_today_km = sum((km or 0.0) for _s, km, start, _p in rows if start.astimezone(_TZ_IL).date() == today)
    # Rolling-month total for the economic ceiling. `rows` already spans exactly
    # the window, so this is free — but it does mean the ceiling's window is
    # `_DRIVER_SCORE_WINDOW_DAYS`; move that and you move this.
    points_month = sum((pts or 0.0) for _s, _km, _start, pts in rows)

    # Streak: consecutive days (including today, counting the trip being saved)
    # with at least one trip (scoring.md "Points").
    trip_days = {start.astimezone(_TZ_IL).date() for _s, _km, start, _p in rows}
    trip_days.add(today)
    streak_days = 0
    cursor = today
    while cursor in trip_days:
        streak_days += 1
        cursor -= timedelta(days=1)

    points = scoring.compute_points(
        trip_score=trip_score,
        distance_km=distance_km,
        risk_multiplier=risk_multiplier,
        streak_days=streak_days,
        level_multiplier=level_multiplier,
        points_today=points_today,
        points_month=points_month,
        distance_today_km=distance_today_km,
        fraud_flagged=False,
    )
    # Same formula minus the daily anti-grind caps — if the caps reduced the
    # award, the save response says so instead of showing a silent 0.
    points_uncapped = scoring.compute_points(
        trip_score=trip_score,
        distance_km=distance_km,
        risk_multiplier=risk_multiplier,
        streak_days=streak_days,
        level_multiplier=level_multiplier,
    )
    return trip_score, driver_score, points, round(points) < round(points_uncapped)


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
    if start.tzinfo is None:
        start = start.replace(tzinfo=UTC)
    end = dto.end_time
    duration = dto.duration_seconds
    if duration is None and end is not None:
        duration = max(0, int((end - start).total_seconds()))

    # Oracle: when a telemetry digest is present, source event counts and distance
    # from the signed digest — not the client DTO — so stored data is consistent
    # with the score that was computed (anti-fraud).
    if dto.telemetry_digest:
        d = dto.telemetry_digest
        scored_hard_brakes = max(0, int(d.get("hardBrakes", 0) or 0))
        scored_aggressive_accels = max(0, int(d.get("aggressiveAccels", 0) or 0))
        scored_sharp_turns = max(0, int(d.get("sharpTurns", 0) or 0))
        scored_touch_epochs = max(0, int(d.get("touchEpochs", 0) or 0))
        scored_screen_secs = max(0, int(float(d.get("screenInteractionSeconds", 0) or 0)))
        distance = max(0.0, float(d.get("distanceKm", 0.0) or 0.0))
        digest_duration = max(int(float(d.get("durationSeconds", 0) or 0)), duration or 0)
    else:
        scored_hard_brakes = dto.hard_brakes or 0
        scored_aggressive_accels = dto.aggressive_accels or 0
        scored_sharp_turns = dto.sharp_turns or 0
        scored_touch_epochs = dto.touch_epochs or 0
        scored_screen_secs = dto.screen_interaction_seconds or 0
        distance = dto.distance_km or 0.0
        digest_duration = duration or 0

    # Server-side GPS cross-check (v2.1): the waypoint trace is an independent
    # witness against client under-detection. Merged counts only ever go UP —
    # the server adds missed events, never erases reported ones — so a client
    # cannot lower its penalty by suppressing detection.
    gps = telemetry.analyze(dto.route_waypoints, digest_duration)
    scored_hard_brakes = max(scored_hard_brakes, gps.hard_brakes)
    scored_aggressive_accels = max(scored_aggressive_accels, gps.aggressive_accels)
    scored_sharp_turns = max(scored_sharp_turns, gps.sharp_turns)

    distance = _witness_distance(distance, gps.distance_km)

    # v2 is the sole scoring engine (scoring.md). The risk multiplier
    # is a time-of-day factor reused from v1; the score, driver score, and points
    # are pure v2. There is no v1 fallback — a v2 failure fails the save.
    now = datetime.now(UTC)
    risk_multiplier = get_risk_multiplier(start)

    # Level bonus (#61). Measured at the level the driver *entered* the trip at,
    # not the one they leave with: the trip's points feed total_points, which
    # sets the level, which would then scale the same points — circular. Entering
    # level is also the honest reading of "you earned this at level 7".
    #
    # The *capped* level, so demotion (#37) has real consequence rather than
    # being a cosmetic badge change.
    entering_level = min(
        levels.level_for_points(user.total_points),
        _level_cap(user.driver_score) if user.driver_score is not None else levels.MAX_LEVEL,
    )

    score_v2, new_driver_score, points_v2, points_capped = await _compute_score(
        db,
        user,
        hard_brakes=scored_hard_brakes,
        aggressive_accels=scored_aggressive_accels,
        sharp_turns=scored_sharp_turns,
        touch_epochs=scored_touch_epochs,
        screen_interaction_seconds=scored_screen_secs,
        distance_km=distance,
        duration_seconds=digest_duration,
        risk_multiplier=risk_multiplier,
        level_multiplier=levels.by_number(entering_level).bonus_multiplier,
        now=now,
        gps=gps,
    )

    trip = Trip(
        user_id=user.id,
        idempotency_key=idempotency_key,
        start_time=start,
        end_time=end,
        duration_seconds=duration or 0,
        distance_km=distance,
        avg_score=score_v2,
        score_v2=score_v2,
        scoring_version=scoring.CONFIG.version,
        points=round(points_v2),
        risk_multiplier=risk_multiplier,
        hard_brakes=scored_hard_brakes,
        aggressive_accels=scored_aggressive_accels,
        sharp_turns=scored_sharp_turns,
        touch_epochs=scored_touch_epochs,
        screen_interaction_seconds=scored_screen_secs,
        start_location=dto.start_location,
        end_location=dto.end_location,
        ai_insight=dto.ai_insight,
        telemetry_digest=dto.telemetry_digest,
        payload_signature=dto.payload_signature,
        route_waypoints=dto.route_waypoints,
        status=TripStatus.COMPLETED if end else TripStatus.ACTIVE,
        synced_at=datetime.now(UTC),
    )

    # Persist the per-event timeline (map markers + future severity inputs). This is
    # forensic, unsigned data sourced from dto.events — independent of the digest
    # counts that drive the score, so the two may legitimately differ. The cascade
    # inserts these rows and stamps trip_id on flush. Server-GPS detections are
    # appended so the map shows what the trace proves even while the client
    # under-reports (issues #12/#13).
    client_events = _build_trip_events(dto.events, start)
    trip.events = client_events + _server_events(gps, client_events)
    # Capture now: expire_on_commit would expire the collection and accessing it
    # after refresh would trigger an illegal lazy-load in async context.
    event_count = len(trip.events)

    db.add(trip)

    if trip.points > 0 or trip.distance_km > 0:
        new_total = User.total_points + trip.points
        earned_level = case(
            *((new_total >= pts, lvl) for pts, lvl in levels.thresholds_desc()),
            else_=1,
        )
        # Demotion (#37): show the lower of what was earned and what current
        # driving supports. LEAST rather than a Python min() so the level is
        # still resolved by the database in the same statement — RETURNING then
        # reports the value that was actually written, with no read-modify-write
        # race against a concurrent save.
        level_expr = func.least(earned_level, _level_cap(new_driver_score))
        values: dict[str, Any] = {
            "points": User.points + trip.points,
            "total_points": new_total,
            "total_distance": User.total_distance + trip.distance_km,
            "level": level_expr,
        }
        # Driver score (scoring.md "The driver's own score") — the headline number.
        values["driver_score"] = new_driver_score
        # RETURNING so the response can carry the level the database actually
        # resolved, rather than the client re-deriving it from points and
        # missing the cap (#61). The level-up notification below reads the same
        # value — it needs the level the CASE and the demotion cap settled on,
        # not one re-derived in Python.
        result = await db.execute(update(User).where(User.id == user.id).values(**values).returning(User.level))
        level_after = result.scalar_one()
        # `entering_level` rather than `user.level`: this UPDATE writes the level
        # column, which expires it on the instance, and re-reading it here would
        # lazy-load inside async context. The two agree by construction — the
        # stored level was written by this same points-and-cap formula.
        #
        # Strictly greater, which now matters rather than being defensive: with
        # demotion live (#37) `level_expr` can resolve *below* the entering level,
        # and a `!=` would congratulate a driver on being demoted. Staged on this
        # transaction, so the IntegrityError rollback below discards it with the trip.
        if level_after > entering_level:
            notifications.create(
                db,
                user.id,
                NOTIFICATION_LEVEL_UP,
                {"level": level_after, "previousLevel": entering_level},
            )
    else:
        # No points and no distance — the user row is untouched.
        level_after = user.level

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
        events=event_count,
        gps_confidence=gps.confidence,
        points_capped=points_capped,
    )
    return TripOut.from_orm_trip(trip, points_capped=points_capped, user_level=level_after)
