"""Server-side GPS telemetry analysis — independent event detection (v2.1).

The client's telemetry digest is the primary scoring input, but live data showed
it under-reports: devices with mis-calibrated SDK detection send all-zero event
counts and score a flat 100 (see CAR-6). The route waypoints
(`{ts, lat, lng, speedKmh}`) the client already sends are an independent
witness the server can analyze itself.

This module is pure (no I/O, no DB) like scoring. It turns a raw waypoint
array into:

  * GPS-detected kinematic events (hard brakes, aggressive accels, sharp turns)
    — a *lower bound* on what happened: 3–6 s GPS sampling misses short events
    an IMU would catch, so counts here only ever raise the digest counts
    (`max(digest, gps)` in the trips service), never lower them.
  * A speeding weight per scoring.md "Speeding" (time-over-threshold),
    measured against a conservative absolute limit rather than map-matched
    posted limits: nothing in Israel allows more than 120 km/h, so only speed
    beyond 120 + the spec's 10 km/h GPS-noise buffer is counted. This catches
    egregious motorway speeding today and stays forward-compatible with
    map-matching.
  * A confidence measure in [0, 1] describing how much the trace can actually
    prove. Sparse sampling and long gaps mean "zero events" is weak evidence —
    the scoring layer uses this to cap how far a trip can score *above* the
    driver's rolling score (upside only; reported events are never diluted).

GPS traces in production contain near-duplicate timestamps (observed: 32 pairs
<0.5 s apart in one trip) which produce absurd accelerations if used naively —
everything here runs on a cleaned, deduplicated, time-sorted series.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

# ── Cleaning ────────────────────────────────────────────────────────────────────
_MIN_SAMPLE_GAP_S = 0.5  # closer pairs are GPS duplicates — keep the first
_MAX_KINEMATIC_GAP_S = 15.0  # no acceleration/bearing math across longer gaps
_MAX_PLAUSIBLE_SPEED_KMH = 250.0

# ── Kinematic detection (thresholds mirror the SDK's intent — scoring.md) ──────
_BRAKE_DECEL_MS2 = 3.0  # sustained GPS-visible decel; IMU threshold is lower
_ACCEL_MS2 = 2.5
_TURN_RATE_DEG_S = 18.0  # bearing change rate at speed
_TURN_MIN_SPEED_KMH = 25.0
_TURN_MAX_DT_S = 8.0
_KINEMATIC_MIN_SPEED_KMH = 15.0  # under-5 km/h filter, with margin for GPS noise
_EVENT_MERGE_WINDOW_S = 5.0  # one physical maneuver, not N samples of it

# ── Speeding (scoring.md "Speeding") — conservative absolute limit, no maps ─────
_ASSUMED_LIMIT_KMH = 120.0  # national maximum — conservative on every road
_SPEED_BUFFER_KMH = 10.0  # spec's GPS-noise / flow-of-traffic buffer
_SPEED_BANDS = (  # (km/h over limit+buffer, band weight) — highest first
    (20.0, 8.0),  # extreme: ≥150 measured (≥30 over the 120 limit)
    (10.0, 3.0),  # major:   140–150
    (0.0, 1.0),  # minor:   130–140
)

# ── Confidence & speed-data coverage ────────────────────────────────────────────
_FULL_CONFIDENCE_DT_S = 4.0  # median sampling this fast proves the trace
_MIN_SPEED_SAMPLES = 20
_SPEED_COVERAGE_MIN = 0.5
_SPEED_MEDIAN_DT_MAX_S = 10.0


@dataclass(frozen=True)
class GpsEvent:
    """One server-detected event, ready to become an `Event` row."""

    type: str  # server EventType name: HARD_BRAKE / AGGRESSIVE_ACCEL / SHARP_TURN / SPEEDING
    ts_ms: int
    lat: float | None
    lng: float | None
    severity: float  # 1.0 (threshold) … 3.0 (extreme) — display scale
    detail: dict[str, Any]  # magnitude readouts for sensor_data forensics


@dataclass(frozen=True)
class TelemetryAnalysis:
    hard_brakes: int
    aggressive_accels: int
    sharp_turns: int
    speeding_weight: float  # severity-weighted minutes over the threshold
    has_speed_data: bool
    confidence: float  # [0, 1] — how much the trace can prove
    distance_km: float  # trace-derived distance — an independent witness (issue #56)
    events: list[GpsEvent]


EMPTY_ANALYSIS = TelemetryAnalysis(
    hard_brakes=0,
    aggressive_accels=0,
    sharp_turns=0,
    speeding_weight=0.0,
    has_speed_data=False,
    confidence=0.0,
    distance_km=0.0,
    events=[],
)


@dataclass(frozen=True)
class _Point:
    ts: float  # epoch seconds
    lat: float | None
    lng: float | None
    speed_kmh: float


def _parse_waypoints(raw: list[dict[str, Any]] | None) -> list[_Point]:
    """Untrusted JSON → clean, time-sorted, deduplicated points."""
    if not raw:
        return []
    points: list[_Point] = []
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        try:
            ts = float(entry["ts"]) / 1000.0  # epoch ms on the wire
            speed = float(entry["speedKmh"])
        except (KeyError, TypeError, ValueError):
            continue
        if not (math.isfinite(ts) and math.isfinite(speed)):
            continue
        if not (0.0 <= speed <= _MAX_PLAUSIBLE_SPEED_KMH):
            continue
        lat = entry.get("lat")
        lng = entry.get("lng")
        try:
            lat = float(lat) if lat is not None and math.isfinite(float(lat)) and abs(float(lat)) <= 90 else None
            lng = float(lng) if lng is not None and math.isfinite(float(lng)) and abs(float(lng)) <= 180 else None
        except (TypeError, ValueError):
            lat = lng = None
        points.append(_Point(ts=ts, lat=lat, lng=lng, speed_kmh=speed))

    points.sort(key=lambda p: p.ts)
    deduped: list[_Point] = []
    for p in points:
        if deduped and p.ts - deduped[-1].ts < _MIN_SAMPLE_GAP_S:
            continue
        deduped.append(p)
    return deduped


def _bearing_deg(a: _Point, b: _Point) -> float | None:
    if a.lat is None or a.lng is None or b.lat is None or b.lng is None:
        return None
    la1, lo1, la2, lo2 = map(math.radians, (a.lat, a.lng, b.lat, b.lng))
    y = math.sin(lo2 - lo1) * math.cos(la2)
    x = math.cos(la1) * math.sin(la2) - math.sin(la1) * math.cos(la2) * math.cos(lo2 - lo1)
    return math.degrees(math.atan2(y, x)) % 360.0


def _median(values: list[float]) -> float:
    ordered = sorted(values)
    n = len(ordered)
    mid = n // 2
    return ordered[mid] if n % 2 else (ordered[mid - 1] + ordered[mid]) / 2.0


def _merge_window_count(timestamps: list[float]) -> int:
    """Collapse detections within the merge window into single maneuvers."""
    count = 0
    last = -math.inf
    for ts in timestamps:
        if ts - last >= _EVENT_MERGE_WINDOW_S:
            count += 1
            last = ts
    return count


def _severity(magnitude: float, threshold: float, extreme_span: float) -> float:
    """Map a magnitude to the 1.0–3.0 display-severity scale."""
    return round(min(3.0, 1.0 + max(0.0, magnitude - threshold) / extreme_span) * 100) / 100


def analyze(raw_waypoints: list[dict[str, Any]] | None, duration_seconds: int) -> TelemetryAnalysis:
    """Analyze a trip's GPS trace. Returns EMPTY_ANALYSIS when there is nothing usable."""
    pts = _parse_waypoints(raw_waypoints)
    if len(pts) < 3:
        return EMPTY_ANALYSIS

    brake_hits: list[tuple[float, _Point, float]] = []  # (ts, at-point, decel)
    accel_hits: list[tuple[float, _Point, float]] = []
    turn_hits: list[tuple[float, _Point, float]] = []  # (ts, at-point, deg/s)
    dts: list[float] = []
    covered_s = 0.0
    distance_km = 0.0

    for i in range(1, len(pts)):
        prev, cur = pts[i - 1], pts[i]
        dt = cur.ts - prev.ts
        dts.append(dt)

        # Trace distance (issue #56): trapezoid-integrate speed over *every*
        # segment, including gaps longer than the kinematic limit. Excluding gaps
        # would under-witness badly on the devices from issue #17 that emit a 6 s
        # median with >15 s holes, and this value is only ever used as an upper
        # bound on the client's claim — under-witnessing would penalise honest users.
        distance_km += ((prev.speed_kmh + cur.speed_kmh) / 2.0 / 3600.0) * dt

        if dt > _MAX_KINEMATIC_GAP_S:
            continue
        covered_s += dt

        accel_ms2 = ((cur.speed_kmh - prev.speed_kmh) / 3.6) / dt
        if accel_ms2 <= -_BRAKE_DECEL_MS2 and prev.speed_kmh >= _KINEMATIC_MIN_SPEED_KMH:
            brake_hits.append((cur.ts, cur, -accel_ms2))
        elif accel_ms2 >= _ACCEL_MS2 and cur.speed_kmh >= _KINEMATIC_MIN_SPEED_KMH:
            accel_hits.append((cur.ts, cur, accel_ms2))

        if i >= 2 and prev.speed_kmh >= _TURN_MIN_SPEED_KMH and dt <= _TURN_MAX_DT_S:
            before, entry = _bearing_deg(pts[i - 2], prev), _bearing_deg(prev, cur)
            if before is not None and entry is not None and pts[i - 1].ts - pts[i - 2].ts <= _TURN_MAX_DT_S:
                delta = abs(entry - before)
                delta = min(delta, 360.0 - delta)
                rate = delta / dt
                if rate >= _TURN_RATE_DEG_S:
                    turn_hits.append((cur.ts, cur, rate))

    # ── Speeding: severity-weighted minutes over the conservative threshold ──────
    threshold = _ASSUMED_LIMIT_KMH + _SPEED_BUFFER_KMH
    speeding_weight = 0.0
    speeding_runs: list[tuple[_Point, float, float]] = []  # (peak point, peak speed, run seconds)
    run_peak: _Point | None = None
    run_seconds = 0.0
    for i in range(1, len(pts)):
        prev, cur = pts[i - 1], pts[i]
        dt = cur.ts - prev.ts
        over = cur.speed_kmh - threshold
        if dt <= _MAX_KINEMATIC_GAP_S and over >= 0.0:
            band_weight = next(w for floor, w in _SPEED_BANDS if over >= floor)
            speeding_weight += band_weight * dt / 60.0
            run_seconds += dt
            if run_peak is None or cur.speed_kmh > run_peak.speed_kmh:
                run_peak = cur
        elif run_peak is not None:
            speeding_runs.append((run_peak, run_peak.speed_kmh, run_seconds))
            run_peak, run_seconds = None, 0.0
    if run_peak is not None:
        speeding_runs.append((run_peak, run_peak.speed_kmh, run_seconds))

    # ── Confidence: how much of the trip the trace covers, and how densely ───────
    median_dt = _median(dts)
    span_s = max(float(duration_seconds), pts[-1].ts - pts[0].ts, 1.0)
    coverage = min(covered_s / span_s, 1.0)
    rate_factor = min(_FULL_CONFIDENCE_DT_S / max(median_dt, 0.1), 1.0)
    confidence = round(coverage * (0.4 + 0.6 * rate_factor) * 1000) / 1000

    has_speed_data = (
        len(pts) >= _MIN_SPEED_SAMPLES and coverage >= _SPEED_COVERAGE_MIN and median_dt <= _SPEED_MEDIAN_DT_MAX_S
    )

    events: list[GpsEvent] = []
    for ts, p, decel in brake_hits:
        events.append(
            GpsEvent(
                type="HARD_BRAKE",
                ts_ms=int(ts * 1000),
                lat=p.lat,
                lng=p.lng,
                severity=_severity(decel, _BRAKE_DECEL_MS2, 3.0),
                detail={"decelMs2": round(decel, 2), "speedKmh": round(p.speed_kmh, 1)},
            )
        )
    for ts, p, acc in accel_hits:
        events.append(
            GpsEvent(
                type="AGGRESSIVE_ACCEL",
                ts_ms=int(ts * 1000),
                lat=p.lat,
                lng=p.lng,
                severity=_severity(acc, _ACCEL_MS2, 3.0),
                detail={"accelMs2": round(acc, 2), "speedKmh": round(p.speed_kmh, 1)},
            )
        )
    for ts, p, rate in turn_hits:
        events.append(
            GpsEvent(
                type="SHARP_TURN",
                ts_ms=int(ts * 1000),
                lat=p.lat,
                lng=p.lng,
                severity=_severity(rate, _TURN_RATE_DEG_S, 25.0),
                detail={"turnRateDegS": round(rate, 1), "speedKmh": round(p.speed_kmh, 1)},
            )
        )
    for peak, peak_speed, seconds in speeding_runs:
        events.append(
            GpsEvent(
                type="SPEEDING",
                ts_ms=int(peak.ts * 1000),
                lat=peak.lat,
                lng=peak.lng,
                severity=_severity(peak_speed, threshold, 30.0),
                detail={"peakSpeedKmh": round(peak_speed, 1), "overThresholdSeconds": round(seconds, 1)},
            )
        )
    events.sort(key=lambda e: e.ts_ms)

    # Merged counts: one maneuver, not one count per GPS sample of it.
    return TelemetryAnalysis(
        hard_brakes=_merge_window_count([ts for ts, _p, _m in brake_hits]),
        aggressive_accels=_merge_window_count([ts for ts, _p, _m in accel_hits]),
        sharp_turns=_merge_window_count([ts for ts, _p, _m in turn_hits]),
        speeding_weight=round(speeding_weight * 1000) / 1000,
        has_speed_data=has_speed_data,
        confidence=confidence,
        distance_km=round(distance_km * 1000) / 1000,
        events=events,
    )
