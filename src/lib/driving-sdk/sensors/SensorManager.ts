/**
 * @fileoverview חיישני מיקום, תאוצה וגירוסקופ לזיהוי אירועי נהיגה — SensorManager
 * @module lib/driving-sdk/sensors/SensorManager
 *
 * @description
 * מאזין ל-GPS (expo-location), תאוצומטר ו-Gyroscope (expo-sensors).
 * - GPS: מחשב מרחק ומהירות נוכחית בין דגימות עוקבות (Haversine)
 * - תאוצומטר: מזהה בלימה חזקה (force > 2.8, y < -0.5) והאצה אגרסיבית
 * - Gyroscope: מזהה פנייה חדה (|z| > 2.0)
 *
 * @remarks ללא קריאות שרת — לוגיקה מקומית בלבד. מפעיל callbacks ל-CarmaDrivingSDK.
 */
import * as Location from 'expo-location';
import { Accelerometer, Gyroscope } from 'expo-sensors';
import { DrivingEventType, DrivingEvent } from '@/lib/driving-sdk/types';

// EMA coefficient for gravity isolation. At 10Hz this gives a ~0.5s time constant:
// slow enough to track phone tilts, fast enough to ignore braking events.
const LPF_ALPHA = 0.8;

// Dynamic magnitude thresholds (g-units, gravity-removed):
// 0.4g ≈ firm braking / hard stomp on gas, validated against NHTSA deceleration data.
const DYNAMIC_ACCEL_THRESHOLD = 0.4;

// Gyro threshold in rad/s. 1.5 rad/s ≈ a fast lane-change; aggressive swerves reach 3+.
const GYRO_THRESHOLD_RADS = 1.5;

export class SensorManager {
  private locationSub: any = null;
  private accelSub: any = null;
  private gyroSub: any = null;
  private lastLocation: any = null;

  // LPF gravity state — initialised to [0,0,1] (phone face-up assumption)
  private gravity = { x: 0, y: 0, z: 1 };

  private onEvent: (event: DrivingEvent) => void;
  private onUpdate: (data: { distanceKm: number, currentSpeed: number }) => void;

  constructor(
    onEvent: (event: DrivingEvent) => void,
    onUpdate: (data: { distanceKm: number, currentSpeed: number }) => void
  ) {
    this.onEvent = onEvent;
    this.onUpdate = onUpdate;
  }

  public async start() {
    this.gravity = { x: 0, y: 0, z: 1 };

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        this.locationSub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, timeInterval: 2000, distanceInterval: 5 },
          (loc) => this.handleLocation(loc)
        );
      } else {
        console.warn('[SensorManager] Location permission denied');
      }

      const accelAvailable = await Accelerometer.isAvailableAsync();
      if (accelAvailable) {
        Accelerometer.setUpdateInterval(100); // 10Hz
        this.accelSub = Accelerometer.addListener(data => this.handleAccel(data));
      }

      const gyroAvailable = await Gyroscope.isAvailableAsync();
      if (gyroAvailable) {
        Gyroscope.setUpdateInterval(100); // 10Hz
        this.gyroSub = Gyroscope.addListener(data => this.handleGyro(data));
      }
    } catch (err) {
      console.error('[SensorManager] Error starting sensors:', err);
    }
  }

  public stop() {
    try {
      if (this.locationSub) this.locationSub.remove();
      if (this.accelSub) this.accelSub.remove();
      if (this.gyroSub) this.gyroSub.remove();
    } catch (err) {
      console.warn('[SensorManager] Error stopping sensors:', err);
    }
    this.lastLocation = null;
  }

  private handleLocation(loc: Location.LocationObject) {
    let distance = 0;
    if (this.lastLocation) {
      distance = this.calculateDistance(
        this.lastLocation.coords.latitude,
        this.lastLocation.coords.longitude,
        loc.coords.latitude,
        loc.coords.longitude
      );
    }
    this.lastLocation = loc;
    this.onUpdate({
      distanceKm: distance,
      currentSpeed: (loc.coords.speed || 0) * 3.6
    });
  }

  private handleAccel(data: { x: number; y: number; z: number }) {
    // EMA low-pass filter: isolate slow-changing gravity from fast-changing dynamic forces
    this.gravity.x = LPF_ALPHA * this.gravity.x + (1 - LPF_ALPHA) * data.x;
    this.gravity.y = LPF_ALPHA * this.gravity.y + (1 - LPF_ALPHA) * data.y;
    this.gravity.z = LPF_ALPHA * this.gravity.z + (1 - LPF_ALPHA) * data.z;

    const dx = data.x - this.gravity.x;
    const dy = data.y - this.gravity.y;
    const dz = data.z - this.gravity.z;
    const dynamicMag = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (dynamicMag < DYNAMIC_ACCEL_THRESHOLD) return;

    // Discriminate brake vs accelerate by the sign of the dominant dynamic axis.
    // Negative peak = deceleration (forward inertia pushes phone toward dashboard).
    const dominant = Math.abs(dx) >= Math.abs(dy) ? dx : dy;
    const type = dominant < 0
      ? DrivingEventType.HARD_BRAKE
      : DrivingEventType.AGGRESSIVE_ACCEL;

    // severity: 0.4g → 0.0, 1.4g → 1.0, clamped to [0, 1]
    const severity = Math.min(1, Math.max(0, (dynamicMag - DYNAMIC_ACCEL_THRESHOLD) / 1.0));
    this.onEvent({ type, timestamp: new Date(), severity });
  }

  private handleGyro(data: { x: number; y: number; z: number }) {
    // Use full rotation magnitude — handles phones mounted at any angle in the car.
    const rotMag = Math.sqrt(data.x * data.x + data.y * data.y + data.z * data.z);

    if (rotMag < GYRO_THRESHOLD_RADS) return;

    // severity: 1.5 rad/s → 0.0, 4.5 rad/s → 1.0, clamped to [0, 1]
    const severity = Math.min(1, Math.max(0, (rotMag - GYRO_THRESHOLD_RADS) / 3.0));
    this.onEvent({ type: DrivingEventType.SHARP_TURN, timestamp: new Date(), severity });
  }

  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }
}
