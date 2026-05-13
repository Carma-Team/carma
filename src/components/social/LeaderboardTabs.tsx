import React from 'react';
import { View, TouchableOpacity, Text, ViewStyle } from 'react-native';
import { COMMON_STYLES } from '@/constants/theme';
import type { LeaderboardType } from '@/navigation/types';

interface LeaderboardTabsProps {
  activeTab: LeaderboardType;
  onTabChange: (tab: LeaderboardType) => void;
  tabs: { key: LeaderboardType; label: string }[];
  style?: ViewStyle;
}

export function LeaderboardTabs({ activeTab, onTabChange, tabs, style }: LeaderboardTabsProps) {
  return (
    <View style={[COMMON_STYLES.tabsContainer, style]}>
      {tabs.map(tab => (
        <TouchableOpacity
          key={tab.key}
          onPress={() => onTabChange(tab.key)}
          style={[COMMON_STYLES.tab, activeTab === tab.key && COMMON_STYLES.tabActive]}
        >
          <Text style={[COMMON_STYLES.tabText, activeTab === tab.key && COMMON_STYLES.tabTextActive]}>
            {tab.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}
