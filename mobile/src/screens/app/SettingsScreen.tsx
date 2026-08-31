import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useApp } from '@/context/AppContext';
import { useTranslation } from '@/hooks/useTranslation';
import { userApi } from '@/services/api/user.api';
import { COLORS, SPACING, TYPOGRAPHY, COMMON_STYLES } from '@/constants/theme';
import { ICONS } from '@/constants/icons';
// dd-mm-yyyy, distinct from the long-form `formatDate` used elsewhere — this is the one place that wants the numeric format.
function formatJoinDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '—';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}-${mm}-${d.getFullYear()}`;
}

/**
 * Settings screen.
 * Includes: drive mode + Bluetooth selection, language, history reset, logout.
 * Local (AsyncStorage / AppContext) except the drive mode toggle, which the server owns.
 */
export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, setUser, patchUser, clearTripHistory, btDevice, addToast, startRawRecording, stopRawRecording, exportRawRecording } = useApp();
  const { t, lang, setLang } = useTranslation();
  const [savingDriveMode, setSavingDriveMode] = useState(false);
  // 'stopped' keeps Export reachable after Stop — exportRawRecording() ships the
  // last *completed* session, so the button can't disappear the moment recording ends.
  const [rawRecordingStatus, setRawRecordingStatus] = useState<'idle' | 'recording' | 'stopped'>('idle');

  if (!user) return null;

  /**
   * Toggles drive mode. The server is asked first and local state follows only on
   * success: the flag is stored server-side, so a toggle that refuses to move is
   * recoverable, while a local value the server never accepted is invisible drift.
   */
  const handleToggleDriveMode = async () => {
    const next = !user.driveModeEnabled;
    setSavingDriveMode(true);
    try {
      await userApi.updateProfile({ driveModeEnabled: next });
      patchUser({ driveModeEnabled: next });
    } catch (e) {
      addToast({ type: 'error', message: t('profile.driveModeFailed') });
      console.error('[Settings] Failed to update drive mode', e);
    } finally {
      setSavingDriveMode(false);
    }
  };

  // CAR-31: staged calibration recording (accel/gyro/GPS), independent of trip start/stop.
  // Scenario is the phone's mount position — labels the session for hand-held-vs-loose
  // calibration (CAR-46/CAR-183). Platform is the device OS, not user-chosen.
  const handleStartRawRecording = async (scenario: string) => {
    try {
      await startRawRecording(scenario, Platform.OS);
      setRawRecordingStatus('recording');
    } catch (e) {
      // e.g. sensorManager.start() rejects on missing permissions — status stays 'idle'
      Alert.alert('Raw recording', 'Could not start — check sensor permissions.');
      console.error('startRawRecording failed', e);
    }
  };

  const handleStopRawRecording = async () => {
    await stopRawRecording();
    setRawRecordingStatus('stopped');
  };

  const handleExportRawRecording = async () => {
    const result = await exportRawRecording();
    if (typeof result === 'object') {
      Alert.alert(
        'Export',
        result.error === 'none-recorded' ? 'Nothing recorded yet.' : 'Sharing is not available on this device.'
      );
    }
  };

  /**
   * Shows a confirmation dialog then logs out.
   * setUser(null) clears AppContext, AsyncStorage (token + user), and returns to the login screen.
   * [server] No server call — logout is local only.
   */
  async function handleLogout() {
    Alert.alert(
      t('auth.logout'),
      t('auth.logoutConfirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('auth.logout'),
          style: 'destructive',
          onPress: async () => {
            await setUser(null);
          }
        }
      ]
    );
  }

  /**
   * Shows a confirmation dialog then hides trip history.
   * The deletion is logical only — sets lastClearedHistory to now,
   * and older trips are filtered out in AppContext (filteredTrips).
   * [server] No server call — trips are not removed from the database.
   */
  const handleClearHistory = () => {
    Alert.alert(
      t('profile.dataManagement'),
      t('profile.clearHistoryConfirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.confirm'),
          style: 'destructive',
          onPress: async () => {
            await clearTripHistory();
            router.back();
          }
        }
      ]
    );
  };

  return (
    <View style={[COMMON_STYLES.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      {/* Header */}
      <View style={COMMON_STYLES.screenHeader}>
        <TouchableOpacity onPress={() => router.back()} style={COMMON_STYLES.screenHeaderBackBtn}>
          <Ionicons name={lang === 'HE' ? 'arrow-forward' : 'arrow-back'} size={28} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={COMMON_STYLES.screenHeaderTitle}>{t('profile.settings')}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={{ gap: 20 }}>

          {/* Account Section */}
          <View>
            <View style={COMMON_STYLES.sectionLabelRow}>
              <Ionicons name={ICONS.profile} size={12} color={COLORS.textMuted} />
              <Text style={COMMON_STYLES.sectionLabel}>{t('profile.title')}</Text>
            </View>
            <Card style={styles.settingCard}>
              <Text style={styles.settingDescription}>
                {t('profile.joined')}: {user.createdAt ? formatJoinDate(user.createdAt) : '—'}
              </Text>
            </Card>
          </View>

          {/* Drive Mode Section */}
          <View>
            <View style={COMMON_STYLES.sectionLabelRow}>
              <Ionicons name={ICONS.trips} size={12} color={COLORS.textMuted} />
              <Text style={COMMON_STYLES.sectionLabel}>{t('profile.driveMode')}</Text>
            </View>
            <Card style={styles.settingCard}>
              <Text style={styles.settingDescription}>
                {t('profile.driveModeDesc')}
              </Text>

              <View style={styles.row}>
                <View style={styles.statusRow}>
                  <Ionicons name={user.driveModeEnabled ? ICONS.active : ICONS.inactive} size={14} color={user.driveModeEnabled ? COLORS.success : COLORS.danger} />
                  <Text style={styles.statusText}>{user.driveModeEnabled ? t('profile.active') : t('profile.inactive')}</Text>
                </View>
                <Button
                  size="sm"
                  variant={user.driveModeEnabled ? 'primary' : 'outline'}
                  loading={savingDriveMode}
                  onPress={handleToggleDriveMode}
                >
                  {user.driveModeEnabled ? t('profile.disable') : t('profile.enable')}
                </Button>
              </View>

              {user.driveModeEnabled && (
                <TouchableOpacity
                  style={styles.linkButton}
                  onPress={() => router.push('/bluetooth-settings')}
                >
                  <View style={styles.linkContent}>
                    <Ionicons name="bluetooth" size={20} color={COLORS.brandLight} />
                    <Text style={styles.linkText}>
                      {btDevice?.name || t('profile.selectDevice')}
                    </Text>
                  </View>
                  <Ionicons name={lang === 'HE' ? 'chevron-back' : 'chevron-forward'} size={18} color={COLORS.textMuted} />
                </TouchableOpacity>
              )}
            </Card>
          </View>

          {/* Language Section */}
          <View>
            <View style={COMMON_STYLES.sectionLabelRow}>
              <Ionicons name={ICONS.globe} size={12} color={COLORS.textMuted} />
              <Text style={COMMON_STYLES.sectionLabel}>{t('profile.language')}</Text>
            </View>
            <Card style={styles.settingCard}>
              <View style={styles.langRow}>
                {(['HE', 'EN'] as const).map(l => (
                  <TouchableOpacity
                    key={l}
                    onPress={() => setLang(l)}
                    style={[styles.langBtn, lang === l && styles.langBtnActive]}
                  >
                    {/* Each language's own endonym, not translated — see docs/i18n.md */}
                    <Text style={[styles.langText, lang === l && styles.langTextActive]}>
                      {/* eslint-disable-next-line no-restricted-syntax */}
                      {l === 'HE' ? 'עברית' : 'English'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </Card>
          </View>

          {/* Data Management Section */}
          <View>
            <View style={COMMON_STYLES.sectionLabelRow}>
              <Ionicons name={ICONS.settings} size={12} color={COLORS.textMuted} />
              <Text style={COMMON_STYLES.sectionLabel}>{t('profile.dataManagement')}</Text>
            </View>
            <Card style={styles.settingCard}>
              <TouchableOpacity style={styles.actionRow} onPress={handleClearHistory}>
                <Text style={styles.actionTextDanger}>{t('profile.clearHistory')}</Text>
                <Ionicons name="trash-outline" size={20} color={COLORS.danger} />
              </TouchableOpacity>
            </Card>
          </View>

          {/* Debug Section — dev builds only, not gated on role (see ActiveTripScreen.tsx) */}
          {__DEV__ && (
            <View>
              <View style={COMMON_STYLES.sectionLabelRow}>
                <Ionicons name="bug-outline" size={12} color={COLORS.textMuted} />
                <Text style={COMMON_STYLES.sectionLabel}>Debug</Text>
              </View>
              <Card style={styles.settingCard}>
                {/* No app/(admin)/ route exists yet — disabled placeholder, not a real nav target */}
                <TouchableOpacity
                  style={[styles.linkButton, { opacity: 0.5 }]}
                  onPress={() => Alert.alert('Admin tools', 'Not built yet — no admin screens exist in the app.')}
                >
                  <View style={styles.linkContent}>
                    <Ionicons name="shield-outline" size={20} color={COLORS.textMuted} />
                    <Text style={[styles.linkText, { color: COLORS.textMuted }]}>Open Admin Tools (coming soon)</Text>
                  </View>
                </TouchableOpacity>

                {/* CAR-31: raw sensor recording for calibration drives, see driving-sdk README */}
                <View style={styles.rawRecordingSection}>
                  <Text style={styles.rawRecordingLabel}>Raw Sample Recording</Text>
                  {rawRecordingStatus === 'idle' && (
                    <View style={styles.debugRow}>
                      {(['Handheld', 'Mounted', 'Pocket', 'Seat'] as const).map(scenario => (
                        <Button
                          key={scenario}
                          variant="outline"
                          size="sm"
                          onPress={() => handleStartRawRecording(scenario)}
                          style={styles.debugBtn}
                        >
                          {scenario}
                        </Button>
                      ))}
                    </View>
                  )}
                  {rawRecordingStatus === 'recording' && (
                    <View style={styles.debugRow}>
                      <Button variant="outline" size="sm" onPress={handleStopRawRecording} style={styles.debugBtn}>
                        Stop
                      </Button>
                    </View>
                  )}
                  {rawRecordingStatus === 'stopped' && (
                    <View style={styles.debugRow}>
                      <Button variant="outline" size="sm" onPress={handleExportRawRecording} style={styles.debugBtn}>
                        Export
                      </Button>
                      <Button variant="outline" size="sm" onPress={() => setRawRecordingStatus('idle')} style={styles.debugBtn}>
                        Record Again
                      </Button>
                    </View>
                  )}
                </View>
              </Card>
            </View>
          )}

          {/* Logout Section */}
          <Button variant="danger" fullWidth onPress={handleLogout} style={styles.logoutBtn}>
            {t('auth.logout')}
          </Button>

          <Text style={styles.versionText}>{t('profile.version')} 1.0.0 (5.3.1)</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: SPACING.lg },
  statusRow:    { flexDirection: 'row', alignItems: 'center', gap: 5 },
  settingCard: { backgroundColor: COLORS.card, padding: 16 },
  settingDescription: { ...TYPOGRAPHY.caption, color: COLORS.textMuted, marginBottom: 16, lineHeight: 18, textAlign: 'left' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statusText: { color: COLORS.text, fontWeight: '700' },
  linkButton: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: COLORS.dark,
    padding: 12,
    borderRadius: 10,
    marginTop: 16,
    borderWidth: 1,
    borderColor: COLORS.border
  },
  linkContent: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  linkText: { color: COLORS.brandLight, fontSize: 14, fontWeight: '600' },
  rawRecordingSection: { marginTop: 16, borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 12 },
  rawRecordingLabel: { ...TYPOGRAPHY.caption, color: COLORS.textMuted, marginBottom: 8 },
  debugRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  debugBtn: { flexGrow: 1 },
  langRow: { flexDirection: 'row', gap: 8 },
  langBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: COLORS.dark, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center' },
  langBtnActive: { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  langText: { ...TYPOGRAPHY.label, fontSize: 13 },
  langTextActive: { color: '#fff' },
  actionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  actionTextDanger: { color: COLORS.danger, fontWeight: '600' },
  logoutBtn: { marginTop: 20 },
  versionText: { ...TYPOGRAPHY.caption, textAlign: 'center', marginTop: 30, color: COLORS.textMuted }
});
