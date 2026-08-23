import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, ScrollView, TouchableOpacity, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/ui/Button';
import { useApp } from '@/context/AppContext';
import { useTranslation } from '@/hooks/useTranslation';
import { authApi } from '@/services/api/auth.api';
import { authErrorMessage } from '@/lib/authErrors';
import { toE164 } from '@/lib/utils';
import { COLORS, COMMON_STYLES, SPACING, TYPOGRAPHY } from '@/constants/theme';
import { ICONS } from '@/constants/icons';

/** Shortest password the server will mint — `PasswordResetIn` in server/app/schemas/auth.py. */
const MIN_PASSWORD = 8;

/**
 * Reset a forgotten password: phone, then the code that arrives by SMS.
 *
 * One screen rather than two routes — the second step needs nothing from the
 * first except the number already held in state here.
 *
 * [server] authApi.requestPasswordReset / confirmPasswordReset.
 *
 * Neither call signs anyone in: the confirm route answers without a token by
 * design, so the driver lands back on login and types the new password there.
 */
export default function ForgotPasswordScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { addToast } = useApp();
  const { t } = useTranslation();

  const [step,     setStep]     = useState<'phone' | 'code'>('phone');
  const [phone,    setPhone]    = useState('');
  const [code,     setCode]     = useState('');
  const [password, setPassword] = useState('');
  const [notice,   setNotice]   = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  async function handleRequest() {
    const e164 = toE164(phone);
    if (!e164) { setError(t('auth.errors.invalidPhone')); return }

    setLoading(true);
    setError('');
    try {
      const { expiresInSeconds } = await authApi.requestPasswordReset(e164);
      // The answer is identical for a number nobody has registered, so this says
      // "if the number is registered" rather than claiming an SMS went out.
      setNotice(t('auth.forgot.codeSent').replace('{minutes}', String(Math.round(expiresInSeconds / 60))));
      setStep('code');
    } catch (e) {
      setError(authErrorMessage(e, t));
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm() {
    const e164 = toE164(phone);
    if (!e164) { setStep('phone'); setError(t('auth.errors.invalidPhone')); return }
    if (password.length < MIN_PASSWORD) { setError(t('auth.errors.passwordTooShort')); return }

    setLoading(true);
    setError('');
    try {
      await authApi.confirmPasswordReset(e164, code.trim(), password);
      addToast({ type: 'success', message: t('auth.forgot.successToast') });
      router.replace('/login');
    } catch (e) {
      // An unknown number, a stale code and a wrong digit are one 401 here — the
      // server refuses to say which, so the message covers all three.
      setError(authErrorMessage(e, t, { 401: 'auth.errors.badResetCode' }));
    } finally {
      setLoading(false);
    }
  }

  function backToPhone() {
    setStep('phone');
    setNotice('');
    setError('');
    setCode('');
    setPassword('');
  }

  return (
    <KeyboardAvoidingView
      style={[COMMON_STYLES.screen, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
        <View style={styles.logo}>
          <Ionicons name={ICONS.car} size={48} color={COLORS.brand} style={{ marginBottom: 8 }} />
          <Text style={styles.logoTitle}>CARMA</Text>
        </View>

        <Text style={styles.heading}>{t('auth.forgot.title')}</Text>

        {error ? <View style={COMMON_STYLES.errorBox}><Text style={COMMON_STYLES.errorText}>{error}</Text></View> : null}
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}

        {step === 'phone' ? (
          <>
            <Text style={styles.intro}>{t('auth.forgot.phoneStep')}</Text>

            <View style={styles.field}>
              <Text style={styles.label}>{t('auth.phone')}</Text>
              <TextInput
                style={COMMON_STYLES.input}
                value={phone}
                onChangeText={setPhone}
                placeholder="050-0000000"
                placeholderTextColor={COLORS.textMuted}
                keyboardType="phone-pad"
                autoCapitalize="none"
              />
            </View>

            <Button fullWidth size="lg" onPress={handleRequest} loading={loading} disabled={!phone} style={styles.btn}>
              {t('auth.forgot.sendCode')}
            </Button>
          </>
        ) : (
          <>
            <View style={styles.field}>
              <Text style={styles.label}>{t('auth.forgot.code')}</Text>
              <TextInput
                style={COMMON_STYLES.input}
                value={code}
                onChangeText={setCode}
                placeholder="123456"
                placeholderTextColor={COLORS.textMuted}
                keyboardType="number-pad"
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>{t('auth.forgot.newPassword')}</Text>
              <TextInput
                style={COMMON_STYLES.input}
                value={password}
                onChangeText={setPassword}
                placeholder={t('auth.passwordPlaceholder')}
                placeholderTextColor={COLORS.textMuted}
                secureTextEntry
                textContentType="newPassword"
              />
            </View>

            <Button
              fullWidth
              size="lg"
              onPress={handleConfirm}
              loading={loading}
              disabled={!code || password.length < MIN_PASSWORD}
              style={styles.btn}
            >
              {t('auth.forgot.submit')}
            </Button>

            {/* A code never arrives for a number that is not registered, and for one that
                has spent its five codes an hour. Both look identical from this screen. */}
            <TouchableOpacity onPress={backToPhone} style={styles.link}>
              <Text style={styles.linkBold}>{t('auth.forgot.resend')}</Text>
            </TouchableOpacity>
          </>
        )}

        <TouchableOpacity onPress={() => router.replace('/login')} style={styles.link}>
          <Text style={styles.linkText}>
            {t('auth.hasAccount')} <Text style={styles.linkBold}>{t('auth.login')}</Text>
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  inner:     { flexGrow: 1, justifyContent: 'center', padding: SPACING.lg },
  logo:      { alignItems: 'center', marginBottom: 24 },
  logoTitle: { color: COLORS.text, fontSize: 30, fontWeight: '900' },
  heading:   { ...TYPOGRAPHY.h2, marginBottom: SPACING.md, textAlign: 'center' },
  intro:     { ...TYPOGRAPHY.caption, fontSize: 14, marginBottom: SPACING.md, textAlign: 'center' },
  notice:    { ...TYPOGRAPHY.caption, fontSize: 14, color: COLORS.brandLight, marginBottom: SPACING.md, textAlign: 'center' },
  field:     { marginBottom: 16 },
  label:     { ...TYPOGRAPHY.label, marginBottom: 6 },
  btn:       { marginTop: 8 },
  link:      { marginTop: 20, alignItems: 'center' },
  linkText:  { ...TYPOGRAPHY.caption, fontSize: 14 },
  linkBold:  { color: COLORS.brandLight, fontWeight: '700' },
});
