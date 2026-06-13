import React, { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { levelToIcon } from '@/lib/utils'
import { friendsApi } from '@/services/api/friends.api'
import { useTranslation } from '@/hooks/useTranslation'
import { COLORS, SPACING, TYPOGRAPHY } from '@/constants/theme'
import type { FriendRequest } from '@/types'

const LEVEL_COLORS = ['#6b7280','#6b7280','#3b82f6','#3b82f6','#f59e0b','#f97316','#22c55e','#8b5cf6','#f59e0b','#fbbf24']
function levelColor(level: number) {
  return LEVEL_COLORS[Math.min(level - 1, LEVEL_COLORS.length - 1)]
}

export function FriendRequestsTab() {
  const { t } = useTranslation()
  const [requests, setRequests] = useState<FriendRequest[]>([])
  const [loading,  setLoading]  = useState(true)
  const [acting,   setActing]   = useState<Set<string>>(new Set())

  const load = useCallback(() => {
    setLoading(true)
    friendsApi.getIncoming()
      .then(d => setRequests(d.requests))
      .catch(err => console.error('Friend requests error:', err))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const handleAccept = useCallback(async (req: FriendRequest) => {
    if (acting.has(req.id)) return
    setActing(prev => new Set(prev).add(req.id))
    try {
      await friendsApi.accept(req.id)
      setRequests(prev => prev.filter(r => r.id !== req.id))
    } catch (e) {
      console.error('Accept failed', e)
    } finally {
      setActing(prev => { const s = new Set(prev); s.delete(req.id); return s })
    }
  }, [acting])

  const handleReject = useCallback(async (req: FriendRequest) => {
    if (acting.has(req.id)) return
    setActing(prev => new Set(prev).add(req.id))
    try {
      await friendsApi.reject(req.id)
      setRequests(prev => prev.filter(r => r.id !== req.id))
    } catch (e) {
      console.error('Reject failed', e)
    } finally {
      setActing(prev => { const s = new Set(prev); s.delete(req.id); return s })
    }
  }, [acting])

  if (loading) {
    return <ActivityIndicator color={COLORS.brand} style={{ marginTop: 40 }} />
  }

  if (requests.length === 0) {
    return (
      <Text style={styles.empty}>{t('profile.noFriendRequests')}</Text>
    )
  }

  return (
    <View style={styles.list}>
      {requests.map(req => (
        <View key={req.id} style={styles.row}>
          <View style={styles.avatar}>
            <Ionicons
              name={levelToIcon(req.fromUserLevel) as any}
              size={22}
              color={levelColor(req.fromUserLevel)}
            />
          </View>
          <View style={styles.info}>
            <Text style={styles.message}>
              <Text style={styles.name}>{req.fromUserName}</Text>
              {'  '}
              {t('profile.sentFriendRequest')}
            </Text>
            {req.fromUserCity ? (
              <Text style={styles.city}>{req.fromUserCity}</Text>
            ) : null}
          </View>
          <View style={styles.actions}>
            {acting.has(req.id) ? (
              <ActivityIndicator size="small" color={COLORS.brand} />
            ) : (
              <>
                <TouchableOpacity
                  onPress={() => handleAccept(req)}
                  style={[styles.actionBtn, styles.acceptBtn]}
                >
                  <Ionicons name="checkmark" size={16} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleReject(req)}
                  style={[styles.actionBtn, styles.rejectBtn]}
                >
                  <Ionicons name="close" size={16} color={COLORS.text} />
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  empty: { ...TYPOGRAPHY.body, textAlign: 'center', color: COLORS.textMuted, marginTop: 40 },
  list:  { paddingTop: SPACING.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    gap: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  avatar: { width: 36, alignItems: 'center', justifyContent: 'center' },
  info:   { flex: 1, minWidth: 0 },
  message: { ...TYPOGRAPHY.body, color: COLORS.text, flexWrap: 'wrap' },
  name:    { fontWeight: '700', color: COLORS.text },
  city:    { ...TYPOGRAPHY.caption, color: COLORS.textMuted, marginTop: 2 },
  actions: { flexDirection: 'row', gap: 8 },
  actionBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  acceptBtn: { backgroundColor: COLORS.brand },
  rejectBtn: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
})
