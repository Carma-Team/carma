import React, { useState } from 'react';
import {
  View, Text, TextInput, ScrollView, StyleSheet,
  TouchableOpacity, KeyboardAvoidingView, Alert,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '@/context/AppContext';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, TYPOGRAPHY, COMMON_STYLES } from '@/constants/theme';
import { businessApi, type BusinessReward } from '@/services/api/business.api';

const CATEGORIES = [
  { key: 'fuel',          label: 'דלק',   emoji: '⛽' },
  { key: 'food',          label: 'אוכל',  emoji: '🍔' },
  { key: 'eco',           label: 'ירוק',  emoji: '🌿' },
  { key: 'entertainment', label: 'בידור', emoji: '🎬' },
  { key: 'shopping',      label: 'קניות', emoji: '🛍️' },
  { key: 'other',         label: 'אחר',   emoji: '🎁' },
];

type FormState = {
  titleHe: string;
  descriptionHe: string;
  costPoints: string;
  imageEmoji: string;
  expiresAt: string;
  category: string;
  stock: string;
  isActive: boolean;
};

const EMPTY_FORM: FormState = {
  titleHe: '', descriptionHe: '', costPoints: '',
  imageEmoji: '🎁', expiresAt: '', category: 'food',
  stock: '100', isActive: true,
};

