import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, ScrollView, TouchableOpacity, KeyboardAvoidingView } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/ui/Button';
import { useApp } from '@/context/AppContext';
import { useTranslation } from '@/hooks/useTranslation';
import { authApi } from '@/services/api/auth.api';
import { isBusiness } from '@/lib/utils';
import { COLORS, COMMON_STYLES, SPACING, TYPOGRAPHY } from '@/constants/theme';
import { ICONS } from '@/constants/icons';

export default function LoginScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { loginUser } = useApp();
  const { t } = useTranslation();

  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  /**
   * Submits login credentials and navigates to the correct screen based on the user's role.
   *
   * [server] authApi.login — when USE_REAL_SERVER=false:
   *   - admin / daniel / arcaffe / superpharm → intercepted in auth.api.ts (no HTTP)
   *   - any other user → POST /api/auth/login to the local server (carma-local-server)
   * When USE_REAL_SERVER=true → POST /api/auth/login to the real server
   *
   * On success: saves token to AsyncStorage and navigates to the appropriate route:
   *   - admin/driver → /(tabs)
   *   - business     → /(business)
   */
  async function handleLogin() {
    if (!email || !password) {
        setError(t('auth.errors.emailRequired'));
        return;
    }
    setLoading(true);
    setError('');

    try {
      const data = await authApi.login(email, password);
      await loginUser(data);

      if (isBusiness(data.user)) router.replace('/(business)');
      else router.replace('/(tabs)');
    } catch (e: any) {
      setError(e.message || t('auth.errors.invalidCredentials'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={[COMMON_STYLES.screen, { paddingTop: insets.top }]} behavior="padding">
      <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
        <View style={styles.logo}>
          <Ionicons name={ICONS.car} size={64} color={COLORS.brand} style={{ marginBottom: 8 }} />
          <Text style={styles.logoTitle}>CARMA</Text>
          <Text style={styles.logoTagline}>{t('app.tagline')}</Text>
        </View>

        <Text style={styles.heading}>{t('auth.login')}</Text>

        {error ? <View style={COMMON_STYLES.errorBox}><Text style={COMMON_STYLES.errorText}>{error}</Text></View> : null}

        <View style={styles.field}>
          <Text style={styles.label}>{t('auth.email')}</Text>
          <TextInput
            style={COMMON_STYLES.input}
            value={email}
            onChangeText={setEmail}
            placeholder={t('auth.emailPlaceholder')}
            placeholderTextColor={COLORS.textMuted}
            autoCapitalize="none"
            keyboardType="email-address"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>{t('auth.password')}</Text>
          <TextInput
            style={COMMON_STYLES.input}
            value={password}
            onChangeText={setPassword}
            placeholder={t('auth.passwordPlaceholder')}
            placeholderTextColor={COLORS.textMuted}
            secureTextEntry
          />
        </View>

        <Button fullWidth size="lg" onPress={handleLogin} loading={loading} style={styles.btn}>
          {t('auth.loginBtn')}
        </Button>

        <TouchableOpacity onPress={() => router.push('/register')} style={styles.link}>
          <Text style={styles.linkText}>
            {t('auth.noAccount')} <Text style={styles.linkBold}>{t('auth.register')}</Text>
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  inner:     { flexGrow: 1, justifyContent: 'center', padding: SPACING.lg },
  logo:      { alignItems: 'center', marginBottom: 30 },
  logoIcon:  { fontSize: 64, marginBottom: 8 },
  logoTitle: { color: COLORS.text, fontSize: 36, fontWeight: '900' },
  logoTagline:{ ...TYPOGRAPHY.caption, fontSize: 14, marginTop: 4 },
  heading:   { ...TYPOGRAPHY.h2, marginBottom: SPACING.md, textAlign: 'center' },
  field:     { marginBottom: 16 },
  label:     { ...TYPOGRAPHY.label, marginBottom: 6 },
  btn:       { marginTop: 8 },
  link:      { marginTop: 24, alignItems: 'center' },
  linkText:  { ...TYPOGRAPHY.caption, fontSize: 14 },
  linkBold:  { color: COLORS.brandLight, fontWeight: '700' },
});
