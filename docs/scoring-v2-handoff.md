# Scoring v2 — Handoff for SDK & Mobile UI

This is the work that scoring v2 needs but that lives **outside the backend/scoring
domain**. The server side is implemented and running in shadow mode
([scoring.md §13](scoring.md)); the items below are written
for their owners so nobody has to reverse-engineer the spec.

**Do not start any of this without coordinating the rollout order** — the SDK change
ships and stabilises *before* the server ever flips from v1 to v2 (spec §10.5).

---

## A. Driving SDK — severity capture  *(owner: SDK / driving-physics)*

> File: `mobile/src/lib/driving-sdk/sensors/SensorManager.ts`
> This is generic hardware-abstraction code and belongs in the SDK. It must stay free
> of CARMA business logic (no scoring formulas, no thresholds tied to gamification).
> See `mobile/STRUCTURE.md` and the SDK README for the boundary.

What the server needs the SDK to start emitting, **per kinematic event**, instead of a
plain count:

```ts
{
  type: 'HARD_BRAKE' | 'AGGRESSIVE_ACCEL' | 'SHARP_TURN',
  peak_g: number,         // peak absolute g on the relevant axis during the event
  duration_ms: number,    // how long the event stayed over threshold
  speed_kmh: number,      // vehicle speed at event onset (from GPS)
  timestamp: number, lat: number, lng: number
}
```

Three concrete changes:

1. **Tiered detection thresholds** (spec §3.1) — keep detecting at the *moderate* floor
   (brake 0.30 g, accel 0.27 g, turn 0.35 g) but record the actual `peak_g`, not just a
   boolean. The continuous severity weight is computed server-side from `peak_g`; the SDK
   only has to report it accurately.
2. **Low-speed filter** (spec §4) — discard any kinematic event detected at
   `speed < 5 km/h` (parking, speed bumps, phone drops). Standard practice; biggest source
   of false positives.
3. **Speed-at-event** — attach the GPS speed at the moment of each event.

**Why peak_g matters:** the server already has the severity formula
(`event_severity()` in `scoring_v2.py`) implemented and tested. It maps `peak_g` →
a 1.0–~4.5 weight. Today, with no `peak_g`, every event is weighted 1.0. The day the SDK
sends `peak_g`, the score gains its severity dimension with **zero** server change.

**Contract sync:** event shape lives in both `server/app/schemas/` and
`mobile/src/types/index.ts`. Per root `CLAUDE.md` engineering rule #1 these must be synced
manually (or via `npm run gen:api` once the server schema is published). Coordinate with
the backend owner before changing the wire shape.

**Out of scope for the SDK:** phone-distraction `handheld_motion_detected` (spec §3.4) is
a nice-to-have CMT-style signal; the server formula already accepts it but nothing breaks
without it. Skip unless cheap.

---

## B. Mobile UI — two scores  *(owner: Mai)*

> Files: `mobile/src/screens/`, `mobile/src/components/` — presentational only.
> No business logic in screens (see `mobile/STRUCTURE.md`).

From v2 onward the app shows **two numbers** (spec §9):

| Number | Meaning | Where |
|---|---|---|
| **Trip score** | quality of a single drive | trip-end / trip-detail screen (already shown) |
| **Driver score** | persistent profile score (rolling 28-day, what the leaderboard uses) | profile + leaderboard |

**Important — nothing to build yet.** The driver score is currently computed in *shadow
mode* and is **not exposed by any API field**. There is intentionally no `driver_score`
in `TripOut` or the user/leaderboard schemas. When the rollout reaches the UI step, the
backend will add `driver_score` to the relevant response schemas and tell you the exact
field name and shape. **Until then there is no client work and no contract change.**

Grade bands and colours are unchanged (`excellent ≥ 90`, `good ≥ 75`, `fair ≥ 55`,
else `poor`), so `scoreToGrade` / `scoreToColor` are reused as-is for both numbers.

When the field lands, this is roughly the scope:
- Profile screen: show driver score as the headline number; trip score becomes per-trip.
- Leaderboard: rank by driver score instead of total points (confirm with product first).
- A short "good, unproven" affordance for new drivers (their score starts at 75 by design,
  not 100 — credibility blending, spec §7.2). Don't present it as a penalty.

---

## C. `mobile/src/lib/scoring.ts` — real-time preview mirror  *(owner: scoring)*

Deliberately **left on v1** for now. It's a display-only local preview; mirroring v2
there is only useful once the SDK emits severity (item A), and the rollout order puts the
SDK first anyway. Updating it now would break the cross-language parity tests for zero
user benefit. It will be updated in lockstep with item A.

---

## Rollout status

v2 is the active engine — shadow mode is complete, v1 is retired. Remaining steps:

1. Ship SDK severity (A) — unblocks the severity dimension (zero server change needed).
2. Ship Mobile UI (B) — surface driver score alongside trip score.
3. Recalibrate `k_c` decay constants once ≥ ~200 real trips accumulate (see [scoring-calibration.md](scoring-calibration.md)).
