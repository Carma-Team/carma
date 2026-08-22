/**
 * @file tripEvents.ts
 * @owner May (Mobile & Frontend UI Lead)
 * @brief Adapts the server's trip-event timeline into the SDK's `DrivingEvent` shape.
 * Lives here rather than in the map component because the mismatch is in the data,
 * not in the rendering.
 *
 * @description
 * GET /api/trips/:id returns the event timeline in the server's own shape. The map
 * markers are typed against the SDK's `DrivingEvent`, so the two have to be bridged
 * before rendering.
 */
import { DrivingEventType, type DrivingEvent } from '@/lib/driving-sdk/types';
import type { TripEvent } from '@/types';

// The column is PHONE_USE while the SDK enum is PHONE_USAGE; the server bridges the
// inbound direction only (services/trips.py), so without this every distraction event
// is dropped here and never reaches the map.
const SERVER_TYPE_ALIAS: Record<string, DrivingEventType> = {
  PHONE_USE: DrivingEventType.PHONE_USAGE,
};

/**
 * Three mismatches to bridge, all silent if missed: the server lower-cases `type`
 * on the wire while the SDK enum and the map's icon/colour tables are upper-case,
 * one name differs outright (see SERVER_TYPE_ALIAS), and coordinates arrive flat
 * rather than nested under `location`.
 *
 * An unknown type is dropped, not passed through — TripMapPlaceholder looks up its
 * icon and colour by type and would otherwise draw an invisible, uncoloured marker.
 * Coordinates are nullable by design: an event detected during a GPS gap has none.
 */
export function toDrivingEvents(events: TripEvent[] | undefined): DrivingEvent[] {
  if (!events?.length) return [];

  return events.flatMap<DrivingEvent>(e => {
    const name = e.type.toUpperCase();
    const type = SERVER_TYPE_ALIAS[name] ?? DrivingEventType[name as keyof typeof DrivingEventType];
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
