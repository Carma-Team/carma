import type { ReactNode } from 'react';
import { Heading, Text } from './Typography';
import styles from './PageHeader.module.css';

type Crumb = { label: string; href?: string };

type PageHeaderProps = {
  title: string;
  /** One-line status summary under the title, e.g. counts or last-updated time. */
  subtitle?: ReactNode;
  breadcrumbs?: Crumb[];
  actions?: ReactNode;
};

// Breadcrumb → title → one-line summary at the start edge; actions at the
// end. Tabs/filter bars sit directly beneath this, inside the page.
export function PageHeader({ title, subtitle, breadcrumbs, actions }: PageHeaderProps) {
  return (
    <div className={styles.header}>
      <div className={styles.text}>
        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav className={styles.breadcrumbs} aria-label={title}>
            {breadcrumbs.map((crumb, index) => (
              <span key={crumb.label} className={styles.crumb}>
                {index > 0 && <span aria-hidden="true">/</span>}
                {crumb.href ? <a href={crumb.href}>{crumb.label}</a> : <span>{crumb.label}</span>}
              </span>
            ))}
          </nav>
        )}
        <Heading level={1}>{title}</Heading>
        {subtitle && (
          <Text variant="caption" className={styles.subtitle}>
            {subtitle}
          </Text>
        )}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  );
}
