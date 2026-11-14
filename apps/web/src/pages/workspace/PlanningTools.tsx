import type { Milestone, Plan, ProjectionResult } from '@fisim/engine';
import {
  Badge,
  Button,
  Card,
  Dialog,
  Icon,
  IconTile,
  Segmented,
  Slider,
  TextField,
  formatMoney,
  formatPct,
} from '@fisim/ui';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { scenarioChanges, useDraft } from '../../state/draft';
import { describeChange } from '../../lib/scenarioSummary';
import { useStore } from '../../state/store';
import { usePlanView } from '../../state/workspace';
import { outcomeDelta } from '../../lib/metrics';

export function useCompactWorkspace(): boolean {
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 1280px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1280px)');
    const change = (): void => setCompact(mq.matches);
    mq.addEventListener('change', change);
    return () => mq.removeEventListener('change', change);
  }, []);
  return compact;
}

export function WorkspaceInspector({
  compact,
  open,
  onClose,
  children,
  footer,
}: {
  compact: boolean;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}): ReactNode {
  if (compact)
    return (
      <Dialog open={open} title="Plan details" onClose={onClose} footer={footer}>
        {children}
      </Dialog>
    );
  return open ? (
    <aside className="workspace-inspector" aria-label="Plan details">
      {children}
    </aside>
  ) : null;
}

export function milestoneYear(plan: Plan, m: Milestone, result: ProjectionResult): number | null {
  if (m.when.type === 'year') return m.when.year;
  if (m.when.type === 'age') {
    const personId = m.when.personId;
    const person = plan.people.find((p) => p.id === personId);
    return person ? Number(person.birthDate.slice(0, 4)) + m.when.age : null;
  }
  return result.milestoneYears[m.id] ?? null;
}

