import React from 'react';
import { View, Text, StyleSheet, Alert, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '@/context/AppContext';
import { useTranslation } from '@/hooks/useTranslation';
import { COLORS, TYPOGRAPHY, SPACING } from '@/constants/theme';
import { ActiveTripMonitor } from '@/components/driving/ActiveTripMonitor';

import { ActiveTripHeader } from '@/components/driving/ActiveTripHeader';

/**
 * מסך נסיעה פעילה.
 * מוצג אוטומטית על ידי ה-Dashboard כאשר tripState.isActive הוא true.
 */
export default function ActiveTripScreen() {
  const insets = useSafeAreaInsets();
  const { tripState, endTrip, user, debugAddDistance } = useApp();
  const { t } = useTranslation();

  // הצגת כלי ניהול אם המשתמש אדמין או שהשם שלו מכיל "מנהל" (לצורך הדמו)
  const showDebug = user?.role === 'admin' || user?.name?.includes('מנהל');

  const handleEndTrip = async () => {
    // הצגת שאלת אישור לפני סיום הנסיעה
    Alert.alert(
      t('trip.endTripConfirm'),
      t('trip.endTripMessage'),
      [
        {
          text: t('common.cancel'),
          style: 'cancel'
        },
        {
          text: t('trip.endBtn'),
          style: 'destructive',
          onPress: async () => {
            // קריאה לסיום נסיעה - ה-Dashboard יטפל בהצגת הסיכום
            await endTrip();
          }
        }
      ]
    );
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <ActiveTripHeader />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <ActiveTripMonitor
          tripState={tripState}
          onEnd={handleEndTrip}
          showDebug={showDebug}
          onDebugAddDistance={debugAddDistance}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.dark },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: SPACING.lg,
    marginTop: 10
  },
  title: { ...TYPOGRAPHY.h2, color: '#fff' },
  liveIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.2)'
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.danger, marginEnd: 6 },
  liveText: { color: COLORS.danger, fontSize: 12, fontWeight: '900' },
  scrollView: { flex: 1 },
  scrollContent: {
    paddingHorizontal: SPACING.lg,
    paddingBottom: 60,
    flexGrow: 1
  }
});
