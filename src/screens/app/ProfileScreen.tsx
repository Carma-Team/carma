import React, { useEffect, useState } from 'react'
import { View, ScrollView } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ProfileHeader } from '@/components/social/ProfileHeader'
import { ScoreChart } from '@/components/social/ScoreChart'
import { AchievementsTab } from '@/components/social/AchievementsTab'
import { TripHistoryTab } from '@/components/social/TripHistoryTab'
import { NotificationsTab } from '@/components/social/NotificationsTab'
import { ProfileSectionTabs, Section } from '@/components/social/ProfileSectionTabs'
import { useApp } from '@/context/AppContext'
import { useTranslation } from '@/hooks/useTranslation'
import { tripsApi } from '@/services/api/trips.api'
import { userApi } from '@/services/api/user.api'
import { COMMON_STYLES } from '@/constants/theme'
import type { DrivingStats, Trip } from '@/navigation/types'

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
  }, [section, stats, trips.length])

  if (!user) return null

  const sectionTabs: { key: Section; label: string; emoji: string }[] = [
    { key: 'stats',    label: t('profile.achievements') || 'הישגים', emoji: '🏆' },
    { key: 'chart',    label: t('profile.chart') || 'סטטיסטיקות',  emoji: '📈' },
    { key: 'trips',    label: t('profile.tripHistory'), emoji: '🚗' },
    { key: 'notifications', label: t('profile.notifications') || 'הודעות', emoji: '🔔' },
  ]

  return (
    <View style={[COMMON_STYLES.screen, { paddingTop: Math.max(insets.top, 20) }]}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={COMMON_STYLES.scrollContent}>
        {/* Header Section */}
        <ProfileHeader user={user} lang={lang} />

        {/* Navigation Tabs */}
        <ProfileSectionTabs
          activeSection={section}
          onSectionChange={setSection}
          tabs={sectionTabs}
        />

        {/* Tab Content */}
        {section === 'stats' && (
          <AchievementsTab stats={stats} loading={loading} />
        )}

        {section === 'chart' && (
          <ScoreChart trips={trips} lang={lang} />
        )}

        {section === 'trips' && (
          <TripHistoryTab trips={trips} loading={loading} />
        )}

        {section === 'notifications' && (
          <NotificationsTab />
        )}
      </ScrollView>
    </View>
  )
}
