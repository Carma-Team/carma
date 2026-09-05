Current behaviour.

# Driving SDK

**Last updated: 2026-09-05**

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

#### The event shape, and the patch it depends on

`react-native-bluetooth-classic` wraps every connect and disconnect event as
`{ device, eventType, timestamp }` — the device is one level down, not on the event itself.
Reading `event.address` instead of `event.device.address` yields `undefined` rather than an
error, so the subscription looks healthy and simply never matches the target.

**More important, and easy to lose:** upstream declares a `DEVICE_CONNECTED` event but never
emits it. This library depends on a patch — applied through `patch-package` in the host app's
`postinstall` — that forwards Android's `ACTION_ACL_CONNECTED` broadcast into that event.
**Without the patch, connection is never detected on any Android device**, and nothing fails
loudly: the app simply never starts a trip on its own. A host adopting this library must
carry the patch, or supply its own detection strategy.

---

## Build Requirements

Bluetooth features require a **development build** (`expo-dev-client`). They are **not compatible with Expo Go**, which does not include the native Bluetooth module.

Location and motion are imported at module scope, so they are required for the library to
load at all. Calibration recording is the exception: `expo-file-system` and `expo-sharing`
are resolved on first use, so a host that never records a staged session does not need them.

```bash
npx expo install expo-location expo-task-manager expo-sensors
npx expo install react-native-bluetooth-classic   # Android automatic detection only
npx expo install expo-file-system expo-sharing    # calibration recording only
```

`react-native-bluetooth-classic` is guarded at runtime and does nothing on iOS, but it is
imported at module scope, so it must be installed even on an iOS-only host.

---

## What belongs in this directory

Every file in the library, each row copied from that file's own `@brief` header. The
header is the current one and is written by whoever changes the file; this table follows
it, never the other way round.

| File | Responsibility |
|---|---|
| `index.ts` | The SDK's public entry point and orchestrator, `DrivingSDK`. Owns the trip lifecycle, accumulates distance/speed/waypoints from the sensor stream, and emits driving events to whatever host app is consuming the library. |
| `types.ts` | Every type and interface the library exposes to its host app. Driving events, `TripData`, `SDKConfig`, and the pluggable `TripValidator` contract through which an app injects its own trip-start, trip-end and suspicion rules. |
| `auto-trip-detection/types.ts` | The contract every automatic trip-detection method implements. One strategy is active at a time, picked per platform, and `DrivingSDK` never learns which. |
| `auto-trip-detection/AutoDriveModeManager.ts` | Owns the one active trip-detection strategy and picks it per platform. Turns whatever that strategy noticed into the two calls `DrivingSDK` cares about. |
| `auto-trip-detection/BluetoothDriveModeStrategy.ts` | Detects vehicle travel from a paired Bluetooth device connecting. Android only. Subscribes to the OS-level connect/disconnect broadcasts for one target device, which is how a trip can start and end without the driver touching the phone. |
| `auto-trip-detection/bluetoothDevices.ts` | Android Bluetooth device listing and permissions, holding no monitoring state. Answers which devices can be picked, and — when none can — why the list is empty. |
| `auto-trip-detection/IosDriveModeStrategy.ts` | Placeholder for iOS automatic trip detection. Detects nothing yet: an iPhone still starts trips from the manual button. |
| `DefaultTripValidator.ts` | The no-op `TripValidator` the SDK falls back to when the host supplies none. Confirms a trip immediately and never evaluates suspicion, so the library works standalone with zero configuration. |
| `PowerManagement.ts` | Detects the platform where OS background throttling can degrade GPS cadence, and opens the system settings screen from which the user can lift it. Holds no opinion on when to ask or what to say — that is host-app UX. |
| `sensors/SensorManager.ts` | Detects hard braking, aggressive acceleration and sharp turns from a GPS+IMU fusion that does not depend on how the phone is oriented in the vehicle. Also resolves the IMU into the vehicle's own frame and streams speed, distance and those vehicle-frame values to the SDK on every fix. |
| `sensors/vehicleFrame.ts` | Resolves phone-frame IMU readings into the vehicle's frame: horizontal force split into signed longitudinal and lateral components, and angular rate about gravity. |
| `sensors/PhoneUsageManager.ts` | Detects a phone actively held in the hand, using IMU variance, a glass-tap proxy and a paired gyroscope tap signature. Reports tap counts and hand-held seconds, and deliberately does not count a mounted phone running a navigation app in the background. |
| `sensors/RawSampleRecorder.ts` | Records the full, unthinned accel/gyro/magnetometer/GPS sample stream to a file for a staged calibration session, tagged with a scenario and platform label. Accel, gyro and GPS are pushed in by `DrivingSDK`; the magnetometer is the one stream it subscribes to itself, for the length of the session only. |
| `sensors/locationTask.ts` | Defines the TaskManager task that receives background location updates. Forwards each fix to the handler `SensorManager` registers, so distance keeps counting while the app is backgrounded or the phone is locked. |
| `DeviceCapabilities.ts` | One-shot startup probe of what the device can actually do: which motion sensors it exposes, and whether its OS meets the floor recorded in [`PLATFORM-CAPABILITIES.md`](./PLATFORM-CAPABILITIES.md). Reports what it finds and stops there — whether a missing sensor blocks the user is a host-app decision. |

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
│  DrivingSDK · SensorManager · PhoneUsageManager              │
│  DefaultTripValidator · auto-trip-detection/                 │
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
| `minSeverity` | `number` | `0` (no gate) | Event severity [0–1] must be ≥ this value. **`PHONE_USAGE` only** — motion events carry no severity, so this condition is ignored rather than blocking them |

