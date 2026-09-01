/**
 * @file authErrors.ts
 * @owner May (Mobile & Frontend UI Lead)
 * @brief Turns a failed auth request into a message the driver can read.
 * Maps the HTTP status onto a translation key, per screen, and never shows the
 * server's own `detail` — that string is always English (CAR-59).
 */
import { ApiError } from '@/services/api/client'

/** Translation keys for the statuses a screen wants to word its own way. */
type StatusKeys = Partial<Record<number, string>>

const FALLBACK: StatusKeys = {
  // Both auth routes are capped per address; the server names the wait it wants.
  429: 'auth.errors.tooManyAttempts',
  422: 'auth.errors.invalidDetails',
  // The client's own timeout (CAR-230). Without a key of its own it reads as
  // "something went wrong", which is what a wrong password looks like too.
  408: 'auth.errors.timeout',
}

export function authErrorMessage(
  error: unknown,
  t: (key: string) => string,
  keys: StatusKeys = {}
): string {
  const status = error instanceof ApiError ? error.status : 0
  const key = keys[status] ?? FALLBACK[status]
  if (!key) return t('common.error')

  const message = t(key)
  if (status !== 429) return message

  // A 429 without a Retry-After still reaches here — the header is the server's
  // to send, so the wording has to survive it being absent.
  const seconds = error instanceof ApiError ? error.retryAfterSeconds : undefined
  return seconds === undefined
    ? t('auth.errors.tooManyAttemptsNoWait')
    : message.replace('{seconds}', String(seconds))
}
