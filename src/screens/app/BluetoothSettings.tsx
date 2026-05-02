import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import { COLORS, TYPOGRAPHY, SPACING, COMMON_STYLES } from '@/theme';
import { BluetoothDevice } from '@/lib/driving-sdk/BluetoothManager';

export default function BluetoothSettings() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { sdk, addToast } = useApp();

  const [devices, setDevices] = useState<BluetoothDevice[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      // טעינת רשימת מכשירים מה-SDK
      const available = await sdk.getAvailableDevices();
      setDevices(available);

      // טעינת המכשיר הנבחר מהזיכרון
      const savedId = await AsyncStorage.getItem('carma_bt_device_id');
      setSelectedId(savedId);
    } catch (error) {
      console.error('Failed to load BT settings', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = async (device: BluetoothDevice) => {
    try {
      const newId = selectedId === device.id ? null : device.id;
      setSelectedId(newId);

      if (newId) {
        await AsyncStorage.setItem('carma_bt_device_id', newId);
        sdk.updateTargetDevice(newId);
        addToast({ title: 'הוגדר בהצלחה', message: `הרכב שלך זוהה כ-${device.name}`, type: 'success' });
      } else {
        await AsyncStorage.removeItem('carma_bt_device_id');
        sdk.updateTargetDevice(null);
      }
    } catch (error) {
      Alert.alert('שגיאה', 'לא ניתן לשמור את ההגדרה');
    }
  };

  const renderItem = ({ item }: { item: BluetoothDevice }) => (
    <TouchableOpacity
      style={[styles.deviceItem, selectedId === item.id && styles.selectedItem]}
      onPress={() => handleSelect(item)}
    >
      <View style={styles.deviceInfo}>
        <Ionicons name="bluetooth" size={24} color={selectedId === item.id ? COLORS.brand : '#fff'} />
        <Text style={[styles.deviceName, selectedId === item.id && styles.selectedText]}>{item.name}</Text>
      </View>
      {selectedId === item.id && <Ionicons name="checkmark-circle" size={24} color={COLORS.brand} />}
    </TouchableOpacity>
  );

  return (
    <View style={[COMMON_STYLES.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-forward" size={28} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.title}>חיבור לרכב</Text>
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
            ListEmptyComponent={
              <Text style={styles.emptyText}>לא נמצאו מכשירים מוצמדים. וודא שהטלפון מוצמד לרכב בהגדרות המכשיר.</Text>
            }
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.lg,
    borderBottomWidth: 1,
    borderBottomColor: '#222'
  },
  backBtn: { marginEnd: 15 },
  title: { ...TYPOGRAPHY.h2, flex: 1, textAlign: 'left' },
  content: { flex: 1, padding: SPACING.lg },
  description: { ...TYPOGRAPHY.body, color: COLORS.textMuted, marginBottom: 30, textAlign: 'left' },
  deviceItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1f2e',
    padding: 20,
    borderRadius: 15,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#333'
  },
  selectedItem: { borderColor: COLORS.brand, backgroundColor: 'rgba(52, 199, 89, 0.05)' },
  deviceInfo: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  deviceName: { color: '#fff', fontSize: 16, fontWeight: '600', marginStart: 15 },
  selectedText: { color: COLORS.brand },
  emptyText: { color: COLORS.textMuted, textAlign: 'center', marginTop: 50, lineHeight: 22 },
  footer: { padding: SPACING.xl, borderTopWidth: 1, borderTopColor: '#222' },
  footerText: { color: COLORS.textMuted, textAlign: 'center', fontSize: 13 }
});
