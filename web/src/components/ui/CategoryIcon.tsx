import type { HTMLAttributes } from 'react';
import type { BusinessCategory } from '@/lib/businessCategory';
import styles from './CategoryIcon.module.css';

type CategoryIconProps = HTMLAttributes<HTMLSpanElement> & {
  category: BusinessCategory;
  // Pre-translated category label — only its first letter is shown. Taking
  // the label rather than translating internally keeps this component free
  // of any one page's i18n namespace (rewards.category* vs a future one).
  label: string;
  size?: 'md' | 'lg';
};

// A reward's category as a colored circle avatar — shared by the reward
// catalog (CAR-202) and the voucher review card (CAR-340), rather than each
// page keeping its own copy of the same tint-by-category rule.
export function CategoryIcon({ category, label, size = 'md', className, ...rest }: CategoryIconProps) {
  return (
    <span
      className={[styles.icon, styles[size], className].filter(Boolean).join(' ')}
      data-category={category}
      aria-hidden="true"
      {...rest}
    >
      {label.charAt(0)}
    </span>
  );
}
