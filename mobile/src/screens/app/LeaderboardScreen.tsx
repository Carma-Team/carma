import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator, FlatList, Linking, Modal, Platform,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useApp } from '@/context/AppContext'
import { LeaderboardTabs } from '@/components/social/LeaderboardTabs'
import { LeaderboardRow } from '@/components/social/LeaderboardRow'
import { LocationPicker } from '@/components/ui/LocationPicker'
import { useTranslation } from '@/hooks/useTranslation'
import { cityLabel } from '@/types'
import { leaderboardApi, type LocationsOut } from '@/services/api/leaderboard.api'
import { userApi, type FoundUser } from '@/services/api/user.api'
import { friendsApi } from '@/services/api/friends.api'
import { COLORS, COMMON_STYLES, SPACING, TYPOGRAPHY } from '@/constants/theme'
import type { FollowStatus, LeaderboardEntry, LeaderboardType } from '@/types'

type SearchState = 'idle' | 'loading' | 'found' | 'not_found'

const INSTALL_LINK = 'https://carma.app/download'

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function LeaderboardScreen() {
  const insets = useSafeAreaInsets()
  const { t, lang } = useTranslation()
  const { user, addToast } = useApp()

  const [type,          setType]          = useState<LeaderboardType>('city')
  const [entries,       setEntries]       = useState<LeaderboardEntry[]>([])
  const [currentUserId, setCurrentUserId] = useState('')
  const [myRank,        setMyRank]        = useState<number | null>(null)
  const [loading,       setLoading]       = useState(true)
  const inFlight   = useRef<Set<string>>(new Set())
  const fetchToken = useRef(0)

  // Location filter state — CARMA is single-country, so only the city is filterable.
  // The state holds a CBS code (CAR-218); the picker shows the label for the
  // viewer's language and the code is what the API filter understands.
  const [locations,        setLocations]        = useState<LocationsOut | null>(null)
  const [selectedCityCode, setSelectedCityCode] = useState<string>(user?.city?.code ?? '')

  // Friends search state
  const [searchPhone, setSearchPhone] = useState('')
  const [searchState, setSearchState] = useState<SearchState>('idle')
  const [foundUser,   setFoundUser]   = useState<FoundUser | null>(null)

  // Remove friend confirmation
  const [removeConfirm, setRemoveConfirm] = useState<LeaderboardEntry | null>(null)

  // Fetch available locations once on mount
  useEffect(() => {
    leaderboardApi.getLocations()
      .then(data => {
        setLocations(data)
        // Ensure the user's default city is valid; keep as-is if not in list
        if (user?.city) setSelectedCityCode(user.city.code)
      })
      .catch(() => {/* non-critical — fall back to user's own values */})
  }, [user?.city?.code])

  const fetchLeaderboard = useCallback((
    tab: LeaderboardType,
    filters?: { cityCode?: string }
  ) => {
    const token = ++fetchToken.current
    setLoading(true)
    leaderboardApi.get(tab, filters)
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
    if (type === 'city') fetchLeaderboard('city', { cityCode: selectedCityCode })
    else                 fetchLeaderboard(type)
  }, [type, selectedCityCode, fetchLeaderboard])

  // Reset search state when leaving the friends tab
  useEffect(() => {
    if (type !== 'friends') {
      setSearchPhone('')
      setSearchState('idle')
      setFoundUser(null)
    }
  }, [type])

  // ── Friends search ────────────────────────────────────────────────────────

  const handleSearch = useCallback(async () => {
    const phone = searchPhone.trim()
    if (!phone) return
    setSearchState('loading')
    setFoundUser(null)
    try {
      const { user: found } = await userApi.searchByPhone(phone)
      setFoundUser(found)
      setSearchState('found')
    } catch {
      setSearchState('not_found')
    }
  }, [searchPhone])

  const handleAddFriend = useCallback(async () => {
    if (!foundUser) return
    try {
      await friendsApi.send(foundUser.id)
      addToast({ type: 'success', message: t('leaderboard.friendRequestSent') })
      setSearchPhone('')
      setSearchState('idle')
      setFoundUser(null)
      fetchLeaderboard('friends')
    } catch {
      addToast({ type: 'error', message: t('common.error') })
    }
  }, [foundUser, addToast, t, fetchLeaderboard])

  const handleSendInvite = useCallback(async () => {
    const senderName = user?.name ?? 'CARMA'
    const message = t('leaderboard.inviteMessage').replace('{name}', senderName).replace('{link}', INSTALL_LINK)
    const phone = searchPhone.replace(/[^0-9]/g, '')
    const intlPhone = phone.startsWith('0') ? `972${phone.slice(1)}` : phone
    const waUrl = `whatsapp://send?phone=${intlPhone}&text=${encodeURIComponent(message)}`
    try {
      const canWA = await Linking.canOpenURL(waUrl)
      if (canWA) { await Linking.openURL(waUrl); return }
    } catch {}
    const sep = Platform.OS === 'ios' ? '&' : '?'
    await Linking.openURL(`sms:${searchPhone}${sep}body=${encodeURIComponent(message)}`)
  }, [searchPhone, user?.name, t])

  // ── Remove friend ────────────────────────────────────────────────────────

  const handleRemoveFriend = useCallback(async () => {
    if (!removeConfirm) return
    const entry = removeConfirm
    setRemoveConfirm(null)
    setEntries(prev => prev.filter(e => e.userId !== entry.userId))
    try {
      await friendsApi.remove(entry.userId)
    } catch {
      // Revert on failure
      setEntries(prev => [...prev, entry].sort((a, b) => a.rank - b.rank))
      addToast({ type: 'error', message: t('common.error') })
    }
  }, [removeConfirm, addToast, t])

  // ── Friend request (send / cancel) ────────────────────────────────────────

  const handleFollow = useCallback(async (targetUserId: string, currentStatus: FollowStatus) => {
    if (inFlight.current.has(targetUserId)) return
    // 'accepted' entries are already friends — no action from leaderboard
    if (currentStatus === 'accepted') return

    const optimisticStatus: FollowStatus = currentStatus === 'none' ? 'pending' : 'none'

    inFlight.current.add(targetUserId)
    setEntries(prev =>
      prev.map(e => e.userId === targetUserId ? { ...e, followStatus: optimisticStatus } : e)
    )

    try {
      if (currentStatus === 'none') {
        // If they had already asked us, the server turns this into an acceptance —
        // so take the status it reports rather than assuming 'pending'.
        const { status } = await friendsApi.send(targetUserId)
        setEntries(prev =>
          prev.map(e => e.userId === targetUserId ? { ...e, followStatus: status } : e)
        )
      } else {
        await friendsApi.cancel(targetUserId)
      }
    } catch {
      // Revert on failure
      setEntries(prev =>
        prev.map(e => e.userId === targetUserId ? { ...e, followStatus: currentStatus } : e)
      )
    } finally {
      inFlight.current.delete(targetUserId)
    }
  }, [])

  // ── Render helpers ────────────────────────────────────────────────────────

  // The picker component works on strings, so it gets labels; these two maps
  // translate between what the screen shows and the code the filter sends.
  const cityOptions = (locations?.cities ?? []).map(c => cityLabel(c, lang))
  const codeByLabel = new Map((locations?.cities ?? []).map(c => [cityLabel(c, lang), c.code]))
  const selectedCityLabel = cityLabel(locations?.cities.find(c => c.code === selectedCityCode), lang)

  const tabs: { key: LeaderboardType; label: string }[] = [
    { key: 'friends',  label: t('leaderboard.friends') },
    { key: 'city',     label: t('leaderboard.city') },
    { key: 'national', label: t('leaderboard.national') },
  ]

  // National tab has nothing left to filter by (single country) — only the
  // city tab keeps a filter, and now gets the full row width to itself.
  const filterRow = type === 'city' ? (
    <View style={styles.filterRow}>
      <Text style={styles.filterSubtitle}>{t('leaderboard.showing_city')}:</Text>
      <LocationPicker
        value={selectedCityLabel}
        options={cityOptions}
        placeholder={t('leaderboard.selectCity')}
        onChange={label => setSelectedCityCode(codeByLabel.get(label) ?? '')}
      />
    </View>
  ) : null

  const friendSearch = type === 'friends' ? (
    <View style={styles.searchSection}>
      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          placeholder={t('leaderboard.searchPhone')}
          placeholderTextColor={COLORS.textMuted}
          value={searchPhone}
          onChangeText={text => {
            setSearchPhone(text)
            if (searchState !== 'idle') { setSearchState('idle'); setFoundUser(null) }
          }}
          onSubmitEditing={handleSearch}
          keyboardType="phone-pad"
          returnKeyType="search"
        />
        <TouchableOpacity
          onPress={handleSearch}
          style={styles.searchBtn}
          disabled={searchState === 'loading'}
        >
          {searchState === 'loading'
            ? <ActivityIndicator size="small" color={COLORS.text} />
            : <Ionicons name="search-outline" size={18} color={COLORS.text} />
          }
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleAddFriend}
          disabled={searchState !== 'found'}
          style={[styles.addBtn, searchState !== 'found' && styles.addBtnDisabled]}
        >
          <Ionicons
            name="add"
            size={20}
            color={searchState === 'found' ? '#fff' : COLORS.textMuted}
          />
        </TouchableOpacity>
      </View>

      {searchState === 'found' && foundUser && (
        <View style={styles.foundRow}>
          <Ionicons name="person-circle-outline" size={16} color={COLORS.brandLight} />
          <Text style={styles.foundName}>{foundUser.name}</Text>
          {foundUser.city ? <Text style={styles.foundCity}>{foundUser.city}</Text> : null}
        </View>
      )}

      {searchState === 'not_found' && (
        <View style={styles.notFoundBox}>
          <Text style={styles.notFoundText}>{t('leaderboard.userNotFound')}</Text>
          <TouchableOpacity onPress={handleSendInvite} style={styles.inviteBtn}>
            <Ionicons name="share-outline" size={14} color={COLORS.brand} style={{ marginRight: 4 }} />
            <Text style={styles.inviteBtnText}>{t('leaderboard.sendInvite')}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  ) : null

  const header = (
    <>
      <Text style={styles.heading}>{t('leaderboard.title')}</Text>
      <LeaderboardTabs activeTab={type} onTabChange={setType} tabs={tabs} />
      <View style={{ height: 16 }} />
      {filterRow}
      {friendSearch}
      <View style={{ height: 8 }} />
    </>
  )

  const footer = myRank && !entries.some(e => e.userId === currentUserId) ? (
    <View style={styles.myRankBanner}>
      <Text style={styles.myRankText}>{t('leaderboard.yourRank')}: #{myRank}</Text>
    </View>
  ) : null

  const removeFriendModal = (
    <Modal
      visible={removeConfirm !== null}
      transparent
      animationType="fade"
      onRequestClose={() => setRemoveConfirm(null)}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <Text style={styles.modalText}>
            {t('leaderboard.removeFriendConfirm')} {removeConfirm?.user?.name}?
          </Text>
          <View style={styles.modalButtons}>
            <TouchableOpacity
              style={[styles.modalBtn, styles.modalBtnNo]}
              onPress={() => setRemoveConfirm(null)}
            >
              <Text style={styles.modalBtnTextNo}>{t('common.no')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalBtn, styles.modalBtnYes]}
              onPress={handleRemoveFriend}
            >
              <Text style={styles.modalBtnTextYes}>{t('common.yes')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  )

  return (
    <View style={[COMMON_STYLES.screen, { paddingTop: Math.max(insets.top, 20) }]}>
      {removeFriendModal}
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
              showRemoveButton={type === 'friends'}
              onRemove={() => setRemoveConfirm(item)}
            />
          )}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  heading:      { ...TYPOGRAPHY.h2, marginBottom: SPACING.lg },
  divider:      { height: 1, backgroundColor: COLORS.border },
  empty:        { ...TYPOGRAPHY.body, textAlign: 'center', color: COLORS.textMuted, marginTop: 40 },
  myRankBanner: { padding: SPACING.md, alignItems: 'center', borderTopWidth: 1, borderTopColor: COLORS.border },
  myRankText:   { ...TYPOGRAPHY.label, color: COLORS.brandLight },

  // Location filter row (city / national tabs)
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  filterSubtitle: { ...TYPOGRAPHY.caption, color: COLORS.textMuted, flexShrink: 0 },

  // Friends search
  searchSection: { marginBottom: 4 },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  searchInput: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.card,
    paddingHorizontal: 12,
    color: COLORS.text,
    fontSize: 14,
  },
  searchBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: COLORS.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnDisabled: {
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  foundRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 4,
    paddingBottom: 4,
  },
  foundName: { ...TYPOGRAPHY.label, color: COLORS.brandLight },
  foundCity: { ...TYPOGRAPHY.caption, color: COLORS.textMuted },
  notFoundBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  notFoundText:  { ...TYPOGRAPHY.caption, color: COLORS.textMuted, flex: 1 },
  inviteBtn:     { flexDirection: 'row', alignItems: 'center', paddingLeft: 8 },
  inviteBtnText: { ...TYPOGRAPHY.label, color: COLORS.brand, fontSize: 12 },

  // Remove friend confirmation modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  modalCard: {
    backgroundColor: COLORS.card,
    borderRadius: 20,
    padding: 24,
    width: '100%',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  modalText:       { ...TYPOGRAPHY.body, color: COLORS.text, textAlign: 'center', marginBottom: 20, lineHeight: 22 },
  modalButtons:    { flexDirection: 'row', gap: 12 },
  modalBtn:        { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
  modalBtnNo:      { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border },
  modalBtnYes:     { backgroundColor: COLORS.danger },
  modalBtnTextNo:  { ...TYPOGRAPHY.label, color: COLORS.text },
  modalBtnTextYes: { ...TYPOGRAPHY.label, color: '#fff' },
})
