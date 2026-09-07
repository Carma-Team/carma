import React, { useEffect, useRef } from 'react'
import { Animated, Text, StyleSheet, TouchableOpacity, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { COLORS } from '@/constants/theme'
import { useTranslation } from '@/hooks/useTranslation'
import type { ToastMessage } from '@/types'

interface ToastProps {
  toast: ToastMessage
  onDismiss: (id: string) => void
}

const typeColors: Record<ToastMessage['type'], string> = {
  success: '#22c55e',
  error:   '#ef4444',
  info:    '#6366f1',
  warning: '#f59e0b',
}

export function Toast({ toast, onDismiss }: ToastProps) {
  const { t } = useTranslation()
  const opacity = useRef(new Animated.Value(0)).current

  useEffect(() => {
    Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 250, useNativeDriver: true }),
      Animated.delay((toast.duration ?? 3500) - 500),
      Animated.timing(opacity, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]).start(() => onDismiss(toast.id))
  }, [])

  return (
    <Animated.View style={[styles.container, { opacity, borderLeftColor: typeColors[toast.type] }]}>
      {/* `end`, so the X sits where the text finishes: the left in Hebrew, the right in
          English. The root view's direction resolves it, so it is already correct
          before the RTL flag takes effect on the next launch. */}
      <TouchableOpacity
        style={styles.close}
        onPress={() => onDismiss(toast.id)}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityRole="button"
        accessibilityLabel={t('common.close')}
      >
        <Ionicons name="close" size={16} color={COLORS.textMuted} />
      </TouchableOpacity>
      {!!toast.title && <Text style={styles.title}>{toast.title}</Text>}
      <Text style={styles.text}>{toast.message}</Text>
    </Animated.View>
  )
}

// ToastContainer: place at root level inside AppProvider
export function ToastContainer({ toasts, onDismiss }: { toasts: ToastMessage[]; onDismiss: (id: string) => void }) {
  return (
    <View style={styles.wrapper} pointerEvents="box-none">
      {toasts.map(t => <Toast key={t.id} toast={t} onDismiss={onDismiss} />)}
    </View>
  )
}

const styles = StyleSheet.create({
  wrapper:   { position: 'absolute', top: 60, left: 16, right: 16, zIndex: 999 },
  container: { backgroundColor: COLORS.card, borderRadius: 12, padding: 14, paddingEnd: 34, marginBottom: 8, borderLeftWidth: 4, borderWidth: 1, borderColor: COLORS.border },
  close:     { position: 'absolute', end: 8, top: 8, padding: 2, zIndex: 1 },
  title:     { color: COLORS.text, fontSize: 14, fontWeight: '700', marginBottom: 2 },
  text:      { color: COLORS.text, fontSize: 14, fontWeight: '500' },
})
