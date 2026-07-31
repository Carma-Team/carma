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
import { ICONS, CATEGORY_CONFIG, DEFAULT_CATEGORY, type IoniconName } from '@/constants/icons';
import { businessApi, type BusinessReward } from '@/services/api/business.api';

// Icons available for reward image selection — sourced from the central icon registry
const SELECTABLE_ICONS: IoniconName[] = [
  'gift-outline',
  'restaurant-outline',
  'car-outline',
  'leaf-outline',
  'film-outline',
  'cart-outline',
];

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
  expiresAt: '', stock: '100', isActive: true,
};

export default function RewardFormScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useApp();
  const { t, lang } = useTranslation();
  const direction = lang === 'he' ? 'rtl' : 'ltr';
  const { rewardData } = useLocalSearchParams<{ rewardData?: string }>();

  const isEdit = !!rewardData;
  const existing: BusinessReward | undefined = rewardData ? JSON.parse(rewardData) : undefined;

  const category = user?.businessCategory ?? existing?.category ?? 'other';

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

  const [selectedIcon, setSelectedIcon] = useState<IoniconName>(
    (existing?.imageIcon as IoniconName) ?? 'gift-outline'
  );

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
    // Blank is a real answer here — it means no cap, which the server stores as
    // null. Anything else has to be a whole number, or Number() yields NaN and
    // JSON turns that into null, quietly making a capped reward unlimited.
    const stockText = form.stock.trim();
    const stock = stockText === '' ? null : Number(stockText);
    if (stock !== null && (!Number.isInteger(stock) || stock < 0)) {
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
      imageIcon:     selectedIcon,
      category,
      stock,
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
    <KeyboardAvoidingView style={[COMMON_STYLES.screen, { direction }]} behavior="padding">

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

        {/* Icon picker */}
        <Text style={styles.label}>{t('rewards.iconLabel')}</Text>
        <View style={styles.iconPicker}>
          {SELECTABLE_ICONS.map(icon => (
            <TouchableOpacity
              key={icon}
              style={[styles.iconOption, selectedIcon === icon && styles.iconOptionSelected]}
              onPress={() => setSelectedIcon(icon)}
            >
              <Ionicons
                name={icon}
                size={24}
                color={selectedIcon === icon ? COLORS.brand : COLORS.textMuted}
              />
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>{t('business.form.name')}</Text>
        <TextInput
          style={COMMON_STYLES.input}
          placeholder={t('business.form.namePlaceholder')}
          placeholderTextColor={COLORS.textMuted}
          value={form.titleHe}
          onChangeText={v => update('titleHe', v)}
          textAlign="right"
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
          textAlign="right"
        />

        <Text style={styles.label}>{t('business.form.costPoints')}</Text>
        <TextInput
          style={COMMON_STYLES.input}
          placeholder="150"
          placeholderTextColor={COLORS.textMuted}
          keyboardType="numeric"
          value={form.costPoints}
          onChangeText={v => update('costPoints', v)}
          textAlign="right"
        />

        <Text style={styles.label}>{t('business.form.expiresAt')}</Text>
        <TextInput
          style={COMMON_STYLES.input}
          placeholder={t('business.form.expiresPlaceholder')}
          placeholderTextColor={COLORS.textMuted}
          value={form.expiresAt}
          onChangeText={v => update('expiresAt', v)}
          keyboardType="numbers-and-punctuation"
          textAlign="right"
        />

        <Text style={styles.label}>{t('business.form.stockLabel')}</Text>
        <TextInput
          style={COMMON_STYLES.input}
          placeholder="100"
          placeholderTextColor={COLORS.textMuted}
          keyboardType="numeric"
          value={form.stock}
          onChangeText={v => update('stock', v)}
          textAlign="right"
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
    textAlign: 'right',
  },
  iconPicker: { flexDirection: 'row', gap: 10, flexWrap: 'wrap', marginBottom: 4 },
  iconOption: {
    width: 48, height: 48, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: COLORS.border,
    backgroundColor: COLORS.card,
  },
  iconOptionSelected: { borderColor: COLORS.brand, backgroundColor: 'rgba(99,102,241,0.12)' },
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
