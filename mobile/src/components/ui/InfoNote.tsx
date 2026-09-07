import React from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useTranslation } from '@/hooks/useTranslation'
import { COLORS, SPACING, TYPOGRAPHY } from '@/constants/theme'

interface InfoNoteProps {
  title?: string
  message: string
  /** Aside under the message, one step smaller and dimmer than it. */
  note?: string
  onClose: () => void
}

/**
 * An explainer that opens under the control that asked for it, rather than over the
 * screen. Rendered by its owner while it is open, so leaving the screen closes it and
 * nothing has to remember it is there.
 */
export function InfoNote({ title, message, note, onClose }: InfoNoteProps) {
  const { t } = useTranslation()

  return (
    <View style={styles.card}>
      {/* `end`, so the X sits where the text finishes: the left in Hebrew, the right
          in English. */}
      <TouchableOpacity
        style={styles.close}
        onPress={onClose}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityRole="button"
        accessibilityLabel={t('common.close')}
      >
        <Ionicons name="close" size={16} color={COLORS.textMuted} />
      </TouchableOpacity>
      {!!title && <Text style={styles.title}>{title}</Text>}
      <Text style={styles.message}>{message}</Text>
      {!!note && <Text style={styles.note}>{note}</Text>}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    paddingEnd: 34,
    marginTop: SPACING.sm,
  },
  close:   { position: 'absolute', end: 8, top: 8, padding: 2, zIndex: 1 },
  title:   { ...TYPOGRAPHY.label, color: COLORS.text, fontWeight: '700', marginBottom: 2 },
  message: { color: COLORS.text, fontSize: 14, fontWeight: '500' },
  note:    { color: COLORS.textMuted, fontSize: 12, marginTop: 6 },
})

export default InfoNote
