/**
 * @fileoverview Server trip-event → SDK DrivingEvent adapter
 * @module lib/tripEvents
 *
 * @description
 * GET /api/trips/:id returns the event timeline in the server's own shape. The map
 * markers are typed against the SDK's `DrivingEvent`, so the two have to be bridged
 * before rendering.
 */
import { DrivingEventType, type DrivingEvent } from '@/lib/driving-sdk/types';
import type { TripEvent } from '@/types';

/**
 * Two mismatches to bridge, both silent if missed: the server lower-cases `type`
 * on the wire while the SDK enum and the map's icon/colour tables are upper-case,
 * and coordinates arrive flat rather than nested under `location`.
 *
 * An unknown type is dropped, not passed through — TripMapPlaceholder looks up its
 * icon and colour by type and would otherwise draw an invisible, uncoloured marker.
 * Coordinates are nullable by design: an event detected during a GPS gap has none.
 */
export function toDrivingEvents(events: TripEvent[] | undefined): DrivingEvent[] {
  if (!events?.length) return [];

  return events.flatMap<DrivingEvent>(e => {
    const type = DrivingEventType[e.type.toUpperCase() as keyof typeof DrivingEventType];
    if (!type) return [];

    return [{
      type,
      timestamp: new Date(e.timestamp),
      severity: e.severity,
      location: e.lat !== null && e.lng !== null
        ? { latitude: e.lat, longitude: e.lng }
        : undefined,
    }];
  });
}