### `DrivingEventType`

| Value | Detected from | Description |
|---|---|---|
| `HARD_BRAKE` | GPS (IMU cross-confirm) | Deceleration ≥ `motionThresholds.brakeThresholdMs2` (default 2.7 m/s²) |
| `AGGRESSIVE_ACCEL` | GPS (IMU cross-confirm) | Acceleration ≥ `motionThresholds.accelThresholdMs2` (default 3.0 m/s²) |
| `SHARP_TURN` | GPS heading rate × speed (IMU cross-confirm) | Lateral accel ≥ `motionThresholds.turnThresholdMs2` (default 3.5 m/s²) |
| `PHONE_USAGE` | Accelerometer + gyroscope variance | IMU variance indicates the phone is hand-held, whichever app is in front — the library never asks the OS what the driver is doing, only how the phone is moving. Fires once per hand-held stretch, not once per second. **Requires the process to keep receiving sensor events**: Android delivers none to a backgrounded app without a foreground service, and iOS delivers none while the app is suspended. See [`docs/event-detection.md`](./docs/event-detection.md) for the full detection logic. |

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
| `autoStartOnBluetooth` | `boolean` | `true` | Start a trip automatically when detection fires. Named for the Android mechanism, but it gates every platform's. |
| `targetBluetoothId` | `string \| null` | — | What detection watches for — a MAC address on Android. |
| `motionThresholds` | `Partial<MotionThresholds>` | `DEFAULT_MOTION_THRESHOLDS` | Tune HARD_BRAKE / AGGRESSIVE_ACCEL / SHARP_TURN sensitivity (m/s²) without editing the SDK. Any field omitted falls back to the default. |
| `tripValidator` | `TripValidator` | `DefaultTripValidator` (confirms/ends trips immediately) | Plug in app-specific rules for when a trip actually starts/ends, and suspicious-activity detection. See [`docs/trip-lifecycle.md`](./docs/trip-lifecycle.md). |

#### Methods

| Method | Returns | Description |
|---|---|---|
| `startTrip()` | `Promise<string>` | Manually start a trip; returns the trip ID — or the string `'ALREADY_ACTIVE'` if one is already running, which is a sentinel and not an ID |
| `stopTrip()` | `Promise<TripData \| null>` | Stop recording and stop the validator; returns final trip data |
| `on(type, condition, handler)` | `ListenerToken` | Subscribe to a sensor event with conditions |
| `off(token)` | `void` | Unsubscribe a registered listener |
| `updateTargetDevice(id)` | `void` | Change the device automatic detection watches for, at runtime. `null` disarms it. **Accepted and ignored on iOS**, where detection is not Bluetooth-based — see the platform table above. |
| `getAvailableDevices()` | `Promise<BluetoothDevice[]>` | Returns OS-bonded BT devices (Android only) |
| `getBTSupportStatus()` | `Promise<{ nativeAvailable, btAvailable, btEnabled, permissionsGranted }>` | Why the device list is empty, as four booleans — the native module missing, no adapter, adapter off, or permissions refused |
| `getStatus()` | `object` | Returns `{ isActive, isValidating, tripData }` |

#### Lifecycle callbacks

