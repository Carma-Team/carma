import React, { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '@/context/AppContext';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, TYPOGRAPHY, COMMON_STYLES } from '@/constants/theme';
import { businessApi, type BusinessReward } from '@/services/api/business.api';

export default function BusinessDashboard() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, setUser } = useApp();

  const [rewards, setRewards] = useState<BusinessReward[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      businessApi.getRewards()
        .then(data => { if (active) setRewards(data); })
        .catch(() => { if (active) Alert.alert('שגיאה', 'לא ניתן לטעון הטבות'); })
        .finally(() => { if (active) setLoading(false); });
      return () => { active = false; };
    }, [])
  );

  function handleDelete(reward: BusinessReward) {
    Alert.alert(
      'מחיקת הטבה',
      `האם למחוק את "${reward.titleHe}"?`,
      [
        { text: 'ביטול', style: 'cancel' },
        {
          text: 'מחק', style: 'destructive',
          onPress: () => {
            businessApi.deleteReward(reward.id)
              .then(() => setRewards(prev => prev.filter(r => r.id !== reward.id)))
              .catch(() => Alert.alert('שגיאה', 'המחיקה נכשלה'));
          },
        },
      ]
    );
  }

  const activeCount = rewards.filter(r => r.isActive).length;

  return (
    <View style={[COMMON_STYLES.screen, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={TYPOGRAPHY.h2}>{user?.name ?? 'ניהול עסק'}</Text>
          <Text style={[TYPOGRAPHY.caption, { marginTop: 2 }]}>ניהול הטבות</Text>
        </View>
        <TouchableOpacity onPress={() => setUser(null)} style={styles.logoutBtn}>
          <Text style={styles.logoutText}>יציאה</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Stats */}
        <Card style={styles.statsCard}>
          <View style={[COMMON_STYLES.rowBetween, { flex: 1 }]}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{rewards.length}</Text>
              <Text style={TYPOGRAPHY.caption}>סה״כ הטבות</Text>
            </View>
            <View style={[styles.statItem, styles.statDivider]}>
              <Text style={[styles.statValue, { color: COLORS.success }]}>{activeCount}</Text>
              <Text style={TYPOGRAPHY.caption}>פעילות</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: COLORS.warning }]}>{rewards.length - activeCount}</Text>
              <Text style={TYPOGRAPHY.caption}>לא פעילות</Text>
            </View>
          </View>
        </Card>

        {/* Section header */}
        <View style={[COMMON_STYLES.rowBetween, { marginBottom: SPACING.md }]}>
          <Text style={TYPOGRAPHY.h3}>ההטבות שלך</Text>
          <Button size="sm" onPress={() => router.push('/(business)/rewardform')}>
            + הוסף הטבה
          </Button>
        </View>

        {loading && <ActivityIndicator color={COLORS.brand} style={{ marginTop: 24 }} />}

        {!loading && rewards.length === 0 && (
          <View style={COMMON_STYLES.emptyState}>
            <Text style={COMMON_STYLES.emptyIcon}>🎁</Text>
            <Text style={COMMON_STYLES.emptyText}>{'אין הטבות עדיין\nלחץ על "הוסף הטבה" כדי להתחיל'}</Text>
          </View>
        )}

        {rewards.map(reward => (
          <Card key={reward.id} style={styles.rewardCard}>
            <View style={styles.rewardRow}>
              <Text style={styles.emoji}>{reward.imageEmoji}</Text>
              <View style={{ flex: 1, marginRight: 12 }}>
                <View style={COMMON_STYLES.rowBetween}>
                  <Text style={TYPOGRAPHY.h3}>{reward.titleHe}</Text>
                  {!reward.isActive && (
                    <Text style={styles.inactiveBadge}>לא פעיל</Text>
                  )}
                </View>
                <Text style={[TYPOGRAPHY.caption, { marginTop: 2 }]} numberOfLines={2}>
                  {reward.descriptionHe}
                </Text>
                <View style={[COMMON_STYLES.row, { marginTop: 6, gap: SPACING.md }]}>
                  <Text style={[TYPOGRAPHY.label, { color: COLORS.brand }]}>
                    {reward.costPoints} נקודות
                  </Text>
                  <Text style={TYPOGRAPHY.caption}>מלאי: {reward.stock}</Text>
                  {reward.expiresAt && (
                    <Text style={TYPOGRAPHY.caption}>
                      עד: {new Date(reward.expiresAt).toLocaleDateString('he-IL')}
                    </Text>
                  )}
                </View>
              </View>
            </View>

            <View style={styles.actions}>
              <TouchableOpacity
                onPress={() => router.push({ pathname: '/(business)/rewardform', params: { rewardData: JSON.stringify(reward) } })}
                style={styles.actionBtn}
              >
                <Text style={{ color: COLORS.brandLight, fontWeight: '600' }}>✏️ עריכה</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => handleDelete(reward)} style={styles.actionBtn}>
                <Text style={{ color: COLORS.danger, fontWeight: '600' }}>🗑 מחיקה</Text>
              </TouchableOpacity>
            </View>
          </Card>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    ...COMMON_STYLES.rowBetween,
    padding: SPACING.lg,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  logoutBtn:   { padding: 8 },
  logoutText:  { color: COLORS.danger, fontWeight: '600' },
  content:     { padding: SPACING.lg, paddingBottom: 60 },
  statsCard:   { marginBottom: SPACING.lg },
  statItem:    { flex: 1, alignItems: 'center', paddingVertical: SPACING.sm },
  statDivider: { borderLeftWidth: 1, borderRightWidth: 1, borderColor: COLORS.border },
  statValue:   { ...TYPOGRAPHY.h2, color: COLORS.brand },
  rewardCard:  { marginBottom: SPACING.sm },
  rewardRow:   { flexDirection: 'row-reverse', alignItems: 'flex-start' },
  emoji:       { fontSize: 36, marginLeft: 12 },
  inactiveBadge: {
    fontSize: 11, color: COLORS.danger,
    borderWidth: 1, borderColor: COLORS.danger,
    borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
  },
  actions: {
    flexDirection: 'row-reverse',
    marginTop: SPACING.sm,
    paddingTop: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    gap: SPACING.lg,
  },
  actionBtn: { paddingVertical: 4 },
});
