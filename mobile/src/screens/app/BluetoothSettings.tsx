import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Alert, Platform } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import { useTranslation } from '@/hooks/useTranslation';
import { COLORS, TYPOGRAPHY, SPACING, COMMON_STYLES } from '@/constants';
import { BluetoothDevice } from '@/lib/driving-sdk/BluetoothManager';
import { userApi } from '@/services/api/user.api';

type BTStatus = {
  nativeAvailable: boolean;
  btAvailable: boolean;
  btEnabled: boolean;
  permissionsGranted: boolean;
} | null;

export default function BluetoothSettings() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  // `activating` is set only when this screen is reached from a fresh "enable drive mode"
  // attempt — it gates the "no device selected" warning on back-out below.
  const { activating } = useLocalSearchParams<{ activating?: string }>();
  const { sdk, user, setUser, addToast } = useApp();

  const [devices, setDevices]       = useState<BluetoothDevice[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(user?.bluetoothDeviceId ?? null);
  const [loading, setLoading]       = useState(true);
  const [btStatus, setBTStatus]     = useState<BTStatus>(null);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const status = await sdk.getBTSupportStatus();
      setBTStatus(status);

      const available = await sdk.getAvailableDevices();
      setDevices(available);
    } catch (error) {
      console.error('Failed to load BT settings', error);
    } finally {
      setLoading(false);
    }
  }, [sdk]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleBack = () => {
    if (activating === '1' && !selectedId) {
      Alert.alert(t('profile.noDeviceSelectedTitle'), t('profile.noDeviceSelectedMessage'), [
        { text: t('common.confirm'), onPress: () => router.back() },
      ]);
      return;
    }
    router.back();
  };

  // Selecting a device links it and turns drive mode on. Turning drive mode back off
  // happens from SettingsScreen, not by re-tapping a device here.
  const handleSelect = (device: BluetoothDevice) => {
    if (!user) return;
    setSelectedId(device.id);

    // sdk.updateTargetDevice() is not called here — useDriveMode() reacts to
    // user.bluetoothDeviceId changes and drives the SDK's BT monitoring on its own.
    const patch = { driveModeEnabled: true, bluetoothDeviceId: device.id, bluetoothDeviceName: device.name };
    setUser({ ...user, ...patch });
    userApi.updateProfile(patch).catch(e =>
      console.error('[BluetoothSettings] Failed to persist device selection', e)
    );

    addToast({ title: 'הוגדר בהצלחה', message: `הרכב שלך זוהה כ-${device.name}`, type: 'success' });
  };

  const renderItem = ({ item }: { item: BluetoothDevice }) => (
    <TouchableOpacity
      style={[styles.deviceItem, selectedId === item.id && styles.selectedItem]}
      onPress={() => handleSelect(item)}
    >
      <View style={styles.deviceInfo}>
        <Ionicons name="bluetooth" size={24} color={selectedId === item.id ? COLORS.brand : COLORS.text} />
        <Text style={[styles.deviceName, selectedId === item.id && styles.selectedText]}>{item.name}</Text>
      </View>
      {selectedId === item.id && <Ionicons name="checkmark-circle" size={24} color={COLORS.brand} />}
    </TouchableOpacity>
  );

  const renderEmpty = () => {
    if (!btStatus) return null;

    if (!btStatus.nativeAvailable) {
      return (
        <View style={styles.emptyContainer}>
          <Ionicons name="construct-outline" size={48} color={COLORS.textMuted} style={{ marginBottom: 16 }} />
          <Text style={styles.emptyTitle}>נדרש גרסת Dev Build</Text>
          <Text style={styles.emptyText}>
            תכונה זו דורשת גרסת פיתוח של האפליקציה (Expo Dev Build) ואינה זמינה ב-Expo Go.
          </Text>
        </View>
      );
    }

    if (Platform.OS !== 'android') {
      return (
        <View style={styles.emptyContainer}>
          <Ionicons name="logo-apple" size={48} color={COLORS.textMuted} style={{ marginBottom: 16 }} />
          <Text style={styles.emptyTitle}>iOS אינה נתמכת</Text>
          <Text style={styles.emptyText}>
            חיבור Bluetooth Classic זמין על מכשירי Android בלבד.
          </Text>
        </View>
      );
    }

    if (!btStatus.btEnabled) {
      return (
        <View style={styles.emptyContainer}>
          <Ionicons name="bluetooth-outline" size={48} color={COLORS.textMuted} style={{ marginBottom: 16 }} />
          <Text style={styles.emptyTitle}>Bluetooth כבוי</Text>
          <Text style={styles.emptyText}>
            אנא הפעל את ה-Bluetooth בהגדרות המכשיר ולחץ על רענון.
          </Text>
          <TouchableOpacity style={styles.refreshBtn} onPress={loadSettings}>
            <Ionicons name="refresh" size={18} color={COLORS.brand} />
            <Text style={styles.refreshText}>רענן</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (!btStatus.permissionsGranted) {
      return (
        <View style={styles.emptyContainer}>
          <Ionicons name="shield-outline" size={48} color={COLORS.textMuted} style={{ marginBottom: 16 }} />
          <Text style={styles.emptyTitle}>נדרשת הרשאה</Text>
          <Text style={styles.emptyText}>
            לא הוענקה הרשאת Bluetooth. אנא אשר גישה בהגדרות האפליקציה ולחץ על רענון.
          </Text>
          <TouchableOpacity style={styles.refreshBtn} onPress={loadSettings}>
            <Ionicons name="refresh" size={18} color={COLORS.brand} />
            <Text style={styles.refreshText}>נסה שוב</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="bluetooth-outline" size={48} color={COLORS.textMuted} style={{ marginBottom: 16 }} />
        <Text style={styles.emptyTitle}>לא נמצאו מכשירים</Text>
        <Text style={styles.emptyText}>
          לא נמצאו מכשירים Bluetooth מוצמדים. ודא שהטלפון מוצמד לרכב בהגדרות הטלפון.
        </Text>
        <TouchableOpacity style={styles.refreshBtn} onPress={loadSettings}>
          <Ionicons name="refresh" size={18} color={COLORS.brand} />
          <Text style={styles.refreshText}>רענן</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={[COMMON_STYLES.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={COMMON_STYLES.screenHeader}>
        <TouchableOpacity onPress={handleBack} style={COMMON_STYLES.screenHeaderBackBtn}>
          <Ionicons name="arrow-forward" size={28} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={COMMON_STYLES.screenHeaderTitle}>חיבור לרכב</Text>
        {!loading && devices.length > 0 && (
          <TouchableOpacity onPress={loadSettings} style={styles.refreshHeaderBtn}>
            <Ionicons name="refresh" size={22} color={COLORS.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.content}>
        <Text style={styles.description}>
          בחר את התקן ה-Bluetooth של הרכב שלך כדי שנוכל להתחיל ולסיים נסיעות באופן אוטומטי.
        </Text>

        {loading ? (
          <ActivityIndicator size="large" color={COLORS.brand} style={{ marginTop: 50 }} />
        ) : (
          <FlatList
            data={devices}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            ListEmptyComponent={renderEmpty}
          />
        )}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          נסיעה תתחיל אוטומטית ברגע שהטלפון יתחבר למכשיר הנבחר.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  refreshHeaderBtn: { marginStart: 'auto' },
  content:          { flex: 1, padding: SPACING.lg },
  description:      { ...TYPOGRAPHY.body, color: COLORS.textMuted, marginBottom: 30, textAlign: 'left' },
  deviceItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    padding: 20,
    borderRadius: 15,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.border
  },
  selectedItem: { borderColor: COLORS.brand, backgroundColor: 'rgba(52, 199, 89, 0.05)' },
  deviceInfo:   { flexDirection: 'row', alignItems: 'center', flex: 1 },
  deviceName:   { color: COLORS.text, fontSize: 16, fontWeight: '600', marginStart: 15 },
  selectedText: { color: COLORS.brand },
  emptyContainer: { alignItems: 'center', marginTop: 60, paddingHorizontal: 24 },
  emptyTitle:     { color: COLORS.text, fontSize: 17, fontWeight: '700', marginBottom: 10, textAlign: 'center' },
  emptyText:      { color: COLORS.textMuted, textAlign: 'center', lineHeight: 22, fontSize: 14 },
  refreshBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginTop: 20, paddingVertical: 10, paddingHorizontal: 20,
    borderRadius: 20, borderWidth: 1, borderColor: COLORS.brand,
  },
  refreshText:  { color: COLORS.brand, fontSize: 15, fontWeight: '600' },
  footer:       { padding: SPACING.xl, borderTopWidth: 1, borderTopColor: COLORS.border },
  footerText:   { color: COLORS.textMuted, textAlign: 'center', fontSize: 13 }
});