| Callback | Signature | Description |
|---|---|---|
| `onTripStart` | `(tripId: string) => void` | Fired when sensor recording begins |
| `onTripEnd` | `(data: TripData) => void` | Fired with final trip summary |
| `onUpdate` | `(data: TripData) => void` | Current trip snapshot. **Not a fixed cadence** — see below |
| `onEventDetected` | `(event: DrivingEvent) => void` | Fired for every SDK-qualified event (no conditions). Use `on()` for conditional logic. |
| `onInteractionData` | `(data: InteractionData) => void` | One phone-handling sample per second, stamped with the speed observed for that second |
| `onFraudDetected` | `(event: FraudDetectedEvent) => void` | Fired when the validation layer suspects non-car transport |
| `onRegionRejected` | `() => void` | Fired when a validator rejects the trip on where it started. The session is torn down silently; `onTripEnd` does **not** fire |

#### What `onUpdate` actually promises

It fires on **any** change to the trip snapshot, from five places: a one-second wall-clock
timer, every qualified event, every per-second interaction sample, every sensor update, and
the debug distance helper. In steady state that is closer to 2.5–3 Hz than to 1 Hz, and it
bursts around events. **Treat it as "something changed", never as a clock.**

One of those sensor updates is not a GPS fix at all. Every two seconds, once the held speed
has decayed to zero, the library emits an update carrying no new position — see *Speed after
a GPS dropout* below. A host counting fixes off `onUpdate`, or reading it as "a fresh fix
arrived", will be wrong on both counts.

#### Speed after a GPS dropout

When the platform reports speed as unavailable the last known-good value is held rather than
clamped to zero, because a clamp reads as a real deceleration to a standstill. The held value
decays to zero after 10 s without a valid reading, and a 2 s tick reports that it has — which
is what stops a sustained dropout from pinning the reported speed above a consumer's
"stopped" threshold indefinitely.

**On iOS this tick is the only way a stop is ever observed**, because the platform delivers
no location update while the device is stationary. It also does not run while the app is
backgrounded and suspended; it corrects itself against wall clock as soon as the app is
resumed.

`onInteractionData` reports the speed, it never interprets it: a second of handling at
walking pace and one at motorway speed arrive the same way, and deciding which of them
counts is the host's. `TripData.screenInteractionSeconds` is the ungated sum of that same
stream, so a host that applies its own speed rule must count from this callback rather
than read the total.

#### Debug helpers

| Method | Description |
|---|---|
| `simulateBluetoothConnection()` | Runs the auto-start path without a physical device |
| `simulateBluetoothDisconnection()` | Runs the auto-end path without a physical device |
| `debugAddDistance(km)` | Injects distance into the active trip (dev only) |

#### Calibration recording

Records real sensor data for a staged session (phone handheld / on-seat / in-pocket /
mounted) — not a simulation, and independent of `startTrip`/`stopTrip`. It exists so that
thresholds this library cannot derive from first principles can be fitted against drives
where the answer is known in advance.

| Method | Description |
|---|---|
| `startRawRecording(scenario, platform, deviceModel?)` | Starts recording the raw accel/gyro/magnetometer/GPS stream, tagged with caller-supplied labels. Writes a `session_start` header as the file's first line. Called while a session is already running, it leaves that session alone |
| `stopRawRecording()` | Ends the session and flushes what is left to its NDJSON file under app storage. Throws if that write fails, leaving the session recording so the caller can retry rather than losing the tail silently |
| `markRawRecording(markerType, label?, metadata?)` | Places a labelled point in the running session. False when nothing is recording, or when the session already hit its line cap, so a UI can tell a recorded marker from a dropped tap |
| `changeRawRecordingScenario(scenario)` | Re-labels the running session from here on, leaving a `scenario_change` marker where it changed — one drive can cover two mount positions without being split. The `session_start` header keeps the scenario the session opened with, so a mixed drive is indexed under that one |
| `exportRawRecording(filePath?)` | Shares a recording via the OS share sheet: the file at `filePath`, or the most recent one, falling back to the newest on disk when none was made in this app run. On failure returns `RawExportFailure`, which is `{ error: 'none-recorded' }` when there is nothing to share and `{ error: 'sharing-unavailable' }` when the device has no share sheet — two cases a caller usually wants to report differently |
| `listRawRecordings()` | Completed recordings on disk, newest first, including sessions from earlier app runs. The file of a **live** session is created up front but stays out of this list: it is a truncated prefix of the drive being recorded, and a host that offered it for export or upload would ship that prefix as if it were the drive |

**A word on stopping.** `stopRawRecording()` rejects if the final write fails, and leaves the
session recording so the caller can retry rather than lose the tail silently. The sensors
stay subscribed in that case as well — a caller that catches the error and gives up owns
shutting them down.

#### The file

