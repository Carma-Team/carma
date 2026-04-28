import { Stack } from 'expo-router';
import { COLORS } from '@/lib/constants';

export default function AdminLayout() {
  return (
    <Stack screenOptions={{
      headerStyle: { backgroundColor: COLORS.background },
      headerTintColor: '#fff',
      headerTitleStyle: { fontWeight: 'bold' },
    }}>
      <Stack.Screen name="index" options={{ title: 'ניהול מערכת' }} />
    </Stack>
  );
}
