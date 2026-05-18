import React from 'react';
import { View, TouchableOpacity, Text } from 'react-native';
import { COMMON_STYLES } from '@/constants/theme';
import { useTranslation } from '@/hooks/useTranslation';

type Tab = 'rewards' | 'vouchers';

interface MarketplaceTabsProps {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  vouchersCount: number;
}

export function MarketplaceTabs({ activeTab, onTabChange, vouchersCount }: MarketplaceTabsProps) {
  const { t } = useTranslation();

  const tabs: { key: Tab; label: string }[] = [
    { key: 'rewards', label: t('marketplace.allRewards') },
    { key: 'vouchers', label: `${t('marketplace.myVouchers')} (${vouchersCount})` },
  ];

  return (
    <View style={[COMMON_STYLES.tabsContainer, { marginBottom: 20 }]}>
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
