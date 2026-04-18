import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Modal } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ActiveTripMonitor } from '@/components/driving/ActiveTripMonitor';
import { useApp } from '@/context/AppContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useTrip } from '@/hooks/useTrip';
import { COLORS } from '@/lib/constants';
import { scoreToColor } from '@/lib/scoring';

export default function ActiveTripScreen() {
  const router = useRouter();
  const { addToast } = useApp();
  const { t } = useTranslation();
  const { state, startTrip, endTrip } = useTrip();
  const [loading, setLoading] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [tripSummary, setTripSummary] = useState<any>(null);

  async function handleStart() {
    setLoading(true);
    try {
      await startTrip();
      addToast({ type: 'success', message: '🚗 נסיעה התחילה - נסיעה טובה!', duration: 2000 });
    } catch (e) {
      addToast({ type: 'error', message: 'שגיאה בהפעלת הנסיעה' });
    } finally {
      setLoading(false);
    }
  }

  async function handleEnd() {
    setLoading(true);
    try {
      const finalState = await endTrip();

      const score = Math.max(0, 100 - (finalState.eventCounts.HARD_BRAKE * 5) - (finalState.eventCounts.PHONE_TOUCH * 10));
      const points = Math.round(finalState.distanceKm * 15) + 50;

      setTripSummary({
        ...finalState,
        score,
        points
      });
      setShowSummary(true);
    } catch (e) {
      addToast({ type: 'error', message: 'שגיאה בסיום הנסיעה' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.heading}>{t('trip.active')}</Text>

        {state.isActive ? (
          <ActiveTripMonitor state={state} onEnd={handleEnd} loading={loading} />
        ) : (
          <Card glass style={styles.startCard}>
            <Text style={styles.startIcon}>🚗</Text>
            <Text style={styles.startTitle}>{t('trip.start')}</Text>
            <Text style={styles.startNote}>{t('trip.simulationNote')}</Text>
            <Button size="xl" onPress={handleStart} loading={loading} style={{ marginTop: 16 }}>
              {t('trip.start')}
            </Button>
          </Card>
        )}
      </ScrollView>

      <Modal visible={showSummary} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <Card style={styles.summaryCard}>
            <Text style={styles.summaryTitle}>נסיעה הושלמה! 🎉</Text>

            {tripSummary && (
              <View style={styles.resultsContainer}>
                <View style={styles.scoreCircle}>
                  <Text style={[styles.scoreValue, { color: scoreToColor(tripSummary.score) }]}>
                    {Math.round(tripSummary.score)}
                  </Text>
                  <Text style={styles.scoreLabel}>ציון סופי</Text>
                </View>

                <View style={styles.statsGrid}>
                  <View style={styles.statBox}>
                    <Text style={styles.statValueSmall}>{tripSummary.distanceKm.toFixed(2)}</Text>
                    <Text style={styles.statLabelSmall}>ק"מ</Text>
                  </View>
                  <View style={styles.statBox}>
                    <Text style={[styles.statValueSmall, { color: COLORS.brand }]}>+{tripSummary.points}</Text>
                    <Text style={styles.statLabelSmall}>נקודות</Text>
                  </View>
                </View>

                <View style={styles.eventsList}>
                  <Text style={styles.eventsTitle}>פירוט אירועים:</Text>
                  <View style={styles.eventRow}>
                    <Text style={styles.eventLabel}>🛑 בלימות חדות</Text>
                    <Text style={styles.eventCount}>{tripSummary.eventCounts.HARD_BRAKE}</Text>
                  </View>
                  <View style={styles.eventRow}>
                    <Text style={styles.eventLabel}>📱 נגיעות בטלפון</Text>
                    <Text style={styles.eventCount}>{tripSummary.eventCounts.PHONE_TOUCH}</Text>
                  </View>
                  <View style={styles.eventRow}>
                    <Text style={styles.eventLabel}>🔄 פניות חדות</Text>
                    <Text style={styles.eventCount}>{tripSummary.eventCounts.SHARP_TURN}</Text>
                  </View>
                </View>
              </View>
            )}

            <Button fullWidth onPress={() => { setShowSummary(false); router.replace('/dashboard'); }} style={{ marginTop: 24 }}>
              סגור וחזור לדף הבית
            </Button>
          </Card>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.dark },
  content: { padding: 16, paddingTop: 60 },
  heading: { color: '#fff', fontSize: 24, fontWeight: '900', marginBottom: 20 },
  startCard: { alignItems: 'center', padding: 32, gap: 8 },
  startIcon: { fontSize: 64, marginBottom: 8 },
  startTitle: { color: '#fff', fontSize: 22, fontWeight: '800' },
  startNote: { color: COLORS.textMuted, textAlign: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', padding: 20 },
  summaryCard: { padding: 24, alignItems: 'center', width: '100%' },
  summaryTitle: { color: '#fff', fontSize: 24, fontWeight: '900', marginBottom: 20 },
  resultsContainer: { width: '100%', alignItems: 'center' },
  scoreCircle: { width: 130, height: 130, borderRadius: 65, borderWidth: 8, borderColor: 'rgba(255,255,255,0.1)', justifyContent: 'center', alignItems: 'center', marginBottom: 24 },
  scoreValue: { fontSize: 48, fontWeight: '900' },
  scoreLabel: { color: COLORS.textMuted, fontSize: 13 },
  statsGrid: { flexDirection: 'row', gap: 16, marginBottom: 32, width: '100%' },
  statBox: { flex: 1, backgroundColor: 'rgba(255,255,255,0.05)', padding: 16, borderRadius: 16, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  statValueSmall: { color: '#fff', fontSize: 22, fontWeight: '800' },
  statLabelSmall: { color: COLORS.textMuted, fontSize: 12, marginTop: 4 },
  eventsList: { width: '100%', gap: 12, backgroundColor: 'rgba(0,0,0,0.2)', padding: 16, borderRadius: 16 },
  eventsTitle: { color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 8 },
  eventRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  eventLabel: { color: COLORS.textMuted, fontSize: 14 },
  eventCount: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
