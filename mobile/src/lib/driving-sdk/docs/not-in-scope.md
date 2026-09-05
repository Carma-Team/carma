Current behaviour.

# Not in scope

Part of [`driving-sdk`](../README.md) — native platform capabilities this SDK
deliberately doesn't wrap, and why.

[`PLATFORM-CAPABILITIES.md`](../PLATFORM-CAPABILITIES.md) is about what the
**platform allows**. This file is about what this library **chose not to
own** on top of what's allowed — a different question. Nothing listed here is
unavailable, and nothing is blocked by the platform: each row is a scope
decision, made because the capability sits outside measuring how a vehicle is
driven and how the phone is handled while it moves. If your app needs one,
the native API is named in the second column and nothing here stands in the
way of calling it directly.

| Capability | Native API | Why it's not in this SDK |
|---|---|---|
| Screen-on / device-locked state (Android) | `PowerManager.isInteractive()`, `KeyguardManager.isKeyguardLocked()` | Available on Android, not on iOS — see `PLATFORM-CAPABILITIES.md`. A feature built on an Android-only signal means two different things on the two platforms for the same driver behaviour, which is why distraction detection here stays motion-only on both. |
| Foreground-app identification | `UsageStatsManager` (Android, requires manual Settings opt-in) | Not reliably available on either platform even where it technically exists — not worth the permission friction for a signal nothing here consumes. |
| BLE (Bluetooth Low Energy) device scanning | `react-native-ble-plx` or similar | This SDK talks to car head units over Classic Bluetooth (BR/EDR) only, since that's the profile family car audio and hands-free systems use — see the README's "Why Bluetooth auto-start is Android-only" section. BLE scanning serves a different purpose: a wearable, or an OBD-II dongle, would want it. |
| Background BLE beacon ranging | `expo-task-manager` + a BLE library's background mode | Same reasoning as above — no BLE surface here, so no background-BLE plumbing. |
| Step counting / pedometer | `expo-sensors`' `Pedometer` | Orthogonal to driving detection. A host distinguishing walking or transit from driving would consume it, but that is a classification the application layer owns, not a sensor this library wraps. |
