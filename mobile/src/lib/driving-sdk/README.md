# Driving SDK

Last updated: 2026-08-15

The `driving-sdk` is a **generic, sensor-layer library** for React Native (Expo). It wraps device hardware — GPS, accelerometer, gyroscope, and Bluetooth — and exposes a unified, event-driven API that any mobile application can consume.

This directory is maintained as a self-contained unit and will be extracted into a standalone npm package. **It must not contain any logic specific to any application** (scoring rules, fraud thresholds, gamification, business decisions about what constitutes a valid trip, etc.). Think of it as a third-party dependency: the application layer sits above it and decides what to do with the raw events it emits.

---

## Platform Support

| Feature | Android | iOS |
|---|---|---|
| GPS & IMU sensors | ✅ | ✅ |
| Bluetooth bonded device listing | ✅ | ❌ |
| Automatic connect / disconnect events | ✅ | ❌ |

For what each platform lets an app observe about phone handling — screen and lock state, foreground app, background sensor delivery, and the cadence differences between the two platforms — see **[PLATFORM-CAPABILITIES.md](./PLATFORM-CAPABILITIES.md)**. Those answers carry verification dates, because platform policy moves.

### Why Bluetooth auto-start is Android-only

Car audio and multimedia systems use **Classic Bluetooth (BR/EDR)** — the profile family that handles audio streaming (A2DP) and hands-free calls (HFP).

**iOS restriction:** Apple's CoreBluetooth framework is limited to Bluetooth Low Energy (BLE) for third-party applications. Accessing Classic Bluetooth devices requires an **Apple MFi (Made for iPhone) licence** — a hardware certification program that is only available to hardware manufacturers. This makes it technically infeasible for a software SDK.

**Android:** Full access via `ACTION_ACL_CONNECTED` / `ACTION_ACL_DISCONNECTED` broadcasts.

**iOS fallback:** Provide a manual start mechanism (e.g. a "Start" button) as the alternative for iOS users.

---

## Build Requirements

Bluetooth features require a **development build** (`expo-dev-client`). They are **not compatible with Expo Go**, which does not include the native Bluetooth module.

The route map feature (`MapView`) also requires a development build — `react-native-maps` links a native module that is absent from Expo Go. The SDK degrades gracefully: map components show a fallback card when the native module is unavailable.

```bash
npx expo install react-native-bluetooth-classic
npx expo install react-native-maps
```

---

## What belongs in this directory

| File | Responsibility |
|---|---|
| `index.ts` | `DrivingSDK` — the single public entry point; orchestrates all managers |
| `BluetoothManager.ts` | Lists OS-bonded BT devices; fires `onConnect` / `onDisconnect` on system connection events |
| `sensors/SensorManager.ts` | GPS + accelerometer + gyroscope fusion; emits `DrivingEvent` objects and raw telemetry |
| `sensors/PhoneUsageManager.ts` | IMU-based hand-held detection (accelerometer variance); emits `touchEpochs`/`screenInteractionSeconds` and `PHONE_USAGE` events while a trip is active |
| `types.ts` | Shared TypeScript types consumed by the SDK and its consumers |

---

## What does NOT belong in this directory

Any file that encodes a decision specific to the consuming application.

| What it is | Correct location |
|---|---|
| Trip start/end rules (e.g. "30 s above 10 km/h = trip confirmed") | Application's own validation layer |
| Fraud / transport-mode detection with hard-coded thresholds | Application's fraud detector |
| Gamification levels, point thresholds, multipliers | Application's business logic |
| Scoring formulas | Application's scoring layer |
| Minimum speed required to count an event for scoring | Application's `sdk.on()` condition |

**Rule of thumb:** if removing the file from this directory and importing it from the application's own `lib/` layer requires zero changes to the SDK's public API, then the file does not belong here.

---

## Architecture boundary

