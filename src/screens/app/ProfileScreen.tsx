import React, { useEffect, useState } from 'react'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Card } from '@/components/ui/Card'
import { LevelBadge } from '@/components/gamification/LevelBadge'
import { TripCard } from '@/components/driving/TripCard'
import { useApp } from '@/context/AppContext'
import { useTranslation } from '@/hooks/useTranslation'
import { tripsApi } from '@/services/api/trips.api'
import { userApi } from '@/services/api/user.api'
import { getLevelConfig } from '@/lib/constants'
import { COLORS, COMMON_STYLES, SPACING, TYPOGRAPHY } from '@/theme'
import { formatDistance, formatDuration, formatDate } from '@/lib/utils'
import type { DrivingStats, Trip } from '@/navigation/types'

type Section = 'stats' | 'chart' | 'trips' | 'notifications'

export default function ProfileScreen() {
  const insets = useSafeAreaInsets()
  const { user } = useApp()
  const { t, lang } = useTranslation()
  const [section, setSection] = useState<Section>('stats')
  const [stats,   setStats]   = useState<DrivingStats | null>(null)
  const [trips,   setTrips]   = useState<Trip[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (section === 'stats' && !stats) {
      setLoading(true)
      userApi.stats()
        .then(d => setStats(d.stats))
        .catch(err => console.error('Stats error:', err))
        .finally(() => setLoading(false))
    }
    if ((section === 'trips' || section === 'chart') && trips.length === 0) {
      setLoading(true)
      tripsApi.list(20)
        .then(d => setTrips(d.trips))
        .catch(err => console.error('Trips error:', err))
        .finally(() => setLoading(false))
    }
  }, [section])

  if (!user) return null

  // הגנה על Level
  const currentLevel = Math.max(1, user.level || 1)
  const levelConfig = getLevelConfig(currentLevel)

  const sectionTabs: { key: Section; label: string; emoji: string }[] = [
    { key: 'stats',    label: t('profile.achievements') || 'הישגים', emoji: '🏆' },
    { key: 'chart',    label: t('profile.chart') || 'סטטיסטיקות',  emoji: '📈' },
    { key: 'trips',    label: t('profile.tripHistory'), emoji: '🚗' },
    { key: 'notifications', label: t('profile.notifications') || 'הודעות', emoji: '🔔' },
  ]

  return (
    <View style={[COMMON_STYLES.screen, { paddingTop: Math.max(insets.top, 20) }]}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={COMMON_STYLES.scrollContent}>
        {/* Profile header */}
        <Card glass style={styles.profileCard}>
          <View style={styles.profileRow}>
            <LevelBadge level={currentLevel} size="lg" lang={lang} />
            <View style={styles.profileInfo}>
              <Text style={styles.profileName}>{user.name}</Text>
              <Text style={styles.profileCity}>{user.city}</Text>
              <Text style={[styles.profileLevel, { color: levelConfig.color }]}>
                {levelConfig.icon} {lang === 'he' ? levelConfig.name : levelConfig.nameEn}
              </Text>
            </View>
            <View style={styles.profilePoints}>
              <Text style={styles.pointsValue}>{(user.totalPoints || 0).toLocaleString()}</Text>
              <Text style={styles.pointsLabel}>{t('common.points')}</Text>
            </View>
          </View>
          <View style={styles.profileStats}>
            {[
              { label: t('profile.totalDistance'), value: formatDistance(user.totalDistance || 0, lang) },
              { label: t('profile.level'),         value: String(currentLevel) },
              { label: t('profile.joined'),        value: user.createdAt ? formatDate(user.createdAt, lang) : '—' },
            ].map(s => (
              <View key={s.label} style={styles.profileStat}>
                <Text style={styles.profileStatValue}>{s.value}</Text>
                <Text style={styles.profileStatLabel}>{s.label}</Text>
              </View>
            ))}
          </View>
        </Card>

        {/* Section tabs */}
        <View style={{ marginBottom: SPACING.md }}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: SPACING.md }}
          >
            {sectionTabs.map(tab => (
              <TouchableOpacity
                key={tab.key}
                onPress={() => setSection(tab.key)}
                style={[
                  styles.sectionTab,
                  section === tab.key && styles.sectionTabActive
                ]}
              >
                <Text style={[styles.sectionTabText, section === tab.key && styles.sectionTabTextActive]}>
                  {tab.emoji} {tab.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* Achievements / Stats */}
        {section === 'stats' && (
          loading
            ? <ActivityIndicator color={COLORS.brand} style={{ marginTop: 20 }} />
            : <View style={{ gap: 10 }}>
                <View style={styles.statsGrid}>
                  {[
                    { emoji: '🚗', label: t('stats.totalTrips'),    value: stats?.totalTrips || 0 },
                    { emoji: '📍', label: t('stats.totalDistance'), value: formatDistance(stats?.totalDistance || 0, lang) },
                    { emoji: '⭐', label: t('stats.totalPoints'),   value: (stats?.totalPoints || 0).toLocaleString() },
                    { emoji: '🎯', label: t('stats.avgScore'),      value: stats?.averageScore || 0 },
                    { emoji: '✅', label: t('stats.safeTrips'),     value: stats?.safeTripsCount || 0 },
                    { emoji: '⏱️', label: t('stats.totalDuration'), value: formatDuration(stats?.totalDurationSeconds || 0, lang) },
                  ].map(s => (
                    <Card key={s.label} padding="sm" style={styles.statCard}>
                      <Text style={styles.statEmoji}>{s.emoji}</Text>
                      <Text style={styles.statValue}>{s.value}</Text>
                      <Text style={styles.statLabel}>{s.label}</Text>
                    </Card>
                  ))}
                </View>
              </View>
        )}

        {/* Stats Chart */}
        {section === 'chart' && (
          <Card style={{ padding: 16 }}>
            <Text style={[TYPOGRAPHY.h3, { marginBottom: 20 }]}>מגמת ציונים שבועית</Text>

            <View style={styles.chartContainer}>
              <View style={styles.yAxis}>
                {[100, 75, 50, 25, 0].map(val => (
                  <Text key={val} style={styles.axisLabel}>{val}</Text>
                ))}
              </View>

              <View style={styles.chartContent}>
                {[0, 1, 2, 3, 4].map(i => (
                  <View key={i} style={[styles.gridLine, { top: `${i * 25}%` }]} />
                ))}

                <View style={styles.barsContainer}>
                  {trips.slice(0, 7).reverse().map((trip) => {
                    const score = trip.avg_score || trip.score || 0;
                    const dateStr = trip.start_time || trip.date;
                    const formatted = dateStr ? formatDate(dateStr, lang) : '--/--';
                    return (
                      <View key={trip.id} style={styles.barWrapper}>
                        <View
                          style={[
                            styles.bar,
                            {
                              height: `${score}%`,
                              backgroundColor: score > 85 ? COLORS.success : score > 70 ? COLORS.warning : COLORS.danger
                            }
                          ]}
                        />
                        <Text style={styles.xLabel}>{formatted.split('/')[0]}/{formatted.split('/')[1]}</Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            </View>
            <Text style={[styles.axisLabel, { textAlign: 'center', marginTop: 10, color: COLORS.brandLight }]}>
              ממוצע ציון לפי תאריך נסיעה
            </Text>
          </Card>
        )}

        {/* Trips */}
        {section === 'trips' && (
          loading
            ? <ActivityIndicator color={COLORS.brand} style={{ marginTop: 20 }} />
            : trips.length === 0
              ? <Card style={COMMON_STYLES.emptyState}>
                  <Text style={COMMON_STYLES.emptyIcon}>🛣️</Text>
                  <Text style={COMMON_STYLES.emptyText}>{t('profile.noTrips')}</Text>
                </Card>
              : <View style={{ gap: 10 }}>
                  {trips.map(trip => <TripCard key={trip.id} trip={trip} onPress={() => {}} />)}
                </View>
        )}

        {/* Notifications */}
        {section === 'notifications' && (
          <Card style={COMMON_STYLES.emptyState}>
            <Text style={COMMON_STYLES.emptyIcon}>🔔</Text>
            <Text style={COMMON_STYLES.emptyText}>אין הודעות חדשות</Text>
            <Text style={styles.emptySubtitle}>כאן יופיעו עדכונים על מבצעים, ציונים והודעות מערכת.</Text>
          </Card>
        )}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  profileCard:       { marginBottom: SPACING.md },
  profileRow:        { flexDirection: 'row', alignItems: 'center', gap: 12 },
  profileInfo:       { flex: 1 },
  profileName:       { ...TYPOGRAPHY.h3, fontSize: 18 },
  profileCity:       { ...TYPOGRAPHY.caption },
  profileLevel:      { fontSize: 12, fontWeight: '700', marginTop: 2 },
  profilePoints:     { alignItems: 'flex-end' },
  pointsValue:       { color: COLORS.brandLight, fontSize: 22, fontWeight: '900' },
  pointsLabel:       { ...TYPOGRAPHY.caption, fontSize: 11 },
  profileStats:      { flexDirection: 'row', borderTopWidth: 1, borderTopColor: COLORS.border, marginTop: 12, paddingTop: 12 },
  profileStat:       { flex: 1, alignItems: 'center' },
  profileStatValue:  { color: '#fff', fontWeight: '700', fontSize: 14 },
  profileStatLabel:  { ...TYPOGRAPHY.caption, fontSize: 11, marginTop: 2 },
  sectionTab:        {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 4,
    flexShrink: 0
  },
  sectionTabActive:  { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  sectionTabText:    { ...TYPOGRAPHY.label, fontSize: 13 },
  sectionTabTextActive:{ color: '#fff' },
  statsGrid:         { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 16 },
  statCard:          { width: '48%', height: 140, justifyContent: 'center', alignItems: 'center' },
  statEmoji:         { fontSize: 28, marginBottom: 8 },
  statValue:         { color: '#fff', fontWeight: '900', fontSize: 20 },
  statLabel:         { ...TYPOGRAPHY.caption, fontSize: 13, marginTop: 4, textAlign: 'center' },
  emptySubtitle:     { ...TYPOGRAPHY.caption, textAlign: 'center', marginTop: 8 },
  chartContainer:    { flexDirection: 'row', height: 220, paddingRight: 10 },
  yAxis:             { width: 30, justifyContent: 'space-between', paddingVertical: 5, alignItems: 'flex-start' },
  axisLabel:         { ...TYPOGRAPHY.caption, fontSize: 10, color: COLORS.textMuted },
  chartContent:      { flex: 1, marginLeft: 10, position: 'relative', borderLeftWidth: 1, borderBottomWidth: 1, borderColor: COLORS.border },
  gridLine:          { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: 'rgba(255,255,255,0.05)' },
  barsContainer:     { flex: 1, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-around', paddingHorizontal: 5 },
  barWrapper:        { alignItems: 'center', flex: 1 },
  bar:               { width: 20, borderRadius: 4, opacity: 0.8 },
  xLabel:            { ...TYPOGRAPHY.caption, fontSize: 9, marginTop: 8, color: COLORS.textMuted },
})
