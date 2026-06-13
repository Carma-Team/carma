import React from 'react';
import { ScrollView, TouchableOpacity, Text, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, TYPOGRAPHY } from '@/constants/theme';
import { CATEGORY_CONFIG } from '@/constants/icons';
import { localize } from '@/lib/utils';
import type { IoniconName } from '@/constants/icons';

interface Category {
  key: string;
  labelHe: string;
  labelEn: string;
  icon: IoniconName;
}

interface CategoryFilterProps {
  categories: Category[];
  selectedCategory: string;
  onSelectCategory: (key: string) => void;
  lang: string;
}

export const CategoryFilter: React.FC<CategoryFilterProps> = ({
  categories,
  selectedCategory,
  onSelectCategory,
  lang,
}) => {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
    >
      {categories.map((cat) => {
        const isActive = selectedCategory === cat.key;
        const catConfig = CATEGORY_CONFIG[cat.key];
        const iconColor = isActive ? '#fff' : (catConfig?.color ?? COLORS.textMuted);

        return (
          <TouchableOpacity
            key={cat.key}
            onPress={() => onSelectCategory(cat.key)}
            style={[styles.catBtn, isActive && styles.catBtnActive]}
          >
            <Ionicons name={cat.icon} size={13} color={iconColor} style={{ marginRight: 4 }} />
            <Text style={[styles.catText, isActive && styles.catTextActive]}>
              {localize(cat.labelHe, cat.labelEn, lang)}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: 12,
  },
  contentContainer: {
    gap: 8,
  },
  catBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  catBtnActive: {
    backgroundColor: COLORS.brand,
    borderColor: COLORS.brand,
  },
  catText: {
    ...TYPOGRAPHY.label,
    fontSize: 12,
  },
  catTextActive: {
    color: '#fff',
  },
});
