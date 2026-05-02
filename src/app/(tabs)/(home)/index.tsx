import { Redirect } from 'expo-router';
import { useApp } from '@/context/AppContext';
import { View, ActivityIndicator } from 'react-native';
import { COLORS } from '@/theme';

/**
 * דף הבית הראשי (/).
 * הוא מפנה אוטומטית לדאשבורד.
 * בזכות ה-Guard ב-Root _layout.tsx, המשתמש יופנה ל-Login אם אינו מחובר.
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

  // הפניה לדאשבורד הפנימי בתוך הסטאק של הבית
  return <Redirect href="/(tabs)/(home)/dashboard" />;
}
