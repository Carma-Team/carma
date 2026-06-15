
// ─── Trip Validation ──────────────────────────────────────────────────────────

export enum ValidationState {
  IDLE      = 'IDLE',       // BT connected, waiting for movement
  PRE_TRIP  = 'PRE_TRIP',  // speed > 10 km/h detected, counting 30s
  SCORING   = 'SCORING',   // 30s confirmed — scoring is active
  ENDED     = 'ENDED',     // 3 min below threshold — trip closed
}

export enum TransportMode {
  UNKNOWN = 'UNKNOWN',  // not yet classified (Phase 2 populates this)
  CAR     = 'CAR',
  TRAIN   = 'TRAIN',
  BUS     = 'BUS',      // Phase 2 classifier (reserved — FraudDetector emits UNKNOWN until implemented)
}

// Snapshot fed into TripValidationManager each tick.
// speed is required for Rules 1 & 2; sensor fields are optional placeholders for Phase 2.
export interface ValidationSample {
  speedKmh: number;
  timestamp: number;          // Date.now()
  accel?: { x: number; y: number; z: number };  // Phase 2 (fraud detection)
  gyroYaw?: number;                              // Phase 2
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
  severity: number; // 0.0 to 1.0
  speedKmh?: number; // vehicle speed at the moment the event fired — stamped by DrivingSDK
  location?: {
    latitude: number;
    longitude: number;
  };
}

/**
 * Conditions that a registered sensor event listener must satisfy before being invoked.
 * All fields are optional — omitting a field means "no constraint on that dimension".
 */
export interface SensorEventCondition {
  /** GPS speed (km/h) must be at or above this value at the moment of detection. */
  minSpeedKmh?: number;
  /** Event severity [0–1] must be at or above this value. */
  minSeverity?: number;
}

/** Callback signature for a registered sensor event listener. */
export type SensorEventHandler = (event: DrivingEvent) => void;

/**
 * Opaque token returned by `DrivingSDK.on()`.
 * Pass it to `DrivingSDK.off()` to remove the listener.
 */
export type ListenerToken = symbol;

export interface SDKConfig {
  autoStartOnBluetooth?: boolean;
  targetBluetoothId?: string | null;
  sensorUpdateInterval?: number; // ms
  scoringEnabled?: boolean;
}

export interface RouteWaypoint {
  lat: number;
  lng: number;
  ts: number;        // Date.now() ms
  speedKmh: number;
}

export interface TripData {
  startTime: Date;
  endTime?: Date;
  distanceKm: number;
  durationSeconds: number;
  events: DrivingEvent[];
  waypoints: RouteWaypoint[];      // GPS track — downsampled at ~5s intervals while moving
  averageSpeed: number;
  maxSpeed: number;
  /** @deprecated v1.7 — replaced by touchEpochs + screenInteractionSeconds */
  phoneSeconds: number;
  touchEpochs: number;             // v1.7 — glass-tap proxy + foreground interaction count
  screenInteractionSeconds: number; // v1.7 — IMU-confirmed hand-held seconds
}

export type TripUpdateCallback = (data: Partial<TripData>) => void;
export type EventCallback = (event: DrivingEvent) => void;
export type StateChangeCallback = (isActive: boolean) => void;

// ─── Fraud Detection Event ────────────────────────────────────────────────────
// Fired by DrivingSDK.onFraudDetected; contains everything AppContext needs
// to build the InvalidTripPayload for Sean's backend.
export interface FraudDetectedEvent {
  confidence: number;       // 0–1 fraud score
  mode: TransportMode;      // classified transport mode
  telemetry: {
    avgSpeedKmh: number;    // average speed over the detection window
    maxLateralAccelG: number; // peak gravity-removed lateral force (g-units)
    yawVariance: number;    // yaw rate variance (rad²/s²)
  };
  durationMs: number;       // validation session length (BT connect → fraud detection)
  maxSpeedKmh: number;      // peak speed seen during the session
}
