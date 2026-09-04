import React, { useEffect, useState } from 'react'
import {
  View, Text, TextInput, StyleSheet, ScrollView,
  TouchableOpacity, KeyboardAvoidingView, Platform
} from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { Button }   from '@/components/ui/Button'
import { LocationPicker } from '@/components/ui/LocationPicker'
import { useApp }   from '@/context/AppContext'
import { useTranslation } from '@/hooks/useTranslation'
import { authApi }  from '@/services/api/auth.api'
import { leaderboardApi } from '@/services/api/leaderboard.api'
import { cityLabel } from '@/lib/cityLabel'
import type { City } from '@/types'
import { authErrorMessage } from '@/lib/authErrors'
import { COLORS, COMMON_STYLES, SPACING, TYPOGRAPHY } from '@/constants/theme'
import { ICONS } from '@/constants/icons'

interface FormState {
  name:        string
  email:       string
  password:    string
  phone:       string
  city:        string
  cityCode:    string
  age:         string
  licenseYear: string
}

const INITIAL: FormState = { name: '', email: '', password: '', phone: '', city: '', cityCode: '', age: '', licenseYear: '' }

// Every bound below is `RegisterIn` in server/app/schemas/auth.py. They are checked
// here so the driver is told which field is wrong: the server answers all of them
// with one 422 that names nothing they can act on.
const MIN_NAME = 2
const MAX_NAME = 80
const MIN_PASSWORD = 8
const MAX_PASSWORD = 200
const MAX_CITY = 80
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_RE = /^[\d\s+()-]{6,20}$/
// Digits only, checked before the numeric bounds below: `Number('abc')` is NaN, and
// every comparison against NaN is false, so a non-numeric entry passes both bounds
// and reaches the server as null. The numeric keyboard is a hint, not a constraint —
// it still offers '.' and '-', and a hardware keyboard ignores it entirely.
const INT_RE = /^\d+$/

// CARMA is for private-car (class B) drivers in Israel only. The practical test
// opens at 16 years and 9 months, so nobody holds a licence issued before the
// year they turned 16 -- which is also why MIN_AGE is 16 and not 17.
const MIN_AGE = 16
const MAX_AGE = 120
const MIN_LICENSE_AGE = 16
// The oldest licence the app will accept at all, for a driver who did not fill in
// an age. Matches RegisterIn; a real class-B licence from before it is not in use.
const MIN_LICENSE_YEAR = 1950
// Read once per render rather than per field. A session left open across midnight
// on the 31st of December keeps the old year until the screen re-renders, which
// costs nothing: the driver is told a year is too late, one day too early.
const CURRENT_YEAR = new Date().getFullYear()

