import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useApp } from '@/context/AppContext';
import { useTranslation } from '@/hooks/useTranslation';
import { userApi } from '@/services/api/user.api';
import { recordingsApi } from '@/services/api/recordings.api';
import { ApiError } from '@/services/api/client';
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

// The phone's mount position, which is what a staged session is calibrating against
// (CAR-46 / CAR-183). Plain strings on the wire — the SDK has no opinion on the labels.
const SCENARIOS = ['Handheld', 'Mounted', 'Pocket', 'Seat'] as const;
type Scenario = (typeof SCENARIOS)[number];

// The four events a tester marks by hand while driving, from CAR-212. Kept short so the
// row fits on one line: a tester's eyes are on the road, and the haptic tick is the real
// confirmation that a tap landed.
const MARKERS: { type: string; label: string }[] = [
  { type: 'hard_brake', label: 'Brake' },
  { type: 'sharp_turn', label: 'Turn' },
  { type: 'phone_pickup', label: 'Pickup' },
  { type: 'phone_putdown', label: 'Putdown' },
];

/**
 * Settings screen.
 * Includes: drive mode + Bluetooth selection, language, history reset, logout.
 * Local (AsyncStorage / AppContext) except the drive mode toggle, which the server owns.
 */
export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, setUser, patchUser, btDevice, addToast, startRawRecording, stopRawRecording, exportRawRecording, sdk } = useApp();
  const { t, lang, setLang } = useTranslation();
  const [savingDriveMode, setSavingDriveMode] = useState(false);
  // 'stopped' keeps Export reachable after Stop — exportRawRecording() ships the
  // last *completed* session, so the button can't disappear the moment recording ends.
  const [rawRecordingStatus, setRawRecordingStatus] = useState<'idle' | 'recording' | 'stopped'>('idle');
  // The scenario the running session is currently labelled with — a drive can change it
  // mid-session (CAR-303), so it is state rather than the argument Start was given.
  const [rawScenario, setRawScenario] = useState<Scenario>('Handheld');
  // Refreshed rather than derived: the list is a directory read, and it changes when a
  // session stops or an upload prunes nothing at all.
  const [savedRecordings, setSavedRecordings] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

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
  const handleStartRawRecording = async (scenario: Scenario) => {
    try {
      await startRawRecording(scenario, Platform.OS);
      setRawScenario(scenario);
      setRawRecordingStatus('recording');
    } catch (e) {
      // e.g. sensorManager.start() rejects on missing permissions — status stays 'idle'
      Alert.alert('Raw recording', 'Could not start — check sensor permissions.');
      console.error('startRawRecording failed', e);
    }
  };

  /**
   * A marker is confirmed by feel, not by looking: the tester is driving. The haptic is
   * fired only when the marker actually landed, so a tap against a stopped session is
   * silent rather than falsely reassuring.
   */
  const handleMarker = (markerType: string, label: string) => {
    if (sdk.markRawRecording(markerType, label)) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    }
  };

  // Mid-session scenario change: one drive covers mounted and then hand-held without
  // being split into two files, with a marker recording where the change happened.
  const handleScenarioChange = (scenario: Scenario) => {
    if (sdk.changeRawRecordingScenario(scenario)) {
      setRawScenario(scenario);
      Haptics.selectionAsync().catch(() => {});
    }
  };

  const handleStopRawRecording = async () => {
    try {
      await stopRawRecording();
      setRawRecordingStatus('stopped');
      setSavedRecordings(sdk.listRawRecordings());
    } catch (e) {
      // The flush is what can fail here (disk full, storage revoked). Status stays
      // 'recording' so Stop can be retried rather than leaving Export pointing at
      // a file that was never written.
      Alert.alert('Raw recording', 'Could not stop — the session was not saved.');
      console.error('stopRawRecording failed', e);
    }
  };

  const handleExportRawRecording = async (filePath?: string) => {
    try {
      const result = await exportRawRecording(filePath);
      if (typeof result === 'object') {
        Alert.alert(
          'Export',
          result.error === 'none-recorded' ? 'Nothing recorded yet.' : 'Sharing is not available on this device.'
        );
      }
    } catch (e) {
      // The share sheet itself can reject — a dismissed sheet on iOS, no handler app.
      Alert.alert('Export', 'Could not open the share sheet.');
      console.error('exportRawRecording failed', e);
    }
  };

  /**
   * Uploads a recording to the server, which reads its index out of the file's own
   * header. Admin accounts only — a 403 here means the tester's account is a regular
   * driver's, which is the endpoint working as designed rather than a failure to retry.
   */
  const handleUploadRawRecording = async (filePath?: string) => {
    const path = filePath ?? sdk.listRawRecordings()[0];
    if (!path) {
      Alert.alert('Upload', 'Nothing recorded yet.');
      return;
    }
    setUploading(true);
    try {
      const saved = await recordingsApi.upload(path);
      addToast({ type: 'success', message: `Uploaded ${saved.sessionId}` });
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 0;
      Alert.alert(
        'Upload',
        status === 403 ? 'This account is not an admin — the endpoint only takes admin uploads.'
          : status === 409 ? 'Already uploaded.'
          : status === 422 ? 'The server refused the file — no session header, or no samples.'
          : 'Upload failed.'
      );
      console.error('recording upload failed', e);
    } finally {
      setUploading(false);
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
                      {SCENARIOS.map(scenario => (
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
                    <View>
                      {/* Markers first, and biggest: this is the row a tester reaches for
                          while driving, and Stop is the one they must not hit by mistake. */}
                      <Text style={styles.rawRecordingHint}>Mark an event — {rawScenario}</Text>
                      <View style={styles.debugRow}>
                        {MARKERS.map(marker => (
                          <Button
                            key={marker.type}
                            variant="outline"
                            size="sm"
                            onPress={() => handleMarker(marker.type, marker.label)}
                            style={styles.debugBtn}
                          >
                            {marker.label}
                          </Button>
                        ))}
                      </View>
                      <Text style={styles.rawRecordingHint}>Change scenario</Text>
                      <View style={styles.debugRow}>
                        {SCENARIOS.filter(scenario => scenario !== rawScenario).map(scenario => (
                          <Button
                            key={scenario}
                            variant="outline"
                            size="sm"
                            onPress={() => handleScenarioChange(scenario)}
                            style={styles.debugBtn}
                          >
                            {scenario}
                          </Button>
                        ))}
                      </View>
                      <View style={styles.debugRow}>
                        <Button variant="danger" size="sm" onPress={handleStopRawRecording} style={styles.debugBtn}>
                          Stop
                        </Button>
                      </View>
                    </View>
                  )}
                  {rawRecordingStatus === 'stopped' && (
                    <View style={styles.debugRow}>
                      <Button variant="outline" size="sm" onPress={() => handleExportRawRecording()} style={styles.debugBtn}>
                        Export
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        loading={uploading}
                        onPress={() => handleUploadRawRecording()}
                        style={styles.debugBtn}
                      >
                        Upload
                      </Button>
                      <Button variant="outline" size="sm" onPress={() => setRawRecordingStatus('idle')} style={styles.debugBtn}>
                        Record Again
                      </Button>
                    </View>
                  )}

                  {/* Sessions on disk, including ones recorded before the last app start.
                      Without this the only reachable recording is the newest, and a restart
                      cost every earlier drive in practice (CAR-305). */}
                  <View style={styles.rawRecordingSection}>
                    <View style={styles.debugRow}>
                      <Button
                        variant="outline"
                        size="sm"
                        onPress={() => setSavedRecordings(sdk.listRawRecordings())}
                        style={styles.debugBtn}
                      >
                        Saved sessions ({savedRecordings.length})
                      </Button>
                    </View>
                    {savedRecordings.map(path => (
                      <View key={path} style={styles.savedRow}>
                        <Text style={styles.savedName} numberOfLines={1}>
                          {path.split('/').pop()}
                        </Text>
                        <Button variant="outline" size="sm" onPress={() => handleExportRawRecording(path)}>
                          Export
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          loading={uploading}
                          onPress={() => handleUploadRawRecording(path)}
                        >
                          Upload
                        </Button>
                      </View>
                    ))}
                  </View>
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
  rawRecordingHint: { ...TYPOGRAPHY.caption, color: COLORS.textMuted, marginTop: 10, marginBottom: 6 },
  savedRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  savedName: { ...TYPOGRAPHY.caption, color: COLORS.textMuted, flex: 1 },
  langRow: { flexDirection: 'row', gap: 8 },
  langBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: COLORS.dark, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center' },
  langBtnActive: { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  langText: { ...TYPOGRAPHY.label, fontSize: 13 },
  langTextActive: { color: '#fff' },
  logoutBtn: { marginTop: 20 },
  versionText: { ...TYPOGRAPHY.caption, textAlign: 'center', marginTop: 30, color: COLORS.textMuted }
});
