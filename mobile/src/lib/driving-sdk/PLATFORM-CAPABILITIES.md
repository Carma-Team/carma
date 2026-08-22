Current behaviour.

# Platform capabilities — what a mobile app can actually observe

**What this file is:** a record of what iOS and Android permit an ordinary,
App-Store-distributable app to observe about phone handling, and what this SDK
therefore does and does not measure.

**Why it exists separately from `README.md`:** every answer here has an
expiry date. Platform policy moves, and a claim like "iOS does not expose this"
is only useful if a reader can see when it was last checked and against what.
The README describes the library; this file describes the ground it stands on.

**Last verified: 2026-08-15.** Verified against `expo` ~54.0.34,
`expo-sensors` ~15.0.8, `expo-location` ~19.0.8.

---

## The boundary that shapes everything else

**No app can observe touch events delivered to a different app.** This is an
operating-system security boundary on both platforms, not a gap in any
particular implementation. It applies to every app on the store equally.

Consequently, a library like this one cannot *measure* phone interaction while
the driver is using some other app. It can only *infer* handling from how the
device moves. Every metric this SDK emits about phone handling is an inference
from motion, and should be read as such.

This is worth stating plainly because the inference is easy to mistake for a
measurement once it has a confident-sounding name.

---

## Capability matrix

| Question | Android | iOS |
|---|---|---|
| Is the screen on? | **Yes** — `PowerManager.isInteractive()`. No special permission. | **No public API.** |
| Is the device locked? | **Yes** — `KeyguardManager.isKeyguardLocked()` / `isDeviceLocked()`; API 33+ also offers a change listener. No special permission. | **No public API.** |
| Which app is in the foreground? | **Effectively no.** `UsageStatsManager` requires `PACKAGE_USAGE_STATS`, which cannot be requested at runtime — the user must enable it manually in a dedicated Settings screen. An accessibility service is the only alternative and is policy-restricted. | **No.** |
| Do motion sensors deliver while backgrounded? | **Only with a foreground service.** Since Android 9, background apps receive *no* events from continuous sensors — accelerometer and gyroscope included. | **Only while the app is not suspended.** A suspended app executes no code, so Core Motion stops with it. A background mode that keeps the app alive (e.g. continuous location updates) keeps sensors delivering. |
| Maximum sensor sample rate | 200 Hz via `registerListener` on Android 12+; higher needs `HIGH_SAMPLING_RATE_SENSORS`. | No comparable cap at the rates this SDK uses. |

### Notes on the rows above

**Screen and lock state — the asymmetry is real and load-bearing.** Android
exposes both through ordinary public APIs. iOS exposes neither. The two
workarounds that circulate are both unusable: `isProtectedDataAvailable`
reports file-protection status rather than lock state and lags the actual
lock by roughly ten seconds, and the `com.apple.springboard.lockstate` Darwin
notification is private API that gets apps rejected from the App Store.

Any detection rule conditioned on "screen unlocked" therefore behaves
differently on the two platforms by construction. A rule that cannot be
applied evenly is usually worse than a weaker rule that can.

**Android background sensors — the restriction is absolute, not a slowdown.**
The platform documentation is explicit that continuous-mode sensors "don't
receive events" for background apps, and that this applies to all apps running
on Android 9 or later regardless of the API level they target. The documented
remedy is a foreground service. An app relying on background motion data
without one will see the stream stop silently — no error, no callback, no
exception.

**iOS background sensors — conditional on staying unsuspended.** There is no
background mode for motion data itself, and Apple's guidance is that declaring
an unrelated background mode purely to keep sensors alive risks rejection. An
app that already runs continuous location updates in the background for a
legitimate reason keeps executing, and Core Motion continues along with it.

---

## What this SDK subscribes to, and under what conditions

| Stream | Rate requested | Notes |
|---|---|---|
| Accelerometer | 10 Hz | Well under the Android 12 cap; no extra permission needed. |
| Gyroscope | 10 Hz | Same. |
| Location | see below | Delivered through a background task. |

Location is requested with high accuracy, automatic pausing disabled, and a
foreground service configured on Android.

**The requested cadence is not the same on both platforms**, and this is the
single most commonly misread part of the configuration:

- **Android** honours both the time interval and the distance interval.
- **iOS ignores the time interval entirely.** Cadence is governed by the
  distance filter alone. With a distance filter set, a stationary device
  produces no updates at all — so a vehicle waiting at a light delivers
  nothing on iOS while Android keeps ticking.

Any statement of the form "we sample location every N seconds" is therefore an
Android statement. Say so, or measure the iOS side separately.

**Delivery is also not guaranteed at the requested rate.** On Android, Doze,
battery-saver, and OEM power management can defer location updates well below
what was asked for; neither the accuracy tier nor the interval settings
override this. The only reliable lever is the user exempting the app from
battery optimisation. See `PowerManagement.ts`.

---

## What follows for handheld detection

The capability matrix removes several designs from consideration before they
are attempted:

1. **Gating on screen state is not portable.** It is available on exactly one
   of the two platforms, so any metric built on it produces two different
   meanings for the same behaviour.
2. **Identifying which app the driver is using is not available at all** in
   practice on either platform.
3. **Background motion data requires an explicit lifeline** — a foreground
   service on Android, an unsuspended process on iOS — and both are
   conditional on permissions the user can decline. A host app that measures
   handling in the background should treat a permission refusal as "this
   metric is unavailable", not as "this metric is zero". The two look
   identical in the data and mean opposite things.
4. **What remains is motion analysis.** Separating a hand from a device
   resting loose in a moving vehicle has to be done from the motion signal
   itself — rotational behaviour, correlation with vehicle movement, or the
   fine continuous tremor a hand produces and a seat does not. This is a
   signal-processing problem, and the platform offers no shortcut around it.
   The SDK's hand-held detector now acts on the first of these: a high
   acceleration-variance reading is vetoed when rotation variance is also
   high, since a loose phone tumbles while a held one keeps its orientation
   stable — see `README.md`'s hand-held detection section.

---

## When to re-check this file

- A major OS release on either platform.
- Any change to the background execution or sensor-access rules.
- Before relying on any row here for a decision that is expensive to reverse.
- If iOS ever exposes lock state through a public API, row 1 of the
  implications above changes and should be revisited deliberately.

## Sources

- Android 9 behaviour changes, "Limited access to sensors in background" —
  https://developer.android.com/about/versions/pie/android-9.0-changes-all
- Android 12 behaviour changes, sensor rate limiting —
  https://developer.android.com/about/versions/12/behavior-changes-12
- `KeyguardManager` — https://developer.android.com/reference/android/app/KeyguardManager
- `PowerManager` — https://developer.android.com/reference/android/os/PowerManager
- Configuring background execution modes (Apple) —
  https://developer.apple.com/documentation/xcode/configuring-background-execution-modes
- Handling location updates in the background (Apple) —
  https://developer.apple.com/documentation/corelocation/handling-location-updates-in-the-background
