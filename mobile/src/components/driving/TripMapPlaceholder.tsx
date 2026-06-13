import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
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
    return (
      <Card glass style={styles.fallback}>
        <Ionicons name={ICONS.roadmap} size={30} color={COLORS.textMuted} />
        <Text style={styles.fallbackText}>{t('trip.mapUnavailable')}</Text>
      </Card>
    );
  }

  return (
    <View style={styles.container}>
      <MapView style={styles.map} initialRegion={region} scrollEnabled={false} zoomEnabled={false}>
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
  );
}

const styles = StyleSheet.create({
  container: { marginTop: 20, borderRadius: 16, overflow: 'hidden', height: 220 },
  map:       { flex: 1 },
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
