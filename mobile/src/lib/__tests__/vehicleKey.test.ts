// The salt is read once at module scope and babel inlines EXPO_PUBLIC_* at transform
// time, so it has to be set before the module is first required — hence `require`
// inside `jest.isolateModules` rather than a top-level import, the same shape
// telemetrySigning.test.ts uses.
//
// The expected key below was produced by Python's `hmac`/`hashlib`, an independent
// implementation, and never written from memory:
//   hmac.new(b'test-salt', b'AA:BB:CC:DD:EE:FF', hashlib.sha256).hexdigest()[:32]

const key = (address: string, salt = 'test-salt') => {
  // process.env is shared by every test file a worker runs, so it is put back even
  // when the call throws — otherwise the unset-salt case below leaks into the others.
  const previous = process.env.EXPO_PUBLIC_VEHICLE_KEY_SALT
  let result: string | null = null
  try {
    jest.isolateModules(() => {
      process.env.EXPO_PUBLIC_VEHICLE_KEY_SALT = salt
      result = require('@/lib/vehicleKey').vehicleKeyHash(address)
    })
  } finally {
    process.env.EXPO_PUBLIC_VEHICLE_KEY_SALT = previous
  }
  return result
}

describe('vehicleKeyHash', () => {
  it('derives the documented 32-character key from the address', () => {
    expect(key('AA:BB:CC:DD:EE:FF')).toBe('f96cbe2f4729db218aa5b71710763a3b')
  })

  it('binds one car to one key however its address is spelled', () => {
    expect(key('aa:bb:cc:dd:ee:ff')).toBe(key('AA:BB:CC:DD:EE:FF'))
  })

  it('gives two cars two keys', () => {
    expect(key('AA:BB:CC:DD:EE:FF')).not.toBe(key('11:22:33:44:55:66'))
  })

  // An unconfigured build must not mint a key every installation would agree on —
  // that is a shared vehicle identity, which is worse than no binding at all.
  it('returns null when no salt is configured', () => {
    // An unset variable reaches the module as '' through its `?? ''`, so the empty
    // string is the same case.
    expect(key('AA:BB:CC:DD:EE:FF', '')).toBeNull()
  })

  it('returns null for an empty address', () => {
    expect(key('')).toBeNull()
  })
})
