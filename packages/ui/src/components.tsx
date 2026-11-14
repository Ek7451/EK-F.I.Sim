/** Longview components: accessible primitives with our own styling (plan 10). */
import {
  FloatingFocusManager,
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  safePolygon,
  useClick,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useRole,
  type Placement,
} from '@floating-ui/react';
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
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
// `|| 0` turns a rounded negative zero into zero, so a few cents below nothing never prints as "-$0".
export const formatMoney = (dollars: number): string =>
  Number.isFinite(dollars) ? usd0.format(Math.round(dollars) || 0) : '—';
export const formatCompact = (dollars: number): string =>
  Number.isFinite(dollars)
    ? Math.abs(dollars) < 10000
      ? usd0.format(Math.round(dollars) || 0)
      : compact.format(dollars)
    : '—';
export const formatPct = (v: number, digits = 0): string =>
  Number.isFinite(v) ? `${(v * 100).toFixed(digits)}%` : '—';
/**
 * A share of runs or outcomes. Whole percent, except near the ends: 99.6% must not read as "100%" while failures
 * are listed beside it, nor 0.4% as "0%". Only an exact 1 or 0 prints as 100% or 0%.
 */
export const formatShare = (v: number): string => {
  if (!Number.isFinite(v)) return '—';
  if ((v >= 0.995 && v < 1) || (v > 0 && v < 0.005)) {
    const one = Math.min(99.9, Math.max(0.1, Math.floor(v * 1000) / 10));
    return `${one.toFixed(1)}%`;
  }
  return `${(v * 100).toFixed(0)}%`;
};
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
  // navigation and screens
  projection: 'M3 20h18M4 16c3-1 5-6 8-6s5 3 8-4',
  cashflow: 'M4 7h12l-3-3M20 17H8l3 3',
  taxes: 'M7 3h10v18l-2.5-1.5L12 21l-2.5-1.5L7 21zM10 8h4M10 12h4M9.5 16l5-5',
  success: 'M12 21a9 9 0 110-18 9 9 0 010 18zM12 17a5 5 0 110-10 5 5 0 010 10zM12 13a1 1 0 100-2',
  history: 'M3 12a9 9 0 103-6.7M3 4v4h4M12 7v5l3 2',
  estate: 'M4 21h16M5 21V10l7-5 7 5v11M9 21v-6h6v6',
  household:
    'M8 11a3 3 0 100-6 3 3 0 000 6zM16 11a3 3 0 100-6 3 3 0 000 6zM2 20c0-3 3-5 6-5s6 2 6 5M14 15c3 0 8 1 8 5',
  wallet: 'M4 7h15a1 1 0 011 1v11H4a1 1 0 01-1-1V6a2 2 0 012-2h11v3M16 13h.01',
  income: 'M12 3v18M16 7c0-1.7-1.8-3-4-3s-4 1.3-4 3 1.8 2.6 4 3 4 1.3 4 3-1.8 3-4 3-4-1.3-4-3',
  spending: 'M3 6h3l2 10h10l2-7H7M10 20h.01M17 20h.01',
  timeline: 'M3 12h18M7 8v8M12 6v12M17 9v6',
  strategy: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4',
  health: 'M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10z',
  assumptions: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M2 14h4M10 8h4M18 16h4',
  progress: 'M12 21a9 9 0 119-9M12 12l5-5M16 3h5v5',
  // item types
  bank: 'M3 9l9-5 9 5M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 21h18',
  piggy: 'M5 11a7 6 0 0113-2h2v4h-2a7 6 0 01-3 3v3h-3v-2H9v2H6v-3.5A6 6 0 015 11zM15 10h.01',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  heart: 'M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10z',
  briefcase: 'M4 8h16v11H4zM9 8V5h6v3M4 13h16',
  coin: 'M12 21a9 9 0 110-18 9 9 0 010 18zM9.5 14.5c.4 1 1.3 1.5 2.5 1.5 1.4 0 2.5-.7 2.5-1.8 0-2.6-5-1.3-5-4 0-1 1-1.7 2.5-1.7 1.1 0 2 .5 2.4 1.3M12 6.5v1.5M12 16v1.5',
  car: 'M5 16l1.5-5.5A2 2 0 018.4 9h7.2a2 2 0 011.9 1.5L19 16M3 16h18v3H3zM7 19v2M17 19v2',
  school: 'M2 9l10-5 10 5-10 5zM6 11v5c3 2 9 2 12 0v-5M22 9v6',
  gift: 'M4 11h16v10H4zM3 7h18v4H3zM12 7v14M12 7c-1.5-3-5-3-5-1s3 1 5 1c2 0 5 1 5-1s-3.5-2-5 1',
  calendar: 'M4 6h16v15H4zM4 10h16M8 3v5M16 3v5',
  target: 'M12 21a9 9 0 110-18 9 9 0 010 18zM12 16a4 4 0 110-8 4 4 0 010 8zM12 12h.01',
  card: 'M3 6h18v12H3zM3 10h18M7 15h4',
  trendUp: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  trendDown: 'M3 7l6 6 4-4 8 8M15 17h6v-6',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  clock: 'M12 21a9 9 0 110-18 9 9 0 010 18zM12 7v5l3 2',
  user: 'M12 11a4 4 0 100-8 4 4 0 000 8zM4 21c0-4 3.6-7 8-7s8 3 8 7',
  sparkle: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6',
  panel: 'M4 4h16v16H4zM9 4v16',
  search: 'M11 18a7 7 0 110-14 7 7 0 010 14zM20 20l-4-4',
  percent: 'M19 5L5 19M7 9a2 2 0 100-4 2 2 0 000 4zM17 19a2 2 0 100-4 2 2 0 000 4z',
  leaf: 'M5 19c0-9 6-14 15-14 0 9-5 15-14 15M5 19l7-7',
  warning: 'M12 4l9 16H3zM12 10v4M12 17h.01',
  // life events and timeline lanes
  child: 'M12 8.5a2.75 2.75 0 100-5.5 2.75 2.75 0 000 5.5zM6 13l6-2 6 2M12 11v6M9 21l3-4 3 4',
  pin: 'M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0113 0c0 5.4-6.5 11-6.5 11zM12 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z',
  compass: 'M12 21a9 9 0 110-18 9 9 0 010 18zM15.5 8.5l-2 5-5 2 2-5z',
  food: 'M7 3v18M4.5 3v5a2.5 2.5 0 005 0V3M17 3c-2 2-3 4.5-3 8h3zM17 11v10',
  plane: 'M3 12l18-8-6 17-3.5-7zM11.5 14L21 4',
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
  variant,
  ...rest
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  /** hero: the screen's headline panel; inset: a quieter panel inside or beside a card. */
  variant?: 'hero' | 'inset';
  id?: string;
} & Record<`data-${string}`, string | undefined>): ReactNode {
  return (
    <section className="lv-card" data-variant={variant} {...rest}>
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

/**
 * A card that folds down to its title row. The row always shows what the section currently says (`summary`),
 * so a folded section still answers "what is set here?" without being opened. Open state is remembered per
 * `storageKey` for the browser session.
 */
export function Fold({
  title,
  summary,
  icon,
  kind,
  defaultOpen = false,
  storageKey,
  actions,
  children,
  ...rest
}: {
  title: ReactNode;
  /** The section's current settings in a few words, shown beside the title (and when folded). */
  summary?: ReactNode;
  icon?: string;
  kind?: 'account' | 'income' | 'expense' | 'milestone' | 'debt';
  defaultOpen?: boolean;
  storageKey?: string;
  /** Controls that stay visible on the title row (they do not toggle the fold). */
  actions?: ReactNode;
  children: ReactNode;
  id?: string;
} & Record<`data-${string}`, string | undefined>): ReactNode {
  const key = storageKey ? `lv-fold:${storageKey}` : null;
  const [open, setOpen] = useState<boolean>(() => {
    if (!key) return defaultOpen;
    try {
      const saved = sessionStorage.getItem(key);
      return saved === null ? defaultOpen : saved === '1';
    } catch {
      return defaultOpen;
    }
  });
  return (
    <details
      className="lv-card lv-fold"
      open={open}
      onToggle={(e) => {
        const next = (e.currentTarget as HTMLDetailsElement).open;
        setOpen(next);
        if (key)
          try {
            sessionStorage.setItem(key, next ? '1' : '0');
          } catch {
            /* private mode: the fold simply is not remembered */
          }
      }}
      {...rest}
    >
      <summary>
        {icon ? <IconTile icon={icon} kind={kind} /> : null}
        <h2>{title}</h2>
        {summary ? <span className="lv-fold-summary">{summary}</span> : <span className="lv-fold-summary" />}
        {actions ? <span className="lv-fold-actions-room" aria-hidden="true" /> : null}
        <span className="lv-fold-chevron" aria-hidden="true">
          <Icon name="down" size={16} />
        </span>
      </summary>
      {/* Controls for an open section sit on its title row but outside the summary: a button inside a
          summary is a control inside a control, which assistive tech cannot operate. */}
      {actions ? <div className="lv-row lv-fold-actions">{actions}</div> : null}
      <div className="lv-fold-body">{children}</div>
    </details>
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
  size,
  delta,
  icon,
  ...rest
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  /** hero: the screen's headline figure. */
  size?: 'hero';
  /** A change against something stated in words, with its direction (the arrow is never the only signal). */
  delta?: { dir: 'up' | 'down' | 'flat'; text: string };
  icon?: string;
} & Record<`data-${string}`, string | undefined>): ReactNode {
  return (
    <div className="lv-stat" data-size={size} {...rest}>
      <span className="lv-stat-label">
        {icon ? (
          <span className="lv-kpi-icon">
            <Icon name={icon} size={14} />
          </span>
        ) : null}
        {label}
      </span>
      <span className="lv-stat-value">{value}</span>
      {delta ? (
        <span className="lv-delta" data-dir={delta.dir}>
          {delta.dir !== 'flat' ? (
            <Icon name={delta.dir === 'up' ? 'trendUp' : 'trendDown'} size={14} />
          ) : null}
          {delta.text}
        </span>
      ) : null}
      {note ? <span className="lv-stat-note">{note}</span> : null}
    </div>
  );
}

/** A strip of key figures in one panel, divided by hairlines (each child is usually a Stat). */
export function KpiStrip({
  children,
  ...rest
}: { children: ReactNode } & Record<`data-${string}`, string | undefined>): ReactNode {
  return (
    <section className="lv-kpis" {...rest}>
      {children}
    </section>
  );
}

/** A line icon on a softly tinted square that marks an item's type, always beside its name. */
export function IconTile({
  icon,
  kind = 'account',
}: {
  icon: string;
  kind?: 'account' | 'income' | 'expense' | 'milestone' | 'debt';
}): ReactNode {
  return (
    <span className="lv-tile" data-kind={kind} aria-hidden="true">
      <Icon name={icon} size={18} />
    </span>
  );
}

/** A placeholder block while something loads. */
export function Skeleton({
  height = 16,
  width = '100%',
}: {
  height?: number;
  width?: number | string;
}): ReactNode {
  return <span className="lv-skeleton" style={{ height, width }} aria-hidden="true" />;
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

/**
 * Where fields find their help text when they are not given a `help` prop: the app provides a lookup by
 * label, so every field with a known label gets an (i) without each screen wiring it up. Pass
 * `help={null}` to a field to switch it off.
 */
const HelpLookup = createContext<(label: string) => ReactNode>(() => undefined);
export const HelpProvider = HelpLookup.Provider;
function useHelp(label: string, help: ReactNode | undefined): ReactNode {
  const lookup = useContext(HelpLookup);
  return help === undefined ? lookup(label) : help;
}

/**
 * A small (i) button beside a label. The explanation opens on hover, on keyboard focus and on tap, and
 * closes with Escape or by moving away. It is text only (no links), so it can be a tooltip.
 */
export function HelpTip({
  children,
  describedBy,
  placement = 'top',
}: {
  children: ReactNode;
  /** Id of the label this help is about, so assistive tech reads "Help, <label>". */
  describedBy?: string;
  placement?: Placement;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const tipId = useId();
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
    whileElementsMounted: autoUpdate,
    middleware: [offset(6), flip(), shift({ padding: 12 })],
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([
    useHover(context, { delay: { open: 120, close: 60 }, handleClose: safePolygon() }),
    useFocus(context),
    useClick(context, { ignoreMouse: true }),
    useDismiss(context),
    useRole(context, { role: 'tooltip' }),
  ]);
  return (
    <>
      <button
        type="button"
        className="lv-help"
        aria-label="Help"
        aria-describedby={[describedBy, open ? tipId : undefined].filter(Boolean).join(' ') || undefined}
        aria-expanded={open}
        data-help=""
        ref={refs.setReference}
        {...getReferenceProps()}
      >
        <Icon name="info" size={15} />
      </button>
      {open ? (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            id={tipId}
            className="lv-helptip"
            style={floatingStyles}
            {...getFloatingProps()}
          >
            {typeof children === 'string'
              ? children.split('\n\n').map((p, i) => <p key={i}>{p}</p>)
              : children}
          </div>
        </FloatingPortal>
      ) : null}
    </>
  );
}

export function Field({
  label,
  hint,
  help,
  children,
}: {
  label: string;
  hint?: string;
  /** Longer explanation shown from an (i) button beside the label. */
  help?: ReactNode;
  children: (id: string, hintId: string | undefined) => ReactNode;
}): ReactNode {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const helpBody = useHelp(label, help);
  return (
    <div className="lv-field">
      {helpBody ? (
        <div className="lv-label-row">
          <label htmlFor={id} id={`${id}-label`}>
            {label}
          </label>
          <HelpTip describedBy={`${id}-label`}>{helpBody}</HelpTip>
        </div>
      ) : (
        <label htmlFor={id}>{label}</label>
      )}
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
  help,
  value,
  onChange,
  type = 'text',
  ...rest
}: {
  label: string;
  hint?: string;
  help?: ReactNode;
  value: string;
  onChange: (v: string) => void;
  type?: string;
} & Record<`data-${string}`, string | undefined>): ReactNode {
  return (
    <Field label={label} hint={hint} help={help}>
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
  help,
  cents,
  onChange,
  ...rest
}: {
  label: string;
  hint?: string;
  help?: ReactNode;
  cents: number;
  onChange: (cents: number) => void;
} & Record<`data-${string}`, string | undefined>): ReactNode {
  const n = useNumberText(
    cents,
    (c) => (c / 100).toLocaleString('en-US', { maximumFractionDigits: 2 }),
    (s) => Math.round(parseLoose(s) * 100),
    onChange,
  );
  return (
    <Field label={label} hint={hint} help={help}>
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
  help,
  value,
  onChange,
  digits = 2,
  ...rest
}: {
  label: string;
  hint?: string;
  help?: ReactNode;
  value: number;
  onChange: (v: number) => void;
  digits?: number;
} & Record<`data-${string}`, string | undefined>): ReactNode {
  const n = useNumberText(
    value,
    (v) => String(+(v * 100).toFixed(digits)),
    // Trim binary noise at the door: 1.1 / 100 is 0.011000000000000001, and that must not be what is saved.
    (s) => +(parseLoose(s) / 100).toFixed(8),
    onChange,
  );
  return (
    <Field label={label} hint={hint} help={help}>
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
  help,
  value,
  onChange,
  min,
  max,
  ...rest
}: {
  label: string;
  hint?: string;
  help?: ReactNode;
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
    <Field label={label} hint={hint} help={help}>
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
  help,
  value,
  onChange,
  options,
  ...rest
}: {
  label: string;
  hint?: string;
  help?: ReactNode;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
} & Record<`data-${string}`, string | undefined>): ReactNode {
  return (
    <Field label={label} hint={hint} help={help}>
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
  help,
  checked,
  onChange,
  ...rest
}: { label: string; help?: ReactNode; checked: boolean; onChange: (v: boolean) => void } & Record<
  `data-${string}`,
  string | undefined
>): ReactNode {
  const id = useId();
  const helpBody = useHelp(label, help);
  const sw = (
    <label className="lv-switch" {...rest}>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span id={`${id}-label`}>{label}</span>
    </label>
  );
  return helpBody ? (
    <span className="lv-label-row">
      {sw}
      <HelpTip describedBy={`${id}-label`}>{helpBody}</HelpTip>
    </span>
  ) : (
    sw
  );
}

export function Slider({
  label,
  help,
  value,
  onChange,
  min,
  max,
  step,
  format,
  ...rest
}: {
  label: string;
  help?: ReactNode;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
} & Record<`data-${string}`, string | undefined>): ReactNode {
  const id = useId();
  const helpBody = useHelp(label, help);
  return (
    <div className="lv-field" {...rest}>
      <div className="lv-spread">
        <span className="lv-label-row">
          <label htmlFor={id} id={`${id}-label`}>
            {label}
          </label>
          {helpBody ? <HelpTip describedBy={`${id}-label`}>{helpBody}</HelpTip> : null}
        </span>
        <span className="lv-range-value">
          {format ? format(value) : Number.isInteger(value) ? value : +value.toFixed(4)}
        </span>
      </div>
      <input
        id={id}
        type="range"
        className="lv-range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(+Number(e.target.value).toFixed(8))}
        aria-valuetext={format ? format(value) : undefined}
        style={{ ['--fill' as string]: `${max > min ? ((value - min) / (max - min)) * 100 : 0}%` }}
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

/** A compact one-of-several switch (for a view or a unit), shown as pills in a tray. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  ...rest
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
} & Record<`data-${string}`, string | undefined>): ReactNode {
  return (
    <div className="lv-segmented" role="group" aria-label={label} {...rest}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export interface MenuItem {
  id: string;
  label: ReactNode;
  icon?: string;
  /** Shown as the selected choice (menuitemradio). */
  checked?: boolean;
  onSelect: () => void;
  /** Draws a divider above this item. */
  divider?: boolean;
}

/** A button that opens a list of actions or choices (keyboard: arrows, Enter, Escape). */
export function Menu({
  trigger,
  items,
  label,
  placement = 'bottom-start',
}: {
  trigger: (props: Record<string, unknown> & { open: boolean }) => ReactNode;
  items: MenuItem[];
  label: string;
  placement?: Placement;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
    whileElementsMounted: autoUpdate,
    middleware: [offset(6), flip(), shift({ padding: 12 })],
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([
    useClick(context),
    useDismiss(context),
    useRole(context, { role: 'menu' }),
  ]);
  const radio = items.some((i) => i.checked !== undefined);
  const move = (by: number): void => {
    const els = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []);
    const i = els.indexOf(document.activeElement as HTMLElement);
    els[(i + by + els.length) % els.length]?.focus();
  };
  return (
    <>
      {trigger({ ref: refs.setReference, open, ...getReferenceProps() })}
      {open ? (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false} initialFocus={0}>
            <div
              ref={(n) => {
                refs.setFloating(n);
                listRef.current = n;
              }}
              style={floatingStyles}
              className="lv-menu"
              aria-label={label}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  move(1);
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  move(-1);
                }
              }}
              {...getFloatingProps()}
            >
              {items.map((it) => (
                <div key={it.id}>
                  {it.divider ? <hr /> : null}
                  <button
                    type="button"
                    role={radio ? 'menuitemradio' : 'menuitem'}
                    aria-checked={radio ? !!it.checked : undefined}
                    onClick={() => {
                      setOpen(false);
                      it.onSelect();
                    }}
                  >
                    {it.icon ? <Icon name={it.icon} size={16} /> : null}
                    <span className="lv-ellipsis" style={{ flex: 1 }}>
                      {it.label}
                    </span>
                    {it.checked ? <Icon name="check" size={16} /> : null}
                  </button>
                </div>
              ))}
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      ) : null}
    </>
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
      <div className="lv-explain-card">
        <strong className="lv-explain-title">{title.charAt(0).toUpperCase() + title.slice(1)}</strong>
        <div className="lv-explain">
          {lines.map((l) => (
            <span key={l.label} style={{ display: 'contents' }}>
              <span>{l.label}</span>
              <span data-sign={l.amount < 0 ? 'minus' : undefined}>
                {l.amount < 0 ? `− ${formatMoney(-l.amount)}` : formatMoney(l.amount)}
              </span>
            </span>
          ))}
          <span className="lv-total">Result</span>
          <span className="lv-total">{formatMoney(total)}</span>
        </div>
        {source ? <span className="lv-muted lv-small">{source}</span> : null}
      </div>
    </Popover>
  );
}
