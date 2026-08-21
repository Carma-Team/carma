import React, { useState } from 'react'
import {
  View, Text, TextInput, StyleSheet, ScrollView,
  TouchableOpacity, KeyboardAvoidingView, Platform
} from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { Button }   from '@/components/ui/Button'
import { useApp }   from '@/context/AppContext'
import { useTranslation } from '@/hooks/useTranslation'
import { authApi }  from '@/services/api/auth.api'
import { authErrorMessage } from '@/lib/authErrors'
import { COLORS, COMMON_STYLES, SPACING, TYPOGRAPHY } from '@/constants/theme'
import { ICONS } from '@/constants/icons'

interface FormState {
  name:        string
  email:       string
  password:    string
  phone:       string
  city:        string
  age:         string
  licenseYear: string
}

const INITIAL: FormState = { name: '', email: '', password: '', phone: '', city: '', age: '', licenseYear: '' }

// Every bound below is `RegisterIn` in server/app/schemas/auth.py. They are checked
// here so the driver is told which field is wrong: the server answers all of them
// with one 422 that names nothing they can act on.
const MIN_NAME = 2
const MIN_PASSWORD = 8
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_RE = /^[\d\s+()-]{6,20}$/

export default function RegisterScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { loginUser, addToast } = useApp()
  const { t } = useTranslation()
  const [form,    setForm]    = useState<FormState>(INITIAL)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  /** Updates a single registration form field without resetting others. */
  function update(field: keyof FormState, value: string) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  /**
   * Submits a new user registration request.
   * Runs local validation before sending.
   *
   * [server] authApi.register — always sends POST /api/auth/register to the real server.
   *
   * On success: calls loginUser (AppContext) which handles token storage and trip sync,
   * then shows a welcome toast. Navigation to tabs happens automatically via the root Layout.
   */
  async function handleRegister() {
    if (!canSubmit) return

    setLoading(true); setError('')
    try {
      const data = await authApi.register({
        name:        form.name.trim(),
        email:       form.email.trim().toLowerCase(),
        password:    form.password,
        phone:       form.phone   || undefined,
        city:        form.city    || undefined,
        age:         form.age         ? Number(form.age)         : undefined,
        licenseYear: form.licenseYear ? Number(form.licenseYear) : undefined,
      })

      await loginUser(data)
      const firstName = data.user?.name?.split(' ')[0] ?? t('auth.defaultUserName')
      addToast({ type: 'success', message: t('auth.welcomeToast').replace('{name}', firstName) })
      // No need for router.replace — the root Layout detects the logged-in user and redirects to tabs
    } catch (e) {
      // Only a 409 means the address is taken. Every other failure used to be shown
      // as one too, which is how a 422, a 429 and a dead network all read as "that
      // email is registered" (CAR-149).
      setError(authErrorMessage(e, t, { 409: 'auth.errors.emailExists' }))
    } finally {
      setLoading(false)
    }
  }

  /**
   * The message under each field, or '' when there is nothing to say.
   *
   * A field that is still empty says nothing — an error that appears before the
   * driver has typed anything reads as a rejection rather than as guidance. The
   * required ones are held by the disabled button instead.
   */
  const fieldErrors: Record<keyof FormState, string> = {
    name:        form.name && form.name.trim().length < MIN_NAME     ? t('auth.errors.nameTooShort')     : '',
    email:       form.email && !EMAIL_RE.test(form.email.trim())     ? t('auth.errors.invalidEmail')     : '',
    password:    form.password && form.password.length < MIN_PASSWORD ? t('auth.errors.passwordTooShort') : '',
    phone:       form.phone && !PHONE_RE.test(form.phone)            ? t('auth.errors.invalidPhone')     : '',
    age:         form.age && (Number(form.age) < 16 || Number(form.age) > 120)
      ? t('auth.errors.invalidAge') : '',
    licenseYear: form.licenseYear && (Number(form.licenseYear) < 1950 || Number(form.licenseYear) > 2100)
      ? t('auth.errors.invalidLicenseYear') : '',
    city:        '',
  }

  const requiredFilled =
    form.name.trim().length >= MIN_NAME &&
    EMAIL_RE.test(form.email.trim()) &&
    form.password.length >= MIN_PASSWORD

  const canSubmit = requiredFilled && Object.values(fieldErrors).every(m => !m)

  const fields: { key: keyof FormState; label: string; placeholder: string; keyboard?: any; secure?: boolean; required?: boolean }[] = [
    { key: 'name',        label: t('auth.name'),        placeholder: t('auth.namePlaceholder'),  required: true },
    { key: 'email',       label: t('auth.email'),       placeholder: t('auth.emailPlaceholder'), keyboard: 'email-address', required: true },
    { key: 'password',    label: t('auth.password'),    placeholder: t('auth.passwordPlaceholder'), secure: true, required: true },
    { key: 'phone',       label: t('auth.phone'),       placeholder: '050-0000000', keyboard: 'phone-pad' },
    { key: 'city',        label: t('auth.city'),        placeholder: t('auth.cityPlaceholder') },
    { key: 'age',         label: t('auth.age'),         placeholder: '25', keyboard: 'numeric' },
    { key: 'licenseYear', label: t('auth.licenseYear'), placeholder: '2020', keyboard: 'numeric' },
  ]

  return (
    <KeyboardAvoidingView
      style={[COMMON_STYLES.screen, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
        <View style={styles.logo}>
          <Ionicons name={ICONS.car} size={48} color={COLORS.brand} style={{ marginBottom: 6 }} />
          <Text style={styles.logoTitle}>CARMA</Text>
          <Text style={styles.logoTagline}>{t('app.tagline')}</Text>
        </View>

        <Text style={styles.heading}>{t('auth.register')}</Text>
        <Text style={styles.requiredHint}>{t('auth.requiredHint')}</Text>

        {error ? (
          <View style={COMMON_STYLES.errorBox}>
            <Text style={COMMON_STYLES.errorText}>{error}</Text>
          </View>
        ) : null}

        {fields.map(field => (
          <View key={field.key} style={styles.field}>
            <Text style={styles.label}>
              {field.label}
              {field.required && <Text style={styles.required}> *</Text>}
            </Text>
            <TextInput
              style={COMMON_STYLES.input}
              value={form[field.key]}
              onChangeText={v => update(field.key, v)}
              placeholder={field.placeholder}
              placeholderTextColor={COLORS.textMuted}
              secureTextEntry={field.secure}
              keyboardType={field.keyboard ?? 'default'}
              autoCapitalize={field.key === 'email' ? 'none' : 'sentences'}
              textContentType={field.key === 'password' ? 'newPassword' : field.key === 'email' ? 'emailAddress' : 'none'}
            />
            {fieldErrors[field.key] ? (
              <Text style={styles.fieldError}>{fieldErrors[field.key]}</Text>
            ) : null}
          </View>
        ))}

        <Button fullWidth size="lg" onPress={handleRegister} loading={loading} disabled={!canSubmit} style={styles.btn}>
          {t('auth.registerBtn')}
        </Button>

        <TouchableOpacity onPress={() => router.push('/login')} style={styles.link}>
          <Text style={styles.linkText}>
            {t('auth.hasAccount')} <Text style={styles.linkBold}>{t('auth.login')}</Text>
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  inner:    { flexGrow: 1, padding: SPACING.lg, paddingBottom: 40 },
  logo:     { alignItems: 'center', marginBottom: 32, marginTop: 16 },
  logoIcon: { fontSize: 48, marginBottom: 6 },
  logoTitle:{ color: COLORS.text, fontSize: 30, fontWeight: '900' },
  logoTagline:{ ...TYPOGRAPHY.caption, fontSize: 13, marginTop: 2 },
  heading:  { ...TYPOGRAPHY.h2, marginBottom: 20, textAlign: 'center' },
  field:    { marginBottom: 14 },
  label:    { ...TYPOGRAPHY.label, marginBottom: 6 },
  required: { color: COLORS.danger },
  requiredHint: { ...TYPOGRAPHY.caption, fontSize: 13, marginBottom: 16, textAlign: 'center' },
  fieldError: { ...TYPOGRAPHY.caption, fontSize: 13, color: COLORS.danger, marginTop: 4 },
  btn:      { marginTop: 8 },
  link:     { marginTop: 20, alignItems: 'center' },
  linkText: { ...TYPOGRAPHY.caption, fontSize: 14 },
  linkBold: { color: COLORS.brandLight, fontWeight: '700' },
})
