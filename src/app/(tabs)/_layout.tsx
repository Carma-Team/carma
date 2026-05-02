import React from 'react';
import { Tabs } from 'expo-router';
import { Text, View, StyleSheet } from 'react-native';
import { useTranslation } from '@/hooks/useTranslation';
import { COLORS } from '@/theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '@/context/AppContext';

const TAB_ITEMS = [
    { name: '(home)',      icon: '🏠', labelKey: 'nav.dashboard'   },
    { name: 'roadmap',     icon: '🗺️', labelKey: 'nav.roadmap'     },
    { name: 'marketplace', icon: '🎁', labelKey: 'nav.marketplace' },
    { name: 'leaderboard', icon: '🏆', labelKey: 'nav.leaderboard' },
    { name: 'profile',     icon: '👤', labelKey: 'nav.profile'     },
] as const;

export default function TabsLayout() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { registerPhoneTouch } = useApp();

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
          listeners={{
            tabPress: () => {
              // רישום נגיעה בטלפון בעת מעבר טאב בזמן נסיעה
              registerPhoneTouch();
            },
          }}
          options={{
            title: t(item.labelKey),
            tabBarIcon: ({ focused }) => (
              <View style={[
                styles.iconContainer,
                focused && styles.iconContainerActive
              ]}>
                <Text style={{ fontSize: focused ? 24 : 20 }}>{item.icon}</Text>
              </View>
            ),
          }}
        />
      ))}
    </Tabs>
  );
}

const styles = StyleSheet.create({
  iconContainer: {
    width: 44,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  iconContainerActive: {
    backgroundColor: 'rgba(52, 199, 89, 0.15)', // צבע הברנד עם שקיפות
    shadowColor: COLORS.brand,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 5,
  }
});

