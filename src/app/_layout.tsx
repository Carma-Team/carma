import React, { useEffect } from 'react';
import { Stack, useRouter } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider, useApp } from '@/context/AppContext';
import { StatusBar } from 'expo-status-bar';
import { I18nManager, View, ActivityIndicator } from 'react-native';
import { COLORS } from '@/lib/constants';

// RTL Support
if (!I18nManager.isRTL) {
  try {
    I18nManager.allowRTL(true);
    I18nManager.forceRTL(true);
    // ב-Expo Go לפעמים צריך טעינה מחדש ידנית, אבל הקוד הזה מבטיח שהפעם הבאה תהיה RTL
  } catch (e) {
    console.warn('RTL initialization failed', e);
  }
}

/**
 * המבנה המקצועי לפי דוגמת Expo: ה-Layout מחליט איזה סטאק להציג.
 */
function RootLayoutNav() {
  const { user, isLoading } = useApp();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading) {
      if (!user) {
        router.replace('/login');
      } else {
        router.replace('/(tabs)');
      }
    }
  }, [user, isLoading]);

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
        // משתמש מחובר: מציגים את הטאבים (כאשר דף הבית הוא index בתוך הטאבים)
        <Stack.Screen name="(tabs)" />
      ) : (
        // משתמש לא מחובר: מציגים את דף הכניסה
        <Stack.Screen name="login" />
      )}

      {/* מסכים נוספים שזמינים תמיד או מודאלים */}
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
