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
  * A speeding ratio per scoring.md "Speeding": the share of the trip's judged
    distance driven above the road's posted limit plus a buffer. Limits come
    from the caller (`speed_limits`, resolved by `app.services.speed_limits`);
    an unmapped stretch inside an otherwise mapped trip falls back to the old
    conservative absolute limit, so a 150 km/h burst off the map is still
    charged. `limit_coverage` reports how much of the trip had a real limit
    behind it, and a trip mostly off the map loses the component altogether
    rather than being scored against a threshold it was never going to reach.
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
_KINEMATIC_MIN_SPEED_KMH = 15.0  # low-speed floor for brake/accel detection (CAR-103)
_EVENT_MERGE_WINDOW_S = 5.0  # one physical maneuver, not N samples of it

# ── Distraction exposure (scoring.md "Phone distraction") ──────────────────────
# CMT gate screen-interaction detection at 9.3 mph; this is that number rounded.
# Deliberately not _KINEMATIC_MIN_SPEED_KMH — same value today, different reasons
# (a detection gate vs. a brake/accel noise floor), so they must drift freely.
_DRIVING_MIN_SPEED_KMH = 15.0

# ── Speeding (scoring.md "Speeding") - share of distance above the posted limit ─
_ASSUMED_LIMIT_KMH = 120.0  # last resort where the map has no road: the national maximum

# The buffer scales with the limit instead of being a flat 10 km/h. Flat, it was
# 20% of a 50 zone and 9% of a 110 one, so the same allowance meant "well over"
# in town and "barely moving" on a motorway. The floor of 5 km/h is the margin
# Israeli traffic cameras subtract from every measured speed, so below it we
# would be charging for what the enforcement system itself treats as noise.
_SPEED_BUFFER_MIN_KMH = 5.0
_SPEED_BUFFER_FRACTION = 0.10

# Severity bands, in km/h over the posted limit (scoring.md "Speeding"). Distance
# driven in each band is multiplied by its weight, so a kilometre at 95 in a 50
# zone costs eight times a kilometre at 62. Without them the component charged
# both the same, which is not what a safety score should say.
_SPEED_BANDS = ((30.0, 8.0), (20.0, 3.0), (0.0, 1.0))  # (km/h over the limit, weight), highest first

# Ceiling on the severity-weighted ratio, which is otherwise unbounded upward at
# the top band. Matches the heaviest band, so "every kilometre at 30+ over" is
# the worst a trip can be, not a number that keeps growing.
_MAX_SPEEDING_RATIO = 8.0
# Below this share of judged distance carrying a mapped limit, speeding is not
# scored at all and its weight is redistributed (scoring.md "Blending the five").
# The alternative - scoring an unmapped trip against the 120 fallback - is what
# made the component return 100.0 on every urban drive (CAR-233). A component
# held constant is worse than a component that honestly stands down.
_LIMIT_COVERAGE_MIN = 0.5

# ── Confidence & speed-data coverage ────────────────────────────────────────────
# The detection ceiling, not the target cadence. Detection averages decel over
# the sampling interval, so the largest median gap at which a 2 s brake at
# 3.75 m/s² still averages to _BRAKE_DECEL_MS2 is 2 × 3.75 / 3.0. The spec's 2 s
# cadence sits under it, so a device that complies is never penalised for jitter.
_FULL_CONFIDENCE_DT_S = 2.5
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
    speeding_ratio: float  # [0, 8] - severity-weighted share of judged distance above the limit
    limit_coverage: float  # [0, 1] - share of judged distance with a mapped posted limit
    has_speed_data: bool
    confidence: float  # [0, 1] — how much the trace can prove
    distance_km: float  # trace-derived distance — an independent witness (issue #56)
    driving_seconds_above_threshold: float  # exposure denominator for distraction
    witnessed_span_seconds: float  # first-to-last sample — how much of the trip the trace saw
    events: list[GpsEvent]


EMPTY_ANALYSIS = TelemetryAnalysis(
    hard_brakes=0,
    aggressive_accels=0,
    sharp_turns=0,
    speeding_ratio=0.0,
    limit_coverage=0.0,
    has_speed_data=False,
    confidence=0.0,
    distance_km=0.0,
    driving_seconds_above_threshold=0.0,
    witnessed_span_seconds=0.0,
    events=[],
)


