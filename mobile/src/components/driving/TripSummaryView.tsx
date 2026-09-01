import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, COMMON_STYLES, SPACING, TYPOGRAPHY } from '@/constants/theme';
import { ICONS } from '@/constants/icons';
import { formatTripDuration, formatTripDistance } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import { TripMapPlaceholder } from '@/components/driving/TripMapPlaceholder';
import { TripScoreGauge } from '@/components/driving/TripScoreGauge';
import { StatsGrid } from '@/components/ui/StatsGrid';
import type { TripSummary } from '@/lib/tripSummary';

interface TripSummaryViewProps {
  summary: TripSummary;
  /** Route still on its way from the server. Without it the map claims "route not
   *  available" for every trip whose fetch has simply not landed yet. */
  loadingRoute?: boolean;
}

/**
 * The whole body of a trip summary, for both places that show one: the modal right
 * after a trip and the trip-detail screen. Only the chrome around it differs, so only
 * the chrome lives in the wrappers.
 */
export function TripSummaryView({ summary, loadingRoute }: TripSummaryViewProps) {
  const { t } = useTranslation();

  if (summary.state === 'tooShort') {
    return (
      <View style={styles.stateBlock}>
        <Ionicons name={ICONS.noLocation} size={60} color={COLORS.textMuted} style={{ marginBottom: 20 }} />
        <Text style={styles.stateTitle}>{t('trip.noTripDetected')}</Text>
        <Text style={styles.stateText}>{t('trip.noTripDetectedDesc')}</Text>
      </View>
    );
  }

  const pending = summary.state === 'pending';

  return (
    <View style={styles.body}>
      {pending ? (
        // No gauge at all rather than a gauge reading zero: the server is the only
        // scoring oracle, and a 0 here told the driver they drove badly when the app
        // had simply never reached it.
        <View style={styles.stateBlock}>
          <Ionicons name={ICONS.notSent} size={44} color={COLORS.textMuted} style={{ marginBottom: 12 }} />
          <Text style={styles.stateText}>{t('trip.notSent')}</Text>
        </View>
      ) : (
        <>
          <TripScoreGauge score={summary.score} />
          <Text style={styles.scoreLabel}>{t('trip.finalScore')}</Text>
        </>
      )}

      <StatsGrid columns={4} variant="compact" items={[
        // Duration and distance are the device's own measurement and hold in every
        // state; points and the multiplier are the server's alone, so with no answer
        // they say nothing rather than repeating the zero the gauge was removed for.
        { icon: ICONS.duration, label: t('trip.duration'),       value: formatTripDuration(summary.durationSeconds) },
        { icon: ICONS.distance, label: t('trip.distance'),       value: formatTripDistance(summary.distanceKm) },
        { icon: ICONS.points,   label: t('trip.points'),         value: pending ? '--' : `+${summary.points}` },
        { icon: ICONS.flash,    label: t('trip.riskMultiplier'), value: pending ? '--' : `x${summary.effectiveRiskMultiplier.toFixed(2)}` },
      ]} />

      {summary.pointsCapped && (
        <View style={COMMON_STYLES.noticeRow}>
          <Ionicons name="information-circle-outline" size={16} color={COLORS.textMuted} />
          <Text style={COMMON_STYLES.noticeText}>{t('trip.pointsCapped')}</Text>
        </View>
      )}

      {/* Route + bad-event markers (route shown when GPS waypoints exist) */}
      <View style={styles.mapWrapper}>
        {loadingRoute && !summary.routeWaypoints.length
          ? <View style={styles.mapLoading}><ActivityIndicator color={COLORS.brand} /></View>
          : <TripMapPlaceholder waypoints={summary.routeWaypoints} events={summary.events} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body:       { width: '100%', alignItems: 'center' },
  stateBlock: { alignItems: 'center', paddingVertical: 20 },
  stateTitle: { ...TYPOGRAPHY.h2, fontSize: 26, marginBottom: SPACING.md, textAlign: 'center' },
  stateText:  { ...TYPOGRAPHY.body, color: COLORS.textMuted, textAlign: 'center' },
  scoreLabel: { ...TYPOGRAPHY.caption, fontSize: 13, marginBottom: SPACING.md },
  mapWrapper: { width: '100%' },
  // Same footprint as the map it stands in for, so the screen does not jump when the
  // route lands (TripMapPlaceholder: height 220, marginTop 20, radius 16).
  mapLoading: {
    height: 220, marginTop: 20, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.card,
  },
});
