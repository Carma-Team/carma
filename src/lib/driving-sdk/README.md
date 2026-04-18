# Carma Driving SDK 🚗📱

The `Carma-Driving-SDK` is a lightweight, modular library for React Native (Expo) designed to track driving behavior using device sensors (GPS, IMU) and Bluetooth connectivity.

## Features
- **Auto-Trip Detection**: Automatically start/stop trips based on Bluetooth connection to car multimedia systems.
- **Sensor Fusion**: Combines GPS data with Accelerometer and Gyroscope (IMU) for precise event detection.
- **Event Recognition**: Detects Hard Braking, Aggressive Acceleration, and Sharp Turns.
- **Background Support**: Designed to work with foreground services for continuous tracking.

## Installation

```bash
# Core dependencies
npx expo install react-native-ble-manager expo-location expo-sensors
```

## Quick Start

```typescript
import { CarmaDrivingSDK } from './driving-sdk';

const sdk = new CarmaDrivingSDK({
  autoStartOnBluetooth: true,
  targetBluetoothId: '00:11:22:33:44:55' // Car's BT ID
});

// Subscribe to events
sdk.onTripStart = (tripId) => {
  console.log('Trip started:', tripId);
};

sdk.onEventDetected = (event) => {
  console.log('Driving Event:', event.type, 'Severity:', event.severity);
};

sdk.onTripEnd = (data) => {
  console.log('Trip Finished! Total Distance:', data.distanceKm);
};
```

## API Reference

### `CarmaDrivingSDK`
Main entry point for the SDK.

#### Methods:
- `startTrip()`: Manually trigger trip recording.
- `stopTrip()`: Stop recording and return trip summary.
- `updateTargetDevice(id)`: Change the Bluetooth device to monitor.
- `getAvailableDevices()`: Returns paired (bonded) Bluetooth devices.

#### Events:
- `onTripStart`: Triggered when sensors begin recording.
- `onTripEnd`: Triggered with final summary data.
- `onEventDetected`: Triggered when an IMU event (e.g., Hard Brake) occurs.
- `onUpdate`: Periodic update with current speed and distance.

---
Developed by May Hajbi as part of the CARMA Project.
