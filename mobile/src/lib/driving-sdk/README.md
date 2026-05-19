# Carma Driving SDK

The `driving-sdk` is a **generic, sensor-layer library** for React Native (Expo). It wraps device hardware — GPS, accelerometer, gyroscope, and Bluetooth — and exposes a unified event-driven API that any mobile application can consume.

This directory is maintained as a self-contained unit and will be extracted into a standalone npm package. **It must not contain any logic that is specific to the CARMA application** (scoring rules, fraud thresholds, gamification, business decisions about what constitutes a valid trip, etc.). Think of it as a third-party dependency: the application layer sits above it and decides what to do with the raw events it emits.

---

## What belongs in this directory

| File / Folder | Responsibility |
|---|---|
| `index.ts` | `CarmaDrivingSDK` — the single public entry point; orchestrates all managers |
| `BluetoothManager.ts` | Connects to a target BLE device; fires `onConnect` / `onDisconnect` callbacks |
| `sensors/SensorManager.ts` | GPS + accelerometer + gyroscope fusion; emits `DrivingEvent` objects and raw telemetry updates |
| `sensors/PhoneUsageManager.ts` | Monitors `AppState` changes; emits `PHONE_USAGE` events while a trip is active |
| `types.ts` | Shared TypeScript types and enums consumed by the SDK (e.g. `DrivingEvent`, `TripData`, `SDKConfig`) |

### Still in development / partial implementation

- `BluetoothManager.ts` — currently a mock that returns hardcoded devices. Production implementation will use `react-native-ble-plx` with real scanning and bonding.
- `sensors/SensorManager.ts` — background mode (foreground service / task) not yet implemented; the sensor loop pauses when the app is backgrounded on Android.
- `onFraudDetected` callback on `CarmaDrivingSDK` — wired up but the underlying detection logic (`TripValidationManager`) currently lives in the wrong location (see below).

---

## What does NOT belong in this directory

**Any file that encodes a decision specific to the CARMA application.**

Concrete examples that must live in `mobile/src/lib/` (the application's own logic layer), not here:

| What it is | Why it does not belong here |
|---|---|
| Trip start/end rules (e.g. "30 s above 10 km/h = trip confirmed") | These are product decisions. A developer using this SDK to build a different app would need completely different rules. |
| Fraud / transport-mode detection with hard-coded thresholds (speed variance, lateral-accel limits, yaw variance, scoring weights) | The thresholds are CARMA-specific constants derived from product requirements (Appendix E). They are not sensor primitives. |
| Gamification levels, point thresholds, multipliers | Entirely unrelated to device sensors or Bluetooth. Pure application business logic. |
| Scoring formulas | Same reason — application-layer concern. |

**Rule of thumb:** if removing the file from this directory and importing it from `@/lib/` instead requires zero changes to the SDK's public API (`CarmaDrivingSDK`, its callbacks, and `types.ts`), then the file does not belong here.

---

## Architecture boundary

```
┌──────────────────────────────────────────┐
│           Application layer              │
│  mobile/src/lib/  ·  mobile/src/context/ │
│  (scoring, fraud detection, validation,  │
│   gamification — CARMA-specific logic)   │
│                                          │
│  consumes ↓ events, feeds ↑ config       │
├──────────────────────────────────────────┤
│              driving-sdk/                │
│  BluetoothManager · SensorManager        │
│  PhoneUsageManager · CarmaDrivingSDK     │
│                                          │
│  emits: DrivingEvent, TripData, raw      │
│  telemetry — no business decisions here  │
├──────────────────────────────────────────┤
│           Device hardware                │
│  GPS · Accelerometer · Gyroscope · BLE   │
└──────────────────────────────────────────┘
```

The SDK emits raw events. The application layer interprets them.

---

## Installation

```bash
npx expo install expo-location expo-sensors react-native-ble-plx
```

## Quick Start

```typescript
import { CarmaDrivingSDK } from '@/lib/driving-sdk';

const sdk = new CarmaDrivingSDK({
  autoStartOnBluetooth: true,
  targetBluetoothId: '00:11:22:33:44:55',
});

sdk.onTripStart = (tripId) => console.log('Trip started:', tripId);

sdk.onEventDetected = (event) => {
  // event.type: HARD_BRAKE | AGGRESSIVE_ACCEL | SHARP_TURN | PHONE_USAGE
  // event.severity: 0.0–1.0
  // Your application decides what to do with this — score it, log it, show UI, etc.
  console.log('Driving event:', event.type, event.severity);
};

sdk.onTripEnd = (data) => {
  // data: TripData — raw distance, duration, events[], speeds
  // Pass to your application's scoring / persistence layer.
  console.log('Trip ended. Distance:', data.distanceKm, 'km');
};
```

## API Reference

### `CarmaDrivingSDK`

Main entry point. Instantiate once per app lifecycle (singleton recommended).

#### Constructor

```typescript
new CarmaDrivingSDK(config?: SDKConfig)
```

`SDKConfig`:
| Field | Type | Default | Description |
|---|---|---|---|
| `autoStartOnBluetooth` | `boolean` | `true` | Start trip automatically when target BT device connects |
| `targetBluetoothId` | `string \| null` | — | BLE device ID to monitor |
| `sensorUpdateInterval` | `number` (ms) | `1000` | Sensor polling interval |
| `scoringEnabled` | `boolean` | `true` | Reserved — passed through to application callbacks |

#### Methods

| Method | Returns | Description |
|---|---|---|
| `startTrip()` | `Promise<string>` | Manually start a trip; returns trip ID |
| `stopTrip()` | `Promise<TripData \| null>` | Stop recording; returns final trip data |
| `updateTargetDevice(id)` | `void` | Change the BLE device to monitor at runtime |
| `getAvailableDevices()` | `Promise<BluetoothDevice[]>` | Returns paired (bonded) BLE devices |
| `getStatus()` | `object` | Returns `{ isActive, isValidating, tripData }` |

#### Callbacks (set directly on the instance)

| Callback | Signature | Description |
|---|---|---|
| `onTripStart` | `(tripId: string) => void` | Fired when sensor recording begins |
| `onTripEnd` | `(data: TripData) => void` | Fired with final trip summary |
| `onEventDetected` | `(event: DrivingEvent) => void` | Fired on each IMU/phone event |
| `onUpdate` | `(data: TripData) => void` | Periodic update (~1 Hz) with current speed and distance |
| `onFraudDetected` | `(event: FraudDetectedEvent) => void` | Fired when the validation layer suspects non-car transport |

#### Debug / simulation helpers

| Method | Description |
|---|---|
| `simulateBluetoothConnection()` | Triggers `onConnect` without a real BLE device |
| `simulateBluetoothDisconnection()` | Triggers `onDisconnect` |
| `debugAddDistance(km)` | Injects distance into the active trip (dev only) |

---

Developed by May Hajbi as part of the CARMA Project.
