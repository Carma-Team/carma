/**
 * @file types.ts
 * @owner May Hajbi — driving-sdk maintainer
 * @brief Every type and interface the library exposes to its host app.
 * Driving events, `TripData`, `SDKConfig`, and the pluggable `TripValidator` contract
 * through which an app injects its own trip-start, trip-end and suspicion rules.
 */

// ─── Trip Validation ──────────────────────────────────────────────────────────

export enum ValidationState {
  IDLE      = 'IDLE',      // detection armed, no movement seen yet
  PRE_TRIP  = 'PRE_TRIP',  // movement seen, validator has not confirmed a trip yet
  SCORING   = 'SCORING',   // validator confirmed the trip — it is running
  ENDED     = 'ENDED',     // validator closed the trip
}

// How long a sample stays usable after it arrives (docs/fraud-detection.md §3.1, §7).
// Lives here rather than in SensorManager because a TripValidator needs it too, and
// SensorManager pulls expo-location/expo-sensors in at module scope — importing it for
// one number drags those into every consumer, jest included.
export const SENSOR_STALE_MS = 5000;

// Snapshot fed into the configured TripValidator each tick.
// speed is always populated; the sensor fields are optional and only some validators read them.
export interface ValidationSample {
  speedKmh: number;
  timestamp: number;          // Date.now()
  // Vehicle-frame readings, read only by validators that classify motion. Both are
  // null when the frame could not be resolved — no GPS heading, gravity not converged,
  // or the forward direction not yet learned. Null is "not measured", which never
  // satisfies a threshold; 0 would be a claim of no force (docs/fraud-detection.md §3.2).
  lateralAccelG?: number | null;  // signed, positive to the left of travel
  yawRate?: number | null;        // rad/s about gravity, signed — not the device Z axis
  // Present only on ticks that carried a GPS fix. A validator that gates on where the
  // journey is happening reads these; one that does not simply ignores them.
  lat?: number;
  lng?: number;
  // Whether the underlying sensor was live at all. Distinct from the frame being
  // unresolvable: a live sensor with an unknown frame is still a working sensor.
  // §3.1: unavailable ≠ zero.
  accelAvailable?: boolean;
  gyroAvailable?: boolean;
  // false means background/"Always" location permission was denied, so automatic
  // (background) trip tracking cannot run — not that tracking is simply idle.
  backgroundLocationAvailable?: boolean;
}

export enum DrivingEventType {
  HARD_BRAKE      = 'HARD_BRAKE',       // EVT_BRAKE   — spec §א table 1
  AGGRESSIVE_ACCEL = 'AGGRESSIVE_ACCEL', // EVT_ACCEL   — spec §א table 1
  SHARP_TURN      = 'SHARP_TURN',        // EVT_TURN    — spec §א table 1
  SWERVE          = 'SWERVE',            // EVT_SWERVE  — spec §א table 1
  PHONE_USAGE     = 'PHONE_USAGE'        // not in spec table — detected separately
}

export interface DrivingEvent {
  type: DrivingEventType;
  timestamp: Date;
  severity?: number; // 0.0 to 1.0. PHONE_USAGE only — motion events omit it (scoring.md §3.4: no vehicle-frame axis, no severity)
  speedKmh?: number; // vehicle speed at the moment the event fired — stamped by DrivingSDK
  location?: {
    latitude: number;
    longitude: number;
  };
  // Motion events (HARD_BRAKE/AGGRESSIVE_ACCEL/SHARP_TURN) only — absent on PHONE_USAGE,
  // and absent on a motion event whose vehicle frame could not be resolved. Signed
  // physical measurements in g, in the vehicle's own frame: positive longitudinal is
  // forward, so a brake is negative; positive lateral is to the left of travel.
  //
  // Measurements, not a score. Turning these into a severity is the scoring engine's
  // job — a curve belongs with the consumer, not in a sensor library (§6).
  peakLongitudinalG?: number;
  peakLateralG?: number;
  durationMs?: number; // how long the signal stayed above the IMU cross-confirm threshold
}

/**
 * Conditions that a registered sensor event listener must satisfy before being invoked.
 * All fields are optional — omitting a field means "no constraint on that dimension".
 */
