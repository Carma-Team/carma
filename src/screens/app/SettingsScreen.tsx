import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useApp } from '@/context/AppContext';
import { useTranslation } from '@/hooks/useTranslation';
import { COLORS, SPACING, TYPOGRAPHY, COMMON_STYLES } from '@/lib/constants';

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, setUser, clearTripHistory } = useApp();
  const { t, lang, setLang } = useTranslation();

  if (!user) return null;

  async function handleLogout() {
    Alert.alert(
      t('auth.logout'),
      t('auth.logoutConfirm') || 'האם אתה בטוח שברצונך להתנתק?',
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
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name={lang === 'he' ? 'arrow-forward' : 'arrow-back'} size={28} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.title}>{t('profile.settings')}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={{ gap: 20 }}>

          {/* Drive Mode Section */}
          <View>
            <Text style={styles.sectionLabel}>🚗 {t('profile.driveMode')}</Text>
            <Card style={styles.settingCard}>
              <Text style={styles.settingDescription}>
                {t('profile.driveModeDesc')}
              </Text>

              <View style={styles.row}>
                <Text style={styles.statusText}>
                  {user.driveModeEnabled ? `✅ ${t('profile.active')}` : `❌ ${t('profile.inactive')}`}
                </Text>
                <Button
                  size="sm"
                  variant={user.driveModeEnabled ? 'danger' : 'success'}
                  onPress={() => setUser({ ...user, driveModeEnabled: !user.driveModeEnabled })}
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
                      {user.bluetoothDeviceName || t('profile.selectDevice')}
                    </Text>
                  </View>
                  <Ionicons name={lang === 'he' ? 'chevron-back' : 'chevron-forward'} size={18} color={COLORS.textMuted} />
                </TouchableOpacity>
              )}
            </Card>
          </View>

          {/* Language Section */}
          <View>
            <Text style={styles.sectionLabel}>🌐 {t('profile.language')}</Text>
            <Card style={styles.settingCard}>
              <View style={styles.langRow}>
                {(['he', 'en'] as const).map(l => (
                  <TouchableOpacity
                    key={l}
                    onPress={() => setLang(l)}
                    style={[styles.langBtn, lang === l && styles.langBtnActive]}
                  >
                    <Text style={[styles.langText, lang === l && styles.langTextActive]}>
                      {l === 'he' ? 'עברית' : 'English'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </Card>
          </View>

          {/* Data Management Section */}
          <View>
            <Text style={styles.sectionLabel}>⚙️ {t('profile.dataManagement')}</Text>
            <Card style={styles.settingCard}>
              <TouchableOpacity style={styles.actionRow} onPress={handleClearHistory}>
                <Text style={styles.actionTextDanger}>{t('profile.clearHistory')}</Text>
                <Ionicons name="trash-outline" size={20} color={COLORS.danger} />
              </TouchableOpacity>
            </Card>
          </View>

          {/* Logout Section */}
          <Button variant="danger" fullWidth onPress={handleLogout} style={styles.logoutBtn}>
            🚪 {t('auth.logout')}
          </Button>

          <Text style={styles.versionText}>{t('profile.version')} 1.0.0 (5.3.1)</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', padding: SPACING.lg, borderBottomWidth: 1, borderBottomColor: '#222' },
  backBtn: { marginEnd: 15 },
  title: { ...TYPOGRAPHY.h2, flex: 1, textAlign: 'left' },
  content: { padding: SPACING.lg },
  sectionLabel: { ...TYPOGRAPHY.label, color: COLORS.textMuted, marginBottom: 8, marginStart: 4 },
  settingCard: { backgroundColor: 'rgba(255,255,255,0.03)', padding: 16 },
  settingDescription: { ...TYPOGRAPHY.caption, color: COLORS.textMuted, marginBottom: 16, lineHeight: 18, textAlign: 'left' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statusText: { color: '#fff', fontWeight: '700' },
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
  langRow: { flexDirection: 'row', gap: 8 },
  langBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: COLORS.dark, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center' },
  langBtnActive: { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  langText: { ...TYPOGRAPHY.label, fontSize: 13 },
  langTextActive: { color: '#fff' },
  actionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  actionTextDanger: { color: COLORS.danger, fontWeight: '600' },
  logoutBtn: { marginTop: 20 },
  versionText: { ...TYPOGRAPHY.caption, textAlign: 'center', marginTop: 30, color: COLORS.textDim }
});
