import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useApp } from '@/context/AppContext'
import { LeaderboardTabs } from '@/components/social/LeaderboardTabs'
import { LeaderboardRow } from '@/components/social/LeaderboardRow'
import { useTranslation } from '@/hooks/useTranslation'
import { leaderboardApi } from '@/services/api/leaderboard.api'
import { COLORS, COMMON_STYLES, SPACING, TYPOGRAPHY } from '@/constants/theme'
import type { FollowStatus, LeaderboardEntry, LeaderboardType } from '@/types'

export default function LeaderboardScreen() {
  const insets = useSafeAreaInsets()
  const { t } = useTranslation()
  const { user } = useApp()

  const [type,          setType]          = useState<LeaderboardType>('city')
  const [entries,       setEntries]       = useState<LeaderboardEntry[]>([])
  const [currentUserId, setCurrentUserId] = useState('')
  const [myRank,        setMyRank]        = useState<number | null>(null)
  const [loading,       setLoading]       = useState(true)
  const inFlight   = useRef<Set<string>>(new Set())
  const fetchToken = useRef(0)

  const fetchLeaderboard = useCallback((tab: LeaderboardType) => {
    const token = ++fetchToken.current
    setLoading(true)
    leaderboardApi.get(tab)
      .then(data => {
        if (token !== fetchToken.current) return
        setEntries(data.entries)
        setCurrentUserId(data.currentUserId)
        setMyRank(data.myRank ?? null)
      })
      .catch(err => {
        if (token !== fetchToken.current) return
        console.error('Leaderboard error:', err)
      })
      .finally(() => {
        if (token === fetchToken.current) setLoading(false)
      })
  }, [])

  useEffect(() => {
    fetchLeaderboard(type)
  }, [type, fetchLeaderboard])

  /**
   * Handles follow/unfollow/cancel-pending.
   * Optimistic update: flip status in local entries immediately,
   * then confirm/revert on server response.
   */
  const handleFollow = useCallback(async (targetUserId: string, currentStatus: FollowStatus) => {
    if (inFlight.current.has(targetUserId)) return

    const optimisticStatus: FollowStatus =
      currentStatus === 'none'    ? 'pending'  : // will correct to 'accepted' if public
      currentStatus === 'pending' ? 'none'     :
      currentStatus === 'accepted'? 'none'     : 'none'

    inFlight.current.add(targetUserId)

    // Optimistic update
    setEntries(prev =>
      prev.map(e => e.userId === targetUserId ? { ...e, followStatus: optimisticStatus } : e)
    )

    try {
      const result = currentStatus === 'none'
        ? await leaderboardApi.follow(targetUserId)
        : await leaderboardApi.unfollow(targetUserId)

      // Reconcile with server truth
      setEntries(prev =>
        prev.map(e => e.userId === targetUserId ? { ...e, followStatus: result.status } : e)
      )

      // Refresh friends tab if we just accepted/removed someone
      if (type === 'friends') fetchLeaderboard('friends')
    } catch {
      // Revert optimistic update on failure
      setEntries(prev =>
        prev.map(e => e.userId === targetUserId ? { ...e, followStatus: currentStatus } : e)
      )
    } finally {
      inFlight.current.delete(targetUserId)
    }
  }, [type, fetchLeaderboard])

  const tabs: { key: LeaderboardType; label: string }[] = [
    { key: 'friends',  label: t('leaderboard.friends') },
    { key: 'city',     label: t('leaderboard.city') },
    { key: 'national', label: t('leaderboard.national') },
  ]

  const header = (
    <>
      <Text style={styles.heading}>{t('leaderboard.title')}</Text>
      <LeaderboardTabs activeTab={type} onTabChange={setType} tabs={tabs} />
      <View style={{ height: 20 }} />
      {type !== 'friends' && (
        <Text style={styles.filterSubtitle}>
          {type === 'city'
            ? `${t('leaderboard.showing_city')}: ${user?.city || 'תל אביב'}`
            : `${t('leaderboard.showing_national')}: ${user?.country || 'ישראל'}`}
        </Text>
      )}
    </>
  )

  const footer = myRank && !entries.some(e => e.userId === currentUserId) ? (
    <View style={styles.myRankBanner}>
      <Text style={styles.myRankText}>
        {t('leaderboard.yourRank') || 'הדירוג שלך'}: #{myRank}
      </Text>
    </View>
  ) : null

  return (
    <View style={[COMMON_STYLES.screen, { paddingTop: Math.max(insets.top, 20) }]}>
      {loading ? (
        <>
          {header}
          <ActivityIndicator color={COLORS.brand} style={{ marginTop: 40 }} />
        </>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={e => e.id}
          ListHeaderComponent={header}
          ListFooterComponent={footer}
          ListEmptyComponent={
            <Text style={styles.empty}>{t('leaderboard.noFriends')}</Text>
          }
          contentContainerStyle={COMMON_STYLES.scrollContent}
          initialNumToRender={15}
          maxToRenderPerBatch={10}
          windowSize={5}
          ItemSeparatorComponent={() => <View style={styles.divider} />}
          renderItem={({ item }) => (
            <LeaderboardRow
              entry={item}
              isCurrentUser={item.userId === currentUserId}
              showFollowButton={type !== 'friends'}
              onFollow={handleFollow}
            />
          )}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  heading:        { ...TYPOGRAPHY.h2, marginBottom: SPACING.lg },
  filterSubtitle: { ...TYPOGRAPHY.caption, textAlign: 'center', color: COLORS.textMuted, marginBottom: 10 },
  divider:        { height: 1, backgroundColor: COLORS.border },
  empty:          { ...TYPOGRAPHY.body, textAlign: 'center', color: COLORS.textMuted, marginTop: 40 },
  myRankBanner:   { padding: SPACING.md, alignItems: 'center', borderTopWidth: 1, borderTopColor: COLORS.border },
  myRankText:     { ...TYPOGRAPHY.label, color: COLORS.brandLight },
})
