import React from 'react'
import { View, Text, StyleSheet } from 'react-native'

type Variant = 'success' | 'warning' | 'danger' | 'info' | 'default'

interface BadgeProps {
  variant?: Variant
  children: React.ReactNode
}

const variantColors: Record<Variant, { bg: string; text: string }> = {
  success: { bg: 'rgba(34,197,94,0.15)',  text: '#22c55e' },
  warning: { bg: 'rgba(245,158,11,0.15)', text: '#f59e0b' },
  danger:  { bg: 'rgba(239,68,68,0.15)',  text: '#ef4444' },
  info:    { bg: 'rgba(99,102,241,0.15)', text: '#818cf8' },
  default: { bg: 'rgba(148,163,184,0.15)',text: '#94a3b8' },
}

export function Badge({ variant = 'default', children }: BadgeProps) {
  const colors = variantColors[variant]
  return (
    <View style={[styles.base, { backgroundColor: colors.bg }]}>
      <Text style={[styles.text, { color: colors.text }]}>{children}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  base: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  text: { fontSize: 12, fontWeight: '700' },
})

export default Badge
