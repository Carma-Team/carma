Current behaviour.

# Driving SDK

**Last updated: 2026-08-15**

The `driving-sdk` is a **generic, sensor-layer library** for React Native (Expo). It wraps device hardware — GPS, accelerometer, gyroscope, and Bluetooth — and exposes a unified, event-driven API that any mobile application can consume.

This directory is maintained as a self-contained unit and will be extracted into a standalone npm package. **It must not contain any logic specific to any application** (scoring rules, fraud thresholds, gamification, business decisions about what constitutes a valid trip, etc.). Think of it as a third-party dependency: the application layer sits above it and decides what to do with the raw events it emits.

**Deeper material lives in [`docs/`](./docs/):**

| Document | What it covers |
|---|---|
| [`docs/usage-patterns.md`](./docs/usage-patterns.md) | Copyable integration recipes — construction, listeners, lifecycle, cleanup, a full worked example |
| [`docs/event-detection.md`](./docs/event-detection.md) | How motion-event and hand-held detection are actually computed, with diagrams |
| [`docs/trip-lifecycle.md`](./docs/trip-lifecycle.md) | The trip state machine, pluggable validation, and per-tick data flow, with a diagram |
| [`docs/not-in-scope.md`](./docs/not-in-scope.md) | Native platform capabilities this SDK deliberately doesn't wrap, and why |

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
| `sensors/PhoneUsageManager.ts` | IMU-based hand-held detection (accelerometer + gyroscope variance); emits `touchEpochs`/`screenInteractionSeconds` and `PHONE_USAGE` events while a trip is active |
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
  (event) => console.log('Hard brake — duration', event.durationMs, 'ms'),
);

// Later: unsubscribe
sdk.off(token);
```

More patterns, including a full worked integration example, are in
[`docs/usage-patterns.md`](./docs/usage-patterns.md).

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
| `minSeverity` | `number` | `0` (no gate) | Event severity [0–1] must be ≥ this value. **`PHONE_USAGE` only** — motion events carry no severity (CAR-156), so this condition is ignored rather than blocking them |

### `DrivingEventType`

| Value | Detected from | Description |
|---|---|---|
| `HARD_BRAKE` | GPS (IMU cross-confirm) | Deceleration ≥ `motionThresholds.brakeThresholdMs2` (default 2.7 m/s²) |
| `AGGRESSIVE_ACCEL` | GPS (IMU cross-confirm) | Acceleration ≥ `motionThresholds.accelThresholdMs2` (default 3.0 m/s²) |
| `SHARP_TURN` | GPS heading rate × speed (IMU cross-confirm) | Lateral accel ≥ `motionThresholds.turnThresholdMs2` (default 3.5 m/s²) |
| `SWERVE` | — | **Defined but inert.** Its detection code is fully commented out; this type never fires. Re-enabling it is a deliberate future step, not a bug. |
| `PHONE_USAGE` | Accelerometer + gyroscope variance | IMU variance indicates the phone is hand-held, whichever app is in front. Fires once per hand-held stretch, not once per second. See [`docs/event-detection.md`](./docs/event-detection.md) for the full detection logic. |

`HARD_BRAKE` / `AGGRESSIVE_ACCEL` / `SHARP_TURN` are computed from GPS speed and heading — this works regardless of how the phone is mounted or oriented in the vehicle. The accelerometer only cross-confirms that the phone actually felt a matching force, rejecting pure GPS glitches. See [`docs/event-detection.md`](./docs/event-detection.md).

One short example — the full multi-listener pattern is in [`docs/usage-patterns.md`](./docs/usage-patterns.md):

```typescript
const token = sdk.on(DrivingEventType.HARD_BRAKE, { minSpeedKmh: 15 }, (e) => {
  scoringCounter.hardBrakes++;
});
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
  // PHONE_USAGE only — motion events omit it (CAR-156, scoring.md §3.4: the IMU
  // magnitude below isn't a vehicle-frame axis, so there is no severity to report
  // until a phone→vehicle rotation stage exists).
  severity?: number;            // PHONE_USAGE only — currently a hardcoded 0.5, see below
  speedKmh?: number;            // GPS speed at detection time (stamped by DrivingSDK)
  location?: { latitude: number; longitude: number }; // GPS coordinates at detection time
  // Motion events only — absent on PHONE_USAGE:
  peakG?:      number;          // reserved for a single vehicle-frame axis once a phone→vehicle
                                 // rotation stage exists; not populated until then
  durationMs?: number;          // how long the force stayed above the IMU cross-confirm threshold
}
```

`severity` on `PHONE_USAGE` events is currently a hardcoded `0.5` — `motionThresholds`
has no effect on it, since that config only tunes the motion-event thresholds
(HARD_BRAKE/AGGRESSIVE_ACCEL/SHARP_TURN), not PHONE_USAGE.

`peakG` is reserved, not populated. The value it would carry — an orientation-invariant,
gravity-relative horizontal magnitude — cannot be mapped onto `scoring.md`'s severity curve,
which is anchored on a single vehicle-frame axis (longitudinal for braking/accel, lateral for
turns): folding both into one unsigned scalar makes a brake and a turn indistinguishable at
the point of measurement. It stays reserved until a phone→vehicle rotation stage exists to
resolve it onto the right axis.

`durationMs` is the length of the continuous stretch, at or above the IMU cross-confirm
threshold, that contains the event's peak horizontal force — not simply the longest such
stretch in the evaluation window, which could belong to an unrelated bump elsewhere in it.

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
| `tripValidator` | `TripValidator` | `DefaultTripValidator` (confirms/ends trips immediately) | Plug in app-specific rules for when a trip actually starts/ends, and suspicious-activity detection. See [`docs/trip-lifecycle.md`](./docs/trip-lifecycle.md). |

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
  accelAvailable:         boolean;          // ever confirmed live this trip; false alone says nothing about why — see accelInitFailed
  accelInitFailed:        boolean;          // true only if accelerometer registration itself threw
}
```

