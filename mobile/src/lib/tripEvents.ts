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

/**
 * Three mismatches to bridge, all silent if missed: the server lower-cases `type`
 * on the wire while the SDK enum and the map's icon/colour tables are upper-case,
 * coordinates arrive flat rather than nested under `location`, and `severity` is on
 * two different scales on the two sides.
 *
 * `severity` is deliberately not carried across, rather than mapped: the server's is
 * 1.0–3.0 for every event type, while the SDK's field means phone-usage intensity on
 * 0.0–1.0 and motion events carry none at all (CAR-156). There is no conversion that
 * makes the server's number mean what the SDK's field claims, so it is left unset.
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
      location: e.lat !== null && e.lng !== null
        ? { latitude: e.lat, longitude: e.lng }
        : undefined,
    }];
  });
}
