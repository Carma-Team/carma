import type { ReactNode } from 'react';
import { Logo } from '@/components/ui';
import roadPhoto from '@/assets/photography/carma-road.jpg';
import styles from './AuthSplitLayout.module.css';

type AuthSplitLayoutProps = {
  children: ReactNode;
  /** Hero copy over the photo panel — omit for the quieter recovery-style treatment. */
  heroTitle?: string;
  heroSubtitle?: string;
};

// The "door" treatment (style guide: "brand intensity — road photography on
// auth screens only"). Logical CSS keeps the form on the reading-start side
// and the photo on the end side in both RTL and LTR without a dir check.
export function AuthSplitLayout({ children, heroTitle, heroSubtitle }: AuthSplitLayoutProps) {
  return (
    <main className={styles.shell}>
      <div className={styles.formPanel}>
        <Logo height={26} className={styles.logo} />
        <div className={styles.formContent}>{children}</div>
      </div>
      <div className={styles.photoPanel} aria-hidden="true">
        <img src={roadPhoto} alt="" className={styles.photoImage} />
        <div className={styles.photoOverlay} />
        {heroTitle && (
          <div className={styles.photoCopy}>
            <p className={styles.photoCopyTitle}>{heroTitle}</p>
            {heroSubtitle && <p className={styles.photoCopySubtitle}>{heroSubtitle}</p>}
          </div>
        )}
      </div>
    </main>
  );
}
