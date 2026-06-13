import { Redirect } from 'expo-router';
import { useApp } from '@/context/AppContext';
import { View, ActivityIndicator } from 'react-native';
import { COLORS } from '@/constants/theme';

/**
 * Home index (/).
 * Automatically redirects to the dashboard.
 * The auth guard in root _layout.tsx redirects to Login if the user is not authenticated.
 */
export default function Index() {
  const { isLoading } = useApp();

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.dark }}>
        <ActivityIndicator size="large" color={COLORS.brand} />
      </View>
    );
  }

  // Redirect to the main dashboard within the home stack
  return <Redirect href="/(tabs)/(home)/dashboard" />;
}
