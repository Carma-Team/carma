import React, { useEffect, useState } from 'react'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Modal } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { LevelBadge } from '@/components/gamification/LevelBadge'
import { TripCard } from '@/components/driving/TripCard'
import { useApp } from '@/context/AppContext'
import { useTranslation } from '@/hooks/useTranslation'
import { tripsApi, userApi } from '@/lib/api'
import { getLevelConfig, COLORS } from '@/lib/constants'
import { formatDistance, formatDuration, formatDate } from '@/lib/utils'
import type { DrivingStats, Trip } from '@/navigation/types'

type Section = 'stats' | 'trips' | 'settings'

export default function ProfileScreen() {
  const { user, setUser } = useApp()
  const { t, lang, setLang } = useTranslation()
  const [section, setSection] = useState<Section>('stats')
  const [stats,   setStats]   = useState<DrivingStats | null>(null)
  const [trips,   setTrips]   = useState<Trip[]>([])
  const [loading, setLoading] = useState(false)
  const [isScanning, setIsScanning] = useState(false)
  const [devices, setDevices] = useState<{ id: string, name: string }[]>([])
  const [showDevicePicker, setShowDevicePicker] = useState(false)

  async function scanDevices() {
    setIsScanning(true)
    setShowDevicePicker(true)

    // כאן תבוא הקריאה האמיתית לספרייה:
    // BleManager.getBondedPeripherals([]).then((results) => { ... })

    // לצורך הבדיקה שלך עם האוזניות/רמקול בבית, נדמה טעינה של 1.5 שניות
    // ואז נציג רשימה (במכשיר אמיתי עם Dev Build הקוד הזה יוחלף בקוד Native)
    setTimeout(() => {
      setDevices([
        { id: 'FC:58:FA:11:22:33', name: 'My Headphones (Sony)' },
        { id: 'AA:BB:CC:DD:EE:FF', name: 'Home Speaker' },
        { id: '00:11:22:33:44:55', name: 'Car Multimedia' },
      ])
      setIsScanning(false)
    }, 1500)
  }

  useEffect(() => {
    if (section === 'stats' && !stats) {
      setLoading(true)
      userApi.stats().then(d => setStats(d.stats)).finally(() => setLoading(false))
    }
    if (section === 'trips' && trips.length === 0) {
      setLoading(true)
      tripsApi.list(20).then(d => setTrips(d.trips)).finally(() => setLoading(false))
    }
  }, [section])

  async function handleLogout() {
    await AsyncStorage.multiRemove(['carma_token', 'carma_user'])
    await setUser(null)
    // Here you need to navigate to the Login screen using your navigation ref or prop:
    // navigation.replace('Login')
  }

  if (!user) return null
  const levelConfig = getLevelConfig(user.level)

  const sectionTabs: { key: Section; label: string; emoji: string }[] = [
    { key: 'stats',    label: t('profile.stats'),       emoji: '📊' },
    { key: 'trips',    label: t('profile.tripHistory'),  emoji: '🚗' },
    { key: 'settings', label: t('profile.settings'),    emoji: '⚙️' },
  ]

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      {/* Profile header */}
      <Card glass style={styles.profileCard}>
        <View style={styles.profileRow}>
          <LevelBadge level={user.level} size="lg" lang={lang} />
          <View style={styles.profileInfo}>
            <Text style={styles.profileName}>{user.name}</Text>
            <Text style={styles.profileCity}>{user.city}</Text>
            <Text style={[styles.profileLevel, { color: levelConfig.color }]}>
              {levelConfig.icon} {lang === 'he' ? levelConfig.name : levelConfig.nameEn}
            </Text>
          </View>
          <View style={styles.profilePoints}>
            <Text style={styles.pointsValue}>{user.totalPoints.toLocaleString()}</Text>
            <Text style={styles.pointsLabel}>{t('common.points')}</Text>
          </View>
        </View>
        <View style={styles.profileStats}>
          {[
            { label: t('profile.totalDistance'), value: formatDistance(user.totalDistance, lang) },
            { label: t('profile.level'),         value: String(user.level) },
            { label: t('profile.joined'),        value: user.createdAt ? formatDate(user.createdAt, lang) : '—' },
          ].map(s => (
            <View key={s.label} style={styles.profileStat}>
              <Text style={styles.profileStatValue}>{s.value}</Text>
              <Text style={styles.profileStatLabel}>{s.label}</Text>
            </View>
          ))}
        </View>
      </Card>

      {/* Section tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }} contentContainerStyle={{ gap: 8 }}>
        {sectionTabs.map(tab => (
          <TouchableOpacity key={tab.key} onPress={() => setSection(tab.key)} style={[styles.sectionTab, section === tab.key && styles.sectionTabActive]}>
            <Text style={[styles.sectionTabText, section === tab.key && styles.sectionTabTextActive]}>
              {tab.emoji} {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Stats */}
      {section === 'stats' && (
        loading || !stats
          ? <ActivityIndicator color={COLORS.brand} />
          : <View style={{ gap: 10 }}>
              <View style={styles.statsGrid}>
                {[
                  { emoji: '🚗', label: t('stats.totalTrips'),    value: stats.totalTrips },
                  { emoji: '📍', label: t('stats.totalDistance'), value: formatDistance(stats.totalDistance, lang) },
                  { emoji: '⭐', label: t('stats.totalPoints'),   value: stats.totalPoints.toLocaleString() },
                  { emoji: '🎯', label: t('stats.avgScore'),      value: stats.averageScore },
                  { emoji: '✅', label: t('stats.safeTrips'),     value: stats.safeTripsCount },
                  { emoji: '⏱️', label: t('stats.totalDuration'), value: formatDuration(stats.totalDurationSeconds, lang) },
                ].map(s => (
                  <Card key={s.label} padding="sm" style={styles.statCard}>
                    <Text style={styles.statEmoji}>{s.emoji}</Text>
                    <Text style={styles.statValue}>{s.value}</Text>
                    <Text style={styles.statLabel}>{s.label}</Text>
                  </Card>
                ))}
              </View>
            </View>
      )}

      {/* Trips */}
      {section === 'trips' && (
        loading
          ? <ActivityIndicator color={COLORS.brand} />
          : trips.length === 0
            ? <Card style={styles.empty}><Text style={styles.emptyText}>{t('profile.noTrips')}</Text></Card>
            : <View style={{ gap: 10 }}>
                {trips.map(trip => <TripCard key={trip.id} trip={trip} onPress={() => {}} />)}
              </View>
      )}

      {/* Settings */}
      {section === 'settings' && (
        <View style={{ gap: 12 }}>
          <Card>
            <Text style={styles.settingsLabel}>🚗 {t('profile.driveMode') || 'מצב נסיעה אוטומטי'}</Text>
            <Text style={styles.settingsDescription}>
              האפליקציה תתחיל ותסיים נסיעה אוטומטית בעת חיבור למכשיר Bluetooth נבחר.
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
              <View style={styles.bluetoothSection}>
                <Text style={styles.bluetoothLabel}>מכשיר משויך:</Text>
                <TouchableOpacity
                  style={styles.bluetoothSelector}
                  onPress={scanDevices}
                >
                  <Text style={styles.bluetoothName}>
                    {user.bluetoothDeviceName || 'בחר מכשיר Bluetooth...'}
                  </Text>
                  <Text style={styles.bluetoothIcon}>📡</Text>
                </TouchableOpacity>
              </View>
            )}
          </Card>

          {/* Modal לבחירת מכשיר Bluetooth */}
          <Modal visible={showDevicePicker} animationType="slide" transparent>
            <View style={styles.modalOverlay}>
              <Card style={styles.devicePickerCard}>
                <Text style={styles.modalTitle}>בחירת מכשיר Bluetooth</Text>
                <Text style={styles.modalSubtitle}>האפליקציה תתחיל נסיעה אוטומטית כשתתחברי לאחד מאלה:</Text>

                {isScanning ? (
                  <View style={styles.loaderContainer}>
                    <ActivityIndicator color={COLORS.brand} size="large" />
                    <Text style={styles.loaderText}>סורק מכשירים משויכים...</Text>
                  </View>
                ) : (
                  <ScrollView style={styles.deviceList}>
                    {devices.map(device => (
                      <TouchableOpacity
                        key={device.id}
                        style={styles.deviceItem}
                        onPress={() => {
                          setUser({
                            ...user,
                            bluetoothDeviceId: device.id,
                            bluetoothDeviceName: device.name
                          });
                          setShowDevicePicker(false);
                        }}
                      >
                        <View>
                          <Text style={styles.deviceName}>{device.name}</Text>
                          <Text style={styles.deviceId}>{device.id}</Text>
                        </View>
                        <Text style={styles.deviceSelectIcon}>🔗</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                )}

                <Button
                  variant="outline"
                  fullWidth
                  onPress={() => setShowDevicePicker(false)}
                  style={{ marginTop: 16 }}
                >
                  ביטול
                </Button>
              </Card>
            </View>
          </Modal>

          <Card>
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
          <Card>
            {[
              { label: t('profile.phone'), value: user.phone || '—' },
              { label: t('profile.city'),  value: user.city  || '—' },
              { label: t('profile.age'),   value: user.age   ? String(user.age) : '—' },
              { label: t('profile.licenseYear'), value: user.licenseYear ? String(user.licenseYear) : '—' },
            ].map(row => (
              <View key={row.label} style={styles.settingsRow}>
                <Text style={styles.settingsRowLabel}>{row.label}</Text>
                <Text style={styles.settingsRowValue}>{row.value}</Text>
              </View>
            ))}
          </Card>
          <Button variant="danger" fullWidth onPress={handleLogout}>🚪 {t('auth.logout')}</Button>
        </View>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  root:              { flex: 1, backgroundColor: COLORS.dark },
  content:           { padding: 16, paddingBottom: 100 },
  profileCard:       { marginBottom: 16 },
  profileRow:        { flexDirection: 'row', alignItems: 'center', gap: 12 },
  profileInfo:       { flex: 1 },
  profileName:       { color: '#fff', fontSize: 18, fontWeight: '900' },
  profileCity:       { color: COLORS.textMuted, fontSize: 13 },
  profileLevel:      { fontSize: 12, fontWeight: '700', marginTop: 2 },
  profilePoints:     { alignItems: 'flex-end' },
  pointsValue:       { color: COLORS.brandLight, fontSize: 22, fontWeight: '900' },
  pointsLabel:       { color: COLORS.textMuted, fontSize: 11 },
  profileStats:      { flexDirection: 'row', borderTopWidth: 1, borderTopColor: COLORS.border, marginTop: 12, paddingTop: 12 },
  profileStat:       { flex: 1, alignItems: 'center' },
  profileStatValue:  { color: '#fff', fontWeight: '700', fontSize: 14 },
  profileStatLabel:  { color: COLORS.textMuted, fontSize: 11, marginTop: 2 },
  sectionTab:        { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border },
  sectionTabActive:  { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  sectionTabText:    { color: COLORS.textMuted, fontSize: 12, fontWeight: '600' },
  sectionTabTextActive:{ color: '#fff' },
  statsGrid:         { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statCard:          { width: '47%', alignItems: 'center' },
  statEmoji:         { fontSize: 22, marginBottom: 4 },
  statValue:         { color: '#fff', fontWeight: '700', fontSize: 16 },
  statLabel:         { color: COLORS.textMuted, fontSize: 11, marginTop: 2, textAlign: 'center' },
  empty:             { alignItems: 'center', paddingVertical: 32 },
  emptyText:         { color: COLORS.textMuted },
  settingsLabel:     { color: '#fff', fontWeight: '700', fontSize: 14, marginBottom: 10 },
  langRow:           { flexDirection: 'row', gap: 8 },
  langBtn:           { flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: COLORS.dark, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center' },
  langBtnActive:     { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  langText:          { color: COLORS.textMuted, fontWeight: '700', fontSize: 13 },
  langTextActive:    { color: '#fff' },
  settingsRow:       { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  settingsRowLabel:  { color: COLORS.textMuted, fontSize: 13 },
  settingsRowValue:  { color: '#fff', fontSize: 13 },
  // Drive Mode Styles
  settingsDescription: { color: COLORS.textMuted, fontSize: 12, marginBottom: 16, lineHeight: 18 },
  driveModeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.05)', padding: 12, borderRadius: 12, marginBottom: 16 },
  driveModeStatus: { color: '#fff', fontWeight: '700', fontSize: 14 },
  bluetoothSection: { borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 16 },
  bluetoothLabel: { color: COLORS.textMuted, fontSize: 12, marginBottom: 8 },
  bluetoothSelector: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: COLORS.dark, borderWidth: 1, borderColor: COLORS.border, padding: 12, borderRadius: 10 },
  bluetoothName: { color: COLORS.brandLight, fontWeight: '600', fontSize: 14 },
  bluetoothIcon: { fontSize: 16 },
  // Modal Styles
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' },
  devicePickerCard: { borderBottomLeftRadius: 0, borderBottomRightRadius: 0, padding: 24, maxHeight: '80%' },
  modalTitle: { color: '#fff', fontSize: 20, fontWeight: '900', marginBottom: 8 },
  modalSubtitle: { color: COLORS.textMuted, fontSize: 14, marginBottom: 20 },
  loaderContainer: { padding: 40, alignItems: 'center' },
  loaderText: { color: COLORS.textMuted, marginTop: 12, fontSize: 14 },
  deviceList: { marginVertical: 8 },
  deviceItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 12, marginBottom: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
  deviceName: { color: '#fff', fontSize: 16, fontWeight: '700' },
  deviceId: { color: COLORS.textMuted, fontSize: 11, marginTop: 2 },
  deviceSelectIcon: { fontSize: 18 },
})