export default function RewardFormScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  useApp();
  const { rewardData } = useLocalSearchParams<{ rewardData?: string }>();

  const isEdit = !!rewardData;
  const existing: BusinessReward | undefined = rewardData ? JSON.parse(rewardData) : undefined;

  const [form, setForm] = useState<FormState>(() => {
    if (existing) {
      return {
        titleHe:       existing.titleHe,
        descriptionHe: existing.descriptionHe,
        costPoints:    String(existing.costPoints),
        imageEmoji:    existing.imageEmoji,
        expiresAt:     existing.expiresAt
          ? new Date(existing.expiresAt).toISOString().split('T')[0]
          : '',
        category:      existing.category,
        stock:         String(existing.stock),
        isActive:      existing.isActive,
      };
    }
    return EMPTY_FORM;
  });

  const [saving, setSaving] = useState(false);

  function update(field: keyof FormState, value: string | boolean) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  function handleSave() {
    if (!form.titleHe.trim()) {
      Alert.alert('שגיאה', 'שם ההטבה הוא שדה חובה'); return;
    }
    if (!form.descriptionHe.trim()) {
      Alert.alert('שגיאה', 'תיאור הוא שדה חובה'); return;
    }
    if (!form.costPoints || Number(form.costPoints) < 1) {
      Alert.alert('שגיאה', 'יש להזין עלות חיובית בנקודות'); return;
    }

    setSaving(true);
    const expiresAt = form.expiresAt
      ? new Date(form.expiresAt).toISOString()
      : undefined;

    const payload = {
      titleHe:       form.titleHe.trim(),
      descriptionHe: form.descriptionHe.trim(),
      costPoints:    Number(form.costPoints),
      imageEmoji:    form.imageEmoji,
      category:      form.category,
      stock:         Number(form.stock) || 100,
      isActive:      form.isActive,
      expiresAt,
    };

    const action = isEdit && existing
      ? businessApi.updateReward(existing.id, payload)
      : businessApi.addReward({ ...payload, titleEn: null, descriptionEn: null });

    action
      .then(() => router.back())
      .catch(() => Alert.alert('שגיאה', 'השמירה נכשלה'))
      .finally(() => setSaving(false));
  }

  return (
    <KeyboardAvoidingView style={COMMON_STYLES.screen} behavior="padding">
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + SPACING.sm }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>‹ חזרה</Text>
        </TouchableOpacity>
        <Text style={TYPOGRAPHY.h3}>{isEdit ? 'עריכת הטבה' : 'הטבה חדשה'}</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

        {/* שם */}
        <Text style={styles.label}>שם ההטבה *</Text>
        <TextInput
          style={styles.input}
          placeholder="לדוגמה: קפה ומאפה חינם"
          placeholderTextColor={COLORS.textMuted}
          value={form.titleHe}
          onChangeText={v => update('titleHe', v)}
          textAlign="right"
        />

        {/* תיאור */}
        <Text style={styles.label}>תיאור *</Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          placeholder="תיאור מלא של ההטבה"
          placeholderTextColor={COLORS.textMuted}
          multiline
          numberOfLines={3}
          value={form.descriptionHe}
          onChangeText={v => update('descriptionHe', v)}
          textAlign="right"
        />

        {/* עלות בנקודות */}
        <Text style={styles.label}>עלות בנקודות *</Text>
        <TextInput
          style={styles.input}
          placeholder="150"
          placeholderTextColor={COLORS.textMuted}
          keyboardType="numeric"
          value={form.costPoints}
          onChangeText={v => update('costPoints', v)}
          textAlign="right"
        />

        {/* אמוג'י */}
        <Text style={styles.label}>אמוג׳י</Text>
        <TextInput
          style={[styles.input, styles.emojiInput]}
          value={form.imageEmoji}
          onChangeText={v => update('imageEmoji', v)}
          maxLength={2}
          textAlign="center"
        />

        {/* תאריך תפוגה */}
        <Text style={styles.label}>תאריך תפוגה (אופציונלי)</Text>
        <TextInput
          style={styles.input}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={COLORS.textMuted}
          value={form.expiresAt}
          onChangeText={v => update('expiresAt', v)}
          keyboardType="numbers-and-punctuation"
          textAlign="right"
        />

        {/* קטגוריה */}
        <Text style={styles.label}>קטגוריה</Text>
        <View style={styles.chips}>
          {CATEGORIES.map(cat => (
            <TouchableOpacity
              key={cat.key}
              style={[styles.chip, form.category === cat.key && styles.chipActive]}
              onPress={() => update('category', cat.key)}
            >
              <Text style={styles.chipText}>{cat.emoji} {cat.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* כמות במלאי */}
        <Text style={styles.label}>כמות במלאי</Text>
        <TextInput
          style={styles.input}
          placeholder="100"
          placeholderTextColor={COLORS.textMuted}
          keyboardType="numeric"
          value={form.stock}
          onChangeText={v => update('stock', v)}
          textAlign="right"
        />

        {/* פעיל / לא פעיל */}
        <Card style={styles.toggleCard}>
          <View style={COMMON_STYLES.rowBetween}>
          <Text style={TYPOGRAPHY.body}>הטבה פעילה</Text>
          <TouchableOpacity
            onPress={() => update('isActive', !form.isActive)}
            style={[styles.toggle, form.isActive && styles.toggleOn]}
          >
            <Text style={styles.toggleText}>{form.isActive ? 'פעיל ✓' : 'לא פעיל'}</Text>
          </TouchableOpacity>
          </View>
        </Card>

        {/* כפתורים */}
        <View style={[COMMON_STYLES.row, styles.buttons]}>
          <Button variant="ghost" onPress={() => router.back()} style={{ flex: 1 }}>
            ביטול
          </Button>
          <Button onPress={handleSave} loading={saving} style={{ flex: 1 }}>
            {isEdit ? 'שמור שינויים' : 'הוסף הטבה'}
          </Button>
        </View>

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: {
    ...COMMON_STYLES.rowBetween,
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backBtn:  { width: 60 },
  backText: { color: COLORS.brand, fontSize: 18, fontWeight: '600' },
  content:  { padding: SPACING.lg, paddingBottom: 60 },
  label: {
    ...TYPOGRAPHY.label,
    marginBottom: 6,
    marginTop: SPACING.md,
    textAlign: 'right',
  },
  input: {
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: SPACING.md,
    paddingVertical: 12,
    color: COLORS.text,
    fontSize: 15,
  },
  multiline:   { height: 80, textAlignVertical: 'top' },
  emojiInput:  { fontSize: 28, height: 56 },
  chips: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  chip: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 20, borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  chipActive:  { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  chipText:    { color: COLORS.text, fontSize: 13 },
  toggleCard:  { marginTop: SPACING.md, padding: SPACING.md },
  toggle: {
    paddingHorizontal: SPACING.md, paddingVertical: 8,
    borderRadius: 20, borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  toggleOn:   { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  toggleText: { color: COLORS.text, fontWeight: '600', fontSize: 13 },
  buttons: {
    marginTop: SPACING.xl,
    gap: SPACING.sm,
  },
});
