
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
}

export type TripUpdateCallback = (data: Partial<TripData>) => void;
export type EventCallback = (event: DrivingEvent) => void;
export type StateChangeCallback = (isActive: boolean) => void;
