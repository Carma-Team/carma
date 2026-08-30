import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { normalizeBusinessRole } from '@/lib/auth/businessRole';
import styles from './AppShell.module.css';

// CAR-204 owns this chrome; CAR-116 owns which nav items it renders for the
// caller's role. Rewards and Redemption stay unconditional — every role in
// the matrix can at least view them, and each page hides its own
// manage-only controls. Team & Permissions (CAR-117) is a real route now,
// OWNER-only; Analytics (redemption history/stats, CAR-119/CAR-80) is still
// coming-soon. Both are capabilities a CASHIER (and, for Team, a MANAGER
// too) never gets — hidden here rather than shown disabled, since a role
// that can't use a page shouldn't see it advertised.
export function AppShell() {
  const { user, logout } = useAuth();
  const { t, lang, setLang } = useTranslation();
  const role = normalizeBusinessRole(user?.businessMembershipRole);
  const canManagePermissions = role === 'OWNER';
  const canSeeAnalytics = role === 'OWNER' || role === 'MANAGER';

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
          {canManagePermissions && (
            <NavLink to="/permissions" className={({ isActive }) => navClass(styles, isActive)}>
              {t('shell.navTeam')}
            </NavLink>
          )}
        </nav>

        {/* Not aria-disabled — these were never interactive controls to begin
            with, so there's no widget state to convey. The muted styling plus
            "coming soon" badge text already say everything a reader needs. */}
        <div className={styles.navGroup} aria-label={t('shell.navGroupUpcoming')}>
          <span className={styles.navDisabled}>
            {t('shell.navOverview')}
            <span className={styles.badge}>{t('shell.comingSoonBadge')}</span>
          </span>
          {canSeeAnalytics && (
            <span className={styles.navDisabled}>
              {t('shell.navAnalytics')}
              <span className={styles.badge}>{t('shell.comingSoonBadge')}</span>
            </span>
          )}
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