@dataclass(frozen=True)
class _Point:
    ts: float  # epoch seconds
    lat: float | None
    lng: float | None
    speed_kmh: float
    limit_kmh: float | None = None  # posted limit here, None where the map has no road


def _parse_waypoints(raw: list[dict[str, Any]] | None, limits: list[float | None] | None = None) -> list[_Point]:
    """Untrusted JSON → clean, time-sorted, deduplicated points.

    `limits` is aligned to `raw` by index. Attaching it here rather than after
    cleaning is what keeps the pairing correct: sorting and dedup move points
    around, and a limit that travels on the point cannot drift off it.
    """
    if not raw:
        return []
    points: list[_Point] = []
    for i, entry in enumerate(raw):
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
        limit = limits[i] if limits is not None and i < len(limits) else None
        points.append(_Point(ts=ts, lat=lat, lng=lng, speed_kmh=speed, limit_kmh=limit))

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


def _segment_limit(prev: _Point, cur: _Point) -> tuple[float, bool]:
    """The limit to judge one segment by, and whether the map actually knew it.

    The *higher* of the two endpoint limits. A segment straddling a boundary
    between a 90 road and a 50 one gets 90, so the metre where the sign changes
    is never the metre a driver is charged for - the same bias as the proximity
    match in `speed_limits`, for the same reason.
    """
    known = [x for x in (prev.limit_kmh, cur.limit_kmh) if x is not None]
    return (max(known), True) if known else (_ASSUMED_LIMIT_KMH, False)


def _speed_buffer(limit_kmh: float) -> float:
    """How far over the limit is not yet speeding, for this limit."""
    return max(_SPEED_BUFFER_MIN_KMH, limit_kmh * _SPEED_BUFFER_FRACTION)


def _band_weight(over_kmh: float) -> float:
    """Severity weight for driving this far over the posted limit."""
    return next(weight for floor, weight in _SPEED_BANDS if over_kmh >= floor)


