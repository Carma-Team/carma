import React, { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider, useApp } from '@/context/AppContext';
import { StatusBar } from 'expo-status-bar';
import { I18nManager, View, ActivityIndicator } from 'react-native';
import { COLORS } from '@/constants/theme';

// RTL Support
if (!I18nManager.isRTL) {
  try {
    I18nManager.allowRTL(true);
    I18nManager.forceRTL(true);
  } catch (e) {
    console.warn('RTL initialization failed', e);
  }
}

function RootLayoutNav() {
  const { user, isLoading } = useApp();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    if (isLoading) return;

    const rootSegment = segments[0];
    const inAuthGroup = rootSegment === 'login' || rootSegment === 'register';
    const inTabsGroup = rootSegment === '(tabs)';
    const inBusinessGroup = rootSegment === '(business)';

    if (!user) {
      if (!inAuthGroup) {
        router.replace('/login');
      }
    } else {
      if (user.role === 'business') {
        if (!inBusinessGroup) {
          router.replace('/(business)');
        }
      } else {
        // driver ו-admin מנותבים לאותם tabs
        if (!inTabsGroup && !inAuthGroup) {
          router.replace('/(tabs)');
        }
      }
    }
  }, [user, isLoading, segments]);

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.dark }}>
        <ActivityIndicator size="large" color={COLORS.brand} />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      {user ? (
        user.role === 'business' ? (
          <Stack.Screen name="(business)" />
        ) : (
          <Stack.Screen name="(tabs)" />
        )
      ) : (
        <Stack.Screen name="login" />
      )}
      <Stack.Screen name="register" />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AppProvider>
        <StatusBar style="light" />
        <RootLayoutNav />
      </AppProvider>
    </SafeAreaProvider>
  );
}
