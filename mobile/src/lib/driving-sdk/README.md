# Driving SDK

The `driving-sdk` is a **generic, sensor-layer library** for React Native (Expo). It wraps device hardware — GPS, accelerometer, gyroscope, and Bluetooth — and exposes a unified, event-driven API that any mobile application can consume.

This directory is maintained as a self-contained unit and will be extracted into a standalone npm package. **It must not contain any logic specific to any application** (scoring rules, fraud thresholds, gamification, business decisions about what constitutes a valid trip, etc.). Think of it as a third-party dependency: the application layer sits above it and decides what to do with the raw events it emits.

---

## Platform Support

| Feature | Android | iOS |
|---|---|---|
| GPS & IMU sensors | ✅ | ✅ |
| Bluetooth bonded device listing | ✅ | ❌ |
| Automatic connect / disconnect events | ✅ | ❌ |

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
| `sensors/PhoneUsageManager.ts` | IMU-based hand-held detection (`AppState` + accelerometer variance); emits `touchEpochs`/`screenInteractionSeconds` and `PHONE_USAGE` events while a trip is active |
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
│  PhoneUsageManager                                           │
│                                                              │
│  Detects physical events (planar accel > 0.45g, gyro > 2 rad/s) │
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

| Value | Sensor | Description |
|---|---|---|
| `HARD_BRAKE` | Accelerometer | Sudden deceleration — planar force > 0.45g |
| `AGGRESSIVE_ACCEL` | Accelerometer | Sudden acceleration — planar force > 0.45g |
| `SHARP_TURN` | Gyroscope | Fast rotation — magnitude > 2.0 rad/s |
| `PHONE_USAGE` | AppState + IMU variance cross-confirm | App backgrounded (Home button / app switch / Siri / call / Control Center) **and** accelerometer variance indicates the phone is hand-held, not just mounted — fires once per pickup, not per background transition |

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
}
```

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
  waypoints:              RouteWaypoint[];  // GPS track, ~5-second intervals
  averageSpeed:           number;           // km/h
  maxSpeed:               number;           // km/h
  touchEpochs:            number;           // glass-tap proxy count (IMU)
  screenInteractionSeconds: number;         // IMU-confirmed hand-held seconds
}
```

> **Note:** `events` contains every event that passed the SDK's internal cooldown guard — it is **not** filtered by any `on()` listener conditions. If your app only wants to count events that met a scoring threshold, maintain your own counter in the relevant `on()` handler.

---

## Sensor internals

### Accelerometer — `SensorManager`

- Sampling rate: **10 Hz** (100 ms interval)
- Gravity isolation: **EMA low-pass filter** (α = 0.8, ~0.5 s time constant)
- Detection metric: **planar magnitude** `√(dx² + dy²)` — Z axis (vertical) excluded to prevent road bumps and phone tilts from triggering events
- Detection threshold: **0.45g** (gravity-removed)
- Severity mapping: `0.45g → 0.0`, `1.45g → 1.0`, clamped to `[0, 1]`

### Gyroscope — `SensorManager`

- Sampling rate: **10 Hz**
- Detection metric: full rotation magnitude `√(x² + y² + z²)` rad/s — works regardless of phone orientation
- Detection threshold: **2.0 rad/s** (~115°/s — a fast lane-change or aggressive swerve)
- Severity mapping: `2.0 rad/s → 0.0`, `5.0 rad/s → 1.0`, clamped to `[0, 1]`

### GPS — `SensorManager`

- Update interval: **2 s** / **5 m** (whichever comes first, `Accuracy.High` — GPS chip only, no network/cell fallback)
- Distance: Haversine formula between consecutive samples
- Speed: from `loc.coords.speed` (m/s → km/h), floored at 0
- Distance gate: ticks below **3 km/h** do not accumulate distance (eliminates coordinate jitter when stationary)
- Teleportation guard: each tick's distance contribution is capped to `(speed / 3600) × timeDeltaS × 1.5 km`. If the Haversine result exceeds this cap (e.g. a GPS position jump while stationary), the capped value is used instead.

### Per-event cooldown

After an event of a given type fires, the same type is suppressed for **500 ms**. Each type has an independent cooldown window — a `SHARP_TURN` does not suppress a concurrent `HARD_BRAKE`.

### Warm-up guard

The first **3 seconds** after `startTrip()` all sensor events are dropped. This eliminates spurious spikes caused by the physical act of pressing the start button.

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