```
┌──────────────────────────────────────────────────────────────┐
│                    Application layer                         │
│  (scoring, fraud detection, trip validation, gamification)   │
│                                                              │
│  sdk.on(HARD_BRAKE, { minSpeedKmh: 15 }, handler)           │
│  sdk.on(SHARP_TURN,  { minSpeedKmh: 10 }, handler)           │
│  sdk.onTripEnd = (data) => persistTrip(data)                 │
│                                                              │
│                   ↓ registers  ↑ events                      │
├──────────────────────────────────────────────────────────────┤
│                      driving-sdk/                            │
│  DrivingSDK · BluetoothManager · SensorManager               │
│  PhoneUsageManager · DefaultTripValidator                    │
│                                                              │
│  Detects physical events via GPS+IMU fusion (tunable via     │
│  SDKConfig.motionThresholds)                                 │
│  Dispatches to registered listeners when conditions are met  │
│  No business decisions — zero app-specific code              │
├──────────────────────────────────────────────────────────────┤
│                     Device hardware                          │
│  GPS · Accelerometer · Gyroscope · Classic Bluetooth         │
└──────────────────────────────────────────────────────────────┘
```

---

## Quick Start

```typescript
import { DrivingSDK, DrivingEventType } from '@/lib/driving-sdk';

const sdk = new DrivingSDK({
  autoStartOnBluetooth: true,
  targetBluetoothId: 'AA:BB:CC:DD:EE:FF',
});

// Trip lifecycle
sdk.onTripStart = (tripId) => console.log('Trip started:', tripId);
sdk.onTripEnd   = (data)   => console.log('Distance:', data.distanceKm, 'km');
sdk.onUpdate    = (data)   => console.log('Speed:', data.maxSpeed, 'km/h');

// Subscribe to a specific event type with conditions
const token = sdk.on(
  DrivingEventType.HARD_BRAKE,
  { minSpeedKmh: 15 },              // only fires above 15 km/h
  (event) => console.log('Hard brake — severity', event.severity),
);

// Later: unsubscribe
sdk.off(token);
```

---

## Sensor Event API — `on()` / `off()`

The primary way to consume driving events. Each listener fires only when **all** specified conditions are met at the moment of detection.

### `sdk.on(type, condition, handler): ListenerToken`

| Parameter | Type | Description |
|---|---|---|
| `type` | `DrivingEventType` | Event type to subscribe to |
| `condition` | `SensorEventCondition` | Constraints that must be satisfied |
| `handler` | `(event: DrivingEvent) => void` | Called when a matching event is detected |

**Returns** a `ListenerToken` — an opaque symbol used to unsubscribe.

### `SensorEventCondition`

| Field | Type | Default | Description |
|---|---|---|---|
| `minSpeedKmh` | `number` | `0` (no gate) | GPS speed at detection time must be ≥ this value |
| `minSeverity` | `number` | `0` (no gate) | Event severity [0–1] must be ≥ this value |

### `DrivingEventType`

| Value | Detected from | Description |
|---|---|---|
| `HARD_BRAKE` | GPS (IMU cross-confirm) | Deceleration ≥ `motionThresholds.brakeThresholdMs2` (default 2.7 m/s²) |
| `AGGRESSIVE_ACCEL` | GPS (IMU cross-confirm) | Acceleration ≥ `motionThresholds.accelThresholdMs2` (default 3.0 m/s²) |
| `SHARP_TURN` | GPS heading rate × speed (IMU cross-confirm) | Lateral accel ≥ `motionThresholds.turnThresholdMs2` (default 3.5 m/s²) |
| `PHONE_USAGE` | Accelerometer variance | IMU variance indicates the phone is hand-held, whichever app is in front. Fires once per hand-held stretch, not once per second — it re-arms as soon as a single tick falls below the variance threshold, so one pickup can produce more than one event. |

