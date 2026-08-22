import React from 'react';
import { View, Text, StyleSheet, Modal, ScrollView, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { COLORS, SPACING, TYPOGRAPHY, COMMON_STYLES } from '@/constants/theme';
import { ICONS } from '@/constants/icons';
import { formatTripDuration, formatTripDistance } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import { TripMapPlaceholder } from '@/components/driving/TripMapPlaceholder';
import { TripScoreGauge } from '@/components/driving/TripScoreGauge';
import { StatsGrid } from '@/components/ui/StatsGrid';
import type { RouteWaypoint, DrivingEvent } from '@/lib/driving-sdk/types';

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
  currentStreak?: number | null;
  bestStreak?: number | null;
}

export function TripSummaryModal({ visible, onClose, trip, onViewDetails, currentStreak, bestStreak }: TripSummaryModalProps) {
  const { t } = useTranslation();

  if (!trip) return null;

  const isTooShort = trip.isTooShort || (trip.distanceKm < 0.1);

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={COMMON_STYLES.modalOverlay}>
        <Card style={styles.summaryCard}>
          {/* The buttons that close this sit below the fold, and the card gives no
              sign it scrolls — so the exit has to be visible without scrolling. */}
          <TouchableOpacity
            onPress={onClose}
            accessibilityLabel={t('trip.close')}
            hitSlop={10}
            style={styles.closeBtn}
          >
            <Ionicons name="close" size={22} color={COLORS.textMuted} />
          </TouchableOpacity>

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
                  <TripScoreGauge score={trip.score} />
                  <Text style={styles.scoreLabel}>{t('trip.finalScore')}</Text>

                  {/* Same component and variant as the trip-detail screen, so the two
                      screens show one row of stats rather than two lookalikes that
                      drift apart. Replaces a hand-built copy of the same four boxes. */}
                  <StatsGrid columns={4} variant="compact" items={[
                    { icon: ICONS.duration, label: t('trip.duration'),       value: formatTripDuration(trip.durationSeconds ?? 0) },
                    { icon: ICONS.distance, label: t('trip.distance'),       value: formatTripDistance(trip.distanceKm ?? 0) },
                    { icon: ICONS.points,   label: t('trip.points'),         value: `+${trip.points || 0}` },
                    { icon: ICONS.flash,    label: t('trip.riskMultiplier'), value: `x${(trip.effectiveRiskMultiplier ?? 1).toFixed(2)}` },
                  ]} />

                  {trip.pointsCapped && (
                    <View style={styles.cappedNotice}>
                      <Ionicons name="information-circle-outline" size={16} color={COLORS.textMuted} />
                      <Text style={styles.cappedNoticeText}>{t('trip.pointsCapped')}</Text>
                    </View>
                  )}

                  {currentStreak !== undefined && bestStreak !== undefined && (
                    <View style={styles.streakNotice}>
                      <Ionicons name={ICONS.streak} size={16} color={COLORS.textMuted} />
                      <Text style={styles.streakNoticeText}>
                        {t('stats.currentStreak')}: {currentStreak ?? '--'} · {t('stats.bestStreak')}: {bestStreak ?? '--'}
                      </Text>
                    </View>
                  )}

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
  // `start`, not `left` — the card's own direction decides which corner this is,
  // and the X belongs opposite the text, on the leading edge.
  closeBtn: {
    position: 'absolute', top: 12, start: 12, zIndex: 2,
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.card,
  },
  scoreLabel:     { ...TYPOGRAPHY.caption, fontSize: 13, marginBottom: SPACING.md },
  cappedNotice: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'stretch', marginBottom: SPACING.md,
    backgroundColor: COLORS.card, borderRadius: 14,
    paddingVertical: 8, paddingHorizontal: 12,
  },
  cappedNoticeText: { ...TYPOGRAPHY.caption, color: COLORS.textMuted, fontSize: 12, flex: 1 },
  streakNotice: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'stretch', marginBottom: SPACING.md,
    backgroundColor: COLORS.card, borderRadius: 14,
    paddingVertical: 8, paddingHorizontal: 12,
  },
  streakNoticeText: { ...TYPOGRAPHY.caption, color: COLORS.textMuted, fontSize: 12, flex: 1 },
  mapWrapper:  { width: '100%' },
});
