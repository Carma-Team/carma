import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, ScrollView, TouchableOpacity, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Button } from '@/components/ui/Button';
import { useApp } from '@/context/AppContext';
import { useTranslation } from '@/hooks/useTranslation';
import { authApi } from '@/services/api/auth.api';
import { COLORS, COMMON_STYLES, SPACING, TYPOGRAPHY } from '@/constants/theme';

export default function LoginScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { setUser } = useApp();
  const { t } = useTranslation();

  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [selectedRole, setSelectedRole] = useState<'driver' | 'business' | 'admin'>('driver');

  async function handleLogin() {
    if (!email || !password) {
        setError(t('auth.errors.emailRequired'));
        return;
    }
    setLoading(true);
    setError('');

    try {
      const data = await authApi.login(email, password);

      await AsyncStorage.setItem('carma_token', data.token);

      const role = data.user.role ?? selectedRole;

      if (role === 'admin') {
        await setUser({ ...data.user, role: 'admin' as const });
        router.replace('/(admin)');
      } else if (role === 'business') {
        await setUser({ ...data.user, role: 'business' as const });
        router.replace('/(business)');
      } else {
        await setUser({
          ...data.user,
          role: 'driver' as const,
          points: data.user.points ?? 0,
          level: data.user.level ?? 1,
          totalPoints: data.user.totalPoints ?? 0,
          totalDistance: data.user.totalDistance ?? 0,
        });
        router.replace('/(tabs)');
      }
    } catch (e: any) {
      setError(e.message || t('auth.errors.invalidCredentials'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={[COMMON_STYLES.screen, { paddingTop: insets.top }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
        <View style={styles.logo}>
          <Text style={styles.logoIcon}>🚗</Text>
          <Text style={styles.logoTitle}>CARMA</Text>
          <Text style={styles.logoTagline}>{t('app.tagline')}</Text>
        </View>

        <Text style={styles.heading}>{t('auth.login')}</Text>

        <View style={styles.roleContainer}>
          {(['driver', 'business', 'admin'] as const).map((role) => (
            <TouchableOpacity
              key={role}
              style={[styles.roleTab, selectedRole === role && styles.roleTabActive]}
              onPress={() => setSelectedRole(role)}
            >
              <Text style={[styles.roleTabText, selectedRole === role && styles.roleTabTextActive]}>
                {role === 'driver' ? 'נהג' : role === 'business' ? 'עסק' : 'מנהל'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {error ? <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View> : null}

        <View style={styles.field}>
          <Text style={styles.label}>{t('auth.email')}</Text>
          <TextInput
            style={styles.input}
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
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            placeholder={t('auth.passwordPlaceholder')}
            placeholderTextColor={COLORS.textMuted}
            secureTextEntry
          />
        </View>

        <Button fullWidth size="lg" onPress={handleLogin} loading={loading} style={styles.btn}>
          {selectedRole === 'business' ? 'כניסת בעל עסק' : t('auth.loginBtn')}
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
  logoTitle: { color: '#fff', fontSize: 36, fontWeight: '900' },
  logoTagline:{ ...TYPOGRAPHY.caption, fontSize: 14, marginTop: 4 },
  heading:   { ...TYPOGRAPHY.h2, marginBottom: SPACING.md, textAlign: 'center' },
  roleContainer: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 12, padding: 4, marginBottom: 24 },
  roleTab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 8 },
  roleTabActive: { backgroundColor: COLORS.brand },
  roleTabText: { ...TYPOGRAPHY.label, color: COLORS.textMuted },
  roleTabTextActive: { color: '#fff' },
  errorBox:  { backgroundColor: 'rgba(239,68,68,0.1)', borderRadius: 12, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)' },
  errorText: { color: COLORS.danger, fontSize: 13, textAlign: 'center' },
  field:     { marginBottom: 16 },
  label:     { ...TYPOGRAPHY.label, marginBottom: 6 },
  input:     { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, color: '#fff', fontSize: 15 },
  btn:       { marginTop: 8 },
  link:      { marginTop: 24, alignItems: 'center' },
  linkText:  { ...TYPOGRAPHY.caption, fontSize: 14 },
  linkBold:  { color: COLORS.brandLight, fontWeight: '700' },
});
