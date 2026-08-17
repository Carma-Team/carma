Current behaviour.

# Not in scope

Part of [`driving-sdk`](../README.md) — native platform capabilities this SDK
deliberately doesn't wrap, and why.

[`PLATFORM-CAPABILITIES.md`](../PLATFORM-CAPABILITIES.md) is about what the
**platform allows**. This file is about what **CARMA chose not to build** on
top of what's allowed — a different question. Something listed here isn't
unavailable; it just wasn't worth the SDK owning, given what CARMA actually
needs today. If your own app needs one of these, the native API is right
there — nothing here is blocked by the platform, only by scope.

| Capability | Native API | Why it's not in this SDK |
|---|---|---|
| Raw, unprocessed accelerometer/gyroscope stream | `expo-sensors`' `Accelerometer`/`Gyroscope` directly | The SDK only exposes derived events (`DrivingEventType`) and a few telemetry fields (`accelX`/`gyroZ` on `onUpdate`) — CARMA has never needed the raw 10 Hz stream itself, only what's derived from it. |
| Screen-on / device-locked state (Android) | `PowerManager.isInteractive()`, `KeyguardManager.isKeyguardLocked()` | Available on Android, not on iOS — see `PLATFORM-CAPABILITIES.md`. Building a feature on an Android-only signal produces two different meanings for the same behavior across platforms, which CARMA's hand-held detection deliberately avoids by staying motion-only on both. |
| Foreground-app identification | `UsageStatsManager` (Android, requires manual Settings opt-in) | Not reliably available on either platform even where it technically exists — not worth the permission-friction for a signal this SDK doesn't currently need. |
| BLE (Bluetooth Low Energy) device scanning | `react-native-ble-plx` or similar | This SDK talks to car head units over Classic Bluetooth (BR/EDR) only, since that's the profile family car audio/hands-free systems use — see the README's "Why Bluetooth auto-start is Android-only" section. BLE scanning is a different use case CARMA hasn't needed (e.g. a wearable or OBD-II dongle would want it). |
| Background BLE beacon ranging | `expo-task-manager` + a BLE library's background mode | Same reasoning as above — no BLE use case in CARMA today, so no background-BLE plumbing exists. |
| Step counting / pedometer | `expo-sensors`' `Pedometer` | Orthogonal to driving detection; CARMA has no walking/transit feature that would consume it. |
