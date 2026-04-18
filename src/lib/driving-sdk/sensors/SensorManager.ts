import * as Location from 'expo-location';
import { Accelerometer, Gyroscope } from 'expo-sensors';
import { DrivingEventType, DrivingEvent } from '@/lib/driving-sdk/types';

export class SensorManager {
  private locationSub: any = null;
  private accelSub: any = null;
  private gyroSub: any = null;
  private lastLocation: any = null;

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

      // Safe Accelerometer setup
      const accelAvailable = await Accelerometer.isAvailableAsync();
      if (accelAvailable) {
        Accelerometer.setUpdateInterval(1000);
        this.accelSub = Accelerometer.addListener(data => this.handleAccel(data));
      }

      // Safe Gyroscope setup
      const gyroAvailable = await Gyroscope.isAvailableAsync();
      if (gyroAvailable) {
        Gyroscope.setUpdateInterval(1000);
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

  private handleAccel(data: any) {
    const force = Math.sqrt(data.x**2 + data.y**2 + data.z**2);
    if (force > 2.8) {
      const type = data.y < -0.5 ? DrivingEventType.HARD_BRAKE : DrivingEventType.AGGRESSIVE_ACCEL;
      this.onEvent({ type, timestamp: new Date(), severity: force / 2 });
    }
  }

  private handleGyro(data: any) {
    if (Math.abs(data.z) > 2.0) {
      this.onEvent({
        type: DrivingEventType.SHARP_TURN,
        timestamp: new Date(),
        severity: Math.abs(data.z)
      });
    }
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