def analyze(
    raw_waypoints: list[dict[str, Any]] | None,
    duration_seconds: int,
    speed_limits: list[float | None] | None = None,
) -> TelemetryAnalysis:
    """Analyze a trip's GPS trace. Returns EMPTY_ANALYSIS when there is nothing usable.

    `speed_limits` is the posted limit in km/h for each entry of `raw_waypoints`,
    aligned by index - `app.services.speed_limits.resolve` produces it. Omitting
    it scores the trace against the absolute fallback alone, which no real trip
    should do; it is the shape the pure unit tests use.
    """
    pts = _parse_waypoints(raw_waypoints, speed_limits)
    if len(pts) < 3:
        return EMPTY_ANALYSIS

    brake_hits: list[tuple[float, _Point, float]] = []  # (ts, at-point, decel)
    accel_hits: list[tuple[float, _Point, float]] = []
    turn_hits: list[tuple[float, _Point, float]] = []  # (ts, at-point, deg/s)
    dts: list[float] = []
    covered_s = 0.0
    distance_km = 0.0
    driving_s = 0.0
    # Speeding is measured over distance, not time (scoring.md "Speeding"). The
    # denominator is the distance we can actually judge - segments short enough
    # to trust - so a trace with holes is scored on what it saw, not diluted by
    # what it missed.
    judged_km = 0.0
    mapped_km = 0.0
    speeding_km = 0.0

    for i in range(1, len(pts)):
        prev, cur = pts[i - 1], pts[i]
        dt = cur.ts - prev.ts
        dts.append(dt)

        # Trace distance (issue #56): trapezoid-integrate speed over *every*
        # segment, including gaps longer than the kinematic limit. Excluding gaps
        # would under-witness badly on the devices from issue #17 that emit a 6 s
        # median with >15 s holes, and this value is only ever used as an upper
        # bound on the client's claim — under-witnessing would penalise honest users.
        mean_kmh = (prev.speed_kmh + cur.speed_kmh) / 2.0
        seg_km = (mean_kmh / 3600.0) * dt
        distance_km += seg_km

        # Distraction exposure, credited by the segment mean for the same reason
        # distance is trapezoid-integrated above. Letting the closing sample decide
        # a whole segment made a one-minute hole worth 60 s or 0 s on identical
        # driving, depending only on whether the driver happened to be stopped when
        # the fix came back — on exactly the sparse-GPS devices from CAR-7.
        if mean_kmh >= _DRIVING_MIN_SPEED_KMH:
            driving_s += dt

        if dt > _MAX_KINEMATIC_GAP_S:
            continue
        covered_s += dt

        limit, mapped = _segment_limit(prev, cur)
        judged_km += seg_km
        if mapped:
            mapped_km += seg_km
        over_kmh = mean_kmh - limit
        if over_kmh > _speed_buffer(limit):
            speeding_km += seg_km * _band_weight(over_kmh)

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

    # ── Speeding runs: one event per continuous stretch over the limit ───────────
    # These are for the trip map and forensics only. The score is the distance
    # ratio above, which is why nothing here feeds back into it - a driver who
    # holds 15 over for ten minutes files one event and is charged for ten
    # minutes of distance, not for one incident.
    speeding_runs: list[tuple[_Point, float, float, float]] = []  # (peak, peak speed, seconds, limit)
    run_peak: _Point | None = None
    run_seconds = 0.0
    run_limit = 0.0
    for i in range(1, len(pts)):
        prev, cur = pts[i - 1], pts[i]
        dt = cur.ts - prev.ts
        limit, _mapped = _segment_limit(prev, cur)
        if dt <= _MAX_KINEMATIC_GAP_S and cur.speed_kmh - limit > _speed_buffer(limit):
            run_seconds += dt
            # The limit reported on the event is the one at the peak, so the
            # readout a driver sees explains the speed beside it.
            if run_peak is None or cur.speed_kmh > run_peak.speed_kmh:
                run_peak, run_limit = cur, limit
        elif run_peak is not None:
            speeding_runs.append((run_peak, run_peak.speed_kmh, run_seconds, run_limit))
            run_peak, run_seconds, run_limit = None, 0.0, 0.0
    if run_peak is not None:
        speeding_runs.append((run_peak, run_peak.speed_kmh, run_seconds, run_limit))

    # Severity-weighted, so this is a share of distance only when every metre of
    # it sat in the mildest band; the ceiling is the heaviest band's weight.
    speeding_ratio = min(speeding_km / judged_km, _MAX_SPEEDING_RATIO) if judged_km > 0 else 0.0
    limit_coverage = mapped_km / judged_km if judged_km > 0 else 0.0

    # ── Confidence: how much of the trip the trace covers, and how densely ───────
    median_dt = _median(dts)
    span_s = max(float(duration_seconds), pts[-1].ts - pts[0].ts, 1.0)
    coverage = min(covered_s / span_s, 1.0)
    rate_factor = min(_FULL_CONFIDENCE_DT_S / max(median_dt, 0.1), 1.0)
    confidence = round(coverage * (0.4 + 0.6 * rate_factor) * 1000) / 1000

    # Two independent questions, and speeding needs yes to both: is the trace
    # dense enough to measure speed at all, and did we know the limit for enough
    # of it to judge that speed against something real.
    has_speed_data = (
        len(pts) >= _MIN_SPEED_SAMPLES
        and coverage >= _SPEED_COVERAGE_MIN
        and median_dt <= _SPEED_MEDIAN_DT_MAX_S
        and limit_coverage >= _LIMIT_COVERAGE_MIN
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
    for peak, peak_speed, seconds, limit in speeding_runs:
        events.append(
            GpsEvent(
                type="SPEEDING",
                ts_ms=int(peak.ts * 1000),
                lat=peak.lat,
                lng=peak.lng,
                severity=_severity(peak_speed, limit + _speed_buffer(limit), 30.0),
                detail={
                    "peakSpeedKmh": round(peak_speed, 1),
                    "limitKmh": round(limit),
                    "overThresholdSeconds": round(seconds, 1),
                },
            )
        )
    events.sort(key=lambda e: e.ts_ms)

    # Merged counts: one maneuver, not one count per GPS sample of it.
    return TelemetryAnalysis(
        hard_brakes=_merge_window_count([ts for ts, _p, _m in brake_hits]),
        aggressive_accels=_merge_window_count([ts for ts, _p, _m in accel_hits]),
        sharp_turns=_merge_window_count([ts for ts, _p, _m in turn_hits]),
        speeding_ratio=round(speeding_ratio * 10000) / 10000,
        limit_coverage=round(limit_coverage * 1000) / 1000,
        has_speed_data=has_speed_data,
        confidence=confidence,
        distance_km=round(distance_km * 1000) / 1000,
        driving_seconds_above_threshold=round(driving_s * 1000) / 1000,
        witnessed_span_seconds=round((pts[-1].ts - pts[0].ts) * 1000) / 1000,
        events=events,
    )
