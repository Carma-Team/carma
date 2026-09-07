import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
import styles from './Menu.module.css';

type MenuProps = {
  // Accessible name for the icon-only trigger — never rendered as visible
  // text (see the style guide's icon-button rule), so callers must supply a
  // translated label rather than leaking English into a Hebrew page.
  triggerLabel: string;
  // <MenuItem> children — a plain array/fragment of them, filtered for
  // falsy values so a caller can conditionally include one with `{cond && <MenuItem .../>}`.
  children: ReactNode;
};

// A small overflow menu for a card's secondary actions (docs/business-portal-
// design/CARMA Rewards Management.dc.html's "more-horizontal" button) — an
// uncontrolled disclosure, not a floating-UI library: the one thing it needs
// beyond a plain toggle is closing on an outside click, Escape, or picking an
// item, all handled locally without a portal (CLAUDE.md's "keep it simple").
export function Menu({ triggerLabel, children }: MenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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

  return (
    <div className={styles.container} ref={containerRef}>
      <button
        type="button"
        className={styles.trigger}
        aria-label={triggerLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <MoreHorizontal size={16} aria-hidden="true" />
      </button>
      {open && (
        // A plain labelled group of buttons, not role="menu"/"menuitem" —
        // that ARIA pattern promises roving-tabindex arrow-key navigation
        // this disclosure doesn't implement, which would overclaim more
        // than a simple secondary-actions panel needs (same call
        // RewardIconPicker's own panel already makes). Closes after any
        // item's own onClick runs and bubbles here — a menu that stayed
        // open past a selection would misrepresent every guard below it as
        // still "pending a choice".
        <div
          role="group"
          aria-label={triggerLabel}
          className={styles.panel}
          onClick={(event) => {
            // A disabled item's own onClick never runs, but the click event
            // itself still bubbles here — closing on it anyway would make a
            // no-op click on a disabled item (e.g. a guarded action mid-race)
            // silently dismiss the menu instead of leaving it open to retry.
            if ((event.target as HTMLElement).closest('button')?.disabled) return;
            setOpen(false);
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

type MenuItemProps = {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
};

export function MenuItem({ onClick, disabled, children }: MenuItemProps) {
  return (
    <button type="button" className={styles.item} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}
