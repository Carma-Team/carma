# Swerve detection — implemented, disabled, never verified

`DrivingEventType.SWERVE` is part of the public event enum, but **nothing in the
library detects it**. The detector below was written, never validated on a real
drive, and switched off before it was wired into any consumer.

It is kept here rather than as commented-out code in `sensors/SensorManager.ts`:
commented code is invisible to the type checker, the linter and the test suite, so
it rots silently while still costing every reader who scrolls past it.

**Status.** Not scheduled. Whether this event comes back at all is an open product
decision (CAR-150). Do not re-enable it as part of unrelated work.

**Before it is re-enabled it has to be verified on real drives.** It has never
been. A heading-rate detector fed by GPS bearing is sensitive to fix noise at low
speed, and no threshold here was fitted against anything.

---

## The detector, as it was

Module-level constants:

```typescript
/** EVT_SWERVE — GPS heading change rate.
 *  Spec: > 15 °/s sustained for >= 3 s.
 *  Recommended for less sensitivity: 20 °/s (eliminates gradual curve noise).
 */
const SWERVE_HEADING_RATE_DEG_S = 15;
const SWERVE_MIN_DURATION_MS    = 3000;
const SWERVE_SEVERITY_RANGE     = 25;   // 15°/s → 0.0 ; 40°/s → 1.0
```

Instance state on `SensorManager`, cleared in `start()` alongside the other
per-trip fields:

```typescript
private prevHeading:      number | null = null;
private prevLocTimestamp: number | null = null;
private swerveStartTime:  number | null = null;
```

Called from `handleLocation`, in the branch that already has a previous fix to
compare against — right after the distance and time delta are computed:

```typescript
this.detectSwerve(loc);
```

The detector itself, plus the bearing helper it is the only caller of:

```typescript
private detectSwerve(loc: Location.LocationObject) {
  const now = loc.timestamp;
  const currentHeading = this.computeBearing(
    this.lastLocation.coords.latitude, this.lastLocation.coords.longitude,
    loc.coords.latitude, loc.coords.longitude
  );
  if (this.prevHeading !== null && this.prevLocTimestamp !== null) {
    const timeDeltaS = (now - this.prevLocTimestamp) / 1000;
    if (timeDeltaS > 0) {
      let delta = currentHeading - this.prevHeading;
      delta = ((delta + 540) % 360) - 180;
      const headingRate = Math.abs(delta) / timeDeltaS;
      if (headingRate > SWERVE_HEADING_RATE_DEG_S) {
        if (this.swerveStartTime === null) {
          this.swerveStartTime = now;
        } else if (now - this.swerveStartTime >= SWERVE_MIN_DURATION_MS) {
          const severity = Math.min(1, Math.max(0,
            (headingRate - SWERVE_HEADING_RATE_DEG_S) / SWERVE_SEVERITY_RANGE
          ));
          this.onEvent({ type: DrivingEventType.SWERVE, timestamp: new Date(), severity });
          this.swerveStartTime = null;
        }
      } else {
        this.swerveStartTime = null;
      }
    }
  }
  this.prevHeading      = currentHeading;
  this.prevLocTimestamp = now;
}

/** Compass bearing from point 1 to point 2, in degrees [0, 360). */
private computeBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const lat1r = lat1 * Math.PI / 180;
  const lat2r = lat2 * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(lat2r);
  const x = Math.cos(lat1r) * Math.sin(lat2r) - Math.sin(lat1r) * Math.cos(lat2r) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
```

Two notes for whoever restores it:

- `severity` here is a library-computed confidence on the SDK's own 0–1 scale. It
  is not the same quantity as an engine-side severity, and must not be mapped onto
  one without a conversion.
- The other motion events cross-confirm against the accelerometer before firing.
  This one does not — it fires on GPS bearing alone.

## What a host has to restore

The event type never left the enum, so a consumer needs only its own wiring back:
a listener for the event type with whatever minimum speed its policy sets, a
counter for it in trip state, a row for it wherever trip events are displayed, and
the matching field in whatever payload it sends upstream. In this repository those
call sites are listed in `mobile/CLAUDE.md` under disabled features.
