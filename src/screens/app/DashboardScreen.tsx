import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Modal } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Progress } from '@/components/ui/Progress';
import { LevelBadge } from '@/components/gamification/LevelBadge';
import { TripCard } from '@/components/driving/TripCard';
import { useApp } from '@/context/AppContext';
import { useTranslation } from '@/hooks/useTranslation';
import { getLevelConfig, getLevelProgress, getPointsToNextLevel, COLORS, SPACING, TYPOGRAPHY, COMMON_STYLES } from '@/lib/constants';
import { formatDistance } from '@/lib/utils';
import { scoreToColor } from '@/lib/scoring';
import ActiveTripScreen from '@/screens/app/ActiveTripScreen';

export default function DashboardScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, setUser, recentTrips, isLoading, simulateBTConnect, tripState, startTrip, lastTripSummary, setLastTripSummary, clearTripHistory } = useApp();
  const { t, lang } = useTranslation();
  const [avgScore, setAvgScore] = useState<number | null>(null);

  // לוגיקה להצגת סיכום נסיעה
  const [showSummary, setShowSummary] = useState(false);
  const [tripSummary, setTripSummary] = useState<any>(null);

  // לוגיקה להגדרות
  const [showSettings, setShowSettings] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [devices, setDevices] = useState<{ id: string, name: string }[]>([])
  const [showDevicePicker, setShowDevicePicker] = useState(false)

  async function scanDevices() {
    setIsScanning(true)
    setShowDevicePicker(true)
    setTimeout(() => {
      setDevices([
        { id: 'FC:58:FA:11:22:33', name: 'My Headphones (Sony)' },
        { id: 'AA:BB:CC:DD:EE:FF', name: 'Home Speaker' },
        { id: '00:11:22:33:44:55', name: 'Car Multimedia' },
      ])
      setIsScanning(false)
    }, 1500)
  }

  const { setLang } = useTranslation()
  async function handleLogout() {
    await AsyncStorage.multiRemove(['carma_token', 'carma_user'])
    await setUser(null)
  }

  useEffect(() => {
    if (lastTripSummary) {
      setTripSummary(lastTripSummary);
      setShowSummary(true);
      setLastTripSummary(null);
    }
  }, [lastTripSummary, setLastTripSummary]);

  useEffect(() => {
    if (recentTrips && recentTrips.length > 0) {
      const sum = recentTrips.reduce((acc, trip) => acc + (trip.score || 0), 0);
      setAvgScore(Math.round(sum / recentTrips.length));
    } else {
      setAvgScore(95);
    }
  }, [recentTrips]);

  if (!user || isLoading) {
    return (
      <View style={[styles.root, { justifyContent: 'center' }]}>
        <ActivityIndicator size="large" color={COLORS.brand} />
      </View>
    );
  }

  // אם יש נסיעה פעילה, נציג את מסך הנסיעה במקום הדאשבורד
  if (tripState.isActive) {
    return <ActiveTripScreen />;
  }

  return (
    <View style={[COMMON_STYLES.screen, { paddingTop: Math.max(insets.top, 20) }]}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={COMMON_STYLES.scrollContent}>
        {/* Header */}
        <View style={COMMON_STYLES.rowBetween}>
          <View>
            <Text style={styles.welcome}>{t('dashboard.welcome')},</Text>
            <Text style={styles.name}>{user.name.split(' ')[0]} 👋</Text>
          </View>
          <View style={styles.headerRight}>
            <TouchableOpacity style={styles.bell} onPress={() => setShowSettings(true)}>
              <Text style={styles.bellIcon}>⚙️</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Score + Level hero */}
        <Card glass glow style={styles.hero}>
          <View style={[COMMON_STYLES.row, { gap: 0 }]}>
            <View style={styles.badgeWrapper}>
              {/* הגדלת התג ע"י שליחת סטייל מותאם אישית במידת הצורך, או שימוש ב-size=lg עם קנה מידה */}
              <LevelBadge level={user.level} size="lg" lang={lang} showName />
            </View>
            <View style={styles.heroRight}>
              <View style={styles.scoreRow}>
                <Text style={[styles.score, { color: avgScore !== null ? scoreToColor(avgScore) : COLORS.success }]}>
                  {avgScore ?? '--'}
                </Text>
                <Text style={styles.scoreSub}>{t('dashboard.yourScore')}</Text>
              </View>
              <View style={styles.progressContainer}>
                <Progress
                  value={getLevelProgress(user.points || user.totalPoints, user.level)}
                  color={getLevelConfig(user.level).color}
                  height={6}
                />
                <View style={styles.progressStatsRow}>
                  <Text style={styles.progressPointsText}>
                    {(user.points || user.totalPoints).toLocaleString()} {t('common.points')}
                  </Text>
                  {getPointsToNextLevel(user.points || user.totalPoints, user.level) > 0 && (
                    <Text style={styles.progressPointsText}>
                      {getPointsToNextLevel(user.points || user.totalPoints, user.level)} לדרגה הבאה
                    </Text>
                  )}
                </View>
              </View>
            </View>
          </View>
        </Card>

        {/* Quick stats */}
        <View style={COMMON_STYLES.statGrid}>
          <Card padding="none" style={COMMON_STYLES.statCard}>
            <Text style={COMMON_STYLES.statEmoji}>🚗</Text>
            <Text style={COMMON_STYLES.statValue}>{recentTrips.length}</Text>
            <Text style={COMMON_STYLES.statLabel}>נסיעות</Text>
          </Card>
          <Card padding="none" style={COMMON_STYLES.statCard}>
            <Text style={COMMON_STYLES.statEmoji}>📍</Text>
            <Text style={COMMON_STYLES.statValue}>{formatDistance(user.totalDistance || 0, lang)}</Text>
            <Text style={COMMON_STYLES.statLabel}>מרחק</Text>
          </Card>
          <Card padding="none" style={COMMON_STYLES.statCard}>
            <Text style={COMMON_STYLES.statEmoji}>⭐</Text>
            <Text style={COMMON_STYLES.statValue}>{user.totalPoints.toLocaleString()}</Text>
            <Text style={COMMON_STYLES.statLabel}>נקודות</Text>
          </Card>
        </View>

        {/* Start trip CTA */}
        <Button fullWidth size="xl" onPress={startTrip} style={styles.ctaBtn}>
          🚗  {t('dashboard.startTrip')}
        </Button>

        {/* Recent trips */}
        <View style={COMMON_STYLES.section}>
          <Text style={COMMON_STYLES.sectionTitle}>{t('dashboard.recentTrips')}</Text>

          {recentTrips.length === 0 ? (
            <Card style={COMMON_STYLES.emptyState}>
              <Text style={COMMON_STYLES.emptyIcon}>🛣️</Text>
              <Text style={COMMON_STYLES.emptyText}>{t('dashboard.noTrips')}</Text>
            </Card>
          ) : (
            <View style={styles.tripList}>
              {recentTrips.map(trip => (
                <TripCard key={trip.id} trip={trip} onPress={() => {}} />
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      {/* Modal הגדרות */}
      <Modal visible={showSettings} animationType="fade" transparent>
        <View style={COMMON_STYLES.modalOverlay}>
          <Card style={styles.settingsModalCard}>
            <View style={COMMON_STYLES.rowBetween}>
              <Text style={TYPOGRAPHY.h2}>{t('profile.settings')}</Text>
              <TouchableOpacity onPress={() => setShowSettings(false)}>
                <Text style={{ fontSize: 24 }}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={{ marginTop: 20 }}>
              <View style={{ gap: 16 }}>
                {/* Drive Mode Section */}
                <Card style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
                  <Text style={styles.settingsLabel}>🚗 {t('profile.driveMode') || 'מצב נסיעה אוטומטי'}</Text>
                  <Text style={styles.settingsDescription}>
                    האפליקציה תתחיל ותסיים נסיעה אוטומטית בעת חיבור למכשיר Bluetooth.
                  </Text>
                  <View style={styles.driveModeRow}>
                    <Text style={styles.driveModeStatus}>
                      {user.driveModeEnabled ? '✅ פעיל' : '❌ כבוי'}
                    </Text>
                    <Button
                      size="sm"
                      variant={user.driveModeEnabled ? 'danger' : 'success'}
                      onPress={() => setUser({ ...user, driveModeEnabled: !user.driveModeEnabled })}
                    >
                      {user.driveModeEnabled ? 'בטל' : 'הפעל'}
                    </Button>
                  </View>

                  {user.driveModeEnabled && (
                    <TouchableOpacity style={styles.bluetoothSelector} onPress={scanDevices}>
                      <Text style={styles.bluetoothName}>{user.bluetoothDeviceName || 'בחר מכשיר Bluetooth...'}</Text>
                      <Text style={styles.bluetoothIcon}>📡</Text>
                    </TouchableOpacity>
                  )}
                </Card>

                {/* Language Section */}
                <Card style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
                  <Text style={styles.settingsLabel}>{t('profile.language')}</Text>
                  <View style={styles.langRow}>
                    {(['he', 'en'] as const).map(l => (
                      <TouchableOpacity key={l} onPress={() => setLang(l)} style={[styles.langBtn, lang === l && styles.langBtnActive]}>
                        <Text style={[styles.langText, lang === l && styles.langTextActive]}>
                          {l === 'he' ? '🇮🇱 עברית' : '🇬🇧 English'}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </Card>

                <Button variant="danger" fullWidth onPress={handleLogout} style={{ marginTop: 10 }}>
                  🚪 {t('auth.logout')}
                </Button>

                <TouchableOpacity
                  onPress={clearTripHistory}
                  style={{ marginTop: 20, alignItems: 'center' }}
                >
                  <Text style={{ color: COLORS.textMuted, fontSize: 12, textDecorationLine: 'underline' }}>
                    איפוס היסטוריית נסיעות (מקומי)
                  </Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </Card>
        </View>
      </Modal>

      {/* Modal בחירת מכשיר Bluetooth */}
      <Modal visible={showDevicePicker} animationType="slide" transparent>
        <View style={COMMON_STYLES.modalOverlay}>
          <Card style={styles.devicePickerCard}>
            <Text style={styles.modalTitle}>בחירת מכשיר Bluetooth</Text>
            {isScanning ? (
              <ActivityIndicator color={COLORS.brand} size="large" style={{ margin: 40 }} />
            ) : (
              <ScrollView>
                {devices.map(device => (
                  <TouchableOpacity
                    key={device.id}
                    style={styles.deviceItem}
                    onPress={() => {
                      setUser({ ...user, bluetoothDeviceId: device.id, bluetoothDeviceName: device.name });
                      setShowDevicePicker(false);
                    }}
                  >
                    <Text style={styles.deviceName}>{device.name}</Text>
                    <Text style={styles.deviceSelectIcon}>🔗</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
            <Button variant="outline" onPress={() => setShowDevicePicker(false)}>ביטול</Button>
          </Card>
        </View>
      </Modal>

      {/* Modal סיכום נסיעה */}
      <Modal visible={showSummary} animationType="slide" transparent>
        <View style={COMMON_STYLES.modalOverlay}>
          <Card style={styles.summaryCard}>
            {tripSummary?.noMovement ? (
              <View style={{ alignItems: 'center', paddingVertical: 20 }}>
                <Text style={{ fontSize: 60, marginBottom: 20 }}>📍</Text>
                <Text style={[styles.summaryTitle, { textAlign: 'center' }]}>לא זוהתה תנועה משמעותית</Text>
                <Text style={[TYPOGRAPHY.body, { textAlign: 'center', color: COLORS.textMuted, marginBottom: 20 }]}>
                  הנסיעה לא נשמרה ביומן מכיוון שלא נרשם מרחק נסיעה במהלך התיעוד.
                </Text>
                <Button fullWidth onPress={() => setShowSummary(false)}>
                  הבנתי, תודה
                </Button>
              </View>
            ) : (
              <>
                <Text style={styles.summaryTitle}>נסיעה הושלמה! 🎉</Text>

                {tripSummary && (
                  <View style={styles.resultsContainer}>
                    <View style={[styles.scoreCircle, { borderColor: scoreToColor(tripSummary.score) }]}>
                      <Text style={[styles.scoreValue, { color: scoreToColor(tripSummary.score) }]}>
                        {Math.round(tripSummary.score)}
                      </Text>
                      <Text style={styles.scoreLabel}>ציון סופי</Text>
                    </View>

                    <View style={styles.statsGrid}>
                      <View style={styles.statBox}>
                        <Text style={styles.statValueSmall}>{tripSummary.distanceKm?.toFixed(2) || '0.00'}</Text>
                        <Text style={styles.statLabelSmall}>ק"מ</Text>
                      </View>
                      <View style={styles.statBox}>
                        <Text style={[styles.statValueSmall, { color: COLORS.brand }]}>+{tripSummary.points || 0}</Text>
                        <Text style={styles.statLabelSmall}>נקודות</Text>
                      </View>
                    </View>

                    <View style={styles.eventsList}>
                      <Text style={styles.eventsTitle}>פירוט אירועים:</Text>
                      <View style={COMMON_STYLES.rowBetween}>
                        <Text style={styles.eventLabel}>🛑 בלימות חדות</Text>
                        <Text style={styles.eventCount}>{tripSummary.eventCounts?.HARD_BRAKE || 0}</Text>
                      </View>
                      <View style={COMMON_STYLES.rowBetween}>
                        <Text style={styles.eventLabel}>📱 נגיעות בטלפון</Text>
                        <Text style={styles.eventCount}>{tripSummary.eventCounts?.PHONE_TOUCH || 0}</Text>
                      </View>
                    </View>
                  </View>
                )}

                <Button fullWidth onPress={() => setShowSummary(false)} style={{ marginTop: 24 }}>
                  סגור וחזור לדף הבית
                </Button>
              </>
            )}
          </Card>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  headerRight:   { flexDirection: 'row', gap: SPACING.sm },
  welcome:       { ...TYPOGRAPHY.caption },
  name:          { ...TYPOGRAPHY.h2, fontSize: 26 }, // גודל ספציפי למסך הבית
  btSim:         { width: 40, height: 40, backgroundColor: COLORS.card, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.brand },
  btIcon:        { fontSize: 18 },
  bell:          { width: 40, height: 40, backgroundColor: COLORS.card, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border },
  bellIcon:      { fontSize: 18 },
  hero:          {
    marginBottom: SPACING.md,
    marginTop: 15,
    paddingVertical: 20,
    paddingHorizontal: 20,
    borderWidth: 0.2,
    borderColor: 'rgba(255,255,255,0.1)'
  },
  badgeWrapper:  {
    marginRight: 40, // הזזה משמעותית יותר שמאלה מהדופן
    transform: [{ scale: 1.2 }] // הגדלת התג ב-20%
  },
  heroRight:     { flex: 1, justifyContent: 'center' },
  scoreRow:      { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginBottom: 8 },
  score:         { fontSize: 48, fontWeight: '900' },
  scoreSub:      { ...TYPOGRAPHY.caption, fontSize: 13 },
  progressContainer: { marginHorizontal: 4 },
  progressStatsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4
  },
  progressPointsText: { ...TYPOGRAPHY.caption, fontSize: 10, color: '#fff' },
  ctaBtn:        { marginVertical: SPACING.lg }, // הוספת ריווח אנכי כדי שלא יהיה צמוד למדדים
  tripList:      { gap: SPACING.sm },

  // Settings Modal styles
  settingsModalCard: { width: '90%', maxHeight: '80%', padding: 20, borderRadius: 25 },
  settingsLabel:     { ...TYPOGRAPHY.label, color: '#fff', marginBottom: 8 },
  settingsDescription: { ...TYPOGRAPHY.caption, fontSize: 12, marginBottom: 12 },
  driveModeRow:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  driveModeStatus:   { color: '#fff', fontWeight: '700' },
  bluetoothSelector: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: COLORS.dark, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border },
  bluetoothName:     { color: COLORS.brandLight, fontSize: 13 },
  bluetoothIcon:     { fontSize: 14 },
  langRow:           { flexDirection: 'row', gap: 8 },
  langBtn:           { flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: COLORS.dark, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center' },
  langBtnActive:     { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  langText:          { ...TYPOGRAPHY.label, fontSize: 13 },
  langTextActive:    { color: '#fff' },
  devicePickerCard:  { width: '85%', padding: 20 },
  modalTitle:        { ...TYPOGRAPHY.h3, marginBottom: 15 },
  deviceItem:        { flexDirection: 'row', justifyContent: 'space-between', padding: 15, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 12, marginBottom: 8 },
  deviceName:        { color: '#fff' },
  deviceSelectIcon:  { fontSize: 16 },

  // Modal styles (ספציפיים לסיכום נסיעה)
  summaryCard: { padding: SPACING.xl, alignItems: 'center', width: '100%', borderRadius: 35, backgroundColor: '#1A1A1A', borderColor: COLORS.border },
  summaryTitle: { ...TYPOGRAPHY.h2, fontSize: 26, marginBottom: SPACING.lg },
  resultsContainer: { width: '100%', alignItems: 'center' },
  scoreCircle: { width: 140, height: 140, borderRadius: 70, borderWidth: 8, justifyContent: 'center', alignItems: 'center', marginBottom: SPACING.lg, backgroundColor: 'rgba(255,255,255,0.02)' },
  scoreValue: { fontSize: 52, fontWeight: '900' },
  scoreLabel: { ...TYPOGRAPHY.caption, fontSize: 14 },
  statsGrid: { flexDirection: 'row', gap: SPACING.md, marginBottom: SPACING.lg, width: '100%' },
  statBox: { flex: 1, backgroundColor: 'rgba(255,255,255,0.05)', padding: SPACING.md, borderRadius: 20, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
  statValueSmall: { ...TYPOGRAPHY.h2, fontSize: 24 },
  statLabelSmall: { ...TYPOGRAPHY.caption, fontSize: 13, marginTop: 4 },
  eventsList: { width: '100%', gap: SPACING.sm, backgroundColor: 'rgba(0,0,0,0.2)', padding: SPACING.md, borderRadius: 20 },
  eventsTitle: { ...TYPOGRAPHY.h3, fontSize: 16, marginBottom: SPACING.sm },
  eventLabel: { ...TYPOGRAPHY.body, color: COLORS.textMuted, fontSize: 14 },
  eventCount: { ...TYPOGRAPHY.label, color: '#fff', fontSize: 16 },
});
