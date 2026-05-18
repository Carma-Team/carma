
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
  HARD_BRAKE = 'HARD_BRAKE',
  AGGRESSIVE_ACCEL = 'AGGRESSIVE_ACCEL',
  SHARP_TURN = 'SHARP_TURN',
  PHONE_USAGE = 'PHONE_USAGE'
}

export interface DrivingEvent {
  type: DrivingEventType;
  timestamp: Date;
  severity: number; // 0.0 to 1.0
  location?: {
    latitude: number;
    longitude: number;
  };
}

export interface SDKConfig {
  autoStartOnBluetooth?: boolean;
  targetBluetoothId?: string | null;
  sensorUpdateInterval?: number; // ms
  scoringEnabled?: boolean;
}

export interface TripData {
  startTime: Date;
  endTime?: Date;
  distanceKm: number;
  durationSeconds: number;
  events: DrivingEvent[];
  averageSpeed: number;
  maxSpeed: number;
  phoneSeconds: number;
}

export type TripUpdateCallback = (data: Partial<TripData>) => void;
export type EventCallback = (event: DrivingEvent) => void;
export type StateChangeCallback = (isActive: boolean) => void;
