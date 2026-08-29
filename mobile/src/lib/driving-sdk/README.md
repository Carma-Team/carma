Current behaviour.

# Driving SDK

**Last updated: 2026-08-29**

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

Calibration recording (`startRawRecording`/`exportRawRecording`) writes to disk and
shares via the OS share sheet — needs `expo-file-system` and `expo-sharing`.

```bash
npx expo install react-native-bluetooth-classic
npx expo install react-native-maps
npx expo install expo-file-system expo-sharing
```

---

## What belongs in this directory

Every file in the library, each row copied from that file's own `@brief` header. The
header is the current one and is written by whoever changes the file; this table follows
it, never the other way round.

| File | Responsibility |
|---|---|
| `index.ts` | The SDK's public entry point and orchestrator, `DrivingSDK`. Owns the trip lifecycle, accumulates distance/speed/waypoints from the sensor stream, and emits driving events to whatever host app is consuming the library. |
| `types.ts` | Every type and interface the library exposes to its host app. Driving events, `TripData`, `SDKConfig`, and the pluggable `TripValidator` contract through which an app injects its own trip-start, trip-end and suspicion rules. |
| `BluetoothManager.ts` | Classic Bluetooth device monitoring, Android only. Lists OS-bonded devices and emits connect/disconnect for the chosen target device, which is how a trip can start and end without the driver touching the phone. |
| `DefaultTripValidator.ts` | The no-op `TripValidator` the SDK falls back to when the host supplies none. Confirms a trip immediately and never evaluates suspicion, so the library works standalone with zero configuration. |
| `PowerManagement.ts` | Detects the platform where OS background throttling can degrade GPS cadence, and opens the system settings screen from which the user can lift it. Holds no opinion on when to ask or what to say — that is host-app UX. |
| `sensors/SensorManager.ts` | Detects hard braking, aggressive acceleration and sharp turns from a GPS+IMU fusion that does not depend on how the phone is oriented in the vehicle. Also resolves the IMU into the vehicle's own frame and streams speed, distance and those vehicle-frame values to the SDK on every fix. |
| `sensors/vehicleFrame.ts` | Resolves phone-frame IMU readings into the vehicle's frame: horizontal force split into signed longitudinal and lateral components, and angular rate about gravity. |
| `sensors/PhoneUsageManager.ts` | Detects a phone actively held in the hand, using IMU variance and a glass-tap proxy. Reports tap count and hand-held seconds, and deliberately does not count a mounted phone running a navigation app in the background. |
| `sensors/RawSampleRecorder.ts` | Records the full, unthinned accel/gyro/GPS sample stream to a file for a staged calibration session, tagged with a scenario and platform label. |
| `sensors/locationTask.ts` | Defines the TaskManager task that receives background location updates. Forwards each fix to the handler `SensorManager` registers, so distance keeps counting while the app is backgrounded or the phone is locked. |

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
  // PHONE_USAGE only — motion events carry physical measurements instead, below.
  severity?: number;            // PHONE_USAGE only — currently a hardcoded 0.5, see below
  speedKmh?: number;            // GPS speed at detection time (stamped by DrivingSDK)
  location?: { latitude: number; longitude: number }; // GPS coordinates at detection time
  // Motion events only — absent on PHONE_USAGE, and absent when the vehicle frame
  // could not be resolved:
  peakLongitudinalG?: number;   // g, signed — positive forward, so a brake is negative
  peakLateralG?:      number;   // g, signed — positive to the left of travel
  durationMs?:        number;   // how long the force stayed above the IMU cross-confirm threshold
}
```

`severity` on `PHONE_USAGE` events is currently a hardcoded `0.5` — `motionThresholds`
has no effect on it, since that config only tunes the motion-event thresholds
(HARD_BRAKE/AGGRESSIVE_ACCEL/SHARP_TURN), not PHONE_USAGE.

`peakLongitudinalG` and `peakLateralG` are **physical measurements, not a score**. They are
the peak force of the event resolved onto the vehicle's own axes, which is what makes a brake
distinguishable from a turn at the point of measurement — an unsigned horizontal magnitude
folds the two together and cannot be mapped onto any per-axis severity curve. Turning them
into a severity is the consuming application's job; a scoring curve does not belong in a
sensor library.

Both are **absent, not zero**, when the frame could not be resolved. The forward direction is
learned from ordinary driving — agreement between GPS speed changes and the force felt over
them — so it takes a few real accelerations or brakes at the start of a trip, and it is
relearned from scratch if the phone is picked up or re-mounted mid-trip.

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
| `motionThresholds` | `Partial<MotionThresholds>` | `DEFAULT_MOTION_THRESHOLDS` | Tune HARD_BRAKE / AGGRESSIVE_ACCEL / SHARP_TURN sensitivity (m/s²) without editing the SDK. Any field omitted falls back to the default. |
| `tripValidator` | `TripValidator` | `DefaultTripValidator` (confirms/ends trips immediately) | Plug in app-specific rules for when a trip actually starts/ends, and suspicious-activity detection. See [`docs/trip-lifecycle.md`](./docs/trip-lifecycle.md). |

#### Methods

| Method | Returns | Description |
|---|---|---|
| `startTrip()` | `Promise<string>` | Manually start a trip; returns trip ID |
| `stopTrip()` | `Promise<TripData \| null>` | Stop recording and stop the validator; returns final trip data |
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
| `onInteractionData` | `(data: InteractionData) => void` | One phone-handling sample per second, stamped with the speed observed for that second |
| `onFraudDetected` | `(event: FraudDetectedEvent) => void` | Fired when the validation layer suspects non-car transport |

`onInteractionData` reports the speed, it never interprets it: a second of handling at
walking pace and one at motorway speed arrive the same way, and deciding which of them
counts is the host's. `TripData.screenInteractionSeconds` is the ungated sum of that same
stream, so a host that applies its own speed rule must count from this callback rather
than read the total.

#### Debug helpers

| Method | Description |
|---|---|
| `simulateBluetoothConnection()` | Fires the BT connect callback without a physical device |
| `simulateBluetoothDisconnection()` | Fires the BT disconnect callback without a physical device |
| `debugAddDistance(km)` | Injects distance into the active trip (dev only) |

#### Calibration recording

Records real sensor data for a staged session (phone handheld / on-seat / in-pocket /
mounted) — not a simulation, and independent of `startTrip`/`stopTrip`. Feeds CAR-31's
labelled-drive-data collection and the hand-held-vs-loose calibration CAR-46/CAR-183
need.

| Method | Description |
|---|---|
| `startRawRecording(scenario, platform)` | Starts recording the raw accel/gyro/GPS stream, tagged with caller-supplied labels |
| `stopRawRecording()` | Stops and flushes the session to an NDJSON file under app storage |
| `exportRawRecording()` | Shares the last completed recording via the OS share sheet; `{ error: 'none-recorded' \| 'sharing-unavailable' }` on failure |

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
  waypoints:              RouteWaypoint[];  // GPS track, one point every 2s of elapsed GPS-fix time while moving
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

### Lifecycle contract

The SDK calls `start()` when a session begins, and `stop()` on **every** route out of
one — a manual `stopTrip()`, a Bluetooth disconnect, and an abort after
`onFraudSuspected`. There is no fourth way for a session to end, so `stop()` is the
single place an implementation tears down whatever it holds — a ticker, a sliding
window, accumulated state — and every trip is guaranteed to start against a clean
validator.

Full interface, timing details, and the trip state-machine diagram are in
[`docs/trip-lifecycle.md`](./docs/trip-lifecycle.md).

---

## What this SDK deliberately doesn't do

A few native platform capabilities this SDK doesn't wrap — not because the
platform forbids them, but because CARMA hasn't needed them. Full list with
the native API each points at: [`docs/not-in-scope.md`](./docs/not-in-scope.md).

- Screen-on / device-locked state — available on Android only, so building on it would behave differently per platform by construction (see `PLATFORM-CAPABILITIES.md`).
- Foreground-app identification — not reliably available on either platform.
- BLE (Bluetooth Low Energy) device scanning — this SDK talks to car head units over Classic Bluetooth only.

---

Developed by May Hajbi.