/** Keep incomplete/invalid text local; the most recent valid model remains visible. */
function PrecisionField({
  label,
  value,
  min,
  max,
  onChange,
  decimals = false,
  money = false,
  note,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  decimals?: boolean;
  /** Show a $ before the figure. */
  money?: boolean;
  /** A few words under the field (for example "a year"). */
  note?: string;
  onChange: (value: number) => void;
}): ReactNode {
  const id = useId();
  const resetId = useDraft((s) => s.resetId);
  const show = (v: number): string => (Number.isInteger(v) ? String(v) : String(+v.toFixed(2)));
  const [text, setText] = useState(show(value));
  const [error, setError] = useState('');
  useEffect(() => {
    setText(show(value));
    setError('');
    useDraft.getState().setInvalid(id, false);
  }, [value, id, resetId]);
  useEffect(() => () => useDraft.getState().setInvalid(id, false), [id]);
  return (
    <div className="lv-field">
      <label className="lv-label" htmlFor={id}>
        {label}
      </label>
      <div className="lv-affix">
        {money ? (
          <span data-side="left" aria-hidden="true">
            $
          </span>
        ) : null}
        <input
          id={id}
          className="lv-input"
          data-prefix={money ? '' : undefined}
          inputMode={decimals ? 'decimal' : 'numeric'}
          value={text}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : note ? `${id}-note` : undefined}
          onChange={(e) => {
            const next = e.target.value;
            setText(next);
            const parsed = next.replace(/[$,\s]/g, '');
            const n = Number(parsed);
            const invalid =
              !parsed || !Number.isFinite(n) || (!decimals && !Number.isInteger(n)) || n < min || n > max;
            useDraft.getState().setInvalid(id, !!invalid);
            if (invalid) {
              setError(`Enter ${decimals ? 'an amount' : 'a whole number'} from ${min} to ${max}.`);
            } else {
              setError('');
              onChange(n);
            }
          }}
        />
      </div>
      {note && !error ? (
        <span className="lv-hint" id={`${id}-note`}>
          {note}
        </span>
      ) : null}
      {error && (
        <span id={`${id}-error`} className="field-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

export function DraftActions({
  base,
  result,
  baseline,
  stale,
}: {
  base: Plan;
  result: ProjectionResult;
  baseline: ProjectionResult | null;
  stale: boolean;
}): ReactNode {
  const t = useDraft((s) => s.transaction);
  const invalid = useDraft((s) => Object.keys(s.invalidFields).length > 0);
  const [name, setName] = useState('');
  if (!t || t.base.id !== base.id) return null;
  const conflict = t.base !== base;
  const changed = t.plan.milestones.filter(
    (m) => JSON.stringify(m.when) !== JSON.stringify(base.milestones.find((b) => b.id === m.id)?.when),
  );
  const delta = baseline ? outcomeDelta('endingWealth', baseline, result) : null;
  const tax = baseline ? outcomeDelta('lifetimeTaxes', baseline, result) : null;
  const signed = (v: number): string => `${v >= 0 ? '+' : '−'}${formatMoney(Math.abs(v))}`;
  return (
    <section className="draft-bar" aria-label="Draft changes" data-tour="draft-actions">
      <div className="draft-what">
        <p className="draft-headline">
          <Badge tone="warn">Unsaved draft</Badge> <strong>What changed</strong>{' '}
          <span>
            {changed.length
              ? changed
                  .map((m) => {
                    const old = base.milestones.find((b) => b.id === m.id);
                    if (!old) return `Added ${m.name}`;
                    return `${m.name}: ${old.when.type === 'age' ? `age ${old.when.age}` : old.when.type === 'year' ? old.when.year : 'condition'} → ${m.when.type === 'age' ? `age ${m.when.age}` : m.when.type === 'year' ? m.when.year : 'condition'}`;
                  })
                  .join('; ')
              : t.label}
            .
          </span>
        </p>
        <p role="status" className="draft-effect">
          {conflict
            ? 'The saved plan changed. Discard this draft and start again.'
            : stale
              ? 'Updating draft outcomes…'
              : delta === null || tax === null
                ? 'Loading baseline…'
                : `Ending wealth ${signed(delta)} · lifetime taxes ${signed(tax)} vs saved plan, in today's dollars.`}
        </p>
        <details>
          <summary>All changed inputs</summary>
          <ul>
            {scenarioChanges(t.base, t.plan).map((patch, i) => (
              <li key={i}>{describeChange(t.base, patch)}</li>
            ))}
          </ul>
        </details>
      </div>
      <TextField label="Scenario name" value={name} onChange={setName} />
      <div className="draft-actions">
        <Button
          variant="primary"
          disabled={stale || conflict || invalid}
          onClick={() => {
            if (useDraft.getState().apply())
              useStore.getState().notify('Draft applied. Undo restores the previous plan.', 'ok');
          }}
        >
          Apply to plan
        </Button>
        <Button
          disabled={stale || conflict || invalid}
          onClick={() => {
            if (useDraft.getState().saveScenario(name)) {
              setName('');
              useStore.getState().notify('Scenario saved. Your baseline is unchanged.', 'ok');
            }
          }}
        >
          Save as scenario
        </Button>
        <Button variant="ghost" onClick={() => useDraft.getState().discard()}>
          Discard
        </Button>
      </div>
    </section>
  );
}

const COVERAGE_NAMES: Record<string, string> = {
  employer: 'employer plan',
  spouseEmployer: "partner's employer plan",
  cobra: 'COBRA',
  aca: 'marketplace plan',
  medicaid: 'Medicaid',
  medicare: 'Medicare',
  none: 'no coverage',
};

export function PlanningEditor({
  base,
  plan,
  selected,
  onSelect,
  onClose,
}: {
  base: Plan;
  plan: Plan;
  selected: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
}): ReactNode {
  const editor = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!window.matchMedia('(max-width: 1280px)').matches)
      editor.current?.querySelector<HTMLInputElement>('input')?.focus();
  }, []);
  const edit = (label: string, fn: (p: Plan) => void): void => useDraft.getState().edit(base, label, fn);
  const m = plan.milestones.find((x) => x.id === selected);
  const linked = m
    ? [
        ...plan.incomes
          .filter((i) => [i.start, i.end].some((r) => r?.type === 'milestone' && r.milestoneId === m.id))
          .map((i) => ({ name: i.name, to: '/plan/income', id: i.id })),
        ...plan.expenses
          .filter((i) => [i.start, i.end].some((r) => r?.type === 'milestone' && r.milestoneId === m.id))
          .map((i) => ({ name: i.name, to: '/plan/spending', id: i.id })),
      ]
    : [];
  const contributions = plan.accounts.filter((a) => linked.some((i) => i.id === a.contribution?.incomeId));
  const coverage = m
    ? plan.healthcare.people.flatMap((person) =>
        person.coverage
          .filter((c) => c.from.type === 'milestone' && c.from.milestoneId === m.id)
          .map(
            (c) =>
              `${plan.people.find((p) => p.id === person.personId)?.name}: ${COVERAGE_NAMES[c.type] ?? c.type}`,
          ),
      )
    : [];
  const retirements = plan.milestones.filter((x) => x.kind === 'retirement');
  const setAge = (v: number): void =>
    edit(`${m?.name ?? 'Milestone'} timing`, (d) => {
      const x = d.milestones.find((q) => q.id === m?.id);
      if (x?.when.type === 'age') x.when.age = v;
    });
  const moves: { key: string; icon: string; label: string; to: string }[] = [
    ...linked.map((i) => ({
      key: i.id,
      icon: i.to === '/plan/income' ? 'income' : 'spending',
      label: i.name,
      to: `${i.to}?edit=${i.id}`,
    })),
    ...contributions.map((a) => ({
      key: `c-${a.id}`,
      icon: 'piggy',
      label: `Saving into ${a.name}`,
      to: '/plan/snapshot',
    })),
    ...coverage.map((c) => ({ key: `h-${c}`, icon: 'health', label: c, to: '/plan/healthcare' })),
    ...(m?.effects ?? []).map((effect, i) => ({
      key: `e-${i}`,
      icon: 'flag',
      label: `A ${effect.type === 'setAmount' ? 'new amount' : effect.type} set at this milestone`,
      to: '/plan/timeline',
    })),
  ];
  return (
    <div ref={editor}>
      <Card
        title="Edit plan"
        actions={
          <Button size="sm" variant="ghost" onClick={onClose}>
            Year details
          </Button>
        }
        data-tour="what-if-sliders"
      >
        <p className="lv-muted lv-small">
          Changes preview on the chart. Apply them, save a scenario or discard from the draft bar.
        </p>
        <div className="pe-body">
          {retirements.length > 1 ? (
            <Segmented
              label="Milestone to move"
              value={selected ?? ''}
              onChange={onSelect}
              options={retirements.map((x) => ({ value: x.id, label: x.name }))}
            />
          ) : null}
          {m ? (
            <section className="pe-section" aria-label={`Edit ${m.name}`}>
              <h3>
                <IconTile icon="sun" kind="milestone" />
                {m.name}
              </h3>
              {m.when.type === 'age' ? (
                <div className="pe-dial">
                  <Slider
                    label={`${m.name} at age`}
                    value={m.when.age}
                    min={0}
                    max={120}
                    step={1}
                    onChange={setAge}
                  />
                  <PrecisionField label="Exact age" value={m.when.age} min={0} max={120} onChange={setAge} />
                </div>
              ) : m.when.type === 'year' ? (
                <PrecisionField
                  label="Exact year"
                  value={m.when.year}
                  min={plan.settings.startYear}
                  max={2200}
                  onChange={(v) =>
                    edit(`${m.name} timing`, (d) => {
                      const x = d.milestones.find((q) => q.id === m.id);
                      if (x?.when.type === 'year') x.when.year = v;
                    })
                  }
                />
              ) : (
                <p className="lv-small">
                  This milestone follows a condition. <Link to="/plan/timeline">Edit its condition</Link>.
                </p>
              )}
              <h4>Moves with it</h4>
              {moves.length ? (
                <ul className="pe-moves">
                  {moves.map((x) => (
                    <li key={x.key}>
                      <Icon name={x.icon} size={14} />
                      <Link to={x.to}>{x.label}</Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="lv-small lv-muted">No income or spending is linked to this milestone.</p>
              )}
            </section>
          ) : null}
          <section className="pe-section" aria-label="Markets">
            <h3>Markets</h3>
            {plan.assumptions.returns.mode === 'fixed' && (
              <Slider
                label="US stock return"
                value={plan.assumptions.returns.fixed.usStocks}
                min={-0.05}
                max={0.15}
                step={0.0025}
                format={(v) => formatPct(v, 2)}
                onChange={(v) =>
                  edit('Expected stock returns changed', (d) => {
                    const f = d.assumptions.returns.fixed;
                    f.intlStocks = +(f.intlStocks + v - f.usStocks).toFixed(6);
                    f.usStocks = v;
                  })
                }
              />
            )}
            <Slider
              label="Inflation"
              value={plan.assumptions.inflation.rate}
              min={0}
              max={0.07}
              step={0.0025}
              format={(v) => formatPct(v, 2)}
              onChange={(v) =>
                edit('Inflation changed', (d) => {
                  d.assumptions.inflation.rate = v;
                })
              }
            />
          </section>
          {plan.expenses.length ? (
            <section className="pe-section" aria-label="Spending">
              <h3>Spending</h3>
              <div className="pe-amounts">
                {plan.expenses.slice(0, 3).map((e) => (
                  <PrecisionField
                    key={e.id}
                    label={e.name}
                    money
                    note={
                      e.recurrence.type === 'once'
                        ? 'once'
                        : e.recurrence.type === 'interval'
                          ? `every ${e.recurrence.everyYears} years`
                          : 'a year'
                    }
                    value={e.amount / 100}
                    decimals
                    min={0}
                    max={10000000}
                    onChange={(v) =>
                      edit(`${e.name} amount changed`, (d) => {
                        const x = d.expenses.find((q) => q.id === e.id);
                        if (x) x.amount = Math.round(v * 100);
                      })
                    }
                  />
                ))}
              </div>
            </section>
          ) : null}
          <Link className="pe-more" to="/plan/household">
            All plan inputs <Icon name="chevron" size={14} />
          </Link>
        </div>
      </Card>
    </div>
  );
}

export function EventTimeline({
  base,
  plan,
  result,
  onSelect,
  selected,
}: {
  base: Plan;
  plan: Plan;
  result: ProjectionResult;
  onSelect: (id: string) => void;
  selected?: string | null;
}): ReactNode {
  const track = useRef<HTMLDivElement>(null);
  const [trackWidth, setTrackWidth] = useState(600);
  useEffect(() => {
    const node = track.current;
    if (!node) return;
    const observer = new ResizeObserver(() => setTrackWidth(node.clientWidth));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const cleanup = useRef<(() => void) | null>(null);
  const view = usePlanView();
  useEffect(() => () => cleanup.current?.(), []);
  const first = result.records[0].year;
  const last = result.records.at(-1)!.year;
  const start = first + ((last - first) * view.range[0]) / 100;
  const end = first + ((last - first) * view.range[1]) / 100;
  const move = (id: string, year: number): void => {
    const y = Math.max(first, Math.min(last, Math.round(year)));
    useDraft.getState().edit(base, 'Milestone timing changed', (d) => {
      const m = d.milestones.find((x) => x.id === id);
      if (m?.when.type === 'year') m.when.year = y;
      else if (m?.when.type === 'age') {
        const pid = m.when.personId;
        const person = d.people.find((p) => p.id === pid);
        if (person) m.when.age = Math.max(0, Math.min(130, y - Number(person.birthDate.slice(0, 4))));
      }
    });
  };
  const events = plan.milestones
    .map((m) => ({ m, year: milestoneYear(plan, m, result) }))
    .filter((x) => x.year !== null && x.year >= start && x.year <= end);
  const lanes: number[] = [];
  const labelWidth = Math.min(190, trackWidth * 0.48);
  const labelPct = (labelWidth / Math.max(1, trackWidth)) * 100;
  // Pins are one line (name and year side by side in a capsule), so every lane is the same height.
  const laneHeight = 38;
  const positioned = events
    .sort((a, b) => a.year! - b.year!)
    .map((event) => {
      const left = ((event.year! - start) / Math.max(1, end - start)) * 100;
      const labelLeft = Math.min(100 - labelPct, left);
      let lane = lanes.findIndex((right) => labelLeft > right + 2);
      if (lane < 0) lane = lanes.length;
      lanes[lane] = labelLeft + labelPct;
      return { ...event, left: labelLeft, anchor: left, lane };
    });
  return (
    <section className="event-timeline" aria-label="Life events" data-tour="integrated-timeline">
      <div className="event-head">
        <strong>Life events</strong>
        <span className="lv-small lv-muted">Drag a pin or use the arrow keys · Esc cancels</span>
        <Link className="lv-small" to="/plan/timeline">
          Every stream on the timeline <Icon name="chevron" size={12} />
        </Link>
      </div>
      <div
        ref={track}
        className="event-track"
        style={{ height: Math.max(46, lanes.length * laneHeight + 10) }}
      >
        <span className="event-start">{Math.round(start)}</span>
        <span className="event-end">{Math.round(end)}</span>
        {positioned.map(({ m, year, left, anchor, lane }) => (
          <button
            type="button"
            key={m.id}
            className="event-marker"
            data-tour="timeline-pin"
            data-derived={m.when.type === 'condition'}
            aria-pressed={selected === m.id}
            style={{ left: `${left}%`, top: lane * laneHeight + 14, maxWidth: labelWidth }}
            onClick={() => onSelect(m.id)}
            onKeyDown={(e) => {
              if (m.when.type !== 'condition' && ['ArrowLeft', 'ArrowRight'].includes(e.key)) {
                e.preventDefault();
                move(m.id, year! + (e.key === 'ArrowRight' ? 1 : -1));
                onSelect(m.id);
              }
            }}
            onPointerDown={(ev) => {
              if (m.when.type === 'condition' || !track.current) return;
              const before = useDraft.getState().transaction;
              const button = ev.currentTarget;
              const rect = track.current.getBoundingClientRect();
              const origin = ev.clientX;
              let newest = year!;
              let timer: ReturnType<typeof setTimeout> | null = null;
              let moved = false;
              button.setPointerCapture(ev.pointerId);
              const preview = (): void => {
                move(m.id, newest);
                timer = null;
              };
              const onMove = (e: PointerEvent): void => {
                if (Math.abs(e.clientX - origin) < 4 && !moved) return;
                moved = true;
                newest = year! + ((e.clientX - origin) / rect.width) * (end - start);
                if (!timer) timer = setTimeout(preview, 75);
              };
              const finish = (cancelled: boolean): void => {
                if (timer) clearTimeout(timer);
                if (cancelled) useDraft.getState().restore(before);
                else if (moved) preview();
                button.removeEventListener('pointermove', onMove);
                button.removeEventListener('pointerup', up);
                button.removeEventListener('pointercancel', cancel);
                document.removeEventListener('keydown', key);
                cleanup.current = null;
              };
              const up = (): void => finish(false);
              const cancel = (): void => finish(true);
              const key = (e: KeyboardEvent): void => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  finish(true);
                }
              };
              button.addEventListener('pointermove', onMove);
              button.addEventListener('pointerup', up);
              button.addEventListener('pointercancel', cancel);
              document.addEventListener('keydown', key);
              cleanup.current = cancel;
            }}
          >
            <span
              className="event-anchor"
              aria-hidden="true"
              style={{ left: ((anchor - left) / 100) * trackWidth }}
            />
            <span className="event-medal" aria-hidden="true">
              <Icon name={m.kind === 'retirement' ? 'sun' : m.kind === 'fi' ? 'target' : 'flag'} size={13} />
            </span>
            {/* Named by what it shows, so voice control can say what is on screen; the hint is for
                assistive tech only. */}
            <span className="event-text">
              <span>{m.name}</span>{' '}
              <small>
                {year} · age{' '}
                {plan.people.map((p) => Math.max(0, year! - Number(p.birthDate.slice(0, 4)))).join(' / ')}
              </small>
            </span>
            <span className="lv-sr">
              {m.when.type === 'condition' ? ', condition based' : ', arrow keys move one year'}
            </span>
          </button>
        ))}
      </div>
      {!events.length && (
        <p className="lv-muted lv-small">
          No events in this range. <Link to="/plan/timeline">Manage milestones</Link>
        </p>
      )}
    </section>
  );
}
