/**
 * @file tripEvents.ts
 * @owner May (Mobile & Frontend UI Lead)
 * @brief Adapts the server's trip-event timeline into the SDK's `DrivingEvent` shape,
 * and renders one into the label + detail line a map marker shows when tapped.
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
import { formatTime } from '@/lib/utils';

// The counter labels the trip screens already use, reused as marker titles so an
// event is named identically wherever it appears.
const EVENT_LABEL_KEY: Record<DrivingEventType, string> = {
  [DrivingEventType.HARD_BRAKE]:       'trip.hardBrakes',
  [DrivingEventType.AGGRESSIVE_ACCEL]: 'trip.aggressiveAccels',
  [DrivingEventType.SHARP_TURN]:       'trip.sharpTurns',
  [DrivingEventType.PHONE_USAGE]:      'trip.phoneUsage',
};

// The column is PHONE_USE while the SDK enum is PHONE_USAGE; the server bridges the
// inbound direction only (services/trips.py), so without this every distraction event
// is dropped here and never reaches the map.
const SERVER_TYPE_ALIAS: Record<string, DrivingEventType> = {
  PHONE_USE: DrivingEventType.PHONE_USAGE,
};

/**
 * Four mismatches to bridge, all silent if missed: the server lower-cases `type`
 * on the wire while the SDK enum and the map's icon/colour tables are upper-case,
 * one name differs outright (see SERVER_TYPE_ALIAS), coordinates arrive flat rather
 * than nested under `location`, and `severity` is on two different scales on the two
 * sides.
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
    const name = e.type.toUpperCase();
    const type = SERVER_TYPE_ALIAS[name] ?? DrivingEventType[name as keyof typeof DrivingEventType];
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

/**
 * The three lines of the callout a map marker opens on tap.
 *
 * Returned as separate fields rather than one newline-joined string: the platform
 * callout renders its detail as a single native text field and ellipsises whatever
 * follows the first line, so the third line never reached the screen — it arrived as
 * a trailing "...". The map renders these as three views of its own.
 *
 * Speed is optional on purpose: `DrivingSDK` stamps `speedKmh` on a live event, while
 * the server timeline has no equivalent field, so the same event shows the time alone
 * in TripDetailScreen and time + speed in the post-trip modal.
 *
 * `action` is the affordance for the callout press, which opens the coordinate in the
 * device's maps app — a native callout cannot make one word tappable on its own, so the
 * whole bubble is the target and the line says what pressing it does.
 */
export function eventMarkerText(event: DrivingEvent, t: (key: string) => string) {
  const speed = event.speedKmh !== undefined
    ? ` · ${Math.round(event.speedKmh)} ${t('trip.kmh')}`
    : '';

  return {
    title: t(EVENT_LABEL_KEY[event.type]),
    detail: `${formatTime(event.timestamp.toISOString())}${speed}`,
    action: t('trip.openLocationInMaps'),
  };
}
