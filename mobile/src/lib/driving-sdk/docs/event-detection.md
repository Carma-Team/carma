Current behaviour.

# Event detection

Part of [`driving-sdk`](../README.md) — how motion events and hand-held
detection are actually computed. The README's Sensor Event API section
covers the consumer-facing `on()`/`off()` surface; this file is the
mechanism behind it.

---

## Motion-event detection (brake / accel / turn) — `SensorManager`

Detects `HARD_BRAKE` / `AGGRESSIVE_ACCEL` / `SHARP_TURN` via **GPS+IMU
fusion**, independent of how the phone is oriented in the vehicle (vent
mount, cup holder, pocket — all work the same):

- **Trigger + direction (GPS, orientation-free):**
  - Longitudinal accel = `Δspeed / Δt` → brake (deceleration) / accel.
  - Lateral accel = `speed × heading-rate` → sharp turn.
  - Evaluated over a rolling ≥1.5 s window so a burst of high-frequency GPS ticks doesn't read as a phantom spike.
  - Turn detection is skipped below ~10 km/h, where GPS heading is unreliable.
- **Cross-confirm (accelerometer, orientation-free):**
  - Gravity is removed (EMA low-pass filter, α = 0.9), and the *horizontal* magnitude of what remains is computed — this magnitude doesn't depend on the phone's yaw, so it's meaningful regardless of mounting angle.
  - A GPS-detected event only fires if the accelerometer also registered a matching horizontal force (rejects pure GPS glitches). This magnitude isn't a vehicle-frame axis, so it's used only as a gate — it is not reported as severity (CAR-156).
- Thresholds default to `DEFAULT_MOTION_THRESHOLDS` (2.7 / 3.0 / 3.5 m/s² — aligned with common UBI/telematics "harsh event" bands) — override via `SDKConfig.motionThresholds`.
- No severity is emitted on motion events until a phone→vehicle rotation stage resolves the IMU magnitude onto the axis `scoring.md` §3.4 needs (longitudinal for braking/accel, lateral for turns).

```mermaid
flowchart LR
    A[GPS tick] --> B[Rolling ≥1.5s window:<br/>Δspeed/Δt or speed×heading-rate]
    B --> C{Crosses<br/>motion threshold?}
    C -- no --> A
    C -- yes --> D[Accelerometer cross-confirm:<br/>gravity-removed horizontal force]
    D -- no matching force --> E[Rejected — GPS glitch]
    D -- confirmed --> F[No severity assigned]
    F --> G{Per-type<br/>cooldown active?}
    G -- yes --> E
    G -- no --> H[DrivingEvent dispatched]
```

---

## GPS — `SensorManager`