> **Note:** `events` contains every event that passed the SDK's internal cooldown guard — it is **not** filtered by any `on()` listener conditions. If your app only wants to count events that met a scoring threshold, maintain your own counter in the relevant `on()` handler.

---

## Sensor internals

The full mechanism — GPS+IMU fusion for motion events, hand-held detection
including the rotation-veto logic, waypoint downsampling, cooldowns, and the
warm-up guard — is in [`docs/event-detection.md`](./docs/event-detection.md),
with flow diagrams for the two hardest-to-follow decisions.

One caveat is load-bearing enough to keep here rather than one click away:
**the hand-held-detection constants are IMU calibration values, not tuned
parameters.** They were chosen from expected separation margins and have
never been validated against real drive data. Treat every metric this SDK
emits about phone handling as indicative, not a measurement, until
calibrated — see [`PLATFORM-CAPABILITIES.md`](./PLATFORM-CAPABILITIES.md) for
why it can only ever be an inference in the first place.

---

## Pluggable trip validation

Deciding when GPS/BT activity actually counts as a "trip" (vs. noise, a
parked car with the engine running, or a red light) is an app-specific
product decision — the SDK ships a trivial `DefaultTripValidator` that
confirms a trip the moment `start()` is called and never flags anything as
suspicious, so `new DrivingSDK()` works with zero configuration.

```typescript
import type { TripValidator } from '@/lib/driving-sdk/types';

class MyTripValidator implements TripValidator {
  // ...
}

const sdk = new DrivingSDK({ tripValidator: new MyTripValidator() });
```

Full interface, timing details, and the trip state-machine diagram are in
[`docs/trip-lifecycle.md`](./docs/trip-lifecycle.md).

---

## What this SDK deliberately doesn't do

A few native platform capabilities this SDK doesn't wrap — not because the
platform forbids them, but because CARMA hasn't needed them. Full list with
the native API each points at: [`docs/not-in-scope.md`](./docs/not-in-scope.md).

- Raw, unprocessed accelerometer/gyroscope streaming — only derived events are exposed.
- Screen-on / device-locked state — available on Android only, so building on it would behave differently per platform by construction (see `PLATFORM-CAPABILITIES.md`).
- Foreground-app identification — not reliably available on either platform.
- BLE (Bluetooth Low Energy) device scanning — this SDK talks to car head units over Classic Bluetooth only.

---

Developed by May Hajbi.
