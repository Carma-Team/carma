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
  summary: {
    score: number;
    distanceKm: number;
    points: number;
    eventCounts?: Record<string, number>;
    noMovement?: boolean;
  } | null;
}

export function TripSummaryModal({ visible, onClose, summary }: TripSummaryModalProps) {
  const { t } = useTranslation();

  if (!summary) return null;

  const isNoMovement = summary.noMovement || (summary.distanceKm < 0.01);

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={COMMON_STYLES.modalOverlay}>
        <Card style={styles.summaryCard}>
          {isNoMovement ? (
            <View style={{ alignItems: 'center', paddingVertical: 20 }}>
              <Text style={{ fontSize: 60, marginBottom: 20 }}>📍</Text>
              <Text style={[styles.summaryTitle, { textAlign: 'center' }]}>לא זוהתה תנועה משמעותית</Text>
              <Text style={[TYPOGRAPHY.body, { textAlign: 'center', color: COLORS.textMuted, marginBottom: 20 }]}>
                הנסיעה לא נשמרה ביומן מכיוון שלא נרשם מרחק נסיעה מספק (לפחות 10 מטרים).
              </Text>
              <Button fullWidth onPress={onClose}>
                הבנתי, תודה
              </Button>
            </View>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false} style={{ width: '100%' }}>
              <View style={{ alignItems: 'center' }}>
                <Text style={styles.summaryTitle}>נסיעה הושלמה! 🎉</Text>

                <View style={styles.resultsContainer}>
                  <View style={[styles.scoreCircle, { borderColor: scoreToColor(summary.score) }]}>
                    <Text style={[styles.scoreValue, { color: scoreToColor(summary.score) }]}>
                      {Math.round(summary.score)}
                    </Text>
                    <Text style={styles.scoreLabel}>ציון סופי</Text>
                  </View>

                  <View style={styles.statsGrid}>
                    <View style={styles.statBox}>
                      <Text style={styles.statValueSmall}>{summary.distanceKm?.toFixed(2) || '0.00'}</Text>
                      <Text style={styles.statLabelSmall}>ק"מ</Text>
                    </View>
                    <View style={styles.statBox}>
                      <Text style={[styles.statValueSmall, { color: COLORS.brand }]}>+{summary.points || 0}</Text>
                      <Text style={styles.statLabelSmall}>נקודות</Text>
                    </View>
                  </View>

                  <View style={styles.eventsList}>
                    <Text style={styles.eventsTitle}>פירוט אירועים:</Text>

                    <EventRow
                      icon="🛑"
                      label="בלימות חדות"
                      count={summary.eventCounts?.HARD_BRAKE || 0}
                    />
                    <EventRow
                      icon="🚀"
                      label="האצות פתאומיות"
                      count={summary.eventCounts?.AGGRESSIVE_ACCEL || 0}
                    />
                    <EventRow
                      icon="↩️"
                      label="פניות חדות"
                      count={summary.eventCounts?.SHARP_TURN || 0}
                    />
                    <EventRow
                      icon="📱"
                      label="נגיעות בטלפון"
                      count={summary.eventCounts?.PHONE_USAGE || summary.eventCounts?.PHONE_TOUCH || 0}
                    />
                  </View>
                </View>

                <Button fullWidth onPress={onClose} style={{ marginTop: 24, marginBottom: 10 }}>
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
      <Text style={[styles.eventCount, count > 0 && { color: COLORS.error }]}>{count}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  summaryCard: {
    paddingHorizontal: 20,
    paddingVertical: 25,
    alignItems: 'center',
    width: '94%',
    maxHeight: '92%', // הגדלת הגובה המקסימלי
    borderRadius: 35,
    backgroundColor: '#1A1A1A',
    borderWidth: 0.3,
    borderColor: 'rgba(255,255,255,0.15)'
  },
  summaryTitle: { ...TYPOGRAPHY.h2, fontSize: 26, marginBottom: SPACING.md },
  resultsContainer: { width: '100%', alignItems: 'center' },
  scoreCircle: {
    width: 130, // הקטנה קלה כדי לחסוך מקום אנכי
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
    paddingVertical: 12, // צמצום קל בפידינג
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
    gap: 2, // צמצום המרווח בין השורות
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
