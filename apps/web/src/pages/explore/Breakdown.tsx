/** What a bar is made of: the drill-down shared by Cash flow and Taxes (see lib/metrics/breakdown.ts). */
import './breakdown.css';
import { Button, Icon, formatMoney, formatPct } from '@fisim/ui';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { Breakdown, BreakdownKey } from '../../lib/metrics/breakdown';

const signed = (v: number): string => `${v >= 0 ? '+' : '−'}${formatMoney(Math.abs(v))}`;
const amount = (v: number): string => (v < 0 ? `−${formatMoney(-v)}` : formatMoney(v));

/**
 * After a chart click on a narrow screen the answer sits below the fold: bring it into view. On a wide screen
 * the panel is already beside the chart and nothing moves.
 */
export function revealBreakdown(selector: string): void {
  requestAnimationFrame(() => {
    const el = document.querySelector(selector);
    if (!el) return;
    const box = el.getBoundingClientRect();
    if (box.top < window.innerHeight - 140 && box.bottom > 0) return;
    el.scrollIntoView({
      block: 'start',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  });
}

export function BreakdownPanel({
  breakdown: b,
  unit,
  colors = {},
  color,
  keys,
  onKey,
  onClose,
  closeLabel = 'Close',
  bare = false,
  showFacts = true,
}: {
  breakdown: Breakdown;
  /** "today's dollars" or "future dollars". */
  unit: string;
  /** Bar colour per line id or per category a line opens (CSS colours). */
  colors?: Partial<Record<string, string>>;
  /** Bar colour for lines without their own. */
  color?: string;
  /** The categories that can be shown here, as a row of buttons (the keyboard's way to pick one). */
  keys?: { key: BreakdownKey; label: string }[];
  onKey?: (key: BreakdownKey) => void;
  onClose?: () => void;
  closeLabel?: string;
  /** Leave out the heading row (the host already shows the year and total). */
  bare?: boolean;
  showFacts?: boolean;
}): ReactNode {
  const largest = Math.max(1, ...b.lines.map((l) => Math.abs(l.amount)));
  const change = b.previousTotal === null ? null : b.total - b.previousTotal;
  const title = `${b.label} in ${b.year}`;
  const here = useLocation().pathname;
  return (
    <section className="bd" aria-label={`${title}: what it is made of`}>
      {/* Announced when the year or category changes, so a chart click is not silent. */}
      <div className={bare ? 'lv-sr' : 'bd-head'} aria-live="polite">
        <h3>{title}</h3>
        <span className="bd-total">{amount(b.total)}</span>
        {!bare && onClose ? (
          <Button size="sm" variant="ghost" icon="close" label={closeLabel} onClick={onClose} />
        ) : null}
      </div>
      {keys && onKey ? (
        <div className="bd-keys" role="group" aria-label="Show the breakdown of">
          {keys.map((k) => (
            <button key={k.key} type="button" aria-pressed={k.key === b.key} onClick={() => onKey(k.key)}>
              <i style={{ background: colors[k.key] ?? 'var(--ink-3)' }} aria-hidden="true" />
              {k.label}
            </button>
          ))}
        </div>
      ) : null}

      {b.lines.length === 0 ? (
        <p className="lv-muted lv-small bd-empty">
          Nothing under {b.label.toLowerCase()} in {b.year}.
        </p>
      ) : (
        <ul className="bd-lines">
          {b.lines.map((l) => {
            const fill = colors[l.drill ?? l.id] ?? color ?? 'var(--primary)';
            const share = b.total > 0 && l.amount > 0 ? l.amount / b.total : null;
            const body = (
              <>
                <span className="bd-line-top">
                  <span className="bd-line-label">
                    {l.label}
                    {l.drill && onKey ? <Icon name="chevron" size={13} /> : null}
                  </span>
                  <span className="bd-line-amount">{amount(l.amount)}</span>
                  <span className="bd-line-share">
                    {l.amount < 0 ? 'credit' : share === null ? '' : formatPct(share)}
                  </span>
                </span>
                <span className="bd-bar" aria-hidden="true">
                  <i
                    data-credit={l.amount < 0 || undefined}
                    style={{
                      width: `${Math.max(1.5, (Math.abs(l.amount) / largest) * 100)}%`,
                      background: fill,
                    }}
                  />
                </span>
                {l.note ? <span className="bd-line-note">{l.note}</span> : null}
              </>
            );
            return (
              <li key={l.id}>
                {l.drill && onKey ? (
                  <button
                    type="button"
                    className="bd-line"
                    onClick={() => onKey(l.drill!)}
                    title={`See what makes up ${l.label.toLowerCase()}`}
                  >
                    {body}
                  </button>
                ) : (
                  <div className="bd-line">{body}</div>
                )}
                {!l.drill && l.route ? (
                  <Link
                    className="bd-line-edit"
                    to={l.route}
                    aria-label={`Edit the inputs behind ${l.label}`}
                    title="Edit the inputs behind this"
                  >
                    <Icon name="edit" size={13} />
                  </Link>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {b.previousYear === null ? (
        <p className="lv-muted lv-small bd-empty">
          First year of the plan: there is no earlier year to compare.
        </p>
      ) : (
        <div className="bd-changes">
          <h4>
            Since {b.previousYear}
            {change !== null ? (
              <span className="bd-delta" data-dir={change > 0.5 ? 'up' : change < -0.5 ? 'down' : 'flat'}>
                {Math.abs(change) < 0.5 ? 'no change' : signed(change)}
              </span>
            ) : null}
          </h4>
          {b.changes.length === 0 ? (
            <p className="lv-muted lv-small">No single line moved by much.</p>
          ) : (
            <ul>
              {b.changes.map((c) => (
                <li key={c.id} data-dir={c.delta > 0 ? 'up' : 'down'}>
                  <Icon name={c.delta > 0 ? 'trendUp' : 'trendDown'} size={14} />
                  <span>
                    <strong>
                      {c.label} {signed(c.delta)}
                    </strong>
                    {c.reason ? <span className="bd-reason">{c.reason}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {showFacts && b.facts.length ? (
        <dl className="lv-facts bd-facts">
          {b.facts.map((f) => (
            <div key={f.label}>
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      <p className="bd-foot lv-small lv-muted">
        {b.notes.join(' ')} Amounts in {unit}.{' '}
        {b.route === here ? null : <Link to={b.route}>{b.routeLabel} →</Link>}
      </p>
    </section>
  );
}
