/**
 * @fileoverview Background location task + bridge for the driving SDK.
 * @module lib/driving-sdk/sensors/locationTask
 *
 * @description
 * Defines the TaskManager task that `Location.startLocationUpdatesAsync` delivers
 * to. It runs even while the app is backgrounded / the phone is locked (Android
 * foreground service, iOS background-location mode), so distance keeps counting.
 *
 * The task is a module-level singleton (defined at import time, before it can
 * fire). It forwards each location to whatever handler SensorManager registers,
 * keeping the task body tiny and decoupled from the SDK instance.
 */
import * as TaskManager from 'expo-task-manager';
import type { LocationObject } from 'expo-location';

export const DRIVING_SDK_LOCATION_TASK = 'driving-sdk-location-updates';

type LocationHandler = (loc: LocationObject) => void;

let handler: LocationHandler | null = null;

/** Register (or clear with null) the consumer for background/foreground locations. */
export function setLocationHandler(fn: LocationHandler | null): void {
  handler = fn;
}

TaskManager.defineTask<{ locations?: LocationObject[] }>(DRIVING_SDK_LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.warn('[locationTask] error:', error.message);
    return;
  }
  const locations = data?.locations;
  if (!locations || !handler) return;
  for (const loc of locations) handler(loc);
});
