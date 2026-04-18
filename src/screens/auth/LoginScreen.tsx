import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, ScrollView, TouchableOpacity, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Button } from '@/components/ui/Button';
import { useApp } from '@/context/AppContext';
import { useTranslation } from '@/hooks/useTranslation';
import { authApi } from '@/lib/api';
import { COLORS, COMMON_STYLES, SPACING, TYPOGRAPHY } from '@/lib/constants';

export default function LoginScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { setUser, addToast } = useApp();
  const { t } = useTranslation();

  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  async function handleLogin() {
    if (!email || !password) { setError(t('auth.errors.emailRequired')); return; }
    setLoading(true); setError('');
    try {
      const data = await authApi.login(email, password);
      await AsyncStorage.setItem('carma_token', data.token);
      await setUser(data.user);
      router.replace('/dashboard');
    } catch (e: any) {
      setError(e.message || t('auth.errors.invalidCredentials'));
    } finally {
      setLoading(false);
    }
  }

  async function handleGuestLogin() {
    setLoading(true);
    try {
      await AsyncStorage.clear();
      const mockUser = {
        id: 'guest-123',
        name: 'Guest User',
        email: 'guest@carma.com',
        avatar: 'https://i.pravatar.cc/150?u=guest',
        level: 5,
        xp: 2400,
        carmaPoints: 500,
        rank: 'Safe Driver',
        totalPoints: 2400,
        totalDistance: 154.2,
        unreadNotifications: 2,
      };
      await AsyncStorage.setItem('carma_token', 'mock-guest-token');
      await setUser(mockUser as any);
      router.replace('/dashboard');
    } catch (e) {
      addToast({ title: t('common.error'), message: 'Failed to login as guest', type: 'error' });
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
          {t('auth.loginBtn')}
        </Button>

        <TouchableOpacity onPress={handleGuestLogin} style={styles.guestBtn}>
          <Text style={styles.guestBtnText}>{t('auth.guestLoginBtn')}</Text>
        </TouchableOpacity>

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
  logo:      { alignItems: 'center', marginBottom: 40 },
  logoIcon:  { fontSize: 64, marginBottom: 8 },
  logoTitle: { color: '#fff', fontSize: 36, fontWeight: '900' },
  logoTagline:{ ...TYPOGRAPHY.caption, fontSize: 14, marginTop: 4 },
  heading:   { ...TYPOGRAPHY.h2, marginBottom: SPACING.lg, textAlign: 'center' },
  errorBox:  { backgroundColor: 'rgba(239,68,68,0.1)', borderRadius: 12, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)' },
  errorText: { color: COLORS.danger, fontSize: 13, textAlign: 'center' },
  field:     { marginBottom: 16 },
  label:     { ...TYPOGRAPHY.label, marginBottom: 6 },
  input:     { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, color: '#fff', fontSize: 15 },
  btn:       { marginTop: 8 },
  guestBtn:  { marginTop: 16, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: COLORS.border, borderRadius: 12 },
  guestBtnText: { ...TYPOGRAPHY.label, fontSize: 14 },
  link:      { marginTop: 24, alignItems: 'center' },
  linkText:  { ...TYPOGRAPHY.caption, fontSize: 14 },
  linkBold:  { color: COLORS.brandLight, fontWeight: '700' },
});
