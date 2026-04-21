import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ActiveTripMonitor } from '@/components/driving/ActiveTripMonitor';
import { useApp } from '@/context/AppContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useTrip } from '@/hooks/useTrip';
import { COLORS, COMMON_STYLES, SPACING, TYPOGRAPHY } from '@/lib/constants';
import { Ionicons } from '@expo/vector-icons';

export default function ActiveTripScreen() {
  const insets = useSafeAreaInsets();
  const { addToast, registerPhoneTouch } = useApp();
  const { t } = useTranslation();
  const { state, startTrip, endTrip } = useTrip();
  const [loading, setLoading] = useState(false);

  // זיהוי מעבר בין טאבים (עזיבת המסך) בזמן נסיעה
  useFocusEffect(
    useCallback(() => {
      // הקוד הזה רץ כשהמסך מקבל פוקוס
      return () => {
        // הקוד הזה רץ כשהמסך מאבד פוקוס (המשתמש עובר לטאב אחר)
        if (state.isActive) {
          console.log('[ActiveTrip] Screen lost focus - registering phone touch');
          registerPhoneTouch();
        }
      };
    }, [state.isActive, registerPhoneTouch])
  );

  async function handleStart() {
    setLoading(true);
    try {
      await startTrip();
    } catch (e) {
      addToast({ type: 'error', message: 'שגיאה בהפעלת הנסיעה' });
    } finally {
      setLoading(false);
    }
  }

  async function handleEnd() {
    setLoading(true);
    try {
      await endTrip();
      // הטיפול בסיכום הנסיעה עבר ל-DashboardScreen כדי למנוע את סגירת המודל
    } catch (e) {
      addToast({ type: 'error', message: 'שגיאה בסיום הנסיעה' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={[COMMON_STYLES.screen, { paddingTop: Math.max(insets.top, 20) }]}>
      <ScrollView style={styles.root} contentContainerStyle={COMMON_STYLES.scrollContent}>
        <Text style={styles.heading}>{t('trip.active')}</Text>

        {state.isActive ? (
          <ActiveTripMonitor state={state} onEnd={handleEnd} loading={loading} />
        ) : (
          <View style={styles.startTripContainer}>
            <Card glass style={styles.startCard}>
              <View style={styles.iconCircle}>
                <Ionicons name="car-sport" size={80} color={COLORS.brand} />
              </View>
              <Text style={styles.startTitle}>{t('trip.start')}</Text>
              <Text style={styles.startNote}>
                המערכת תתחיל לנטר את הנסיעה שלך באופן אוטומטי ברגע שתתחיל לנהוג, או לחץ על הכפתור למטה.
              </Text>
              <Button size="xl" onPress={handleStart} loading={loading} style={styles.startButton}>
                {t('trip.start')}
              </Button>
            </Card>

            <View style={styles.tipBox}>
              <Ionicons name="bulb-outline" size={20} color={COLORS.brand} />
              <Text style={styles.tipText}>טיפ: נהיגה בטוחה מזכה אותך ביותר נקודות ובפרסים בחנות!</Text>
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.dark },
  heading: { ...TYPOGRAPHY.h2, fontSize: 28, marginBottom: SPACING.lg },
  startTripContainer: { gap: SPACING.md },
  startCard: { alignItems: 'center', padding: SPACING.xl, borderRadius: 30 },
  iconCircle: { width: 130, height: 130, borderRadius: 65, backgroundColor: 'rgba(99, 102, 241, 0.1)', justifyContent: 'center', alignItems: 'center', marginBottom: SPACING.lg },
  startTitle: { ...TYPOGRAPHY.h2, fontSize: 26, marginBottom: 12 },
  startNote: { ...TYPOGRAPHY.body, color: COLORS.textMuted, textAlign: 'center', fontSize: 16, lineHeight: 24, marginBottom: SPACING.lg },
  startButton: { width: '100%', borderRadius: 18 },
  tipBox: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: SPACING.md, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 15 },
  tipText: { ...TYPOGRAPHY.caption, fontSize: 14, flex: 1 },
});
