import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/ui/Card';
import { COLORS, TYPOGRAPHY } from '@/constants/theme';
import { ICONS, type IoniconName } from '@/constants/icons';
import { useTranslation } from '@/hooks/useTranslation';
import { eventMarkerText } from '@/lib/tripEvents';
import type { DrivingEvent } from '@/lib/driving-sdk/types';

// react-native-maps requires a native build (dev build / production).
// In Expo Go the native module is not linked — catch at require time so
// the screen degrades gracefully instead of crashing. A static import can't
// be wrapped in try/catch (ES imports are hoisted), so require() stays here.
let MapView: any = null;
let Polyline: any = null;
let Marker:   any = null;
let Callout:  any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- see comment above
  const maps = require('react-native-maps');
  MapView   = maps.default;
  Polyline  = maps.Polyline;
  Marker    = maps.Marker;
  Callout   = maps.Callout;
} catch {
  // Native module unavailable — map will show fallback card
}

interface RouteWaypoint {
  lat: number;
  lng: number;
  ts: number;
  speedKmh: number;
}

interface TripMapProps {
  waypoints?: RouteWaypoint[];
  events?: DrivingEvent[];
}

const EVENT_ICON: Record<string, IoniconName> = {
  HARD_BRAKE:       ICONS.hardBrake,
  AGGRESSIVE_ACCEL: ICONS.aggressiveAccel,
  SHARP_TURN:       ICONS.sharpTurn,
  PHONE_USAGE:      ICONS.phoneUsage,
};

const EVENT_COLOR: Record<string, string> = {
  HARD_BRAKE:       COLORS.danger,
  AGGRESSIVE_ACCEL: COLORS.warning,
  SHARP_TURN:       COLORS.warning,
  PHONE_USAGE:      COLORS.danger,
};

