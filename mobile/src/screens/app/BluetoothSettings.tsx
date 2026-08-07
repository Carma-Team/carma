import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Alert, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import { COLORS, TYPOGRAPHY, SPACING, COMMON_STYLES } from '@/constants';
import { BluetoothDevice } from '@/lib/driving-sdk/BluetoothManager';

type BTStatus = {
  nativeAvailable: boolean;
  btAvailable: boolean;
  btEnabled: boolean;
  permissionsGranted: boolean;
} | null;

export default function BluetoothSettings() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { sdk, addToast, btDevice, setBtDevice } = useApp();

  const [devices, setDevices]   = useState<BluetoothDevice[]>([]);
  const [loading, setLoading]   = useState(true);
  const [btStatus, setBTStatus] = useState<BTStatus>(null);

  // The selection lives in AppContext, so the settings screen and the SDK listener
  // can never disagree about which device is the target.
  const selectedId = btDevice?.id ?? null;

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

  const handleSelect = async (device: BluetoothDevice) => {
    try {
      const isDeselecting = selectedId === device.id;
      await setBtDevice(isDeselecting ? null : { id: device.id, name: device.name });

      if (!isDeselecting) {
        addToast({ title: 'הוגדר בהצלחה', message: `הרכב שלך זוהה כ-${device.name}`, type: 'success' });
      }
    } catch {
      Alert.alert('שגיאה', 'לא ניתן לשמור את ההגדרה');
    }
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
        <TouchableOpacity onPress={() => router.back()} style={COMMON_STYLES.screenHeaderBackBtn}>
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
