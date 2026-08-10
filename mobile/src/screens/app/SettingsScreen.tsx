import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useApp } from '@/context/AppContext';
import { useTranslation } from '@/hooks/useTranslation';
import { COLORS, SPACING, TYPOGRAPHY, COMMON_STYLES } from '@/constants/theme';
import { ICONS } from '@/constants/icons';

/**
 * Settings screen.
 * Includes: drive mode + Bluetooth selection, language, history reset, logout.
 * All actions here are local (AsyncStorage / AppContext) — no server calls.
 */
export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, setUser, clearTripHistory, btDevice } = useApp();
  const { t, lang, setLang } = useTranslation();

  if (!user) return null;

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
