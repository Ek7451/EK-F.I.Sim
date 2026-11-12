import type { Milestone, Plan, ProjectionResult, YearRef } from '@fisim/engine';
import { Badge, Button, Card, Dialog, Slider, TextField, formatMoney, formatPct } from '@fisim/ui';
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
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  decimals?: boolean;
  onChange: (value: number) => void;
}): ReactNode {
  const id = useId();
  const resetId = useDraft((s) => s.resetId);
  const [text, setText] = useState(String(value));
  const [error, setError] = useState('');
  useEffect(() => {
    setText(String(value));
    setError('');
    useDraft.getState().setInvalid(id, false);
  }, [value, id, resetId]);
  useEffect(() => () => useDraft.getState().setInvalid(id, false), [id]);
  return (
    <div className="lv-field">
      <label className="lv-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="lv-input"
        inputMode={decimals ? 'decimal' : 'numeric'}
        value={text}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
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
      <div>
        <Badge tone="warn">Unsaved draft</Badge> <strong>What changed</strong>
      </div>
      <p>
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
      </p>
      <details>
        <summary>All changed inputs</summary>
        <ul>
          {scenarioChanges(t.base, t.plan).map((patch, i) => (
            <li key={i}>{describeChange(t.base, patch)}</li>
          ))}
        </ul>
      </details>
      <p role="status">
        {conflict
          ? 'The saved plan changed. Discard this draft and start again.'
          : stale
            ? 'Updating draft outcomes…'
            : delta === null || tax === null
              ? 'Loading baseline…'
              : `Ending wealth ${signed(delta)} · lifetime taxes ${signed(tax)} vs saved plan, in today's dollars.`}
      </p>
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
          .map((c) => `${plan.people.find((p) => p.id === person.personId)?.name}: ${c.type} coverage`),
      )
    : [];
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
          Changes preview here. Apply, save a scenario, or discard when ready.
        </p>
        <div className="planning-fields">
          {plan.milestones
            .filter((x) => x.kind === 'retirement')
            .map((x) => (
              <Button key={x.id} size="sm" aria-pressed={selected === x.id} onClick={() => onSelect(x.id)}>
                {x.name}
              </Button>
            ))}
          {m && (
            <section aria-label={`Edit ${m.name}`}>
              <h3>{m.name}</h3>
              {m.when.type === 'age' ? (
                <>
                  <Slider
                    label={`${m.name} at age`}
                    value={m.when.age}
                    min={0}
                    max={120}
                    step={1}
                    onChange={(v) =>
                      edit(`${m.name} timing`, (d) => {
                        const x = d.milestones.find((q) => q.id === m.id);
                        if (x?.when.type === 'age') x.when.age = v;
                      })
                    }
                  />
                  <PrecisionField
                    label="Exact age"
                    value={m.when.age}
                    min={0}
                    max={120}
                    onChange={(v) =>
                      edit(`${m.name} timing`, (d) => {
                        const x = d.milestones.find((q) => q.id === m.id);
                        if (x?.when.type === 'age') x.when.age = v;
                      })
                    }
                  />
                </>
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
                <p>
                  This milestone follows a condition. <Link to="/plan/timeline">Edit its condition</Link>.
                </p>
              )}
              <h4>Affected items</h4>
              <ul className="dependency-list">
                {linked.map((i) => (
                  <li key={i.id}>
                    <Link to={i.to}>{i.name}</Link>
                  </li>
                ))}
                {contributions.map((a) => (
                  <li key={a.id}>
                    <Link to="/plan/snapshot">Contributions to {a.name}</Link>
                  </li>
                ))}
                {coverage.map((c) => (
                  <li key={c}>
                    <Link to="/plan/healthcare">{c}</Link>
                  </li>
                ))}
                {m.effects.map((effect, i) => (
                  <li key={i}>Explicit {effect.type} change at this milestone</li>
                ))}
              </ul>
              {!linked.length && !m.effects.length && (
                <p className="lv-small lv-muted">No income or spending is linked to this milestone.</p>
              )}
            </section>
          )}
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
                  f.intlStocks += v - f.usStocks;
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
          {plan.expenses.slice(0, 3).map((e) => (
            <PrecisionField
              key={e.id}
              label={`${e.name} (${e.recurrence.type}, dollars)`}
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
          <Link to="/plan/household">All plan inputs →</Link>
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
  const resolve = (ref: YearRef | undefined, fallback: number): number | null => {
    if (!ref) return fallback;
    if (ref.type === 'year') return ref.year;
    if (ref.type === 'age')
      return Number(plan.people.find((p) => p.id === ref.personId)?.birthDate.slice(0, 4) ?? first) + ref.age;
    const m = plan.milestones.find((item) => item.id === ref.milestoneId);
    const year = m ? milestoneYear(plan, m, result) : null;
    return year === null ? null : year + ref.offset;
  };
  const spans = [
    ...plan.incomes.map((item) => ({ ...item, route: '/plan/income' })),
    ...plan.expenses.map((item) => ({ ...item, route: '/plan/spending' })),
  ];
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
  const labelWidth = Math.min(160, trackWidth * 0.48);
  const labelPct = (labelWidth / Math.max(1, trackWidth)) * 100;
  const laneHeight = Math.max(
    54,
    ...events.map(({ m }) => Math.ceil((m.name.length * 7) / Math.max(40, labelWidth - 16)) * 16 + 32),
  );
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
      <div className="lv-spread">
        <strong>Life events</strong>
        <span className="lv-small lv-muted">Drag or use arrow keys · Escape cancels</span>
      </div>
      <div
        ref={track}
        className="event-track"
        style={{ height: Math.max(82, lanes.length * laneHeight + 30) }}
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
            style={{ left: `${left}%`, top: lane * laneHeight + 24, width: labelWidth }}
            aria-label={`${m.name} ${year} · ${plan.people.map((p) => Math.max(0, year! - Number(p.birthDate.slice(0, 4)))).join(' / ')} years old${m.when.type === 'condition' ? ', condition based' : ', arrow keys move one year'}`}
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
            <span aria-hidden="true">{m.kind === 'retirement' ? '◉' : '◇'}</span> {m.name}{' '}
            <small>
              {year} ·{' '}
              {plan.people.map((p) => Math.max(0, year! - Number(p.birthDate.slice(0, 4)))).join(' / ')} years
              old
            </small>
          </button>
        ))}
      </div>
      <details className="timeline-spans">
        <summary>Income and spending spans</summary>
        <ul className="lv-list">
          {spans.map((item) => {
            const from = resolve(item.start, first);
            const to = resolve(item.end, last);
            const linked = [item.start, item.end].some(
              (ref) => ref?.type === 'milestone' && ref.milestoneId === selected,
            );
            return (
              <li key={item.id} data-linked={linked}>
                <div className="lv-grow">
                  <Link to={`${item.route}?edit=${item.id}`}>{item.name}</Link>
                  <div className="lv-small lv-muted">
                    {from ?? 'Condition not reached'} → {to ?? 'Condition not reached'}
                    {linked ? ' · linked to selected event' : ''}
                  </div>
                  <div className="span-track">
                    {from !== null && to !== null && to >= start && from <= end && (
                      <span
                        style={{
                          left: `${Math.max(0, ((from - start) / (end - start)) * 100)}%`,
                          width: `${Math.max(0, ((Math.min(end, to) - Math.max(start, from)) / (end - start)) * 100)}%`,
                        }}
                      />
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </details>
      {!events.length && (
        <p className="lv-muted lv-small">
          No events in this range. <Link to="/plan/timeline">Manage milestones</Link>
        </p>
      )}
    </section>
  );
}
