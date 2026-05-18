import { Stack } from 'expo-router';

/**
 * הסטאק הפנימי של טאב הבית.
 * מנהל את המעברים בין דאשבורד, נסיעה פעילה וסיכום נסיעה.
 */
export default function HomeLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      {/* מסך ברירת המחדל שמבצע את ההפניה */}
      <Stack.Screen name="index" />

      {/* מסך הבית המרכזי */}
      <Stack.Screen name="dashboard" />

      {/* מסך נסיעה פעילה */}
      <Stack.Screen name="trip" options={{ gestureEnabled: false }} />

      {/* מסך סיכום נסיעה (Trip Detail) */}
      <Stack.Screen name="trip-detail" options={{ presentation: 'modal' }} />

      {/* מסכי הגדרות חדשים */}
      <Stack.Screen name="settings" options={{ presentation: 'card' }} />
      <Stack.Screen name="bluetooth-settings" options={{ presentation: 'card' }} />
    </Stack>
  );
}
