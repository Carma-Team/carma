import { Stack } from 'expo-router';
import { COLORS } from '@/constants/theme';

export default function AdminLayout() {
  return (
    <Stack screenOptions={{
      headerStyle: { backgroundColor: COLORS.dark },
      headerTintColor: '#fff',
      headerTitleStyle: { fontWeight: 'bold' },
    }}>
      <Stack.Screen name="index" options={{ title: 'ניהול מערכת' }} />
    </Stack>
  );
}
