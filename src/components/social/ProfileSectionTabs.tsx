import React from 'react';
import { ScrollView, TouchableOpacity, Text, StyleSheet, View } from 'react-native';
import { COLORS, SPACING, TYPOGRAPHY } from '@/constants/theme';

export type Section = 'stats' | 'chart' | 'trips' | 'notifications';

interface TabItem {
  key: Section;
  label: string;
  emoji: string;
}

interface ProfileSectionTabsProps {
  activeSection: Section;
  onSectionChange: (section: Section) => void;
  tabs: TabItem[];
}

export function ProfileSectionTabs({ activeSection, onSectionChange, tabs }: ProfileSectionTabsProps) {
  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {tabs.map(tab => (
          <TouchableOpacity
            key={tab.key}
            onPress={() => onSectionChange(tab.key)}
            style={[
              styles.sectionTab,
              activeSection === tab.key && styles.sectionTabActive
            ]}
          >
            <Text style={[styles.sectionTabText, activeSection === tab.key && styles.sectionTabTextActive]}>
              {tab.emoji} {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: SPACING.md,
  },
  scrollContent: {
    paddingHorizontal: SPACING.md,
  },
  sectionTab: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 4,
  },
  sectionTabActive: {
    backgroundColor: COLORS.brand,
    borderColor: COLORS.brand,
  },
  sectionTabText: {
    ...TYPOGRAPHY.label,
    fontSize: 13,
  },
  sectionTabTextActive: {
    color: '#fff',
  },
});
