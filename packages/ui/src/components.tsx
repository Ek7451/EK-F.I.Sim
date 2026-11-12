/** Longview components: accessible primitives with our own styling (plan 10). */
import {
  FloatingFocusManager,
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
  type Placement,
} from '@floating-ui/react';
import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// ------------------------------------------------------------------ formatting

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
});

/** Dollars -> "$41,200". Rounding happens only here, at display. */
export const formatMoney = (dollars: number): string =>
  Number.isFinite(dollars) ? usd0.format(Math.round(dollars)) : '—';
export const formatCompact = (dollars: number): string =>
  Number.isFinite(dollars)
    ? Math.abs(dollars) < 10000
      ? usd0.format(Math.round(dollars))
      : compact.format(dollars)
    : '—';
export const formatPct = (v: number, digits = 0): string =>
  Number.isFinite(v) ? `${(v * 100).toFixed(digits)}%` : '—';
export const centsToDollars = (c: number): number => c / 100;

// ------------------------------------------------------------------ icons (original, simple strokes)

const ICONS: Record<string, string> = {
  home: 'M3 11l9-7 9 7M5 10v9h5v-6h4v6h5v-9',
  plan: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h7',
  explore: 'M3 20h18M6 16l4-5 4 3 5-8',
  compare: 'M4 6h7v12H4zM13 6h7v12h-7z',
  track: 'M4 19V5M4 19h16M8 15l3-4 3 2 4-6',
  reports: 'M7 3h10v18H7zM10 8h4M10 12h4M10 16h2',
  help: 'M12 21a9 9 0 110-18 9 9 0 010 18zM9.5 9.5a2.5 2.5 0 114 2c-.9.6-1.5 1.1-1.5 2.2M12 17.2v.3',
  settings:
    'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12l2-1-1-3-2 .3-1.4-1.4.3-2-3-1-1 2h-2l-1-2-3 1 .3 2L5 7.3 3 7 2 10l2 1v2l-2 1 1 3 2-.3L6.4 18l-.3 2 3 1 1-2h2l1 2 3-1-.3-2 1.4-1.3 2 .3 1-3-2-1z',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  edit: 'M4 20h4l10-10-4-4L4 16zM13 7l4 4',
  trash: 'M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13',
  undo: 'M9 7L4 12l5 5M4 12h10a5 5 0 010 10h-2',
  redo: 'M15 7l5 5-5 5M20 12H10a5 5 0 000 10h2',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  check: 'M5 12l5 5 9-10',
  info: 'M12 21a9 9 0 110-18 9 9 0 010 18zM12 11v6M12 7.5v.5',
  chevron: 'M9 6l6 6-6 6',
  up: 'M6 15l6-6 6 6',
  down: 'M6 9l6 6 6-6',
  sun: 'M12 16a4 4 0 100-8 4 4 0 000 8zM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5',
  moon: 'M20 14A8 8 0 0110 4a8 8 0 1010 10z',
  copy: 'M9 9h10v12H9zM5 15V3h10',
  download: 'M12 4v11M7 11l5 5 5-5M5 20h14',
  upload: 'M12 16V5M7 9l5-5 5 5M5 20h14',
  lock: 'M6 11h12v10H6zM8 11V8a4 4 0 018 0v3',
  cloud: 'M7 18a4 4 0 01-.5-8A6 6 0 0118 9a4.5 4.5 0 01-.5 9z',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  drag: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
};
export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 20 }: { name: string; size?: number }): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={ICONS[name] ?? ICONS.info} />
    </svg>
  );
}

// ------------------------------------------------------------------ basics

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'ghost' | 'danger';
  size?: 'md' | 'sm';
  icon?: string;
  label?: string;
};
export function Button({
  variant = 'default',
  size = 'md',
  icon,
  label,
  children,
  ...rest
}: BtnProps): ReactNode {
  const iconOnly = !!icon && !children;
  return (
    <button
      type="button"
      className="lv-btn"
      data-variant={variant}
      data-size={size}
      data-icon={iconOnly ? '' : undefined}
      aria-label={iconOnly ? label : undefined}
      title={iconOnly ? label : undefined}
      {...rest}
    >
      {icon ? <Icon name={icon} size={18} /> : null}
      {children}
    </button>
  );
}

