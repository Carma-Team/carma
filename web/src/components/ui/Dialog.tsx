import { useEffect, useId, useRef, type HTMLAttributes, type ReactNode } from 'react';
import { Heading } from './Typography';
import styles from './Dialog.module.css';

type DialogProps = Omit<HTMLAttributes<HTMLDialogElement>, 'title'> & {
  open: boolean;
  onClose: () => void;
  title?: string;
  // No English default — this is read to screen readers, so callers must
  // supply a translated label rather than silently leaking English into a
  // Hebrew page.
  closeLabel: string;
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

  return (
    <dialog
      ref={ref}
      className={[styles.dialog, className].filter(Boolean).join(' ')}
      onClose={onClose}
      onCancel={onClose}
      aria-labelledby={title ? titleId : undefined}
      {...rest}
    >
      {title && (
        <Heading level={2} id={titleId}>
          {title}
        </Heading>
      )}
      <div className={styles.body}>{children}</div>
      <button type="button" className={styles.closeButton} onClick={onClose} aria-label={closeLabel}>
        ×
      </button>
    </dialog>
  );
}
