import React, { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import { useTranslation } from '@/hooks/useTranslation';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, TYPOGRAPHY, COMMON_STYLES } from '@/constants/theme';
import { ICONS, CATEGORY_CONFIG, DEFAULT_CATEGORY } from '@/constants/icons';
import { LanguagePicker } from '@/components/ui/LanguagePicker';
import { businessApi, type BusinessReward } from '@/services/api/business.api';
import { formatStockLabel } from '@/lib/rewardStock';

export default function BusinessDashboardScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, setUser } = useApp();
  const { t, lang, setLang } = useTranslation();

  const [rewards, setRewards] = useState<BusinessReward[]>([]);
  const [loading, setLoading] = useState(true);
  const direction = lang === 'he' ? 'rtl' : 'ltr';

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      businessApi.getRewards()
        .then(data => { if (active) setRewards(data); })
        .catch(() => { if (active) Alert.alert(t('common.error'), t('business.loadError')); })
        .finally(() => { if (active) setLoading(false); });
      return () => { active = false; };
    }, [])
  );

  function handleDelete(reward: BusinessReward) {
    Alert.alert(
      t('business.deleteTitle'),
      `${t('business.deleteConfirm')} "${reward.titleHe}"?`,
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('business.delete'), style: 'destructive',
          onPress: () => {
            businessApi.deleteReward(reward.id)
              .then(() => setRewards(prev => prev.filter(r => r.id !== reward.id)))
              .catch(() => Alert.alert(t('common.error'), t('business.deleteError')));
          },
        },
      ]
    );
  }

  const activeCount = rewards.filter(r => r.isActive).length;

  return (
    <View style={[COMMON_STYLES.screen, { paddingTop: insets.top, direction }]}>

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={COMMON_STYLES.row}>
            {user?.businessCategory && (() => {
              const cat = CATEGORY_CONFIG[user.businessCategory] ?? DEFAULT_CATEGORY;
              return (
                <View style={[styles.headerCatIcon, { backgroundColor: cat.bg, borderColor: cat.color + '40' }]}>
                  <Ionicons name={cat.icon} size={18} color={cat.color} />
                </View>
              );
            })()}
            <Text style={TYPOGRAPHY.h2}>{user?.name ?? t('business.title')}</Text>
          </View>
          <Text style={[TYPOGRAPHY.caption, { marginTop: 2 }]}>{t('business.subtitle')}</Text>
        </View>

        <View style={styles.headerRight}>
          <LanguagePicker lang={lang} onSelect={code => setLang(code as 'he' | 'en')} buttonLabel={t('profile.language')} />

          {/* Logout */}
          <TouchableOpacity onPress={() => setUser(null)} style={styles.logoutBtn}>
            <Ionicons name={ICONS.logout} size={20} color={COLORS.danger} />
            <Text style={styles.logoutText}>{t('auth.logout')}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content}>

        {/* Stats */}
        <Card style={styles.statsCard}>
          <View style={[COMMON_STYLES.rowBetween, { flex: 1 }]}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{rewards.length}</Text>
              <Text style={TYPOGRAPHY.caption}>{t('business.totalRewards')}</Text>
            </View>
            <View style={[styles.statItem, styles.statDivider]}>
              <Text style={[styles.statValue, { color: COLORS.success }]}>{activeCount}</Text>
              <Text style={TYPOGRAPHY.caption}>{t('business.active')}</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: COLORS.warning }]}>{rewards.length - activeCount}</Text>
              <Text style={TYPOGRAPHY.caption}>{t('business.inactive')}</Text>
            </View>
          </View>
        </Card>

        {/* Section header */}
        <View style={[COMMON_STYLES.rowBetween, { marginBottom: SPACING.md }]}>
          <Text style={TYPOGRAPHY.h3}>{t('business.yourRewards')}</Text>
          <Button size="sm" onPress={() => router.push('/(business)/rewardform')}>
            + {t('business.addReward')}
          </Button>
        </View>

        {loading && <ActivityIndicator color={COLORS.brand} style={{ marginTop: 24 }} />}

        {!loading && rewards.length === 0 && (
          <View style={COMMON_STYLES.emptyState}>
            <Ionicons name={ICONS.noRewards} size={40} color={COLORS.textMuted} style={{ marginBottom: 8 }} />
            <Text style={COMMON_STYLES.emptyText}>{t('business.emptyRewards')}</Text>
          </View>
        )}

        {rewards.map(reward => {
          const cat = CATEGORY_CONFIG[reward.category] ?? DEFAULT_CATEGORY;
          return (
            <Card key={reward.id} style={styles.rewardCard}>
              <View style={styles.rewardRow}>

                {/* Category icon */}
                <View style={[styles.iconCircle, { backgroundColor: cat.bg, borderColor: cat.color + '40' }]}>
                  <Ionicons name={cat.icon} size={22} color={cat.color} />
                </View>

                {/* Content */}
                <View style={styles.rewardContent}>
                  <View style={COMMON_STYLES.rowBetween}>
                    <Text style={TYPOGRAPHY.h3} numberOfLines={1}>{reward.titleHe}</Text>
                    {!reward.isActive && (
                      <Text style={styles.inactiveBadge}>{t('business.inactiveBadge')}</Text>
                    )}
                  </View>
                  <Text style={[TYPOGRAPHY.caption, { marginTop: 2 }]} numberOfLines={2}>
                    {reward.descriptionHe}
                  </Text>
                  <View style={[COMMON_STYLES.row, { marginTop: 6, gap: SPACING.md }]}>
                    <View style={styles.costBadge}>
                      <Ionicons name={ICONS.points} size={11} color={COLORS.brandLight} style={{ marginRight: 3 }} />
                      <Text style={styles.costText}>{reward.costPoints} {t('common.points')}</Text>
                    </View>
                    <Text style={TYPOGRAPHY.caption}>
                      {t('business.stock')}: {formatStockLabel(reward.stock, reward.available, t('business.stockUnlimited'))}
                    </Text>
                    {reward.expiresAt && (
                      <Text style={TYPOGRAPHY.caption}>
                        {t('business.expires')}: {new Date(reward.expiresAt).toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-US')}
                      </Text>
                    )}
                  </View>
                </View>

              </View>

              {/* Actions */}
              <View style={styles.actions}>
                <TouchableOpacity
                  onPress={() => router.push({ pathname: '/(business)/rewardform', params: { rewardData: JSON.stringify(reward) } })}
                  style={styles.actionBtn}
                >
                  <Ionicons name={ICONS.edit} size={15} color={COLORS.brandLight} />
                  <Text style={[styles.actionText, { color: COLORS.brandLight }]}>{t('business.edit')}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => handleDelete(reward)} style={styles.actionBtn}>
                  <Ionicons name={ICONS.trash} size={15} color={COLORS.danger} />
                  <Text style={[styles.actionText, { color: COLORS.danger }]}>{t('business.delete')}</Text>
                </TouchableOpacity>
              </View>
            </Card>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header:     { ...COMMON_STYLES.screenHeader, justifyContent: 'space-between' },
  headerLeft: { gap: 2 },
  headerCatIcon: {
    width: 30, height: 30, borderRadius: 15,
    alignItems: 'center' as const, justifyContent: 'center' as const,
    borderWidth: 1, marginEnd: 8,
  },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  logoutBtn:   { flexDirection: 'row', alignItems: 'center', gap: 4, padding: 6 },
  logoutText:  { ...TYPOGRAPHY.label, color: COLORS.danger },
  content:     { ...COMMON_STYLES.scrollContent },
  statsCard:   { marginBottom: SPACING.lg },
  statItem:    { flex: 1, alignItems: 'center', paddingVertical: SPACING.sm },
  statDivider: { borderLeftWidth: 1, borderRightWidth: 1, borderColor: COLORS.border },
  statValue:   { ...TYPOGRAPHY.h2, color: COLORS.brand },
  rewardCard:  { marginBottom: SPACING.sm },
  rewardRow:   { flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.sm, marginBottom: SPACING.sm },
  iconCircle: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, flexShrink: 0,
  },
  rewardContent: { flex: 1 },
  inactiveBadge: {
    fontSize: 11, color: COLORS.danger,
    borderWidth: 1, borderColor: COLORS.danger,
    borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
  },
  costBadge: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(99,102,241,0.08)',
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
  },
  costText:   { color: COLORS.brandLight, fontSize: 12, fontWeight: '700' },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingTop: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    gap: SPACING.lg,
  },
  actionBtn:  { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4 },
  actionText: { ...TYPOGRAPHY.label },
});
