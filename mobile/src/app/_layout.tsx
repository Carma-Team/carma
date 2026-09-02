import React, { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider, useApp } from '@/context/AppContext';
import { StatusBar } from 'expo-status-bar';
import { I18nManager, View, ActivityIndicator } from 'react-native';
import { COLORS } from '@/constants/theme';
import { useDriveMode } from '@/hooks/useDriveMode';
import { ToastContainer } from '@/components/ui/Toast';
import UnsupportedDeviceScreen from '@/screens/auth/UnsupportedDeviceScreen';

// Allow RTL so the OS respects direction style — actual direction is set per render
I18nManager.allowRTL(true);

// Dev-only manual test accounts (mock-business@carma.dev / mock-driver@carma.dev,
// password "mock") — see src/testing/mocks. Never runs outside __DEV__, so it
// has no effect on a real build and real logins are never touched.
if (__DEV__) require('@/testing/mocks').registerMockNetwork();

function RootLayoutNav() {
  const { user, isLoading, deviceBlocked, lang } = useApp();
  const router = useRouter();
  useDriveMode();
  const segments = useSegments();
  const direction = lang === 'HE' ? 'rtl' : 'ltr';

  useEffect(() => {
    if (isLoading) return;

    const rootSegment = segments[0];
    // Every route a signed-out driver is allowed to be on. Leaving one out sends
    // them back to /login the moment the screen opens.
    const inAuthGroup =
      rootSegment === 'login' || rootSegment === 'register' || rootSegment === 'forgot-password';
    const inTabsGroup = rootSegment === '(tabs)';

    if (!user) {
      if (!inAuthGroup) {
        router.replace('/login');
      }
    } else {
      // Every role uses the same tabs layout — a business owner drives too, and
      // manages their business on the web (CAR-205).
      // No auth-group exception here: register signs the driver in and leaves the
      // redirect to this effect, so skipping it strands them on the form (CAR-237).
      // If phone verification is ever added to registration (CAR-231), the OTP step
      // belongs between the two — signed in, but not yet let into the tabs — and this
      // condition has to grow a "verified" check rather than being reverted.
      if (!inTabsGroup) {
        router.replace('/(tabs)');
      }
    }
  }, [user, isLoading, segments, router]);

  if (deviceBlocked) {
    return <UnsupportedDeviceScreen />;
  }

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.dark }}>
        <ActivityIndicator size="large" color={COLORS.brand} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, direction }}>
      <Stack screenOptions={{ headerShown: false }}>
        {user ? <Stack.Screen name="(tabs)" /> : <Stack.Screen name="login" />}
        <Stack.Screen name="register" />
        <Stack.Screen name="forgot-password" />
      </Stack>
    </View>
  );
}

// Sibling of the navigator, not a child of it: RootLayoutNav returns early while
// isLoading is true, and the "server unreachable" toast is raised during that window.
function Toasts() {
  const { toasts, removeToast } = useApp();
  return <ToastContainer toasts={toasts} onDismiss={removeToast} />;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AppProvider>
        <StatusBar style="light" />
        <RootLayoutNav />
        <Toasts />
      </AppProvider>
    </SafeAreaProvider>
  );
}
