/**
 * @file locationTask.ts
 * @owner May Hajbi — driving-sdk maintainer
 * @brief Defines the TaskManager task that receives background location updates.
 * Forwards each fix to the handler `SensorManager` registers, so distance keeps counting
 * while the app is backgrounded or the phone is locked.
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
type LocationErrorHandler = (error: TaskManager.TaskManagerError) => void;

let handler: LocationHandler | null = null;
let errorHandler: LocationErrorHandler | null = null;

/** Register (or clear with null) the consumer for background/foreground locations. */
export function setLocationHandler(fn: LocationHandler | null): void {
  handler = fn;
}

/**
 * Register (or clear with null) the consumer for the task's own failures. Separate
 * from the location handler because the two are registered and cleared together but
 * carry nothing in common, and a caller that only wants fixes should not have to
 * branch on a union to get them.
 *
 * Without this the error branch below ended at a console line: a foreground service
 * the platform killed mid-trip reports itself here, and nothing downstream learned
 * that location had stopped arriving (CAR-326).
 */
export function setLocationErrorHandler(fn: LocationErrorHandler | null): void {
  errorHandler = fn;
}

TaskManager.defineTask<{ locations?: LocationObject[] }>(DRIVING_SDK_LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.warn('[locationTask] error:', error.message);
    errorHandler?.(error);
    return;
  }
  const locations = data?.locations;
  if (!locations || !handler) return;
  for (const loc of locations) handler(loc);
});
