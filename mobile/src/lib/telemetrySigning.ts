/**
 * @file telemetrySigning.ts
 * @owner Shared — Dan (CPO) holds what is signed and why, May (Mobile) holds the primitive
 * @brief Signs the RFC-001 telemetry digest: canonical JSON over a hand-written SHA-256 and
 * HMAC-SHA256 (FIPS 180-4 / FIPS 198-1). The primitive is hand-written because the app has no
 * crypto dependency and cannot get one — expo-crypto ships no HMAC, Hermes exposes neither
 * `crypto.subtle` nor `node:crypto`, a native module would break Expo Go, and the single
 * caller signs synchronously inside the end-trip path.
 */
import type { TelemetryDigest } from '@/services/sync/types';

// The key ships inside the app bundle, so a valid signature proves the payload came
// from a copy of the client, not from a trusted device. That limit is accepted
// deliberately — docs/fraud-detection.md, "What we accept losing"; attestation-
// provisioned keys are Stage 2 of its maturity path.
// The 'ph:' prefix marks the signature unverifiable. The server accepts it today;
// CAR-13 is the switch to rejecting it.
const SIGNING_KEY = process.env.EXPO_PUBLIC_TRIP_SIGNING_KEY ?? '';

// SHA-256 round constants: first 32 bits of the cube roots of the first 64 primes.
const _SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function _rotr32(n: number, d: number): number {
  return ((n >>> d) | (n << (32 - d))) >>> 0;
}

// UTF-8 encode a string to bytes (handles BMP characters; ASCII is the common case).
function _utf8Bytes(s: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if      (c < 0x80)   { out.push(c); }
    else if (c < 0x800)  { out.push((c >> 6) | 0xc0, (c & 0x3f) | 0x80); }
    else                  { out.push((c >> 12) | 0xe0, ((c >> 6) & 0x3f) | 0x80, (c & 0x3f) | 0x80); }
  }
  return new Uint8Array(out);
}

// SHA-256 core — FIPS 180-4 §6.2.2. Returns a 32-byte digest.
export function sha256(data: Uint8Array): Uint8Array {
  // Initial hash values: first 32 bits of fractional parts of sqrt of first 8 primes.
  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);

  const byteLen = data.length;
  const bitLen  = byteLen * 8;
  // Pad: append 0x80, zero bytes, then 64-bit big-endian message length.
  const padLen = ((byteLen + 9 + 63) & ~63);
  const padded = new Uint8Array(padLen);
  padded.set(data);
  padded[byteLen] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padLen - 8, Math.floor(bitLen / 0x100000000), false);
  dv.setUint32(padLen - 4, bitLen >>> 0, false);

  const w = new Uint32Array(64);
  for (let i = 0; i < padLen; i += 64) {
    // Prepare message schedule.
    for (let j = 0; j < 16; j++) w[j] = dv.getUint32(i + j * 4, false);
    for (let j = 16; j < 64; j++) {
      const s0 = _rotr32(w[j-15], 7)  ^ _rotr32(w[j-15], 18) ^ (w[j-15] >>> 3);
      const s1 = _rotr32(w[j-2],  17) ^ _rotr32(w[j-2],  19) ^ (w[j-2]  >>> 10);
      w[j] = (w[j-16] + s0 + w[j-7] + s1) >>> 0;
    }

    // Compression.
    let a = H[0], b = H[1], c = H[2], d = H[3];
    let e = H[4], f = H[5], g = H[6], hh = H[7];
    for (let j = 0; j < 64; j++) {
      const S1  = _rotr32(e, 6)  ^ _rotr32(e, 11) ^ _rotr32(e, 25);
      const ch  = (e & f) ^ (~e & g);
      const t1  = (hh + S1 + ch + _SHA256_K[j] + w[j]) >>> 0;
      const S0  = _rotr32(a, 2)  ^ _rotr32(a, 13) ^ _rotr32(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2  = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d  + t1) >>> 0;
      d  = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0]=(H[0]+a)>>>0; H[1]=(H[1]+b)>>>0; H[2]=(H[2]+c)>>>0; H[3]=(H[3]+d)>>>0;
    H[4]=(H[4]+e)>>>0; H[5]=(H[5]+f)>>>0; H[6]=(H[6]+g)>>>0; H[7]=(H[7]+hh)>>>0;
  }

  const result = new Uint8Array(32);
  const rv = new DataView(result.buffer);
  H.forEach((v, i) => rv.setUint32(i * 4, v, false));
  return result;
}

// HMAC-SHA256 — FIPS 198-1. Returns lowercase hex string (64 chars).
export function hmacSha256Hex(key: string, message: string): string {
  const BLOCK = 64;
  let k = _utf8Bytes(key);
  if (k.length > BLOCK) k = sha256(k);   // keys > block size are hashed first

  const kPad = new Uint8Array(BLOCK);      // zero-padded to block size
  kPad.set(k);

  const ipad = kPad.map(b => b ^ 0x36);
  const opad = kPad.map(b => b ^ 0x5c);

  const msg   = _utf8Bytes(message);
  const inner = new Uint8Array(BLOCK + msg.length);
  inner.set(ipad); inner.set(msg, BLOCK);

  const innerHash = sha256(inner);
  const outer     = new Uint8Array(BLOCK + 32);
  outer.set(opad); outer.set(innerHash, BLOCK);

  return Array.from(sha256(outer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Signs the digest with HMAC-SHA256. Canonical JSON (sorted keys) guarantees a
// deterministic byte sequence regardless of JS engine key-insertion order.
// 'ph:' prefix marks the signature unverifiable — accepted today, rejected under CAR-13.
export function signTelemetryDigest(digest: TelemetryDigest): string {
  // Empty key would still produce a well-formed HMAC, so the trip would look signed
  // while being unverifiable. Fail instead — the caller sends it unsigned.
  if (!SIGNING_KEY) throw new Error('EXPO_PUBLIC_TRIP_SIGNING_KEY is not set');
  const canonical = JSON.stringify(digest, Object.keys(digest).sort() as (keyof TelemetryDigest)[]);
  const hmac = hmacSha256Hex(SIGNING_KEY, canonical);
  return `ph:${hmac}`;
}
