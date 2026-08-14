import React from 'react';
import { View, Text, StyleSheet, Modal, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { COLORS, SPACING, TYPOGRAPHY, COMMON_STYLES } from '@/constants/theme';
import { ICONS } from '@/constants/icons';
import { scoreToColor } from '@/lib/scoring';
import { formatDuration, formatDistance } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import { TripMapPlaceholder } from '@/components/driving/TripMapPlaceholder';
import type { RouteWaypoint, DrivingEvent } from '@/lib/driving-sdk/types';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

interface TripSummaryModalProps {
  visible: boolean;
  onClose: () => void;
  trip: {
    id?: string;
    score: number;
    distanceKm: number;
    durationSeconds?: number;
    points: number;
    effectiveRiskMultiplier?: number;
    pointsCapped?: boolean;
    eventCounts?: Record<string, number>;
    touchEpochs?: number;
    isTooShort?: boolean;
    routeWaypoints?: RouteWaypoint[];
    tripEvents?: DrivingEvent[];
  } | null;
  onViewDetails?: (id: string) => void;
}

export function TripSummaryModal({ visible, onClose, trip, onViewDetails }: TripSummaryModalProps) {
  const { t, lang } = useTranslation();

  if (!trip) return null;

  const isTooShort = trip.isTooShort || (trip.distanceKm < 0.1);

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={COMMON_STYLES.modalOverlay}>
        <Card style={styles.summaryCard}>
          {isTooShort ? (
            <View style={{ alignItems: 'center', paddingVertical: 20 }}>
              <Ionicons name={ICONS.noLocation} size={60} color={COLORS.textMuted} style={{ marginBottom: 20 }} />
              <Text style={[styles.summaryTitle, { textAlign: 'center' }]}>{t('trip.noTripDetected')}</Text>
              <Text style={[TYPOGRAPHY.body, { textAlign: 'center', color: COLORS.textMuted, marginBottom: 30 }]}>
                {t('trip.noTripDetectedDesc')}
              </Text>
              <Button fullWidth size="xl" onPress={onClose} textStyle={{ textAlign: 'center' }}>
                {t('trip.gotIt')}
              </Button>
            </View>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false} style={{ width: '100%' }}>
              <View style={{ alignItems: 'center' }}>
                <Text style={styles.summaryTitle}>{t('trip.tripCompleted')}</Text>

                <View style={styles.resultsContainer}>
                  <View style={[styles.scoreCircle, { borderColor: scoreToColor(trip.score) }]}>
                    <Text style={[styles.scoreValue, { color: scoreToColor(trip.score) }]}>
                      {Math.round(trip.score)}
                    </Text>
                    <Text style={styles.scoreLabel}>{t('trip.finalScore')}</Text>
                  </View>

                  <View style={styles.statsGrid}>
                    <View style={styles.statBox}>
                      <Ionicons name={ICONS.duration} size={18} color={COLORS.textMuted} style={{ marginBottom: 4 }} />
                      <Text style={styles.statValueSmall}>{formatDuration(trip.durationSeconds ?? 0, lang)}</Text>
                      <Text style={styles.statLabelSmall}>{t('trip.duration')}</Text>
                    </View>
                    <View style={[styles.statBox, styles.statBoxMiddle]}>
                      <Ionicons name={ICONS.distance} size={18} color={COLORS.textMuted} style={{ marginBottom: 4 }} />
                      <Text style={styles.statValueSmall}>{formatDistance(trip.distanceKm ?? 0, lang)}</Text>
                      <Text style={styles.statLabelSmall}>{t('trip.distance')}</Text>
                    </View>
                    <View style={[styles.statBox, styles.statBoxMiddle]}>
                      <Ionicons name={ICONS.points} size={18} color={COLORS.brand} style={{ marginBottom: 4 }} />
                      <Text style={[styles.statValueSmall, { color: COLORS.brand }]}>+{trip.points || 0}</Text>
                      <Text style={styles.statLabelSmall}>{t('trip.points')}</Text>
                    </View>
                    <View style={styles.statBox}>
                      <Ionicons name={ICONS.flash} size={18} color={COLORS.textMuted} style={{ marginBottom: 4 }} />
                      <Text style={styles.statValueSmall}>x{(trip.effectiveRiskMultiplier ?? 1).toFixed(2)}</Text>
                      <Text style={styles.statLabelSmall}>{t('trip.riskMultiplier')}</Text>
                    </View>
                  </View>

                  {trip.pointsCapped && (
                    <View style={styles.cappedNotice}>
                      <Ionicons name="information-circle-outline" size={16} color={COLORS.textMuted} />
                      <Text style={styles.cappedNoticeText}>{t('trip.pointsCapped')}</Text>
                    </View>
                  )}

                  <View style={styles.eventsList}>
                    <Text style={styles.eventsTitle}>{t('trip.eventDetails')}</Text>
                    <EventRow icon={ICONS.hardBrake}       label={t('trip.hardBrakes')}      count={trip.eventCounts?.HARD_BRAKE || 0} />
                    <EventRow icon={ICONS.aggressiveAccel} label={t('trip.aggressiveAccels')} count={trip.eventCounts?.AGGRESSIVE_ACCEL || 0} />
                    <EventRow icon={ICONS.sharpTurn}  label={t('trip.sharpTurns')}   count={trip.eventCounts?.SHARP_TURN || 0} />
                    {/* <EventRow icon={ICONS.swerve} label={t('trip.swerve')} count={trip.eventCounts?.SWERVE || 0} /> */}{/* EVT_SWERVE disabled */}
                    <EventRow icon={ICONS.phoneUsage} label={t('trip.phoneTouches')} count={trip.touchEpochs || 0} />
                  </View>

                  {/* Route + bad-event markers on the map (route shown when GPS waypoints exist) */}
                  <View style={styles.mapWrapper}>
                    <TripMapPlaceholder waypoints={trip.routeWaypoints} events={trip.tripEvents} />
                  </View>
                </View>

                {trip.id && onViewDetails && (
                  <Button
                    fullWidth
                    variant="outline"
                    onPress={() => onViewDetails(trip.id!)}
                    style={{ marginTop: 24 }}
                  >
                    {t('trip.viewFullDetails')}
                  </Button>
                )}

                <Button fullWidth onPress={onClose} style={{ marginTop: 12, marginBottom: 10 }}>
                  {t('trip.closeAndHome')}
                </Button>
              </View>
            </ScrollView>
          )}
        </Card>
      </View>
    </Modal>
  );
}

