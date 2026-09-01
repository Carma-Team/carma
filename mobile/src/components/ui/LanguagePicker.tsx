import React, { useState } from 'react';
import { Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/constants/theme';
import { ICONS } from '@/constants/icons';
import { SelectSheet } from '@/components/ui/SelectSheet';
import type { Language } from '@/types';

export interface SupportedLanguage {
  code: Language;
  label: string;
}

// Each language's own endonym — shown as-is regardless of the active app
// language, same convention as every OS language picker. Not translated text.
/* eslint-disable no-restricted-syntax */
export const SUPPORTED_LANGUAGES: SupportedLanguage[] = [
  { code: 'HE', label: 'עברית' },
  { code: 'EN', label: 'English' },
];
/* eslint-enable no-restricted-syntax */

interface LanguagePickerProps {
  lang: Language;
  onSelect: (lang: Language) => void;
  /** Caller supplies this via t('profile.language') — no in-component default,
   *  so a missing translation can't silently fall back to one hardcoded language. */
  buttonLabel: string;
}

export function LanguagePicker({ lang, onSelect, buttonLabel }: LanguagePickerProps) {
  const [open, setOpen] = useState(false);

  function handleSelect(code: Language) {
    onSelect(code);
    setOpen(false);
  }

  return (
    <>
      <TouchableOpacity onPress={() => setOpen(true)} style={styles.trigger}>
        <Ionicons name={ICONS.globe} size={16} color={COLORS.brandLight} />
        <Text style={styles.triggerText}>{buttonLabel}</Text>
        <Ionicons name="chevron-down" size={12} color={COLORS.textMuted} />
      </TouchableOpacity>

      <SelectSheet
        visible={open}
        onClose={() => setOpen(false)}
        title={buttonLabel}
        items={SUPPORTED_LANGUAGES.map(l => ({ key: l.code, label: l.label }))}
        selectedKey={lang}
        onSelect={code => handleSelect(code as Language)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.card,
  },
  triggerText: { fontSize: 13, fontWeight: '600', color: COLORS.brandLight },
});
