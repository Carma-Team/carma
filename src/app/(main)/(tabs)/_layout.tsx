import React from 'react';
import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { useTranslation } from '@/hooks/useTranslation';
import { COLORS } from '@/lib/constants';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const TAB_ITEMS = [
  { name: 'dashboard',   icon: '🏠', labelKey: 'nav.dashboard'   },
  { name: 'trip',        icon: '🚗', labelKey: 'nav.trip'        },
  { name: 'roadmap',     icon: '🗺️', labelKey: 'nav.roadmap'     },
  { name: 'marketplace', icon: '🎁', labelKey: 'nav.marketplace' },
  { name: 'leaderboard', icon: '🏆', labelKey: 'nav.leaderboard' },
  { name: 'profile',     icon: '👤', labelKey: 'nav.profile'     },
] as const;

export default function TabsLayout() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: COLORS.dark,
          borderTopColor: COLORS.border,
          paddingBottom: insets.bottom > 0 ? insets.bottom + 10 : 16,
          paddingTop: 12,
          height: 80 + (insets.bottom > 0 ? insets.bottom : 0),
        },
        tabBarActiveTintColor: COLORS.brandLight,
        tabBarInactiveTintColor: COLORS.textMuted,
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '500',
        },
      }}
    >
      {TAB_ITEMS.map((item) => (
        <Tabs.Screen
          key={item.name}
          name={item.name}
          options={{
            title: t(item.labelKey),
            tabBarIcon: () => <Text style={{ fontSize: 20 }}>{item.icon}</Text>,
          }}
        />
      ))}
    </Tabs>
  );
}