export interface SensorEventCondition {
  /** GPS speed (km/h) must be at or above this value at the moment of detection. */
  minSpeedKmh?: number;
  /** Event severity [0–1] must be at or above this value. PHONE_USAGE only —
   *  motion events don't carry severity (CAR-156), so this condition is ignored
   *  rather than blocking them. */
  minSeverity?: number;
}

/** Callback signature for a registered sensor event listener. */
export type SensorEventHandler = (event: DrivingEvent) => void;

/**
 * Opaque token returned by `DrivingSDK.on()`.
 * Pass it to `DrivingSDK.off()` to remove the listener.
 */
export type ListenerToken = symbol;

// Magnitude (m/s²) a GPS+IMU sample must cross to be flagged as that event type.
// See sensors/SensorManager.ts DEFAULT_MOTION_THRESHOLDS for the out-of-the-box
// values and the reasoning behind them.
export interface MotionThresholds {
  brakeThresholdMs2: number; // deceleration that triggers HARD_BRAKE
  accelThresholdMs2: number; // acceleration that triggers AGGRESSIVE_ACCEL
  turnThresholdMs2: number;  // lateral accel that triggers SHARP_TURN
}

// ─── Automatic trip detection ─────────────────────────────────────────────────

/** A device the handset is already paired with, as offered to the user to pick as the trigger. */
export interface BluetoothDevice {
  id: string;   // MAC address on Android (e.g. "AA:BB:CC:DD:EE:FF")
  name: string;
}

// ─── Pluggable trip validation ─────────────────────────────────────────────────
// DrivingSDK ships with a trivial default (confirms/ends trips immediately, never
// flags anything as suspicious). Apps that need "wait N seconds of sustained
// movement before it counts as a trip", or transport-mode fraud detection, supply
// their own TripValidator via SDKConfig.tripValidator instead of editing the SDK.

/**
 * Result of a TripValidator's suspicious-activity check (e.g. transport-mode
 * fraud detection). Deliberately minimal — a validator's own evaluation type may
 * carry extra fields; only these are read by DrivingSDK.
 */
export interface SuspiciousActivityEvaluation {
  score: number;
  // The validator's own label for what it thinks it saw. Opaque on purpose, for the same
  // reason `signals` below is: a list of modes here would be one consumer's classifier
  // vocabulary — "TRAIN", "BUS" — sitting inside a sensor library that has no opinion on
  // public transport. The SDK carries the string to onFraudDetected without reading it.
  mode: string;
  telemetry: {
    avgSpeedKmh: number;
    maxLateralAccelG: number;
    yawVariance: number;
  };
  // Whichever rule gates the validator evaluated, under its own names. Opaque on
  // purpose: naming them here would put a consumer's classifier vocabulary inside
  // the SDK. `null` is "could not be evaluated", which is not the same claim as
  // `false` — the SDK carries the distinction without interpreting it.
  signals?: Record<string, boolean | null>;
}

/**
 * Decides when a trip actually "starts" (vs. GPS noise or a stationary Bluetooth
 * connection) and "ends" (vs. a red light), and can flag a session as suspicious
 * before it's confirmed. Inject a custom implementation via SDKConfig.tripValidator;
 * omit it to use DrivingSDK's built-in DefaultTripValidator.
 */
export interface TripValidator {
  start(): void;
  stop(): void;
  updateSample(sample: ValidationSample): void;
  onTripConfirmed?: () => void;
  onTripEnded?: () => void;
  onFraudSuspected?: (evaluation: SuspiciousActivityEvaluation) => void;
  onRegionRejected?: () => void;
}

export interface SDKConfig {
  autoStartOnBluetooth?: boolean;
  targetBluetoothId?: string | null;
  // Overrides the SDK's default motion-event sensitivity. Any field omitted falls
  // back to DEFAULT_MOTION_THRESHOLDS — most consumers never need to set this.
  motionThresholds?: Partial<MotionThresholds>;
  // Custom trip-start/trip-end/fraud rules. Omit to use DefaultTripValidator.
  tripValidator?: TripValidator;
}

export interface RouteWaypoint {
  lat: number;
  lng: number;
  ts: number;        // epoch ms of the GPS fix the point came from
  speedKmh: number;
}

/**
 * One tick from the sensor layer: a GPS fix, or a speed-only tick emitted when the
 * location stream has gone quiet. Declared once here because `SensorManager` produces
 * it and `DrivingSDK` consumes it — a field added on one side has to reach the other.
 */