function computeRegion(waypoints: RouteWaypoint[]) {
  const lats = waypoints.map(w => w.lat);
  const lngs = waypoints.map(w => w.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const latDelta = Math.max(maxLat - minLat, 0.005) * 1.4;
  const lngDelta = Math.max(maxLng - minLng, 0.005) * 1.4;
  return {
    latitude:  (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta:  latDelta,
    longitudeDelta: lngDelta,
  };
}

// Fallback card shown when the map can't render (no route, native module missing, or a render error).
function MapFallback() {
  const { t } = useTranslation();
  return (
    <Card glass style={styles.fallback}>
      <Ionicons name={ICONS.roadmap} size={30} color={COLORS.textMuted} />
      <Text style={styles.fallbackText}>{t('trip.mapUnavailable')}</Text>
    </Card>
  );
}

// A native MapView failure (e.g. a missing/invalid Google Maps key on Android)
// must degrade to the fallback — never crash the whole app.
class MapErrorBoundary extends React.Component<
  { fallback: React.ReactNode; children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(err: unknown) { console.warn('[TripMap] render failed, showing fallback:', err); }
  render() { return this.state.hasError ? this.props.fallback : this.props.children; }
}

// An iOS device without the Google Maps app installed sends a google.com/maps link to
// Safari, which is where most of them end up; maps.apple.com opens the native app
// instead. Android has no Apple Maps, so it keeps the Google URLs (CAR-201).
function openInExternalMaps(coordinates: { latitude: number; longitude: number }[]) {
  const origin = coordinates[0];
  const destination = coordinates[coordinates.length - 1];
  const url = Platform.OS === 'ios'
    ? `https://maps.apple.com/?saddr=${origin.latitude},${origin.longitude}&daddr=${destination.latitude},${destination.longitude}&dirflg=d`
    : `https://www.google.com/maps/dir/?api=1&origin=${origin.latitude},${origin.longitude}&destination=${destination.latitude},${destination.longitude}&travelmode=driving`;
  Linking.openURL(url);
}

// `q` is what makes Apple Maps drop a labelled pin — with `ll` alone it just centres
// the map and the user sees no marker at all.
function openPointInExternalMaps(point: { latitude: number; longitude: number }, label: string) {
  const url = Platform.OS === 'ios'
    ? `https://maps.apple.com/?ll=${point.latitude},${point.longitude}&q=${encodeURIComponent(label)}`
    : `https://www.google.com/maps/search/?api=1&query=${point.latitude},${point.longitude}`;
  Linking.openURL(url);
}

export function TripMapPlaceholder({ waypoints = [], events = [] }: TripMapProps) {
  const { t } = useTranslation();
  const eventsWithLocation = useMemo(
    () => events.filter(e => e.location?.latitude !== undefined && e.location?.longitude !== undefined),
    [events]
  );
  const region = useMemo(
    () => waypoints.length >= 2 ? computeRegion(waypoints) : null,
    [waypoints]
  );
  const coordinates = useMemo(
    () => waypoints.map(w => ({ latitude: w.lat, longitude: w.lng })),
    [waypoints]
  );

  if (waypoints.length < 2 || !MapView || !region) {
    return <MapFallback />;
  }

  return (
    <MapErrorBoundary fallback={<MapFallback />}>
      <View style={styles.container}>
      <TouchableOpacity
        style={styles.openMapsButton}
        onPress={() => openInExternalMaps(coordinates)}
        accessibilityLabel={t('trip.openInMaps')}
      >
        <Ionicons name={ICONS.openInMaps} size={18} color={COLORS.text} />
      </TouchableOpacity>
      {/* Android pops a native directions toolbar over the map when a marker is
          tapped, which is a second control that looks like ours and goes to the same
          place. Our own button above is the one route out (CAR-241). */}
      <MapView style={styles.map} initialRegion={region} toolbarEnabled={false}>
        <Polyline
          coordinates={coordinates}
          strokeColor={COLORS.brand}
          strokeWidth={3}
        />

        {/* Start marker */}
        <Marker
          coordinate={coordinates[0]}
          anchor={{ x: 0.5, y: 0.5 }}
          title={t('trip.routeStart')}
        >
          <View style={[styles.dot, styles.dotStart]} />
        </Marker>

        {/* End marker */}
        <Marker
          coordinate={coordinates[coordinates.length - 1]}
          anchor={{ x: 0.5, y: 0.5 }}
          title={t('trip.routeEnd')}
        >
          <View style={[styles.dot, styles.dotEnd]} />
        </Marker>

        {/* Event markers. A Callout of our own rather than the marker's `title` and
            `description`: those render as two native text fields, and the platform
            ellipsises the detail one after its first line, so the line saying what a
            press does never reached the screen — it arrived as a trailing "...". The
            press target is still the whole bubble, because a native callout has no way
            to make only its last line tappable (CAR-223), so that line says so rather
            than looking like a link. */}
        {eventsWithLocation.map((event, i) => {
          const { title, detail, action } = eventMarkerText(event, t);
          const coordinate = {
            latitude:  event.location!.latitude,
            longitude: event.location!.longitude,
          };
          return (
            <Marker
              key={i}
              coordinate={coordinate}
              anchor={{ x: 0.5, y: 0.5 }}
              onCalloutPress={() => openPointInExternalMaps(coordinate, title)}
            >
              <View style={[styles.eventBubble, { backgroundColor: EVENT_COLOR[event.type] ?? COLORS.warning }]}>
                <Ionicons
                  name={EVENT_ICON[event.type] ?? ICONS.hardBrake}
                  size={12}
                  color="#fff"
                />
              </View>
              {Callout && (
                <Callout>
                  <View style={styles.callout}>
                    <Text style={styles.calloutTitle}>{title}</Text>
                    <Text style={styles.calloutDetail}>{detail}</Text>
                    <Text style={styles.calloutAction}>{action}</Text>
                  </View>
                </Callout>
              )}
            </Marker>
          );
        })}
      </MapView>
      </View>
    </MapErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: 20, borderRadius: 16, overflow: 'hidden', height: 220 },
  map:       { flex: 1 },
  openMapsButton: {
    position: 'absolute', top: 10, right: 10, zIndex: 1,
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.9)',
  },
  fallback: {
    marginTop: 20,
    paddingVertical: 40,
    alignItems: 'center',
    borderStyle: 'dashed',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  fallbackText: { ...TYPOGRAPHY.caption, color: COLORS.textMuted, marginTop: 10 },
  dot:      { width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: '#fff' },
  dotStart: { backgroundColor: COLORS.success },
  dotEnd:   { backgroundColor: COLORS.danger },
  // Width is fixed rather than fitted: the native callout measures its child before
  // the text has laid out, and an unconstrained view collapses to the widest word.
  callout:       { width: 190, paddingVertical: 6, paddingHorizontal: 8, gap: 2 },
  calloutTitle:  { ...TYPOGRAPHY.body, fontSize: 13, fontWeight: '700', color: '#111' },
  calloutDetail: { fontSize: 12, color: '#444' },
  calloutAction: { fontSize: 12, color: COLORS.brand, fontWeight: '600' },
  eventBubble: {
    width: 20, height: 20, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: '#fff',
  },
});
