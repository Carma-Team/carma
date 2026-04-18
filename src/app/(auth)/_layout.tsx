import { Stack } from 'expo-router';

/**
 * מעטפת דפי ההתחברות וההרשמה.
 * קבוצת ה-(auth) ב-Expo Router.
 */
export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="register" options={{ headerShown: false }} />
    </Stack>
  );
}
