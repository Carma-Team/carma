import React from 'react';
import { ScrollView, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { COLORS, TYPOGRAPHY } from '@/constants/theme';

interface Category {
  key: string;
  labelHe: string;
  labelEn: string;
  emoji: string;
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
      {categories.map((cat) => (
        <TouchableOpacity
          key={cat.key}
          onPress={() => onSelectCategory(cat.key)}
          style={[styles.catBtn, selectedCategory === cat.key && styles.catBtnActive]}
        >
          <Text style={[styles.catText, selectedCategory === cat.key && styles.catTextActive]}>
            {cat.emoji} {lang === 'he' ? cat.labelHe : cat.labelEn}
          </Text>
        </TouchableOpacity>
      ))}
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
