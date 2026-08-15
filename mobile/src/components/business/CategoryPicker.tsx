import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, COMMON_STYLES } from '@/constants/theme';
import { CATEGORY_CONFIG, DEFAULT_CATEGORY, REWARD_CATEGORIES } from '@/constants/icons';
import { SelectSheet } from '@/components/ui/SelectSheet';
import { localize } from '@/lib/utils';
import type { Language } from '@/types';

interface CategoryPickerProps {
  lang: Language;
  category: string;
  onSelect: (key: string) => void;
  /** Doubles as the field label the caller renders and the sheet's title. */
  label: string;
}

export function CategoryPicker({ lang, category, onSelect, label }: CategoryPickerProps) {
  const [open, setOpen] = useState(false);
  const current = CATEGORY_CONFIG[category] ?? DEFAULT_CATEGORY;

  return (
    <>
      <TouchableOpacity onPress={() => setOpen(true)} style={styles.trigger}>
        <View style={[styles.iconCircle, { backgroundColor: current.bg, borderColor: current.color + '40' }]}>
          <Ionicons name={current.icon} size={16} color={current.color} />
        </View>
        <Text style={styles.triggerText}>{localize(current.labelHe, current.labelEn, lang)}</Text>
        <Ionicons name="chevron-down" size={14} color={COLORS.textMuted} />
      </TouchableOpacity>

      <SelectSheet
        visible={open}
        onClose={() => setOpen(false)}
        title={label}
        items={REWARD_CATEGORIES.map(c => ({
          key: c.key,
          label: localize(c.labelHe, c.labelEn, lang),
          icon: c.icon,
          iconColor: CATEGORY_CONFIG[c.key]?.color,
        }))}
        selectedKey={category}
        onSelect={key => { onSelect(key); setOpen(false); }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    ...COMMON_STYLES.input,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingVertical: 8,
  },
  iconCircle: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1,
  },
  triggerText: { flex: 1, color: COLORS.text, fontSize: 15 },
});
