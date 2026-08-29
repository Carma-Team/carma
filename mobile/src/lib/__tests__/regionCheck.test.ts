import { isRegionAllowed } from '@/lib/regionCheck';

describe('isRegionAllowed', () => {

  test.each([
    ['Tel Aviv',        32.08, 34.78],
    ['Eilat',           29.55, 34.95],
    ['Metula',          33.28, 35.58],
    // Inside the box on purpose: a geocoder answers PS here, which is exactly the
    // answer the box exists to avoid acting on.
    ['Ramallah',        31.90, 35.20],
  ])('%s is inside', (_name, lat, lng) => {
    expect(isRegionAllowed(lat, lng)).toBe(true);
  });

  test.each([
    ['New York',        40.71, -74.01],
    ['Cairo',           30.04,  31.24],
    ['Nicosia',         35.19,  33.38],
    ['Amman',           31.95,  35.93],   // just east of the box
  ])('%s is outside', (_name, lat, lng) => {
    expect(isRegionAllowed(lat, lng)).toBe(false);
  });

  test('the corners themselves are inside — the bounds are inclusive', () => {
    expect(isRegionAllowed(29.45, 34.25)).toBe(true);
    expect(isRegionAllowed(33.35, 35.90)).toBe(true);
  });

  test('a null-island fix is outside', () => {
    expect(isRegionAllowed(0, 0)).toBe(false);
  });
});
