import React, { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useApp } from '@/context/AppContext';
import { COLORS } from '@/lib/constants';

/**
 * Entry Point - דף הנחיתה של האפליקציה.
 * אחראי על ניתוב ראשוני (Login vs Dashboard).
 */
export default function Index() {
  const { user, isLoading } = useApp();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading) {
      console.log('[Index] Auth State:', user ? 'Logged In' : 'Guest/Logged Out');

      const timer = setTimeout(() => {
        if (user) {
          console.log('[Index] Redirecting to Dashboard');
          router.replace('/dashboard');
        } else {
          console.log('[Index] Redirecting to Login');
          router.replace('/login');
        }
      }, 100); // הגדלתי מעט את ה-delay ליציבות ב-WSL
      return () => clearTimeout(timer);
    }
  }, [user, isLoading, router]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={COLORS.brand} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.dark,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
