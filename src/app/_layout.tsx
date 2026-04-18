import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider } from '@/context/AppContext';
import { StatusBar } from 'expo-status-bar';
import { I18nManager } from 'react-native';

// הפעלת תמיכה ב-RTL
try {
  I18nManager.allowRTL(true);
  I18nManager.forceRTL(true);
} catch (e) {
  console.warn('RTL initialization failed', e);
}

/**
 * Root Layout - השער הראשי של האפליקציה.
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
