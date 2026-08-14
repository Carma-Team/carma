import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// react-native-maps requires a native build (dev build / production).
// In Expo Go the native module is not linked — catch at require time so
// the screen degrades gracefully instead of crashing.
let MapView: any = null;
let Polyline: any = null;
let Marker:   any = null;
try {
  const maps = require('react-native-maps');
  MapView   = maps.default;
  Polyline  = maps.Polyline;
  Marker    = maps.Marker;
} catch {
  // Native module unavailable — map will show fallback card
}
import { Card } from '@/components/ui/Card';
import { COLORS, TYPOGRAPHY } from '@/constants/theme';
import { ICONS, type IoniconName } from '@/constants/icons';
import { useTranslation } from '@/hooks/useTranslation';
import type { DrivingEvent, DrivingEventType } from '@/lib/driving-sdk/types';

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

function openInExternalMaps(coordinates: { latitude: number; longitude: number }[]) {
  const origin = coordinates[0];
  const destination = coordinates[coordinates.length - 1];
  const url = `https://www.google.com/maps/dir/?api=1&origin=${origin.latitude},${origin.longitude}&destination=${destination.latitude},${destination.longitude}&travelmode=driving`;
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
      <MapView style={styles.map} initialRegion={region}>
        <Polyline
          coordinates={coordinates}
          strokeColor={COLORS.brand}
          strokeWidth={3}
        />

        {/* Start marker */}
        <Marker
          coordinate={coordinates[0]}
          anchor={{ x: 0.5, y: 0.5 }}
        >
          <View style={[styles.dot, styles.dotStart]} />
        </Marker>

        {/* End marker */}
        <Marker
          coordinate={coordinates[coordinates.length - 1]}
          anchor={{ x: 0.5, y: 0.5 }}
        >
          <View style={[styles.dot, styles.dotEnd]} />
        </Marker>

        {/* Event markers */}
        {eventsWithLocation.map((event, i) => (
          <Marker
            key={i}
            coordinate={{
              latitude:  event.location!.latitude,
              longitude: event.location!.longitude,
            }}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View style={[styles.eventBubble, { backgroundColor: EVENT_COLOR[event.type] ?? COLORS.warning }]}>
              <Ionicons
                name={EVENT_ICON[event.type] ?? ICONS.hardBrake}
                size={12}
                color="#fff"
              />
            </View>
          </Marker>
        ))}
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
  eventBubble: {
    width: 20, height: 20, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: '#fff',
  },
});
