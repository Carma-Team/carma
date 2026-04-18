import { Stack } from 'expo-router';
import { useDriveMode } from '@/hooks/useDriveMode';

/**
 * המעטפת הראשית של האפליקציה לאחר התחברות.
 */
export default function MainLayout() {
  // הפעלת מצב נסיעה אוטומטי מבוסס Bluetooth
  useDriveMode();

  return (
    <Stack screenOptions={{ headerShown: false }}>
      {/* (tabs) הוא הקבוצה שמכילה את הדאשבורד והטאבים */}
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      {/* trip-detail הוא מסך מודאלי */}
      <Stack.Screen name="trip-detail" options={{ presentation: 'modal' }} />
    </Stack>
  );
}
