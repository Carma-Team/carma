import { describe, it, expect } from 'vitest';
import { isValidLatitude, isValidLongitude, isValidCoordinate } from './coordinates';

describe('isValidLatitude', () => {
  it.each([-90, 0, 32.0648, 90])('accepts %s — within [-90, 90]', (value) => {
    expect(isValidLatitude(value)).toBe(true);
  });

  it.each([-90.0001, 90.0001, 132.5, -180, Infinity, -Infinity, NaN])('rejects %s — outside range or non-finite', (value) => {
    expect(isValidLatitude(value)).toBe(false);
  });
});

describe('isValidLongitude', () => {
  it.each([-180, 0, 34.7748, 180])('accepts %s — within [-180, 180]', (value) => {
    expect(isValidLongitude(value)).toBe(true);
  });

  it.each([-180.0001, 180.0001, 999, Infinity, -Infinity, NaN])('rejects %s — outside range or non-finite', (value) => {
    expect(isValidLongitude(value)).toBe(false);
  });
});

describe('isValidCoordinate', () => {
  it('accepts a valid pair, including the equator/prime-meridian intersection (0, 0)', () => {
    expect(isValidCoordinate(0, 0)).toBe(true);
    expect(isValidCoordinate(32.0648, 34.7748)).toBe(true);
  });

  it('rejects the pair if either half is invalid', () => {
    expect(isValidCoordinate(132.5, 34.7748)).toBe(false);
    expect(isValidCoordinate(32.0648, 999)).toBe(false);
    expect(isValidCoordinate(NaN, 34.7748)).toBe(false);
  });
});
