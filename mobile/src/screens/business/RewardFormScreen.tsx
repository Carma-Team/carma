import React, { useState } from 'react';
import {
  View, Text, TextInput, ScrollView, StyleSheet,
  TouchableOpacity, KeyboardAvoidingView, Alert,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import { useTranslation } from '@/hooks/useTranslation';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, TYPOGRAPHY, COMMON_STYLES } from '@/constants/theme';
import { ICONS, CATEGORY_CONFIG, DEFAULT_CATEGORY } from '@/constants/icons';
import { businessApi, type BusinessReward } from '@/services/api/business.api';
import { parseStockInput } from '@/lib/rewardStock';
import { CategoryPicker } from '@/components/business/CategoryPicker';

type FormState = {
  titleHe: string;
  descriptionHe: string;
  costPoints: string;
  expiresAt: string;
  stock: string;
  isActive: boolean;
};

const EMPTY_FORM: FormState = {
  titleHe: '', descriptionHe: '', costPoints: '',
  // Blank, not a number: a prefilled default is a cap the business never chose,
  // and the save below reads blank back as uncapped.
  expiresAt: '', stock: '', isActive: true,
};

export default function RewardFormScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useApp();
  const { t, lang } = useTranslation();
  const { rewardData } = useLocalSearchParams<{ rewardData?: string }>();

  const isEdit = !!rewardData;
  const existing: BusinessReward | undefined = rewardData ? JSON.parse(rewardData) : undefined;

  const [category, setCategory] = useState(() => user?.businessCategory ?? existing?.category ?? 'other');

  const [form, setForm] = useState<FormState>(() => {
    if (existing) {
      return {
        titleHe:       existing.titleHe,
        descriptionHe: existing.descriptionHe,
        costPoints:    String(existing.costPoints),
        expiresAt:     existing.expiresAt
          ? new Date(existing.expiresAt).toISOString().split('T')[0]
          : '',
        // An uncapped reward has no number to show. Blank, not "null" — and the
        // save below reads blank back as uncapped, so editing anything else
        // about the reward leaves its stock alone.
        stock:    existing.stock === null ? '' : String(existing.stock),
        isActive: existing.isActive,
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
      Alert.alert(t('common.error'), t('business.form.nameRequired')); return;
    }
    if (!form.descriptionHe.trim()) {
      Alert.alert(t('common.error'), t('business.form.descriptionRequired')); return;
    }
    if (!form.costPoints || Number(form.costPoints) < 1) {
      Alert.alert(t('common.error'), t('business.form.costRequired')); return;
    }
    const parsedStock = parseStockInput(form.stock);
    if (!parsedStock.valid) {
      Alert.alert(t('common.error'), t('business.form.stockInvalid')); return;
    }

    setSaving(true);
    const expiresAt = form.expiresAt
      ? new Date(form.expiresAt).toISOString()
      : undefined;

    const payload = {
      titleHe:       form.titleHe.trim(),
      descriptionHe: form.descriptionHe.trim(),
      costPoints:    Number(form.costPoints),
      // Category fully determines the icon now — no independent icon choice.
      imageIcon:     (CATEGORY_CONFIG[category] ?? DEFAULT_CATEGORY).icon,
      category,
      stock:         parsedStock.stock,
      isActive:      form.isActive,
      expiresAt,
    };

    const action = isEdit && existing
      ? businessApi.updateReward(existing.id, payload)
      : businessApi.addReward({ ...payload, titleEn: null, descriptionEn: null });

    action
      .then(() => router.back())
      .catch(() => Alert.alert(t('common.error'), t('business.form.saveError')))
      .finally(() => setSaving(false));
  }

  return (
    <KeyboardAvoidingView style={COMMON_STYLES.screen} behavior="padding">

      {/* Header */}
      <View style={[COMMON_STYLES.screenHeader, { paddingTop: insets.top + SPACING.sm }]}>
        <TouchableOpacity onPress={() => router.back()} style={COMMON_STYLES.screenHeaderBackBtn}>
          <Ionicons name={ICONS.back} size={24} color={COLORS.brandLight} />
        </TouchableOpacity>
        <Text style={COMMON_STYLES.screenHeaderTitle}>
          {isEdit ? t('business.form.editReward') : t('business.form.newReward')}
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

        <Text style={styles.label}>{t('business.form.category')}</Text>
        <CategoryPicker
          lang={lang}
          category={category}
          onSelect={setCategory}
          label={t('business.form.category')}
        />

        <Text style={styles.label}>{t('business.form.name')}</Text>
        <TextInput
          style={COMMON_STYLES.input}
          placeholder={t('business.form.namePlaceholder')}
          placeholderTextColor={COLORS.textMuted}
          value={form.titleHe}
          onChangeText={v => update('titleHe', v)}
        />

        <Text style={styles.label}>{t('business.form.description')}</Text>
        <TextInput
          style={[COMMON_STYLES.input, styles.multiline]}
          placeholder={t('business.form.descriptionPlaceholder')}
          placeholderTextColor={COLORS.textMuted}
          multiline
          numberOfLines={3}
          value={form.descriptionHe}
          onChangeText={v => update('descriptionHe', v)}
        />

        <Text style={styles.label}>{t('business.form.costPoints')}</Text>
        <TextInput
          style={COMMON_STYLES.input}
          placeholder="150"
          placeholderTextColor={COLORS.textMuted}
          keyboardType="numeric"
          value={form.costPoints}
          onChangeText={v => update('costPoints', v)}
        />

        <Text style={styles.label}>{t('business.form.expiresAt')}</Text>
        <TextInput
          style={COMMON_STYLES.input}
          placeholder={t('business.form.expiresPlaceholder')}
          placeholderTextColor={COLORS.textMuted}
          value={form.expiresAt}
          onChangeText={v => update('expiresAt', v)}
          keyboardType="numbers-and-punctuation"
        />

        <Text style={styles.label}>{t('business.form.stockLabel')}</Text>
        {/* No placeholder on purpose — the label says to leave it blank for
            unlimited, and a suggested number contradicts that. */}
        <TextInput
          style={COMMON_STYLES.input}
          keyboardType="numeric"
          value={form.stock}
          onChangeText={v => update('stock', v)}
        />

        <Card style={styles.toggleCard}>
          <View style={COMMON_STYLES.rowBetween}>
            <View style={COMMON_STYLES.row}>
              <Ionicons
                name={form.isActive ? ICONS.active : ICONS.inactive}
                size={18}
                color={form.isActive ? COLORS.success : COLORS.textMuted}
                style={{ marginRight: 8 }}
              />
              <Text style={TYPOGRAPHY.body}>{t('business.form.isActive')}</Text>
            </View>
            <TouchableOpacity
              onPress={() => update('isActive', !form.isActive)}
              style={[styles.toggle, form.isActive && styles.toggleOn]}
            >
              <Text style={[styles.toggleText, form.isActive && { color: '#fff' }]}>
                {form.isActive ? t('business.form.activeLabel') : t('business.form.inactiveLabel')}
              </Text>
            </TouchableOpacity>
          </View>
        </Card>

        <View style={[COMMON_STYLES.row, styles.buttons]}>
          <Button variant="primary" onPress={() => router.back()} style={{ flex: 1 }}>
            {t('common.cancel')}
          </Button>
          <Button onPress={handleSave} loading={saving} style={{ flex: 1 }}>
            {isEdit ? t('business.form.saveChanges') : t('business.addReward')}
          </Button>
        </View>

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { ...COMMON_STYLES.scrollContent },
  label: {
    ...COMMON_STYLES.sectionLabel,
    marginBottom: 6,
    marginTop: SPACING.md,
  },
  multiline:  { height: 80, textAlignVertical: 'top' },
  toggleCard: { marginTop: SPACING.md, padding: SPACING.md },
  toggle: {
    paddingHorizontal: SPACING.md, paddingVertical: 8,
    borderRadius: 20, borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.card,
  },
  toggleOn:   { backgroundColor: COLORS.success, borderColor: COLORS.success },
  toggleText: { color: COLORS.text, fontWeight: '600', fontSize: 13 },
  buttons: { marginTop: SPACING.xl, gap: SPACING.sm },
});