export function Card({
  title,
  actions,
  children,
  ...rest
}: { title?: ReactNode; actions?: ReactNode; children: ReactNode } & Record<
  `data-${string}`,
  string | undefined
>): ReactNode {
  return (
    <section className="lv-card" {...rest}>
      {title || actions ? (
        <header>
          {title ? <h2>{title}</h2> : <span />}
          {actions ? <div className="lv-row">{actions}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function Badge({
  tone,
  children,
}: {
  tone?: 'ok' | 'warn' | 'danger';
  children: ReactNode;
}): ReactNode {
  return (
    <span className="lv-badge" data-tone={tone}>
      {children}
    </span>
  );
}

export function Stat({
  label,
  value,
  note,
  ...rest
}: { label: string; value: ReactNode; note?: ReactNode } & Record<
  `data-${string}`,
  string | undefined
>): ReactNode {
  return (
    <div className="lv-stat" {...rest}>
      <span className="lv-stat-label">{label}</span>
      <span className="lv-stat-value">{value}</span>
      {note ? <span className="lv-stat-note">{note}</span> : null}
    </div>
  );
}

export function Notice({
  tone,
  children,
}: {
  tone?: 'warn' | 'danger' | 'ok';
  children: ReactNode;
}): ReactNode {
  return (
    <div className="lv-notice" data-tone={tone} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon name="info" size={18} />
      <div>{children}</div>
    </div>
  );
}

// ------------------------------------------------------------------ fields

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: (id: string, hintId: string | undefined) => ReactNode;
}): ReactNode {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className="lv-field">
      <label htmlFor={id}>{label}</label>
      {children(id, hintId)}
      {hint ? (
        <span className="lv-hint" id={hintId}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}

export function TextField({
  label,
  hint,
  value,
  onChange,
  type = 'text',
  ...rest
}: { label: string; hint?: string; value: string; onChange: (v: string) => void; type?: string } & Record<
  `data-${string}`,
  string | undefined
>): ReactNode {
  return (
    <Field label={label} hint={hint}>
      {(id, hintId) => (
        <input
          id={id}
          aria-describedby={hintId}
          className="lv-input"
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          {...rest}
        />
      )}
    </Field>
  );
}

/** Number input that keeps the raw text while typing and commits a parsed number. */
function useNumberText(
  value: number,
  format: (v: number) => string,
  parse: (s: string) => number,
  onChange: (v: number) => void,
  /**
   * Optional range rule. While typing, a value outside the range is held back (so typing "2030" into a
   * year field does not save 1990 along the way); on blur it is pulled into range and saved.
   */
  range?: { accept: (v: number) => boolean; settle: (v: number) => number },
): { text: string; set: (s: string) => void; blur: () => void; invalid: boolean } {
  const [text, setText] = useState(() => format(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(format(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const typed = parse(text);
  return {
    text,
    invalid: focused.current && Number.isFinite(typed) && !!range && !range.accept(typed),
    set: (s) => {
      focused.current = true;
      setText(s);
      const n = parse(s);
      if (Number.isFinite(n) && (!range || range.accept(n)) && n !== value) onChange(n);
    },
    blur: () => {
      focused.current = false;
      const n = parse(text);
      if (Number.isFinite(n) && range) {
        const settled = range.settle(n);
        if (settled !== value) onChange(settled);
        setText(format(settled));
        return;
      }
      setText(format(value));
    },
  };
}

const parseLoose = (s: string): number => {
  const t = s.replace(/[$,%\s]/g, '');
  if (t === '' || t === '-' || t === '.') return NaN;
  return Number(t);
};

/** Money field. `cents` in and out (plan files store integer cents). */
export function MoneyField({
  label,
  hint,
  cents,
  onChange,
  ...rest
}: { label: string; hint?: string; cents: number; onChange: (cents: number) => void } & Record<
  `data-${string}`,
  string | undefined
>): ReactNode {
  const n = useNumberText(
    cents,
    (c) => (c / 100).toLocaleString('en-US', { maximumFractionDigits: 2 }),
    (s) => Math.round(parseLoose(s) * 100),
    onChange,
  );
  return (
    <Field label={label} hint={hint}>
      {(id, hintId) => (
        <div className="lv-affix">
          <span data-side="left" aria-hidden="true">
            $
          </span>
          <input
            id={id}
            aria-describedby={hintId}
            className="lv-input"
            data-prefix=""
            inputMode="decimal"
            autoComplete="off"
            value={n.text}
            onChange={(e) => n.set(e.target.value)}
            onBlur={n.blur}
            {...rest}
          />
        </div>
      )}
    </Field>
  );
}

/** Percent field. `value` is a decimal (0.07 = 7%). */
export function PercentField({
  label,
  hint,
  value,
  onChange,
  digits = 2,
  ...rest
}: { label: string; hint?: string; value: number; onChange: (v: number) => void; digits?: number } & Record<
  `data-${string}`,
  string | undefined
>): ReactNode {
  const n = useNumberText(
    value,
    (v) => String(+(v * 100).toFixed(digits)),
    (s) => parseLoose(s) / 100,
    onChange,
  );
  return (
    <Field label={label} hint={hint}>
      {(id, hintId) => (
        <div className="lv-affix">
          <input
            id={id}
            aria-describedby={hintId}
            className="lv-input"
            data-suffix=""
            inputMode="decimal"
            autoComplete="off"
            value={n.text}
            onChange={(e) => n.set(e.target.value)}
            onBlur={n.blur}
            {...rest}
          />
          <span data-side="right" aria-hidden="true">
            %
          </span>
        </div>
      )}
    </Field>
  );
}

export function NumberField({
  label,
  hint,
  value,
  onChange,
  min,
  max,
  ...rest
}: {
  label: string;
  hint?: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
} & Record<`data-${string}`, string | undefined>): ReactNode {
  const clamp = (v: number): number => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
  const n = useNumberText(
    value,
    (v) => String(v),
    (s) => {
      const v = parseLoose(s);
      return Number.isFinite(v) ? Math.round(v) : NaN;
    },
    onChange,
    { accept: (v) => v === clamp(v), settle: clamp },
  );
  return (
    <Field label={label} hint={hint}>
      {(id, hintId) => (
        <input
          id={id}
          aria-describedby={hintId}
          className="lv-input"
          inputMode="numeric"
          autoComplete="off"
          value={n.text}
          aria-invalid={n.invalid || undefined}
          onChange={(e) => n.set(e.target.value)}
          onBlur={n.blur}
          onKeyDown={(e) => {
            if (e.key === 'Enter') n.blur();
          }}
          {...rest}
        />
      )}
    </Field>
  );
}

export function SelectField<T extends string>({
  label,
  hint,
  value,
  onChange,
  options,
  ...rest
}: {
  label: string;
  hint?: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
} & Record<`data-${string}`, string | undefined>): ReactNode {
  return (
    <Field label={label} hint={hint}>
      {(id, hintId) => (
        <select
          id={id}
          aria-describedby={hintId}
          className="lv-select"
          value={value}
          onChange={(e) => onChange(e.target.value as T)}
          {...rest}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

export function Switch({
  label,
  checked,
  onChange,
  ...rest
}: { label: string; checked: boolean; onChange: (v: boolean) => void } & Record<
  `data-${string}`,
  string | undefined
>): ReactNode {
  return (
    <label className="lv-switch" {...rest}>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function Slider({
  label,
  value,
  onChange,
  min,
  max,
  step,
  format,
  ...rest
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
} & Record<`data-${string}`, string | undefined>): ReactNode {
  const id = useId();
  return (
    <div className="lv-field" {...rest}>
      <div className="lv-spread">
        <label htmlFor={id}>{label}</label>
        <span className="lv-num">{format ? format(value) : value}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-valuetext={format ? format(value) : undefined}
        style={{ width: '100%', accentColor: 'var(--primary)', minHeight: 32 }}
      />
    </div>
  );
}

// ------------------------------------------------------------------ tabs

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}): ReactNode {
  return (
    <div className="lv-tabs" role="tablist" aria-label={label}>
      {tabs.map((t, i) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          className="lv-tab"
          aria-selected={t.id === value}
          tabIndex={t.id === value ? 0 : -1}
          data-tour={`tab-${t.id}`}
          onClick={() => onChange(t.id)}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
            const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
            onChange(next.id);
            const el = e.currentTarget.parentElement?.children[tabs.indexOf(next)] as HTMLElement | undefined;
            el?.focus();
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ dialog (modal on desktop, bottom sheet on phones)

export function Dialog({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const focusables = (): HTMLElement[] =>
      Array.from(
        el?.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((x) => !x.hasAttribute('disabled') && x.getClientRects().length > 0);
    (
      focusables().find((x) => x.tagName === 'INPUT' || x.tagName === 'SELECT') ??
      focusables()[0] ??
      el
    )?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      } else if (e.key === 'Tab') {
        const f = focusables();
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    // Belt and braces: if focus ever lands outside every dialog, bring it back.
    const onFocusIn = (e: FocusEvent): void => {
      const t = e.target as HTMLElement | null;
      if (el && t && !el.contains(t) && !t.closest?.('[role="dialog"]')) (focusables()[0] ?? el).focus();
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusin', onFocusIn);
      prev?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  if (!open) return null;
  // A plain portal (not FloatingPortal, which mounts a tick late) so the dialog exists when the focus effect runs.
  return createPortal(
    <div
      className="lv-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="lv-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={ref}
        tabIndex={-1}
      >
        <header>
          <h2 id={titleId}>{title}</h2>
          <Button variant="ghost" icon="close" label="Close" onClick={onClose} />
        </header>
        <div className="lv-dialog-body">{children}</div>
        {footer ? <footer>{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}

// ------------------------------------------------------------------ popover (also the tour engine's primitive)

export function Popover({
  trigger,
  children,
  placement = 'bottom',
  label,
}: {
  trigger: (props: Record<string, unknown>) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  placement?: Placement;
  label: string;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
    whileElementsMounted: autoUpdate,
    middleware: [offset(8), flip(), shift({ padding: 12 })],
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([
    useClick(context),
    useDismiss(context),
    useRole(context, { role: 'dialog' }),
  ]);
  return (
    <>
      {trigger({ ref: refs.setReference, ...getReferenceProps() })}
      {open ? (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false}>
            <div
              ref={refs.setFloating}
              style={floatingStyles}
              className="lv-popover"
              aria-label={label}
              {...getFloatingProps()}
            >
              {typeof children === 'function' ? children(() => setOpen(false)) : children}
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      ) : null}
    </>
  );
}

/** "How was this worked out?" button that opens a breakdown (UX-04). */
export function Explain({
  title,
  lines,
  total,
  source,
}: {
  title: string;
  lines: { label: string; amount: number }[];
  total: number;
  source?: string;
}): ReactNode {
  return (
    <Popover
      label={title}
      trigger={(p) => (
        <button
          type="button"
          className="lv-btn"
          data-variant="ghost"
          data-size="sm"
          data-icon=""
          aria-label={`How ${title} is worked out`}
          data-tour="explain-button"
          {...p}
        >
          <Icon name="info" size={16} />
        </button>
      )}
    >
      <div className="lv-stack" style={{ gap: 8 }}>
        <strong>{title}</strong>
        <div className="lv-explain">
          {lines.map((l) => (
            <span key={l.label} style={{ display: 'contents' }}>
              <span>{l.label}</span>
              <span style={{ textAlign: 'right' }}>
                {l.amount < 0 ? `− ${formatMoney(-l.amount)}` : formatMoney(l.amount)}
              </span>
            </span>
          ))}
          <span className="lv-total">Result</span>
          <span className="lv-total" style={{ textAlign: 'right' }}>
            {formatMoney(total)}
          </span>
        </div>
        {source ? <span className="lv-muted lv-small">{source}</span> : null}
      </div>
    </Popover>
  );
}
