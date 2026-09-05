import { authErrorMessage } from '@/lib/authErrors'
import { ApiError } from '@/services/api/client'
import en from '@/i18n/en'
import he from '@/i18n/he'

// authErrors reaches the real ApiError class through client.ts, which pulls in
// AsyncStorage and serverConfig at import. Mocking the class out is not an option —
// authErrorMessage branches on `instanceof ApiError`.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
)

jest.mock('@/constants/serverConfig', () => ({
  USE_REAL_SERVER: false,
  LOCAL_SERVER_URL: 'http://localhost:3000',
}))

// The real lookup, not an identity stub: `t` returns the key itself when the key is
// missing, so a stub would pass on a translation that was never written.
function translator(map: unknown) {
  return (key: string): string => {
    const value = key.split('.').reduce<unknown>(
      (node, part) =>
        node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined,
      map
    )
    return typeof value === 'string' ? value : key
  }
}

// LoginScreen words 401 itself and leaves every other status to the fallback map.
const LOGIN_KEYS = { 401: 'auth.errors.invalidCredentials' }

describe('authErrorMessage', () => {
  // A server that stalls must not read like a wrong password. Without a key of its
  // own the 408 falls through to `common.error`, which is what a rejected login says.
  test.each([
    ['en', en],
    ['he', he],
  ])('a login that times out surfaces the timeout message (%s)', (_lang, map) => {
    const t = translator(map)

    const message = authErrorMessage(new ApiError(408, 'Request timed out after 30s'), t, LOGIN_KEYS)

    expect(message).toBe(t('auth.errors.timeout'))
    expect(message).not.toBe(t('common.error'))
    expect(message).not.toBe('auth.errors.timeout')
  })
})
