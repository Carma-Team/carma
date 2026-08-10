import React, { useEffect, useState } from 'react'
import { View, ScrollView } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ProfileHeader } from '@/components/social/ProfileHeader'
import { ScoreChart } from '@/components/social/ScoreChart'
import { AchievementsTab } from '@/components/social/AchievementsTab'
import { TripHistoryTab } from '@/components/social/TripHistoryTab'
import { NotificationsTab } from '@/components/social/NotificationsTab'
import { ProfileSectionTabs, Section } from '@/components/social/ProfileSectionTabs'
import { FriendRequestsTab } from '@/components/social/FriendRequestsTab'
import { useApp } from '@/context/AppContext'
import { useTranslation } from '@/hooks/useTranslation'
import { tripsApi } from '@/services/api/trips.api'
import { userApi } from '@/services/api/user.api'
import { COMMON_STYLES } from '@/constants/theme'
import { ICONS, type IoniconName } from '@/constants/icons'
import type { DrivingStats, Trip } from '@/types'

/**
 * User profile screen.
 * Contains 4 tabs: achievements, score chart, trip history, notifications.
 * Each tab is loaded lazily on first visit.
 */
export default function ProfileScreen() {
  const insets = useSafeAreaInsets()
  const { user } = useApp()
  const { t, lang } = useTranslation()
  const [section, setSection] = useState<Section>('stats')
  const [stats,   setStats]   = useState<DrivingStats | null>(null)
  const [trips,   setTrips]   = useState<Trip[]>([])
  const [loading, setLoading] = useState(false)

  /**
   * Loads data for the active tab on first visit — does not reload if data already exists.
   *
   * [server] userApi.stats() → GET /api/user/stats — for stats and chart tab:
   *   - USE_REAL_SERVER=false → intercepted in client.ts, returns MOCK_STATS / MOCK_DRIVER_STATS
   *   - USE_REAL_SERVER=true  → GET /api/user/stats on the real server
   *
   * [server] tripsApi.list(20) → GET /api/trips — for trips and chart tab:
   *   - USE_REAL_SERVER=false → intercepted in client.ts, returns MOCK_TRIPS
   *   - USE_REAL_SERVER=true  → GET /api/trips on the real server
   */
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
      tripsApi.list()
        .then(d => setTrips(d.trips))
        .catch(err => console.error('Trips error:', err))
        .finally(() => setLoading(false))
    }
  }, [section, stats, trips.length])

  if (!user) return null

  const sectionTabs: { key: Section; label: string; icon: IoniconName }[] = [
    { key: 'stats',          label: t('profile.achievements'),   icon: ICONS.achievements },
    { key: 'chart',          label: t('profile.chart'),          icon: ICONS.chart },
    { key: 'trips',          label: t('profile.tripHistory'),    icon: ICONS.trips },
    { key: 'notifications',  label: t('profile.notifications'),  icon: ICONS.notifications },
    { key: 'friendRequests', label: t('profile.friendRequests'), icon: 'people-outline' },
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
          <NotificationsTab onOpenFriendRequests={() => setSection('friendRequests')} />
        )}

        {section === 'friendRequests' && (
          <FriendRequestsTab />
        )}
      </ScrollView>
    </View>
  )
}