function EventRow({ icon, label, count }: { icon: IoniconName; label: string; count: number }) {
  return (
    <View style={styles.eventRow}>
      <Ionicons name={icon} size={16} color={count > 0 ? COLORS.danger : COLORS.textMuted} style={{ width: 22 }} />
      <Text style={styles.eventLabel}>{label}</Text>
      <Text style={[styles.eventCount, count > 0 && { color: COLORS.danger }]}>{count}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  summaryCard: {
    paddingHorizontal: 20,
    paddingVertical: 25,
    alignItems: 'center',
    width: '94%',
    maxHeight: '92%',
    borderRadius: 35,
    backgroundColor: COLORS.dark,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  summaryTitle:     { ...TYPOGRAPHY.h2, fontSize: 26, marginBottom: SPACING.md },
  resultsContainer: { width: '100%', alignItems: 'center' },
  scoreCircle: {
    width: 130, height: 130, borderRadius: 65, borderWidth: 8,
    justifyContent: 'center', alignItems: 'center',
    marginBottom: SPACING.md, backgroundColor: 'transparent'
  },
  scoreValue:     { fontSize: 48, fontWeight: '900' },
  scoreLabel:     { ...TYPOGRAPHY.caption, fontSize: 13 },
  statsGrid:      { flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.md, alignSelf: 'stretch' },
  statBox: {
    flex: 1, backgroundColor: COLORS.card,
    paddingVertical: 14, paddingHorizontal: 6,
    borderRadius: 20, alignItems: 'center',
    borderWidth: 1, borderColor: COLORS.border
  },
  statBoxMiddle: {
    borderLeftWidth: 1, borderRightWidth: 1,
    borderLeftColor: COLORS.border, borderRightColor: COLORS.border,
  },
  statValueSmall: { ...TYPOGRAPHY.h2, fontSize: 18 },
  statLabelSmall: { ...TYPOGRAPHY.caption, fontSize: 11, marginTop: 2, textAlign: 'center' },
  cappedNotice: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'stretch', marginBottom: SPACING.md,
    backgroundColor: COLORS.card, borderRadius: 14,
    paddingVertical: 8, paddingHorizontal: 12,
  },
  cappedNoticeText: { ...TYPOGRAPHY.caption, color: COLORS.textMuted, fontSize: 12, flex: 1 },
  eventsList: {
    width: '100%', gap: 2,
    backgroundColor: COLORS.card,
    padding: 12, borderRadius: 20
  },
  mapWrapper:  { width: '100%' },
  eventsTitle: { ...TYPOGRAPHY.h3, fontSize: 16, marginBottom: 4 },
  eventRow:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 3 },
  eventLabel:  { ...TYPOGRAPHY.body, color: COLORS.textMuted, fontSize: 14, flex: 1, marginStart: 6 },
  eventCount:  { ...TYPOGRAPHY.label, color: COLORS.text, fontSize: 15 },
});
