import { useEffect, useId, useRef, type HTMLAttributes, type ReactNode } from 'react';
import { Heading } from './Typography';
import { AlertCircleIcon, AlertTriangleIcon } from './icons';
import styles from './Dialog.module.css';

type DialogSize = 'sm' | 'lg';

// Confirm-dialog icon, per the style guide's "Modal / dialog" pattern — a
// tone-tinted circle beside the title. Only the two tones that pattern uses
// for a confirmation (warning for a reversible-but-notable action, danger
// for a destructive one) are supported; a plain informational/form dialog
// passes no tone at all.
type DialogTone = 'warning' | 'danger';

const toneIcons: Record<DialogTone, ReactNode> = {
  warning: <AlertTriangleIcon />,
  danger: <AlertCircleIcon />,
};

type DialogProps = Omit<HTMLAttributes<HTMLDialogElement>, 'title'> & {
  open: boolean;
  onClose: () => void;
  title?: string;
  // No English default — this is read to screen readers, so callers must
  // supply a translated label rather than silently leaking English into a
  // Hebrew page.
  closeLabel: string;
  // sm (480px) for confirmations, lg (640px) for a form. Reward create/edit
  // is a full page rather than a dialog — too many fields plus an image
  // upload for either size.
  size?: DialogSize;
  tone?: DialogTone;
  children: ReactNode;
};

// Built on the native <dialog> element rather than a portal + focus-trap
// library — the browser already provides modal semantics, Escape-to-close
// and ::backdrop for free.
export function Dialog({
  open,
  onClose,
  title,
  closeLabel,
  size = 'sm',
  tone,
  children,
  className,
  ...rest
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  // The dialog's own accessible name — without it, a screen reader announces
  // a native <dialog> as unlabelled even though it has a visible title.
  const titleId = useId();

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
  }, [open]);

  const heading = title && (
    <Heading level={2} id={titleId} className={styles.title}>
      {title}
    </Heading>
  );

  return (
    <dialog
      ref={ref}
      className={[styles.dialog, styles[size], className].filter(Boolean).join(' ')}
      onClose={onClose}
      onCancel={onClose}
      aria-labelledby={title ? titleId : undefined}
      {...rest}
    >
      {tone ? (
        <div className={styles.headerRow}>
          <span className={[styles.iconCircle, `tone-${tone}`].join(' ')} aria-hidden="true">
            {toneIcons[tone]}
          </span>
          <div className={styles.headerText}>
            {heading}
            <div className={styles.body}>{children}</div>
          </div>
        </div>
      ) : (
        <>
          {heading}
          <div className={styles.body}>{children}</div>
        </>
      )}
      <button type="button" className={styles.closeButton} onClick={onClose} aria-label={closeLabel}>
        ×
      </button>
    </dialog>
  );
}
