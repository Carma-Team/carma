import React from 'react';
import { Tabs } from 'expo-router';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from '@/hooks/useTranslation';
import { COLORS } from '@/constants/theme';
import { ICONS, outlineIcon } from '@/constants/icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Reading order, not screen order: the app forces RTL in Hebrew, so the tab row is laid
// out right to left and the first entry here is the rightmost tab. Home stays under the
// thumb it has always been under, and the roadmap moves to the far end - it is the one
// tab a driver opens deliberately rather than in passing.
const TAB_ITEMS = [
    { name: '(home)',      icon: ICONS.home,        labelKey: 'nav.dashboard'   },
    { name: 'marketplace', icon: ICONS.marketplace, labelKey: 'nav.marketplace' },
    { name: 'leaderboard', icon: ICONS.leaderboard, labelKey: 'nav.leaderboard' },
    { name: 'roadmap',     icon: ICONS.roadmap,     labelKey: 'nav.roadmap'     },
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
            tabBarIcon: ({ focused }) => (
              <View style={[
                styles.iconContainer,
                focused && styles.iconContainerActive
              ]}>
                <Ionicons
                  name={focused ? item.icon : outlineIcon(item.icon)}
                  size={focused ? 24 : 20}
                  color={focused ? COLORS.brandLight : COLORS.textMuted}
                />
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
    backgroundColor: 'rgba(52, 199, 89, 0.15)', // brand color at low opacity
    shadowColor: COLORS.brand,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 5,
  }
});

