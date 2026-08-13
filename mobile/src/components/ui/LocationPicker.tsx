import React, { useState } from 'react'
import {
  Modal, View, Text, TouchableOpacity,
  FlatList, StyleSheet,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { COLORS, TYPOGRAPHY } from '@/constants/theme'

interface LocationPickerProps {
  value: string
  options: string[]
  placeholder: string
  onChange: (v: string) => void
}

export function LocationPicker({ value, options, placeholder, onChange }: LocationPickerProps) {
  const [open, setOpen] = useState(false)
  const insets = useSafeAreaInsets()

  return (
    <>
      <TouchableOpacity onPress={() => setOpen(true)} style={styles.trigger}>
        <Text style={styles.triggerText} numberOfLines={1}>
          {value || placeholder}
        </Text>
        <Ionicons name="chevron-down" size={14} color={COLORS.textMuted} />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setOpen(false)}>
          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <FlatList
              data={options}
              keyExtractor={o => o}
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.option, item === value && styles.optionActive]}
                  onPress={() => { onChange(item); setOpen(false) }}
                >
                  <Text style={[styles.optionText, item === value && styles.optionTextActive]}>
                    {item}
                  </Text>
                  {item === value && <Ionicons name="checkmark" size={16} color={COLORS.brand} />}
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  )
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flex: 1,
    minWidth: 0,
  },
  triggerText: { ...TYPOGRAPHY.caption, color: COLORS.text, flex: 1 },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: COLORS.card,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 8,
    maxHeight: 320,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
  optionActive: { backgroundColor: COLORS.dark },
  optionText: { ...TYPOGRAPHY.body, color: COLORS.text },
  optionTextActive: { color: COLORS.brand, fontWeight: '700' },
})
