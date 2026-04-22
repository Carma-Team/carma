import React from 'react';
import { View, Text, StyleSheet, Modal, ScrollView } from 'react-native';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { COLORS, SPACING, TYPOGRAPHY, COMMON_STYLES } from '@/lib/constants';
import { scoreToColor } from '@/lib/scoring';
import { useTranslation } from '@/hooks/useTranslation';

interface TripSummaryModalProps {
  visible: boolean;
  onClose: () => void;
  trip: {
    id?: string;
    score: number;
    distanceKm: number;
    points: number;
    eventCounts?: Record<string, number>;
    isTooShort?: boolean;
  } | null;
  onViewDetails?: (id: string) => void;
}

export function TripSummaryModal({ visible, onClose, trip, onViewDetails }: TripSummaryModalProps) {
  const { t } = useTranslation();

  if (!trip) return null;

  // אם הנסיעה הייתה קצרה מדי או שלא זוהתה תנועה
  const isTooShort = trip.isTooShort || (trip.distanceKm < 0.1);

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={COMMON_STYLES.modalOverlay}>
        <Card style={styles.summaryCard}>
          {isTooShort ? (
            <View style={{ alignItems: 'center', paddingVertical: 20 }}>
              <Text style={{ fontSize: 60, marginBottom: 20 }}>📍</Text>
              <Text style={[styles.summaryTitle, { textAlign: 'center' }]}>לא זוהתה נסיעה משמעותית</Text>
              <Text style={[TYPOGRAPHY.body, { textAlign: 'center', color: COLORS.textMuted, marginBottom: 30 }]}>
                הנסיעה לא נשמרה ביומן מכיוון שלא נרשם מרחק נסיעה מספק (לפחות 100 מטרים).
              </Text>
              <Button fullWidth size="xl" onPress={onClose}>
                הבנתי, תודה
              </Button>
            </View>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false} style={{ width: '100%' }}>
              <View style={{ alignItems: 'center' }}>
                <Text style={styles.summaryTitle}>נסיעה הושלמה! 🎉</Text>

                <View style={styles.resultsContainer}>
                  <View style={[styles.scoreCircle, { borderColor: scoreToColor(trip.score) }]}>
                    <Text style={[styles.scoreValue, { color: scoreToColor(trip.score) }]}>
                      {Math.round(trip.score)}
                    </Text>
                    <Text style={styles.scoreLabel}>ציון סופי</Text>
                  </View>

                  <View style={styles.statsGrid}>
                    <View style={styles.statBox}>
                      <Text style={styles.statValueSmall}>{trip.distanceKm?.toFixed(2) || '0.00'}</Text>
                      <Text style={styles.statLabelSmall}>ק"מ</Text>
                    </View>
                    <View style={styles.statBox}>
                      <Text style={[styles.statValueSmall, { color: COLORS.brand }]}>+{trip.points || 0}</Text>
                      <Text style={styles.statLabelSmall}>נקודות</Text>
                    </View>
                  </View>

                  <View style={styles.eventsList}>
                    <Text style={styles.eventsTitle}>פירוט אירועים:</Text>

                    <EventRow
                      icon="🛑"
                      label="בלימות חדות"
                      count={trip.eventCounts?.HARD_BRAKE || 0}
                    />
                    <EventRow
                      icon="🚀"
                      label="האצות פתאומיות"
                      count={trip.eventCounts?.AGGRESSIVE_ACCEL || 0}
                    />
                    <EventRow
                      icon="↩️"
                      label="פניות חדות"
                      count={trip.eventCounts?.SHARP_TURN || 0}
                    />
                    <EventRow
                      icon="📱"
                      label="נגיעות בטלפון"
                      count={trip.eventCounts?.PHONE_TOUCH || 0}
                    />
                  </View>
                </View>

                {trip.id && onViewDetails && (
                  <Button
                    fullWidth
                    variant="outline"
                    onPress={() => onViewDetails(trip.id!)}
                    style={{ marginTop: 24 }}
                  >
                    🔍 לצפייה בפרטים המלאים
                  </Button>
                )}

                <Button fullWidth onPress={onClose} style={{ marginTop: 12, marginBottom: 10 }}>
                  סגור וחזור לדף הבית
                </Button>
              </View>
            </ScrollView>
          )}
        </Card>
      </View>
    </Modal>
  );
}

function EventRow({ icon, label, count }: { icon: string, label: string, count: number }) {
  return (
    <View style={styles.eventRow}>
      <Text style={styles.eventLabel}>{icon} {label}</Text>
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
    backgroundColor: '#1A1A1A',
    borderWidth: 0.3,
    borderColor: 'rgba(255,255,255,0.15)'
  },
  summaryTitle: { ...TYPOGRAPHY.h2, fontSize: 26, marginBottom: SPACING.md },
  resultsContainer: { width: '100%', alignItems: 'center' },
  scoreCircle: {
    width: 130,
    height: 130,
    borderRadius: 65,
    borderWidth: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: SPACING.md,
    backgroundColor: 'rgba(255,255,255,0.02)'
  },
  scoreValue: { fontSize: 48, fontWeight: '900' },
  scoreLabel: { ...TYPOGRAPHY.caption, fontSize: 13 },
  statsGrid: { flexDirection: 'row', gap: SPACING.md, marginBottom: SPACING.md, width: '100%' },
  statBox: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.05)',
    paddingVertical: 12,
    paddingHorizontal: SPACING.sm,
    borderRadius: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)'
  },
  statValueSmall: { ...TYPOGRAPHY.h2, fontSize: 24 },
  statLabelSmall: { ...TYPOGRAPHY.caption, fontSize: 13, marginTop: 2 },
  eventsList: {
    width: '100%',
    gap: 2,
    backgroundColor: 'rgba(0,0,0,0.2)',
    padding: 12,
    borderRadius: 20
  },
  eventsTitle: { ...TYPOGRAPHY.h3, fontSize: 16, marginBottom: 4 },
  eventRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 3
  },
  eventLabel: { ...TYPOGRAPHY.body, color: COLORS.textMuted, fontSize: 14 },
  eventCount: { ...TYPOGRAPHY.label, color: '#fff', fontSize: 15 },
});
