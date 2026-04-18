import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider } from '@/context/AppContext';
import { StatusBar } from 'expo-status-bar';

/**
 * Root Layout - השער הראשי של האפליקציה.
 * כאן אנחנו מגדירים רק את ה-Providers ואת ה-Stack הראשי.
 */
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AppProvider>
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false }}>
          {/* הנתיבים כאן הם שמות התיקיות/קבצים בתוך src/app */}
          <Stack.Screen name="index" />
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(main)" />
        </Stack>
      </AppProvider>
    </SafeAreaProvider>
  );
}