`HARD_BRAKE` / `AGGRESSIVE_ACCEL` / `SHARP_TURN` are computed from GPS speed and heading — this works regardless of how the phone is mounted or oriented in the vehicle. The accelerometer only cross-confirms that the phone actually felt a matching force, rejecting pure GPS glitches. See [Sensor internals](#sensor-internals).

### Multiple listeners

Any number of listeners may be registered for the same event type with different conditions or handlers. Each fires independently.

```typescript
// Listener A: low-severity warning (any speed)
const tokenA = sdk.on(DrivingEventType.HARD_BRAKE, {}, (e) => showWarning(e));

// Listener B: high-severity scoring event (only at driving speed)
const tokenB = sdk.on(DrivingEventType.HARD_BRAKE, { minSpeedKmh: 15, minSeverity: 0.3 }, (e) => {
  scoringCounter.hardBrakes++;
});

// Cleanup
sdk.off(tokenA);
sdk.off(tokenB);
```

### `onEventDetected` (legacy)

```typescript
sdk.onEventDetected = (event) => { /* fires for ALL SDK-qualified events */ };
```

This fires for every event that passes the SDK's internal cooldown guard, **regardless** of any registered listener conditions. Useful for raw display (e.g. live event log), but does not carry condition semantics. Prefer `on()` for business logic.

---

## `DrivingEvent` shape

```typescript
interface DrivingEvent {
  type:      DrivingEventType;
  timestamp: Date;
  severity:  number;            // 0.0 (threshold) → 1.0 (maximum)
  speedKmh?: number;            // GPS speed at detection time (stamped by DrivingSDK)
  location?: { latitude: number; longitude: number }; // GPS coordinates at detection time
  // Motion events only — absent on PHONE_USAGE:
  peakG?:      number;          // peak gravity-removed horizontal force, in g (unsigned)
  durationMs?: number;          // how long the force stayed above the IMU cross-confirm threshold
}
```

`severity` is normalised against the configured threshold, so it changes meaning if
`motionThresholds` is overridden. `peakG` and `durationMs` are the raw physical
measurements behind it.

`peakG` is an **orientation-invariant, gravity-relative horizontal magnitude** — gravity is
removed and the magnitude of the component perpendicular to it is taken, so the same brake
reads the same on a vent mount, in a cup holder or in a pocket. Longitudinal and lateral are
not recoverable from it: only the running scalar peak is kept, so direction is discarded
before the event is emitted. With no accelerometer present `peakG` is emitted as `0`, not
omitted.

`durationMs` is the longest continuous stretch the horizontal force stayed at or above
the IMU cross-confirm threshold within the evaluation window.

---

## API Reference

### `DrivingSDK`

Main entry point. Instantiate once per app lifecycle (singleton recommended).

#### Constructor

```typescript
new DrivingSDK(config?: SDKConfig)
```

`SDKConfig`:

| Field | Type | Default | Description |
|---|---|---|---|
| `autoStartOnBluetooth` | `boolean` | `true` | Start trip automatically when target BT device connects |
| `targetBluetoothId` | `string \| null` | — | MAC address of the BT device to monitor |
| `sensorUpdateInterval` | `number` (ms) | `1000` | How often `onUpdate` fires (wall-clock) |
| `scoringEnabled` | `boolean` | `true` | Reserved — passed through to application callbacks |
| `motionThresholds` | `Partial<MotionThresholds>` | `DEFAULT_MOTION_THRESHOLDS` | Tune HARD_BRAKE / AGGRESSIVE_ACCEL / SHARP_TURN sensitivity (m/s²) without editing the SDK. Any field omitted falls back to the default. |
| `tripValidator` | `TripValidator` | `DefaultTripValidator` (confirms/ends trips immediately) | Plug in app-specific rules for when a trip actually starts/ends, and suspicious-activity detection. See [Pluggable trip validation](#pluggable-trip-validation). |

#### Methods

| Method | Returns | Description |
|---|---|---|
| `startTrip()` | `Promise<string>` | Manually start a trip; returns trip ID |
| `stopTrip()` | `Promise<TripData \| null>` | Stop recording; returns final trip data |
| `on(type, condition, handler)` | `ListenerToken` | Subscribe to a sensor event with conditions |
| `off(token)` | `void` | Unsubscribe a registered listener |
| `updateTargetDevice(id)` | `void` | Change the BT device to monitor at runtime |
| `getAvailableDevices()` | `Promise<BluetoothDevice[]>` | Returns OS-bonded BT devices (Android only) |
| `getStatus()` | `object` | Returns `{ isActive, isValidating, tripData }` |

#### Lifecycle callbacks

| Callback | Signature | Description |
|---|---|---|
| `onTripStart` | `(tripId: string) => void` | Fired when sensor recording begins |
| `onTripEnd` | `(data: TripData) => void` | Fired with final trip summary |
| `onUpdate` | `(data: TripData) => void` | Periodic update (~1 Hz) with current speed, distance, phone data |
| `onEventDetected` | `(event: DrivingEvent) => void` | Fired for every SDK-qualified event (no conditions). Use `on()` for conditional logic. |
| `onFraudDetected` | `(event: FraudDetectedEvent) => void` | Fired when the validation layer suspects non-car transport |

#### Debug helpers

| Method | Description |
|---|---|
| `simulateBluetoothConnection()` | Fires the BT connect callback without a physical device |
| `simulateBluetoothDisconnection()` | Fires the BT disconnect callback without a physical device |
| `debugAddDistance(km)` | Injects distance into the active trip (dev only) |

---

## `TripData` shape

Returned by `onTripEnd` and `onUpdate`:

```typescript
interface TripData {
  startTime:              Date;
  endTime?:               Date;
  distanceKm:             number;
  durationSeconds:        number;
  events:                 DrivingEvent[];   // all SDK-qualified events (route map markers)
  waypoints:              RouteWaypoint[];  // GPS track, one point every ~5s of wall-clock time while moving
  averageSpeed:           number;           // km/h
  maxSpeed:               number;           // km/h
  touchEpochs:            number;           // glass-tap proxy count (IMU)
  screenInteractionSeconds: number;         // IMU-confirmed hand-held seconds
}
```

> **Note:** `events` contains every event that passed the SDK's internal cooldown guard — it is **not** filtered by any `on()` listener conditions. If your app only wants to count events that met a scoring threshold, maintain your own counter in the relevant `on()` handler.

---

## Sensor internals

### Motion-event detection (brake / accel / turn) — `SensorManager`

Detects `HARD_BRAKE` / `AGGRESSIVE_ACCEL` / `SHARP_TURN` via **GPS+IMU fusion**,
independent of how the phone is oriented in the vehicle (vent mount, cup holder,
pocket — all work the same):

- **Trigger + direction (GPS, orientation-free):**
  - Longitudinal accel = `Δspeed / Δt` → brake (deceleration) / accel.
  - Lateral accel = `speed × heading-rate` → sharp turn.
  - Evaluated over a rolling ≥1.5 s window so a burst of high-frequency GPS ticks doesn't read as a phantom spike.
  - Turn detection is skipped below ~10 km/h, where GPS heading is unreliable.
- **Severity + cross-confirm (accelerometer, orientation-free):**
  - Gravity is removed (EMA low-pass filter, α = 0.9), and the *horizontal* magnitude of what remains is computed — this magnitude doesn't depend on the phone's yaw, so it's meaningful regardless of mounting angle.
  - A GPS-detected event only fires if the accelerometer also registered a matching horizontal force (rejects pure GPS glitches); the IMU peak also refines the reported severity.
- Thresholds default to `DEFAULT_MOTION_THRESHOLDS` (2.7 / 3.0 / 3.5 m/s² — aligned with common UBI/telematics "harsh event" bands) — override via `SDKConfig.motionThresholds`.
- Severity mapping: `threshold → 0.0`, `threshold + 5.0 m/s² → 1.0`, clamped to `[0, 1]`.

### GPS — `SensorManager`

- Update interval: **2 s** / **5 m** (whichever comes first, `Accuracy.High` — GPS chip only, no network/cell fallback)
- Distance: Haversine formula between consecutive samples
- Speed: from `loc.coords.speed` (m/s → km/h). expo reports **`-1`**, not `0`, when speed is momentarily unavailable (weak fix, urban canyon, parking garage) — clamping that to `0` would read as a real deceleration to a standstill, so the last known-good reading is carried forward instead. It decays back to `0` only after **10 s** without a valid reading, so a sustained dropout can't pin the reported speed above a consumer's "stopped" threshold indefinitely.
- Duplicate-tick guard: a fix arriving less than 500ms after the previous one is dropped before it reaches distance/motion math — some devices emit near-duplicate GPS fixes in bursts (#17), which would otherwise imply physically impossible accelerations.
- Background tracking: a TaskManager task keeps GPS updates flowing while the app is backgrounded or the phone is locked.

#### Waypoint cadence — `Accuracy.BestForNavigation` tried and reverted — #17

Live cloud data found waypoint cadence degrading badly on some devices — a ~6 s median gap instead of the requested 2 s, with individual gaps over 15 s — which coarsens the route trace and any speed or distance figure derived from it. **Root cause:** some Android OEMs (Xiaomi, Huawei, Samsung, …) throttle background location under Doze, battery-saver, or their own power management, regardless of the requested accuracy tier.

Raising accuracy from `High` to `BestForNavigation` looked like the direct lever, but on Android it isn't one: expo-location's `mapAccuracyToPriority` maps both `High` and `BestForNavigation` to the same `PRIORITY_HIGH_ACCURACY`, and the caller-supplied `timeInterval`/`distanceInterval` override the accuracy-derived request params regardless — so the resulting `LocationRequest` is identical either way. On iOS, `BestForNavigation` *is* a distinct, higher-power tier, so raising it there would cost real battery for zero cadence benefit on Android.

Staying on `Accuracy.High`. The duplicate-tick guard above is fully implemented, but no accuracy setting alone fixes the underlying throttling — the only real lever is the user exempting the app from battery optimization, which is what `PowerManagement` below exists to support. **#17 remains open**; that nudge is a mitigation, not a fix.

### Distance accumulation — `DrivingSDK`

`SensorManager` reports the raw per-tick Haversine distance; `DrivingSDK` decides how
much of it counts. Both guards below live in the orchestrator, not the sensor layer.

- Distance gate: ticks below **3 km/h** do not accumulate distance (eliminates coordinate jitter when stationary)
- Teleportation guard: each tick's distance contribution is capped to `(speed / 3600) × timeDeltaS × 1.5 km`. If the Haversine result exceeds this cap (e.g. a GPS position jump while stationary), the capped value is used instead.
- Waypoints are appended on the same gate, one point every `WAYPOINT_INTERVAL_MS` (5 s) of **wall-clock time**, not a GPS-tick count — a tick-count assumption compounds throttling instead of just reflecting it. On clean 2 s ticks this yields ~360 points per 30 minutes. On a throttled Android device with real ~6 s gaps (see #17), it still stores roughly one point per real tick, ~6 s apart — a tick-count assumption of 2 s per tick would instead have stored one point every 3 ticks, ~18 s apart. Cadence can never be denser than the ticks actually arriving; on iOS it's governed by the distance filter and so rises with speed — see [PLATFORM-CAPABILITIES.md](./PLATFORM-CAPABILITIES.md).

### Gyroscope — `SensorManager`

Raw yaw rate is captured at 10 Hz and exposed as `accelX`/`gyroZ` telemetry on every `onUpdate` tick, for use by an app-supplied `TripValidator` (e.g. transport-mode fraud detection). It does not itself trigger any `DrivingEventType`.

### Hand-held detection — `PhoneUsageManager`

Answers one question: **is the phone in a hand, or fixed to the vehicle?** Touches delivered
to other apps are not observable — see [PLATFORM-CAPABILITIES.md](./PLATFORM-CAPABILITIES.md)
— so device motion is used as a proxy. Two metrics are emitted via `onInteractionData`,
plus the `PHONE_USAGE` event.

- **Variance window:** accelerometer magnitude over a rolling **10 samples at 10 Hz** (a 1-second window).
- **Hand-held threshold:** variance above **0.025 g²**. A phone on a vehicle mount sits at ~0.002–0.010 g² (road vibration only); a hand-held phone at ~0.030–0.150 g² (micro hand-movements). `screenInteractionSeconds` is driven by a 1 Hz timer that runs from `start()` to `stop()`: each second above the threshold increments it, whichever app is in front. A mounted phone running a navigation app accumulates nothing, because its variance stays below the threshold.
- **Glass-tap proxy:** a single sample above **1.8 g** total magnitude increments `touchEpochs`, with a **1 500 ms** cooldown so one physical tap isn't counted several times across the 10 Hz stream. This fires regardless of foreground/background.
- **`PHONE_USAGE`** fires once per hand-held stretch, not once per second — see the `DrivingEventType` table above.

> **These three constants are IMU calibration values, not tuned parameters.** They were
> chosen from expected separation margins and **have never been validated against real
> drive data.** In particular the glass-tap proxy cannot distinguish a finger tap from a
> sharp road bump, and variance alone cannot distinguish a hand from a phone sliding
> loose on a seat. Treat both metrics as indicative until calibrated.

### Power management — `PowerManagement`

`isBackgroundThrottlingRiskPlatform()` and `openAppSystemSettings()` are the only two exports: a platform check and a thin `Linking.openSettings()` wrapper. This module has no UI and no opinion on when/whether to ask the user — it exists so any consuming app can build its own nudge for the Android OEM-throttling risk above (#17) without duplicating the platform check. CARMA's own nudge — copy, "ask once" persistence, and *when* to show it — lives outside the SDK in `mobile/src/lib/BatteryOptimizationPrompt.ts`.

### Per-event cooldown

After an event of a given type fires, the same type is suppressed for **500 ms**. Each type has an independent cooldown window — a `SHARP_TURN` does not suppress a concurrent `HARD_BRAKE`.

### Warm-up guard

The first **3 seconds** after `startTrip()` all sensor events are dropped. This eliminates spurious spikes caused by the physical act of pressing the start button.

---

## Pluggable trip validation

Deciding when GPS/BT activity actually counts as a "trip" (vs. noise, a parked car
with the engine running, or a red light) is an app-specific product decision — the
SDK ships a trivial `DefaultTripValidator` that confirms a trip the moment `start()`
is called and never flags anything as suspicious, so `new DrivingSDK()` works with
zero configuration.

To apply your own rules (a minimum-duration/speed gate before confirming a trip, an
idle-timeout to auto-end one, transport-mode fraud detection, …), implement the
`TripValidator` interface and pass an instance via `SDKConfig.tripValidator`:

```typescript
import type { TripValidator, ValidationSample, SuspiciousActivityEvaluation } from '@/lib/driving-sdk/types';

class MyTripValidator implements TripValidator {
  onTripConfirmed?: () => void;
  onTripEnded?: () => void;
  onFraudSuspected?: (evaluation: SuspiciousActivityEvaluation) => void;

  start(): void { /* begin watching samples */ }
  stop(): void { /* stop watching */ }
  updateSample(sample: ValidationSample): void { /* e.g. accumulate time above a speed threshold */ }
}

const sdk = new DrivingSDK({ tripValidator: new MyTripValidator() });
```

`updateSample()` is called at sensor rate with the latest GPS speed and (when
available) accelerometer/gyroscope readings. Call `onTripConfirmed()` once your
rules decide a trip has genuinely started, and `onTripEnded()` once it's genuinely
over — `DrivingSDK` calls `startTrip()` / `stopTrip()` in response. `onFraudSuspected`
is optional and only needed if your validator also does suspicious-activity detection.

---

## Bluetooth Events

`BluetoothManager` exposes two system-level connection events, both firing **only** for the device ID registered via `setTargetDevice()`.

```typescript
const btManager = new BluetoothManager(
  () => console.log('Connected'),
  () => console.log('Disconnected'),
);

btManager.setTargetDevice('AA:BB:CC:DD:EE:FF');
btManager.startMonitoring();
// ...
btManager.stopMonitoring();
```

---

## Complete example — application integration

```typescript
import { DrivingSDK, DrivingEventType } from '@/lib/driving-sdk';

// ── 1. Create SDK instance ────────────────────────────────────────
const sdk = new DrivingSDK({ autoStartOnBluetooth: false });

// ── 2. Trip lifecycle ─────────────────────────────────────────────
sdk.onTripStart = (id) => { /* update UI */ };
sdk.onTripEnd   = (data) => { /* persist trip, show summary */ };
sdk.onUpdate    = (data) => { /* update live trip screen */ };

// ── 3. Register application-specific scoring events ───────────────
// These thresholds are defined BY THE APPLICATION — the SDK knows nothing
// about how many km/h or what severity constitutes a "scored" event.
const listeners = [
  sdk.on(DrivingEventType.HARD_BRAKE,       { minSpeedKmh: 15 }, () => { hardBrakes++; }),
  sdk.on(DrivingEventType.AGGRESSIVE_ACCEL, { minSpeedKmh: 5  }, () => { aggressiveAccels++; }),
  sdk.on(DrivingEventType.SHARP_TURN,       { minSpeedKmh: 10 }, () => { sharpTurns++; }),
  // No condition on PHONE_USAGE — using your phone at any speed is unsafe
  sdk.on(DrivingEventType.PHONE_USAGE,      {                 }, () => { phoneTouches++; }),
];

// ── 4. Start and stop ─────────────────────────────────────────────
await sdk.startTrip();
// ... user drives ...
const tripData = await sdk.stopTrip();

// ── 5. Cleanup ────────────────────────────────────────────────────
listeners.forEach(token => sdk.off(token));
```

---

Developed by May Hajbi.
