import { Stack } from 'expo-router';

/**
 * Inner stack for the Home tab.
 * Manages navigation between dashboard, active trip, and trip detail.
 */
export default function HomeLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      {/* Default index screen that performs the redirect */}
      <Stack.Screen name="index" />

      {/* Main dashboard screen */}
      <Stack.Screen name="dashboard" />

      {/* Active trip screen */}
      <Stack.Screen name="trip" options={{ gestureEnabled: false }} />

      {/* Trip detail / summary screen */}
      <Stack.Screen name="trip-detail" options={{ presentation: 'modal' }} />

      {/* Settings screens */}
      <Stack.Screen name="settings" options={{ presentation: 'card' }} />
      <Stack.Screen name="bluetooth-settings" options={{ presentation: 'card' }} />
    </Stack>
  );
}
