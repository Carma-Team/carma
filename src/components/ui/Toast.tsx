import React, { useEffect, useRef } from 'react'
import { Animated, Text, StyleSheet, View } from 'react-native'
import type { ToastMessage } from '@/navigation/types'

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
      <Text style={styles.text}>{toast.message}</Text>
    </Animated.View>
  )
}

// ToastContainer: place at root level inside AppProvider
export function ToastContainer({ toasts, onDismiss }: { toasts: ToastMessage[]; onDismiss: (id: string) => void }) {
  return (
    <View style={styles.wrapper} pointerEvents="none">
      {toasts.map(t => <Toast key={t.id} toast={t} onDismiss={onDismiss} />)}
    </View>
  )
}

const styles = StyleSheet.create({
  wrapper:   { position: 'absolute', top: 60, left: 16, right: 16, zIndex: 999 },
  container: { backgroundColor: '#1e293b', borderRadius: 12, padding: 14, marginBottom: 8, borderLeftWidth: 4 },
  text:      { color: '#fff', fontSize: 14, fontWeight: '500' },
})
