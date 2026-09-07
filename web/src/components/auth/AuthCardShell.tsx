import type { ReactNode } from 'react';
import { Logo } from '@/components/ui';
import styles from './AuthCardShell.module.css';

// The "onboarding forms stay clean and functional" treatment (style guide) —
// a quiet logo header over the page background, no road photography. Used
// for every public flow that isn't a sign-in/create-account door: business
// registration, request-status lookup, and invitation acceptance.
export function AuthCardShell({ children }: { children: ReactNode }) {
  return (
    <main className={styles.page}>
      <Logo height={24} className={styles.logo} />
      <div className={styles.content}>{children}</div>
    </main>
  );
}
