import { useId, type InputHTMLAttributes } from 'react';
import styles from './Switch.module.css';

type SwitchProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  label: string;
};

// A labeled on/off control (e.g. reward availability). Built on a checkbox
// input so it keeps native keyboard and screen-reader semantics — the pill
// track and knob are pure styling over it. In RTL the knob rests at the
// inline-start when off and travels to inline-end when on, for free, since
// the track uses justify-content: flex-start / flex-end rather than left/right.
export function Switch({ label, id, className, checked, ...props }: SwitchProps) {
  const generatedId = useId();
  const switchId = id ?? generatedId;

  return (
    <label htmlFor={switchId} className={[styles.wrapper, className].filter(Boolean).join(' ')}>
      <span className={styles.trackWrapper}>
        <input
          id={switchId}
          type="checkbox"
          role="switch"
          checked={checked}
          className={styles.input}
          {...props}
        />
        <span className={[styles.track, checked && styles.trackOn].filter(Boolean).join(' ')} aria-hidden="true">
          <span className={styles.knob} />
        </span>
      </span>
      <span className={[styles.label, checked && styles.labelOn].filter(Boolean).join(' ')}>{label}</span>
    </label>
  );
}
