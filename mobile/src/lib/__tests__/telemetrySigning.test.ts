// The signing path had no test until it left AppContext.tsx: the functions were
// module-private in a 700-line React context, so nothing could import them.
//
// Every expected value below was produced by Python's `hashlib`/`hmac` — an
// independent implementation — and never written from memory. The ones marked
// with a document are also published there, and were cross-checked against it.
//
// `SIGNING_KEY` is read once at module scope, and babel inlines EXPO_PUBLIC_*
// at transform time. The assignment therefore has to happen before the module is
// first required, which is why these tests use `require` inside `jest.isolateModules`
// rather than a top-level import.
process.env.EXPO_PUBLIC_TRIP_SIGNING_KEY = 'test-signing-key'

import type { TelemetryDigest } from '@/services/sync/types'
import { sha256, hmacSha256Hex } from '@/lib/telemetrySigning'

const hex = (bytes: Uint8Array) =>
  Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')

const utf8 = (s: string) => new Uint8Array(Array.from(s, c => c.charCodeAt(0)))

describe('sha256 — FIPS 180-4 known answers', () => {
  it('hashes a single-block message', () => {
    expect(hex(sha256(utf8('abc'))))
      .toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('hashes the empty message — the padding-only path', () => {
    expect(hex(sha256(utf8(''))))
      .toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })

  it('hashes a 448-bit message, which spills into a second block', () => {
    const msg = 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'
    expect(hex(sha256(utf8(msg))))
      .toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1')
  })
})

describe('hmacSha256Hex — RFC 4231 known answers', () => {
  // Cases 3, 4, 6 and 7 of RFC 4231 are not here and cannot be: their keys are
  // 0xaa bytes, and this function takes a string that it UTF-8 encodes, so 0xaa
  // would widen to two bytes and stop representing the vector. Case 1's 0x0b
  // key is below 0x80 and survives the round trip.
  it('case 1 — a key shorter than the block', () => {
    expect(hmacSha256Hex('\x0b'.repeat(20), 'Hi There'))
      .toBe('b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7')
  })

  it('case 2 — a very short key', () => {
    expect(hmacSha256Hex('Jefe', 'what do ya want for nothing?'))
      .toBe('5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843')
  })

  it('hashes a key longer than the 64-byte block before using it', () => {
    // Not from RFC 4231 — its over-length key is unrepresentable here (see above).
    // Generated with Python: hmac.new(b'a'*100, msg, hashlib.sha256).
    const msg = 'message longer than one 64-byte block so both paths are exercised'
    expect(hmacSha256Hex('a'.repeat(100), msg))
      .toBe('00c9c274149d6ea47523c1dffe85bcaaa443c41bccd56b8018f597d9fba3cf14')
  })
})

describe('signTelemetryDigest', () => {
  const digest: TelemetryDigest = {
    distanceKm: 12.345,
    durationSeconds: 900,
    hardBrakes: 2,
    aggressiveAccels: 1,
    sharpTurns: 3,
    touchEpochs: 4,
    screenInteractionSeconds: 17,
    startTime: '2026-08-30T08:00:00.000Z',
    endTime: '2026-08-30T08:15:00.000Z',
    timestamp: 1756540800000,
    accelAvailable: true,
    accelInitFailed: false,
  }

  const sign = (d: TelemetryDigest, key = 'test-signing-key') => {
    // process.env is shared by every test file a worker runs, so the key is put
    // back even when signing throws — otherwise the empty-key case below leaks.
    const previous = process.env.EXPO_PUBLIC_TRIP_SIGNING_KEY
    let signature = ''
    try {
      jest.isolateModules(() => {
        process.env.EXPO_PUBLIC_TRIP_SIGNING_KEY = key
        signature = require('@/lib/telemetrySigning').signTelemetryDigest(d)
      })
    } finally {
      process.env.EXPO_PUBLIC_TRIP_SIGNING_KEY = previous
    }
    return signature
  }

  it('signs the same digest identically whatever order its keys were set in', () => {
    // This is the assertion that matters most. The client sorts keys before
    // hashing and the server hashes with `sort_keys`; if the two ever stop
    // agreeing, every signature fails verification and nothing here says why.
    const reordered = Object.fromEntries(
      Object.entries(digest).reverse(),
    ) as unknown as TelemetryDigest

    expect(Object.keys(reordered)).not.toEqual(Object.keys(digest))
    expect(sign(reordered)).toBe(sign(digest))
  })

  it('marks the signature unverifiable and returns a full-width digest', () => {
    // The ph: prefix is what tells the server not to verify. CAR-13 removes it
    // on both sides at once; until then a signature without it would be rejected.
    expect(sign(digest)).toMatch(/^ph:[0-9a-f]{64}$/)
  })

  it('changes the signature when a single field changes', () => {
    expect(sign({ ...digest, hardBrakes: 3 })).not.toBe(sign(digest))
  })

  it('refuses to sign with no key rather than emitting a well-formed forgery', () => {
    // An empty key still produces a valid-looking HMAC, so the trip would travel
    // marked as signed while being unverifiable. The caller sends it unsigned instead.
    expect(() => sign(digest, '')).toThrow('EXPO_PUBLIC_TRIP_SIGNING_KEY is not set')
  })
})