export default function RegisterScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { loginUser, addToast } = useApp()
  const { t, lang }               = useTranslation()
  const [form,      setForm]      = useState<FormState>(INITIAL)
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState('')
  // The rows, not labels: the label depends on `lang`, which can change later.
  const [cities,    setCities]    = useState<City[]>([])
  const [regionAck, setRegionAck] = useState(false)

  useEffect(() => {
    // The public list, not the leaderboard's. That one needs a bearer token
    // registration does not have yet, so it 401'd on every fresh install, and
    // even when it answered it only held cities that already have a driver -
    // the circularity CAR-218 exists to break.
    leaderboardApi.getCities()
      .then(data => setCities(data.cities))
      // A network failure still leaves the free-text field below as a fallback.
      .catch(() => setCities([]))
  }, [])

  /** Updates a single registration form field without resetting others. */
  function update(field: keyof FormState, value: string) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  // Derived here rather than stored: the labels depend on `lang`, and building
  // them once when the list arrives left them in whatever language was active
  // at mount.
  const cityOptions = cities.map(c => ({ value: c.code, label: cityLabel(c, lang) }))

  /**
   * The picker deals in codes. `city` is still kept alongside, because the free-text
   * branch below has no code to send and the server resolves that label instead.
   */
  function pickCity(code: string) {
    const label = cityLabel(cities.find(c => c.code === code), lang)
    setForm(prev => ({ ...prev, city: label, cityCode: code }))
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
        // City is optional — '' means the placeholder is still showing, i.e. no
        // pick was made, not "picked nothing." Send undefined so the server sees
        // an unanswered field, not an empty string.
        //
        // A code when one was picked from the list. `city` stays as the fallback
        // for the free-text branch below, where there is no code to send; the
        // server resolves that label against the same list.
        cityCode:    form.cityCode || undefined,
        city:        form.cityCode ? undefined : form.city || undefined,
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
  const age         = INT_RE.test(form.age)         ? Number(form.age)         : NaN
  const licenseYear = INT_RE.test(form.licenseYear) ? Number(form.licenseYear) : NaN

  // The earliest licence year this particular driver could hold. Age is given in
  // whole years, so the birth year is CURRENT_YEAR - age give or take one; taking
  // the earlier side keeps a real driver from being turned away over that year.
  const earliestLicenseYear = Number.isNaN(age)
    ? MIN_LICENSE_YEAR
    : Math.max(MIN_LICENSE_YEAR, CURRENT_YEAR - age + MIN_LICENSE_AGE)

  const fieldErrors: Record<keyof FormState, string> = {
    name:        form.name && (form.name.trim().length < MIN_NAME || form.name.trim().length > MAX_NAME)
      ? t('auth.errors.invalidName') : '',
    email:       form.email && !EMAIL_RE.test(form.email.trim())     ? t('auth.errors.invalidEmail')     : '',
    password:    form.password && (form.password.length < MIN_PASSWORD || form.password.length > MAX_PASSWORD)
      ? t('auth.errors.invalidPassword') : '',
    phone:       form.phone && !PHONE_RE.test(form.phone)            ? t('auth.errors.invalidPhone')     : '',
    city:        form.city && form.city.trim().length > MAX_CITY     ? t('auth.errors.cityTooLong')      : '',
    // Never typed, only set by picking from the list, so it has nothing to reject.
    cityCode:    '',
    age:         form.age && (Number.isNaN(age) || age < MIN_AGE || age > MAX_AGE)
      ? t('auth.errors.invalidAge') : '',
    licenseYear: form.licenseYear && (Number.isNaN(licenseYear) || licenseYear < MIN_LICENSE_YEAR || licenseYear > CURRENT_YEAR)
      ? t('auth.errors.invalidLicenseYear')
      // Only reachable once the year itself is valid, so the driver is never told
      // about their age while the year is still the thing that is wrong.
      : form.licenseYear && licenseYear < earliestLicenseYear
        ? t('auth.errors.licenseYearBeforeAge') : '',
  }

  const requiredFilled =
    form.name.trim().length >= MIN_NAME &&
    EMAIL_RE.test(form.email.trim()) &&
    form.password.length >= MIN_PASSWORD

  // CAR-23: the region acknowledgement is a submit condition like any required field —
  // the checkbox says why it is unchecked, so it needs no error string of its own.
  const canSubmit = requiredFilled && regionAck && Object.values(fieldErrors).every(m => !m)

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
            {/* The list is public now, so this normally renders. The free-text
                branch stays for the case where fetching it failed outright. */}
            {field.key === 'city' && cityOptions.length > 0 ? (
              <LocationPicker
                value={form.cityCode}
                options={cityOptions}
                placeholder={t('auth.citySelectPlaceholder')}
                onChange={pickCity}
                style={styles.cityTrigger}
              />
            ) : (
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
            )}
            {fieldErrors[field.key] ? (
              <Text style={styles.fieldError}>{fieldErrors[field.key]}</Text>
            ) : null}
          </View>
        ))}

        <TouchableOpacity
          style={styles.ackRow}
          onPress={() => setRegionAck(prev => !prev)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: regionAck }}
        >
          <Ionicons
            name={regionAck ? 'checkbox' : 'square-outline'}
            size={22}
            color={regionAck ? COLORS.brand : COLORS.textMuted}
          />
          <Text style={styles.ackText}>{t('auth.regionAck')}</Text>
        </TouchableOpacity>

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
  cityTrigger: { paddingVertical: 14, paddingHorizontal: 16, borderRadius: 12 },
  label:    { ...TYPOGRAPHY.label, marginBottom: 6 },
  required: { color: COLORS.danger },
  ackRow:   { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginTop: 4, marginBottom: 4 },
  ackText:  { ...TYPOGRAPHY.caption, flex: 1 },
  requiredHint: { ...TYPOGRAPHY.caption, fontSize: 13, marginBottom: 16, textAlign: 'center' },
  fieldError: { ...TYPOGRAPHY.caption, fontSize: 13, color: COLORS.danger, marginTop: 4 },
  btn:      { marginTop: 8 },
  link:     { marginTop: 20, alignItems: 'center' },
  linkText: { ...TYPOGRAPHY.caption, fontSize: 14 },
  linkBold: { color: COLORS.brandLight, fontWeight: '700' },
})