- Update interval: **2 s** / **5 m** (whichever comes first, `Accuracy.High` — GPS chip only, no network/cell fallback)
- Distance: Haversine formula between consecutive samples
- Speed: from `loc.coords.speed` (m/s → km/h). expo reports **`-1`**, not `0`, when speed is momentarily unavailable (weak fix, urban canyon, parking garage) — clamping that to `0` would read as a real deceleration to a standstill, so the last known-good reading is carried forward instead. It decays back to `0` only after **10 s** without a valid reading, so a sustained dropout can't pin the reported speed above a consumer's "stopped" threshold indefinitely.
- Duplicate-tick guard: a fix arriving less than 500ms after the previous one is dropped before it reaches distance/motion math — some devices emit near-duplicate GPS fixes in bursts (#17), which would otherwise imply physically impossible accelerations.
- Background tracking: a TaskManager task keeps GPS updates flowing while the app is backgrounded or the phone is locked.

### Waypoint cadence — `Accuracy.BestForNavigation` tried and reverted — #17

Live cloud data found waypoint cadence degrading badly on some devices — a
~6 s median gap instead of the requested 2 s, with individual gaps over 15 s —
which coarsens the route trace and any speed or distance figure derived from
it. **Root cause:** some Android OEMs (Xiaomi, Huawei, Samsung, …) throttle
background location under Doze, battery-saver, or their own power management,
regardless of the requested accuracy tier.

Raising accuracy from `High` to `BestForNavigation` looked like the direct
lever, but on Android it isn't one: expo-location's `mapAccuracyToPriority`
maps both `High` and `BestForNavigation` to the same `PRIORITY_HIGH_ACCURACY`,
and the caller-supplied `timeInterval`/`distanceInterval` override the
accuracy-derived request params regardless — so the resulting `LocationRequest`
is identical either way. On iOS, `BestForNavigation` *is* a distinct,
higher-power tier, so raising it there would cost real battery for zero
cadence benefit on Android.

Staying on `Accuracy.High`. The duplicate-tick guard above is fully
implemented, but no accuracy setting alone fixes the underlying throttling —
the only real lever is the user exempting the app from battery optimization,
which is what `PowerManagement` exists to support. **#17 remains open**; that
nudge is a mitigation, not a fix.

---

## Distance accumulation — `DrivingSDK`

`SensorManager` reports the raw per-tick Haversine distance; `DrivingSDK`
decides how much of it counts. Both guards below live in the orchestrator,
not the sensor layer.

- Distance gate: ticks below **3 km/h** do not accumulate distance (eliminates coordinate jitter when stationary).
- Teleportation guard: each tick's distance contribution is capped to `(speed / 3600) × timeDeltaS × 1.5 km`. If the Haversine result exceeds this cap (e.g. a GPS position jump while stationary), the capped value is used instead.
- **Waypoints:** appended on the same gate, downsampled to one point per
  **2 seconds of elapsed GPS-fix time** while moving. Two things decide that:
  - **The interval.** The server re-detects a brake as the average deceleration
    between two consecutive points, so a sampling interval longer than the event
    smears it across time in which nothing happened — at 5 s it takes a 54 km/h
    drop between two points to register a brake, where a real one is ~25 km/h.
    A hard brake lasts ~2 s, so the cadence is 2 s. ~900 points per 30-minute
    trip, and no extra battery: the location stream already runs at 2 s.
  - **The clock.** Elapsed time is measured between the GPS fixes themselves
    (`fixTs`), never between arrivals. Android defers updates under Doze and
    releases them as a batch in one JS turn (see #17 above), where arrival time
    barely moves — thinning against it would collapse the whole deferred window
    into a single point and stamp every point in the batch with one instant.

---

## Gyroscope — `SensorManager`

Yaw rate is captured at 10 Hz, resolved about gravity rather than about the
device's Z axis, and exposed as `yawRateRadS` on every `onUpdate` tick alongside
the vehicle-frame `longitudinalAccelG`/`lateralAccelG`, for use by an app-supplied
`TripValidator` (e.g. transport-mode fraud detection). All three are `null` while
the vehicle frame is unresolved. It does not itself trigger any `DrivingEventType`.

## Raw accel/gyro taps — `onAccelSample` / `onGyroSample`

Both the accelerometer and gyroscope subscriptions `SensorManager` already
holds open are also offered, raw, to a second and third consumer, rather
than each one opening its own subscription to the same sensor:
`PhoneUsageManager` (hand-held detection, gyro only — see below) and
`RawSampleRecorder` (both, only while a staged calibration session is
active — see the README's "Calibration recording" section and CAR-31).
Neither tap affects motion-event detection above; both fire unconditionally
at 10 Hz regardless of whether anything is currently listening.

The magnetometer is deliberately not a tap. `SensorManager` never subscribes
to it, because nothing here detects anything from it — so `RawSampleRecorder`
owns that subscription itself, opening it in `start()` and removing it in
`stop()`. A trip that runs without a staged session therefore holds no
magnetometer subscription at all (CAR-295).

---

## Hand-held detection — `PhoneUsageManager`

Answers one question: **is the phone in a hand, or fixed to the vehicle?**
Touches delivered to other apps are not observable — see
[`PLATFORM-CAPABILITIES.md`](../PLATFORM-CAPABILITIES.md) — so device motion
is used as a proxy. One delta is emitted per second via `onInteractionData`
(see [trip-lifecycle.md](./trip-lifecycle.md) for the accounting), plus the
`PHONE_USAGE` event.

- **Variance window:** accelerometer magnitude over a rolling **10 samples at 10 Hz** (a 1-second window). Gyroscope samples, when the host pushes them in, share the same window.
- **Hand-held threshold:** variance above **0.025 g²**. A phone on a vehicle mount sits at ~0.002–0.010 g² (road vibration only); a hand-held phone at ~0.030–0.150 g² (micro hand-movements).
- **Rotation veto, `(since #138)`:** a phone loose on a seat also bounces
  enough to trip the acceleration threshold, but it tumbles — a hand keeps the
  phone's orientation stable, a loose phone doesn't. So a high-variance
  reading only counts as hand-held when rotation variance over the same
  window stays below **0.5 (rad/s)²**; at or above it, the acceleration spike
  is read as a tumbling phone rather than a hand. If the host never calls
  `pushGyroSample()`, the veto is skipped and the decision falls back to
  acceleration alone — the behavior every version before #138 has.
- **Glass-tap proxy:** a single sample above **1.8 g** total magnitude flags a touch-epoch transient, with a **1 500 ms** cooldown so one physical tap isn't counted several times across the 10 Hz stream. This fires regardless of foreground/background.
- **Paired-peak tap signature:** reported as `gyroTapPairs` on the motion features, and
  independent of everything above — it changes no decision the manager makes. A jolt
  through the suspension drives mostly the vertical accelerometer axis; a finger on glass
  produces a small *rotational* kick on both in-plane axes at once, because the hand's
  grip resists it. A pair is both X and Y between **0.2 and 0.7 rad/s** on the same
  sample, counted on the sample that enters the band rather than on every sample inside
  it; a tap is two pairs within **400 ms**. The Z axis is excluded on purpose — in a flat
  mounting it is the vehicle's own yaw, and including it would let a turn qualify.
  The 10 Hz feed puts a floor of 100 ms under the repeat gap, so the tightest gaps the
  method describes cannot be resolved at this sample rate.
- **`PHONE_USAGE`** fires once per hand-held stretch, not once per second — it re-arms as soon as a single tick falls below the combined threshold, so one pickup can produce more than one event.

```mermaid
flowchart TD
    A[Accel variance sample] --> B{accelVariance ><br/>0.025 g²?}
    B -- no --> Z[Not hand-held]
    B -- yes --> C{Gyro sample<br/>ever pushed?}
    C -- no --> D[Hand-held<br/>accel-only fallback]
    C -- yes --> E{rotationVariance <<br/>0.5 rad²/s²?}
    E -- yes, low rotation --> D
    E -- no, tumbling --> Z
    D --> F[PHONE_USAGE + InteractionData tick]
    Z --> G[InteractionData tick, no event]
```

> **These constants are IMU calibration values, not tuned parameters.** They
> were chosen from expected separation margins and **have never been
> validated against real drive data** — the rotation threshold most of all,
> since no drive-test data backs it yet (tracked as CAR-183). The glass-tap
> proxy also cannot distinguish a finger tap from a sharp road bump. Treat
> all of these as indicative until calibrated. The tap-signature band and repeat gap are
> the patent's own worked example and carry the same caveat.

---

## Power management — `PowerManagement`

`isBackgroundThrottlingRiskPlatform()` and `openAppSystemSettings()` are the
only two exports: a platform check and a thin `Linking.openSettings()`
wrapper. This module has no UI and no opinion on when/whether to ask the
user — it exists so any consuming app can build its own nudge for the
Android OEM-throttling risk above (#17) without duplicating the platform
check.

---

## Per-event cooldown

After an event of a given type fires, the same type is suppressed for
**500 ms**. Each type has an independent cooldown window — a `SHARP_TURN`
does not suppress a concurrent `HARD_BRAKE`.

## Warm-up guard

The first **3 seconds** after `startTrip()` all sensor events are dropped.
This eliminates spurious spikes caused by the physical act of pressing the
start button.