One JSON object per line (NDJSON), under the app's document directory:

```jsonc
{"t":1724608000100,"kind":"accel","accel":{"x":0.01,"y":-0.02,"z":0.98}}
{"t":1724608000100,"kind":"gyro","gyro":{"x":0,"y":0,"z":0.004}}
{"t":1724608000100,"kind":"mag","mag":{"x":21.4,"y":-8.1,"z":43.9}}
{"t":1724608002000,"kind":"location","location":{"lat":32.07,"lng":34.78,"speed":12.4,"accuracy":5}}
```

`t` is wall-clock milliseconds, stamped per sample rather than batched under one tick.
Accelerometer, gyroscope and magnetometer are requested at 10 Hz; location arrives at
whatever cadence the platform delivers. The magnetometer (microtesla) is sampled only while
a staged session is open — a normal trip subscribes to it not at all. 10 Hz is a request and
not a guarantee: a staged Android session measured 8.6 Hz on the magnetometer against the
accelerometer's 9.3 in the same window.

Samples reach the file **while the session is still running** — every 1 000 lines, which at
the ~30 lines/s of three 10 Hz channels is roughly every 33 seconds, so an app kill costs
that interval rather than the whole session. One session is capped at 200 000 lines, about
1.9 hours at the same rate, and the five newest recordings are kept — starting a session
deletes the rest.

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
  accelCoverage:          number;           // 0–1 share of the trip the accelerometer actually delivered samples for
  accelInitFailed:        boolean;          // true only if accelerometer registration itself threw
}
```

> **Note:** `events` contains every event that passed the SDK's internal cooldown guard — it is **not** filtered by any `on()` listener conditions. If your app only wants to count events that met a scoring threshold, maintain your own counter in the relevant `on()` handler.

---

## Other exported surface

Smaller pieces a host reaches for once it does anything beyond consuming events.

| Export | From | What it is |
|---|---|---|
| `SENSOR_STALE_MS` | entry point | **5000.** How long a sensor may go without delivering a sample before it stops counting as available. This is the cutoff behind `accelAvailable` / `gyroAvailable` on every sample, so a validator reasoning about sensor honesty needs the same number the library used |
| `ValidationState` | entry point | The trip state machine's states, for a host that mirrors them in its own UI |
| `RawExportFailure` | entry point | `{ error: 'none-recorded' }` or `{ error: 'sharing-unavailable' }` — see *Calibration recording* |
| `checkDeviceCapabilities()` | `./DeviceCapabilities` | One-shot startup probe: which motion sensors the device exposes, and whether its OS meets the floor in [`PLATFORM-CAPABILITIES.md`](./PLATFORM-CAPABILITIES.md). Reports and stops there — whether a missing sensor should block the user is the host's call |
| `isBackgroundThrottlingRiskPlatform()`, `openAppSystemSettings()` | `./PowerManagement` | A platform check and a settings deep link, for building your own battery-optimisation nudge |

The last two rows are reached by path rather than from the entry point, which is a wrinkle
of the current export surface rather than a deliberate distinction.

**Sensor availability is three-valued, not two.** `accelAvailable: false` on its own does not
say why: the hardware may be absent, the subscription may have failed to register, or samples
may simply have stopped arriving. `accelInitFailed` separates the second case, and
`accelCoverage` — the 0–1 share of the trip the accelerometer actually delivered for — separates
the third. A sensor that was never sampled is not a sensor that read zero, and a consumer
that collapses them will read a dead sensor as a perfectly smooth drive.

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
one — a manual `stopTrip()`, a Bluetooth disconnect, an abort after `onFraudSuspected`,
and an abort after `onRegionRejected`. Those four are exhaustive, so `stop()` is the
single place an implementation tears down whatever it holds — a ticker, a sliding
window, accumulated state — and every trip is guaranteed to start against a clean
validator.

Full interface, timing details, and the trip state-machine diagram are in
[`docs/trip-lifecycle.md`](./docs/trip-lifecycle.md).

---

## What this SDK deliberately doesn't do

A few native platform capabilities this SDK doesn't wrap — not because the
platform forbids them, but because nothing it measures has needed them. Full
list with the native API each points at: [`docs/not-in-scope.md`](./docs/not-in-scope.md).

- Screen-on / device-locked state — available on Android only, so building on it would behave differently per platform by construction (see `PLATFORM-CAPABILITIES.md`).
- Foreground-app identification — not reliably available on either platform.
- BLE (Bluetooth Low Energy) device scanning — this SDK talks to car head units over Classic Bluetooth only.

---

Developed by May Hajbi.
