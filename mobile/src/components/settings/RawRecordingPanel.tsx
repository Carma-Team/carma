/**
 * @file RawRecordingPanel.tsx
 * @brief The staged-calibration recorder's controls: start under a mount-position
 * label, mark an event by feel while driving, change the label mid-drive, stop, and
 * export or upload what is on disk.
 *
 * Lifted out of the settings screen, where it was around half the file and shared
 * nothing with the rest of it. It is a debug tool for whoever is collecting labelled
 * drives (CAR-31), not a setting, and it renders only under __DEV__ - the screen's own
 * debug section is what gates it, so this component assumes it.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, Alert, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Button } from '@/components/ui/Button';
import { useApp } from '@/context/AppContext';
import { recordingsApi } from '@/services/api/recordings.api';
import { ApiError } from '@/services/api/client';
import { COLORS, TYPOGRAPHY } from '@/constants/theme';

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

export function RawRecordingPanel() {
  const { addToast, startRawRecording, stopRawRecording, exportRawRecording, sdk } = useApp();

  // Both seeded from the SDK rather than from a constant: the recording outlives this
  // screen, so navigating away and back used to show Start for a session that was still
  // running, with no way left to stop it (CAR-321). Lazy initialiser — the session is
  // read once on mount, and every change after that goes through the handlers below.
  const liveSession = () => sdk.getRawRecordingSession();
  // 'stopped' keeps Export reachable after Stop — exportRawRecording() ships the
  // last *completed* session, so the button can't disappear the moment recording ends.
  const [rawRecordingStatus, setRawRecordingStatus] = useState<'idle' | 'recording' | 'stopped'>(
    () => (liveSession() ? 'recording' : 'idle'),
  );
  // The scenario the running session is currently labelled with — a drive can change it
  // mid-session (CAR-303), so it is state rather than the argument Start was given.
  // The SDK stores it as a free-form string, so a label this screen does not offer falls
  // back rather than putting an unselectable value in the row.
  const [rawScenario, setRawScenario] = useState<Scenario>(() => {
    const scenario = liveSession()?.scenario;
    return SCENARIOS.includes(scenario as Scenario) ? (scenario as Scenario) : 'Handheld';
  });
  // Refreshed rather than derived: the list is a directory read, and it changes when a
  // session stops or an upload prunes nothing at all. Seeded on mount for the same reason
  // the two above are — sessions from an earlier app run are on disk and reachable, and
  // an empty list said the opposite until something in this screen stopped a recording.
  const [savedRecordings, setSavedRecordings] = useState<string[]>(() => sdk.listRawRecordings());
  // The path being uploaded, not a boolean: one flag lit every row's spinner and the
  // first response to land put them all back, whichever row was still uploading.
  const [uploadingPath, setUploadingPath] = useState<string | null>(null);

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
    setUploadingPath(path);
    try {
      const saved = await recordingsApi.upload(path);
      addToast({ type: 'success', message: `Uploaded ${saved.sessionId}` });
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 0;
      Alert.alert(
        'Upload',
        // 409 is not "already uploaded" — an identical file answers 200. It means a
        // *different* file is stored under this session id, which is a drive that
        // cannot be saved as it stands, not a duplicate to shrug at.
        status === 403 ? 'This account is not an admin — the endpoint only takes admin uploads.'
          : status === 409 ? 'A different recording is already stored under this session id — this file was not saved.'
          : status === 422 ? 'The server refused the file — no session header, or no samples.'
          : 'Upload failed.'
      );
      console.error('recording upload failed', e);
    } finally {
      setUploadingPath(null);
    }
  };

  return (
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
            loading={uploadingPath === savedRecordings[0]}
            onPress={() => handleUploadRawRecording(savedRecordings[0])}
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
              loading={uploadingPath === path}
              onPress={() => handleUploadRawRecording(path)}
            >
              Upload
            </Button>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  rawRecordingSection: { marginTop: 16, borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 12 },
  rawRecordingLabel: { ...TYPOGRAPHY.caption, color: COLORS.textMuted, marginBottom: 8 },
  debugRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  debugBtn: { flexGrow: 1 },
  rawRecordingHint: { ...TYPOGRAPHY.caption, color: COLORS.textMuted, marginTop: 10, marginBottom: 6 },
  savedRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  savedName: { ...TYPOGRAPHY.caption, color: COLORS.textMuted, flex: 1 },
});