export interface SensorUpdate {
  distanceKm: number;
  currentSpeed: number;
  timeDeltaS: number;
  // Vehicle-frame readings, resolved inside the SDK so nothing downstream has to know
  // how the phone is sitting. Null means the frame could not be resolved — never 0,
  // which would read as a measured absence of force (docs/fraud-detection.md §3.2).
  longitudinalAccelG: number | null; // signed, positive forward
  lateralAccelG: number | null;      // signed, positive to the left of travel
  yawRateRadS: number | null;        // signed, about gravity — not the device's Z axis
  // Whether the sensors themselves are live. A live sensor whose frame is unresolved
  // reports true here and null above; the two answer different questions (§3.1).
  accelAvailable: boolean;
  gyroAvailable: boolean;
  // Fraction (0–1) of the measured window in which the accelerometer actually
  // delivered samples. `accelAvailable` answers "right now" and latches over a trip,
  // which cannot separate a sensor that quit halfway from one that never started —
  // this can. 0 with accelAvailable false is "never delivered anything"; a value
  // strictly between 0 and 1 is an outage the trip lived through.
  accelCoverage: number;
  // Whether accelerometer *registration* itself threw — distinct from
  // accelAvailable=false (no such hardware). Unlike accelAvailable/gyroAvailable
  // this one is CARMA-agnostic trip metadata, not a fraud-detection input, so it
  // is exposed here purely for a consumer to tell "no sensor" from "broken sensor" (CAR-189).
  accelInitFailed: boolean;
  // Whether "Always"/background location permission was granted — false means
  // automatic (background) tracking cannot run, distinct from it just not
  // having happened yet.
  backgroundLocationAvailable: boolean;
  lat?: number;
  lng?: number;
  accuracy?: number;
  // Timestamp of the GPS fix itself, absent on speed-only ticks. Anything measuring
  // elapsed time between fixes must use this and not its own arrival time: Android can
  // deliver a batch of deferred fixes in one turn, all arriving at the same instant (CAR-178).
  fixTs?: number;
}

export interface TripData {
  startTime: Date;
  endTime?: Date;
  distanceKm: number;
  durationSeconds: number;
  events: DrivingEvent[];
  waypoints: RouteWaypoint[];      // GPS track — downsampled to 2s intervals of GPS-fix time while moving
  averageSpeed: number;
  maxSpeed: number;
  touchEpochs: number;             // v1.7 — glass-tap proxy + foreground interaction count
  screenInteractionSeconds: number; // v1.7 — IMU-confirmed hand-held seconds, no speed gate
                                    // (per-second samples arrive via onInteractionData)
  accelAvailable: boolean;   // ever confirmed live this trip; false alone says nothing about
                             // why — see accelInitFailed
  accelCoverage: number;     // 0–1 share of the trip the accelerometer actually delivered
                             // samples for. The three fields answer different questions:
                             // "ever alive", "why not", "how much of the way"
  accelInitFailed: boolean;  // true only if accelerometer registration itself threw (CAR-189)
}

export type TripUpdateCallback = (data: Partial<TripData>) => void;
export type EventCallback = (event: DrivingEvent) => void;
export type StateChangeCallback = (isActive: boolean) => void;

// ─── Fraud Detection Event ────────────────────────────────────────────────────
// Fired by DrivingSDK.onFraudDetected when the configured TripValidator flags a
// session as suspicious. Carries the classification and the raw telemetry behind
// it, so the host app can decide what to do — surface it, drop the trip, or report
// it upstream. The SDK itself takes no action beyond emitting this.
export interface FraudDetectedEvent {
  fraudScore: number;       // 0–1 weighted rule score — not a calibrated confidence
  detectedMode: string;     // the validator's own label — see SuspiciousActivityEvaluation.mode
  telemetry: {
    avgSpeedKmh: number;    // average speed over the detection window
    maxLateralAccelG: number; // peak gravity-removed lateral force (g-units)
    yawVariance: number;    // yaw rate variance (rad²/s²)
  };
  signals?: Record<string, boolean | null>; // the gates behind the verdict, passed through untouched
  durationMs: number;       // validation session length (BT connect → fraud detection)
  maxSpeedKmh: number;      // peak speed seen during the session
  distanceKm?: number;      // absent for a detection at the pre-trip gate: the trip was never
                            // confirmed, so no distance was ever accumulated. Not zero — unknown.
}
