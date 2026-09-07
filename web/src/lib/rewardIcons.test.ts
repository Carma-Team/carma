import { describe, it, expect } from 'vitest';
import { DEFAULT_REWARD_ICON, REWARD_ICON_OPTIONS, rewardIconLabel, rewardIconOption } from './rewardIcons';

describe('rewardIcons', () => {
  it('resolves a known value to its own option', () => {
    const option = rewardIconOption('cafe-outline');
    expect(option.labelEn).toBe('Coffee');
  });

  it('falls back to the generic reward icon for an unrecognized or legacy value', () => {
    expect(rewardIconOption('some-legacy-emoji-key').value).toBe(DEFAULT_REWARD_ICON);
    expect(rewardIconOption('').value).toBe(DEFAULT_REWARD_ICON);
  });

  it('every option carries a non-empty Hebrew and English label', () => {
    for (const option of REWARD_ICON_OPTIONS) {
      expect(option.labelHe.trim()).not.toBe('');
      expect(option.labelEn.trim()).not.toBe('');
    }
  });

  it('picks the label matching the requested language', () => {
    const option = rewardIconOption('cafe-outline');
    expect(rewardIconLabel(option, 'HE')).toBe('קפה');
    expect(rewardIconLabel(option, 'EN')).toBe('Coffee');
  });

  it('the default icon value is itself a selectable option', () => {
    expect(REWARD_ICON_OPTIONS.some((option) => option.value === DEFAULT_REWARD_ICON)).toBe(true);
  });
});
