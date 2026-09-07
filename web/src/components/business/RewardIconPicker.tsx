import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { REWARD_ICON_GROUPS, REWARD_ICON_OPTIONS, rewardIconLabel, rewardIconOption, type RewardIconGroup } from '@/lib/rewardIcons';
import { Input } from '@/components/ui';
import styles from './RewardIconPicker.module.css';

const GROUP_LABEL_KEY: Record<RewardIconGroup, string> = {
  foodDrink: 'iconGroupFoodDrink',
  retail: 'iconGroupRetail',
  automotive: 'iconGroupAutomotive',
  home: 'iconGroupHome',
  entertainment: 'iconGroupEntertainment',
  lifestyle: 'iconGroupLifestyle',
  generic: 'iconGroupGeneric',
};

type RewardIconPickerProps = {
  id: string;
  value: string;
  onChange: (value: string) => void;
};

// A collapsible grouped grid rather than a floating popover — this form
// already lives inside a Dialog built on the native <dialog> element, and a
// second layer of positioning/portal logic for a nested overlay is
// complexity this picker doesn't need (CLAUDE.md's "keep it simple").
export function RewardIconPicker({ id, value, onChange }: RewardIconPickerProps) {
  const { t, lang } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = rewardIconOption(value);
  const SelectedIcon = selected.Icon;
  // Referential equality against the one canonical option `rewardIconOption`
  // itself resolves to — not `option.value === value` — so that when two
  // labeled options share a persisted value (e.g. retail's "Gift" and
  // generic's "General reward" both are 'gift-outline'), only one of them
  // ever shows as selected instead of both at once.
  const isSelected = (option: (typeof REWARD_ICON_OPTIONS)[number]) => option === selected;

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const normalizedQuery = query.trim().toLowerCase();
  const groupedOptions = useMemo(() => {
    const matches =
      normalizedQuery === ''
        ? REWARD_ICON_OPTIONS
        : REWARD_ICON_OPTIONS.filter(
            (option) => option.labelHe.includes(normalizedQuery) || option.labelEn.toLowerCase().includes(normalizedQuery),
          );
    return REWARD_ICON_GROUPS.map((group) => ({ group, options: matches.filter((option) => option.group === group) })).filter(
      (entry) => entry.options.length > 0,
    );
  }, [normalizedQuery]);

  return (
    <div className={styles.field} ref={containerRef}>
      <label htmlFor={id} className={styles.label}>
        {t('rewards.iconLabel')}
      </label>
      <button
        id={id}
        type="button"
        className={styles.trigger}
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className={styles.swatch}>
          <SelectedIcon size={20} strokeWidth={2} aria-hidden="true" />
        </span>
        <span className={styles.triggerLabel}>{rewardIconLabel(selected, lang)}</span>
        <span className={styles.changeLabel}>{t('rewards.iconChangeButton')}</span>
        <ChevronDown size={18} aria-hidden="true" className={styles.chevron} />
      </button>

      {open && (
        <div className={styles.panel} role="group" aria-label={t('rewards.iconLabel')}>
          <Input
            variant="search"
            autoFocus
            placeholder={t('rewards.iconSearchPlaceholder')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className={styles.search}
          />
          <div className={styles.groups}>
            {groupedOptions.length === 0 && <p className={styles.empty}>{t('rewards.iconNoResults')}</p>}
            {groupedOptions.map(({ group, options }) => (
              <div key={group}>
                <div className={styles.groupTitle}>{t(`rewards.${GROUP_LABEL_KEY[group]}`)}</div>
                <div className={styles.grid}>
                  {options.map((option, index) => {
                    const Icon = option.Icon;
                    const label = rewardIconLabel(option, lang);
                    return (
                      <button
                        // Two entries can share the same persisted `value` (see
                        // rewardIcons.ts) — the label is what makes each option
                        // distinct, so it joins the value in the key.
                        key={`${option.value}-${label}-${index}`}
                        type="button"
                        className={styles.option}
                        aria-pressed={isSelected(option)}
                        title={label}
                        onClick={() => {
                          onChange(option.value);
                          setOpen(false);
                        }}
                      >
                        <Icon size={20} strokeWidth={2} aria-hidden="true" />
                        <span className={styles.optionLabel}>{label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
