/** Small building blocks shared by the Strategy, Healthcare, Assumptions and Household inputs. */
import { HelpTip, Segmented } from '@fisim/ui';
import { useId, type ReactNode } from 'react';
import './inputs-b.css';

/**
 * A slider laid beside a number field for the same value: drag for a feel of the range, type for an exact
 * figure. The field (the child) owns the label, help and keyboard entry; the slider is a pointer shortcut
 * to the same value, so it is kept out of the tab order and the accessibility tree rather than announced
 * as a second control.
 */
export function Dial({
  value,
  min,
  max,
  step,
  onChange,
  children,
  ...rest
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  /** One field component (PercentField, NumberField…) bound to the same value. */
  children: ReactNode;
} & Record<`data-${string}`, string | undefined>): ReactNode {
  const shown = Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
  return (
    <div className="pib-dial" {...rest}>
      <input
        type="range"
        className="lv-range"
        aria-hidden="true"
        tabIndex={-1}
        min={min}
        max={max}
        step={step}
        value={shown}
        onChange={(e) => onChange(+Number(e.target.value).toFixed(8))}
        style={{ ['--fill' as string]: `${max > min ? ((shown - min) / (max - min)) * 100 : 0}%` }}
      />
      {children}
    </div>
  );
}

/** A labelled one-of-a-few choice shown as pills, for options short enough to read at a glance. */
export function Choice<T extends string>({
  label,
  help,
  hint,
  value,
  options,
  onChange,
  ...rest
}: {
  label: string;
  help?: ReactNode;
  hint?: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
} & Record<`data-${string}`, string | undefined>): ReactNode {
  const id = useId();
  return (
    <div className="lv-field pib-choice">
      <span className="lv-label-row">
        <span className="lv-label" id={`${id}-label`}>
          {label}
        </span>
        {help ? <HelpTip describedBy={`${id}-label`}>{help}</HelpTip> : null}
      </span>
      <Segmented label={label} value={value} options={options} onChange={onChange} {...rest} />
      {hint ? <span className="lv-hint">{hint}</span> : null}
    </div>
  );
}

/** Two independent stacks of sections side by side, so opening one never stretches its neighbour. */
export function FoldColumns({ left, right }: { left: ReactNode; right: ReactNode }): ReactNode {
  return (
    <div className="pib-cols">
      <div className="pib-col">{left}</div>
      <div className="pib-col">{right}</div>
    </div>
  );
}

/** A quiet line of explanation at the top of a section, with the long version behind an (i). */
export function Lead({ children, more }: { children: ReactNode; more?: ReactNode }): ReactNode {
  return (
    <p className="pib-lead">
      {children}
      {more ? <HelpTip>{more}</HelpTip> : null}
    </p>
  );
}
