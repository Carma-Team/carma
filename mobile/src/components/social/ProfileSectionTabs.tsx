import React from 'react';
import { ScrollView, TouchableOpacity, Text, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { COLORS, SPACING, TYPOGRAPHY } from '@/constants/theme';
import type { IoniconName } from '@/constants/icons';

export type Section = 'stats' | 'chart' | 'trips' | 'notifications' | 'friendRequests';

interface TabItem {
  key: Section;
  label: string;
  icon: IoniconName;
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
        {tabs.map(tab => {
          const active = activeSection === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              onPress={() => onSectionChange(tab.key)}
              style={[styles.sectionTab, active && styles.sectionTabActive]}
            >
              <Ionicons
                name={tab.icon}
                size={14}
                color={active ? '#fff' : COLORS.textMuted}
                style={{ marginRight: 5 }}
              />
              <Text style={[styles.sectionTabText, active && styles.sectionTabTextActive]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
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
    flexDirection: 'row',
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
