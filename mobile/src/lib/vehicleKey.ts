/**
 * @file vehicleKey.ts
 * @owner May (Mobile & Frontend UI Lead)
 * @brief Turns the connected vehicle's Bluetooth address into the opaque key a trip is
 * bound by. The raw address never leaves this function — it is not sent, logged or stored
 * anywhere else (driver-identification.md §2.3.1 / §3.1, CAR-310).
 */
import { hmacSha256Hex } from '@/lib/telemetrySigning'

// Same provisioning as the telemetry signing key: it ships inside the app bundle, which
// is accepted deliberately here for a different reason. The salt is not a secret that
// proves anything — it exists so the same car produces the same key on every trip and so
// a stored key cannot be reversed into a MAC address. Both hold with a bundled value.
//
// It must stay stable across releases: changing it re-keys every vehicle, and the server
// side (CAR-309) binds by equality, so every driver would look like they changed car once.
const VEHICLE_KEY_SALT = process.env.EXPO_PUBLIC_VEHICLE_KEY_SALT ?? ''

// §3.1 fixes the field at 32 hex characters. 128 bits of a SHA-256 HMAC — far past what a
// collision between two cars in one fleet would need, and the column stays narrow.
const KEY_LENGTH = 32

/**
 * The trip's vehicle key, or null when there is nothing trustworthy to derive one from.
 * Null rather than a hash of an empty salt: an unconfigured build must not mint keys that
 * every installation would agree on.
 */
export function vehicleKeyHash(bluetoothAddress: string): string | null {
  if (!VEHICLE_KEY_SALT || !bluetoothAddress) return null
  // Case-folded: the OS reports an address as "AA:BB:.." and a picker may hand back
  // "aa:bb:..", and two spellings of one car must not bind as two vehicles.
  return hmacSha256Hex(VEHICLE_KEY_SALT, bluetoothAddress.toUpperCase()).slice(0, KEY_LENGTH)
}
