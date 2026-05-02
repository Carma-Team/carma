import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Card } from '@/components/ui/Card';
import { useApp } from '@/context/AppContext';
import { COLORS, COMMON_STYLES, SPACING, TYPOGRAPHY } from '@/theme';
import { Button } from '@/components/ui/Button';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function AdminDashboard() {
  const { user, setUser } = useApp();

  const handleLogout = async () => {
    await AsyncStorage.removeItem('carma_token');
    setUser(null);
  };

  return (
    <View style={COMMON_STYLES.screen}>
      <ScrollView contentContainerStyle={COMMON_STYLES.scrollContent}>
        <View style={styles.header}>
          <Text style={TYPOGRAPHY.h1}>שלום, {user?.name || 'מנהל'}</Text>
          <Text style={TYPOGRAPHY.caption}>פאנל ניהול מערכת CARMA</Text>
        </View>

        <View style={styles.grid}>
          <Card style={styles.statCard}>
            <Text style={styles.statLabel}>משתמשים פעילים</Text>
            <Text style={styles.statValue}>1,284</Text>
          </Card>
          <Card style={styles.statCard}>
            <Text style={styles.statLabel}>נסיעות היום</Text>
            <Text style={styles.statValue}>452</Text>
          </Card>
          <Card style={styles.statCard}>
            <Text style={styles.statLabel}>נקודות שחולקו</Text>
            <Text style={styles.statValue}>85.2K</Text>
          </Card>
          <Card style={styles.statCard}>
            <Text style={styles.statLabel}>דיווחים פתוחים</Text>
            <Text style={styles.statValue}>12</Text>
          </Card>
        </View>

        <Text style={[TYPOGRAPHY.h3, { marginTop: SPACING.xl, marginBottom: SPACING.md }]}>פעולות מהירות</Text>

        <TouchableOpacity style={styles.actionRow}>
          <Text style={styles.actionText}>ניהול משתמשים</Text>
          <Text style={styles.actionIcon}>👥</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionRow}>
          <Text style={styles.actionText}>ניהול עסקים והטבות</Text>
          <Text style={styles.actionIcon}>🏪</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionRow}>
          <Text style={styles.actionText}>ניתוח נתוני נהיגה</Text>
          <Text style={styles.actionIcon}>📊</Text>
        </TouchableOpacity>

        <Button
          variant="outline"
          onPress={handleLogout}
          style={{ marginTop: SPACING.xxl }}
        >
          התנתק מהמערכת
        </Button>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    marginBottom: SPACING.xl,
    marginTop: SPACING.md,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.md,
    justifyContent: 'space-between',
  },
  statCard: {
    width: '47%',
    padding: SPACING.md,
    alignItems: 'center',
  },
  statLabel: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textMuted,
    marginBottom: 4,
  },
  statValue: {
    ...TYPOGRAPHY.h2,
    color: COLORS.brandLight,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: SPACING.lg,
    backgroundColor: COLORS.card,
    borderRadius: 12,
    marginBottom: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  actionText: {
    ...TYPOGRAPHY.label,
    fontSize: 16,
  },
  actionIcon: {
    fontSize: 20,
  }
});
