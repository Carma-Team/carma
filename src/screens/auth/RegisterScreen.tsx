import React, { useState } from 'react'
import {
  View, Text, TextInput, StyleSheet, ScrollView,
  TouchableOpacity, KeyboardAvoidingView, Platform
} from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Button }   from '@/components/ui/Button'
import { useApp }   from '@/context/AppContext'
import { useTranslation } from '@/hooks/useTranslation'
import { authApi }  from '@/services/api/auth.api'
import { COLORS, COMMON_STYLES, SPACING, TYPOGRAPHY } from '@/constants/theme'

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

export default function RegisterScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { loginUser, addToast } = useApp()
  const { t } = useTranslation()
  const [form,    setForm]    = useState<FormState>(INITIAL)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  /** מעדכן שדה בודד בטופס הרישום מבלי לאפס את שאר השדות. */
  function update(field: keyof FormState, value: string) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  /**
   * שולחת בקשת רישום משתמש חדש.
   * מבצעת ולידציה מקומית לפני שליחה.
   *
   * [שרת] authApi.register — אין mock interceptor לרישום.
   * תמיד שולח POST /api/auth/register:
   *   - USE_REAL_SERVER=false → לשרת המקומי (carma-local-server, db.json)
   *   - USE_REAL_SERVER=true  → לשרת האמיתי של נווה
   *
   * לאחר הצלחה: קורא ל-loginUser (AppContext) שמטפל בשמירת token וסנכרון נסיעות,
   * ומציג toast ברוך הבא. הניתוב לטאבים מתבצע אוטומטית ע"י ה-Layout.
   */
  async function handleRegister() {
    if (!form.name)  { setError(t('auth.errors.nameRequired'));  return }
    if (!form.email) { setError(t('auth.errors.emailRequired')); return }
    if (form.password.length < 6) { setError(t('auth.errors.passwordTooShort')); return }

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
      const firstName = data.user?.name?.split(' ')[0] ?? 'משתמש'
      addToast({ type: 'success', message: `ברוך הבא, ${firstName}! 🎉` })
      // אין צורך ב-router.replace, ה-Layout הראשי יזהה את המשתמש ויעביר לטאבים
    } catch (e: any) {
      setError(e.message || t('auth.errors.emailExists'))
    } finally {
      setLoading(false)
    }
  }

  const fields: { key: keyof FormState; label: string; placeholder: string; keyboard?: any; secure?: boolean; required?: boolean }[] = [
    { key: 'name',        label: t('auth.name'),        placeholder: t('auth.namePlaceholder'),  required: true },
    { key: 'email',       label: t('auth.email'),       placeholder: t('auth.emailPlaceholder'), keyboard: 'email-address', required: true },
    { key: 'password',    label: t('auth.password'),    placeholder: t('auth.passwordPlaceholder'), secure: true, required: true },
    { key: 'phone',       label: t('auth.phone'),       placeholder: '050-0000000', keyboard: 'phone-pad' },
    { key: 'city',        label: t('auth.city'),        placeholder: 'תל אביב' },
    { key: 'age',         label: t('auth.age'),         placeholder: '25', keyboard: 'numeric' },
    { key: 'licenseYear', label: t('auth.licenseYear'), placeholder: '2020', keyboard: 'numeric' },
  ]

  return (
    <KeyboardAvoidingView style={[COMMON_STYLES.screen, { paddingTop: insets.top }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
        <View style={styles.logo}>
          <Text style={styles.logoIcon}>🚗</Text>
          <Text style={styles.logoTitle}>CARMA</Text>
          <Text style={styles.logoTagline}>{t('app.tagline')}</Text>
        </View>

        <Text style={styles.heading}>{t('auth.register')}</Text>

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {fields.map(field => (
          <View key={field.key} style={styles.field}>
            <Text style={styles.label}>
              {field.label}
              {field.required && <Text style={styles.required}> *</Text>}
            </Text>
            <TextInput
              style={styles.input}
              value={form[field.key]}
              onChangeText={v => update(field.key, v)}
              placeholder={field.placeholder}
              placeholderTextColor={COLORS.textMuted}
              secureTextEntry={field.secure}
              keyboardType={field.keyboard ?? 'default'}
              autoCapitalize={field.key === 'email' ? 'none' : 'sentences'}
              textContentType={field.key === 'password' ? 'newPassword' : field.key === 'email' ? 'emailAddress' : 'none'}
            />
          </View>
        ))}

        <Button fullWidth size="lg" onPress={handleRegister} loading={loading} style={styles.btn}>
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
  logoTitle:{ color: '#fff', fontSize: 30, fontWeight: '900' },
  logoTagline:{ ...TYPOGRAPHY.caption, fontSize: 13, marginTop: 2 },
  heading:  { ...TYPOGRAPHY.h2, marginBottom: 20, textAlign: 'center' },
  errorBox: { backgroundColor: 'rgba(239,68,68,0.1)', borderRadius: 12, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)' },
  errorText:{ color: COLORS.danger, fontSize: 13, textAlign: 'center' },
  field:    { marginBottom: 14 },
  label:    { ...TYPOGRAPHY.label, marginBottom: 6 },
  required: { color: COLORS.danger },
  input:    { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 13, color: '#fff', fontSize: 15 },
  btn:      { marginTop: 8 },
  link:     { marginTop: 20, alignItems: 'center' },
  linkText: { ...TYPOGRAPHY.caption, fontSize: 14 },
  linkBold: { color: COLORS.brandLight, fontWeight: '700' },
})
