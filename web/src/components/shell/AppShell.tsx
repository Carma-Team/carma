import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import styles from './AppShell.module.css';

// CAR-204 owns this chrome only — every route it wraps is either a real page
// (its own ticket) or the shared ComingSoonPage. No page-specific logic here.
export function AppShell() {
  const { user, logout } = useAuth();
  const { t, lang, setLang } = useTranslation();

  // Raw businessName/businessNameHe, not a server-resolved fallback (see
  // AuthUser) — the fallback direction flips with the UI language, so the
  // shell is the one place that needs to pick.
  const businessName =
    (lang === 'HE' ? (user?.businessNameHe ?? user?.businessName) : (user?.businessName ?? user?.businessNameHe)) ??
    t('shell.brandTag');
  const initial = (user?.name ?? businessName ?? '?').trim().charAt(0).toUpperCase();

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <span className={styles.brandName}>{t('app.name')}</span>
        </div>

        <div className={styles.businessCard}>
          <span className={styles.businessAvatar}>{businessName.charAt(0)}</span>
          <span className={styles.businessLabel}>{businessName}</span>
        </div>

        <nav className={styles.navGroup} aria-label={t('shell.navGroupManagement')}>
          <NavLink to="/rewards" className={({ isActive }) => navClass(styles, isActive)}>
            {t('shell.navRewards')}
          </NavLink>
          <NavLink to="/redemption" className={({ isActive }) => navClass(styles, isActive)}>
            {t('shell.navRedemption')}
          </NavLink>
          <NavLink to="/business-profile" className={({ isActive }) => navClass(styles, isActive)}>
            {t('shell.navBusinessProfile')}
          </NavLink>
          <span className={styles.navDisabled} aria-disabled="true">
            {t('shell.navTeam')}
            <span className={styles.badge}>{t('shell.comingSoonBadge')}</span>
          </span>
        </nav>

        <div className={styles.navGroup} aria-label={t('shell.navGroupUpcoming')}>
          <span className={styles.navDisabled} aria-disabled="true">
            {t('shell.navOverview')}
            <span className={styles.badge}>{t('shell.comingSoonBadge')}</span>
          </span>
          <span className={styles.navDisabled} aria-disabled="true">
            {t('shell.navAnalytics')}
            <span className={styles.badge}>{t('shell.comingSoonBadge')}</span>
          </span>
        </div>
      </aside>

      <div className={styles.main}>
        <header className={styles.header}>
          <div className={styles.headerSpacer} />
          <div className={styles.langSwitch}>
            <button
              type="button"
              className={lang === 'HE' ? styles.langActive : styles.langButton}
              onClick={() => setLang('HE')}
            >
              {t('language.he')}
            </button>
            <button
              type="button"
              className={lang === 'EN' ? styles.langActive : styles.langButton}
              onClick={() => setLang('EN')}
            >
              {t('language.en')}
            </button>
          </div>
          <div className={styles.userBlock}>
            <span className={styles.userAvatar}>{initial}</span>
            <span className={styles.userName}>{user?.name ?? businessName}</span>
          </div>
          <button type="button" className={styles.signOut} onClick={() => void logout()}>
            {t('auth.signOutButton')}
          </button>
        </header>

        <main className={styles.content}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function navClass(styles: Record<string, string>, isActive: boolean): string {
  return isActive ? `${styles.navItem} ${styles.navItemActive}` : styles.navItem;
}
