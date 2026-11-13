/**
 * The plan drawn on one time axis: a life line with a pin per milestone, and under it a lane for everything
 * that starts or stops along the way (income, spending, health coverage, saving from pay).
 */
import type { Milestone, Plan, ProjectionResult, YearRef } from '@fisim/engine';
import { Icon, formatCompact, formatPct } from '@fisim/ui';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useDraft } from '../../state/draft';
import { milestoneYear } from '../workspace/PlanningTools';

export const KIND_ICON: Record<Milestone['kind'], string> = {
  retirement: 'sun',
  fi: 'target',
  homePurchase: 'estate',
  child: 'child',
  college: 'school',
  relocation: 'pin',
  careerChange: 'briefcase',
  sabbatical: 'compass',
  windfall: 'gift',
  custom: 'flag',
};

const INCOME_ICON: Record<string, string> = {
  wages: 'briefcase',
  bonus: 'sparkle',
  selfEmployment: 'briefcase',
  rental: 'estate',
  pension: 'clock',
  annuity: 'shield',
  other: 'coin',
};
const EXPENSE_ICON: Record<string, string> = {
  housing: 'home',
  food: 'food',
  transport: 'car',
  travel: 'plane',
  healthcare: 'health',
  education: 'school',
  childcare: 'child',
  insurance: 'shield',
  giving: 'gift',
  discretionary: 'sparkle',
  other: 'spending',
};
const COVERAGE_LABEL: Record<string, string> = {
  employer: 'Employer plan',
  spouseEmployer: 'Spouse’s plan',
  cobra: 'COBRA',
  aca: 'Marketplace',
  medicaid: 'Medicaid',
  medicare: 'Medicare',
};

type Group = 'income' | 'spending' | 'coverage' | 'saving';
interface Seg {
  /** First year of the span. */
  from: number;
  /** The year after its last one (spans are [from, to)). */
  to: number;
  label?: string;
  tone?: string;
  /** A single payment rather than a span. */
  point?: boolean;
}
interface Lane {
  id: string;
  group: Group;
  icon: string;
  name: string;
  note: string;
  to: string;
  segs: Seg[];
  linked: boolean;
}
const GROUPS: { id: Group; label: string; to: string }[] = [
  { id: 'income', label: 'Income', to: '/plan/income' },
  { id: 'spending', label: 'Spending', to: '/plan/spending' },
  { id: 'coverage', label: 'Health coverage', to: '/plan/healthcare' },
  { id: 'saving', label: 'Saving from pay', to: '/plan/snapshot' },
];

const birthYear = (plan: Plan, personId: string | undefined, fallback: number): number =>
  Number(plan.people.find((p) => p.id === personId)?.birthDate.slice(0, 4) ?? fallback);

/** Consecutive `true` years as [from, to) spans. */
function runs(first: number, active: boolean[]): Seg[] {
  const out: Seg[] = [];
  active.forEach((on, i) => {
    if (!on) return;
    const last = out.at(-1);
    if (last && last.to === first + i) last.to += 1;
    else out.push({ from: first + i, to: first + i + 1 });
  });
  return out;
}

/** Everything in the plan that occupies a stretch of years, resolved the way the engine runs it. */
function buildLanes(
  plan: Plan,
  result: ProjectionResult,
  selected: string | null,
  years: Record<string, number | null>,
): Lane[] {
  const first = result.records[0].year;
  const last = result.records.at(-1)!.year;
  const n = last - first + 1;
  const resolve = (ref: YearRef | undefined, fallback: number): number => {
    if (!ref) return fallback;
    if (ref.type === 'year') return ref.year;
    if (ref.type === 'age') return birthYear(plan, ref.personId, first) + ref.age;
    const y = years[ref.milestoneId];
    return y === null || y === undefined ? Infinity : y + ref.offset;
  };
  // Milestone effects that switch an item on or off from their year on.
  const forces = (target: 'income' | 'expense' | 'contribution', id: string): Map<number, 1 | -1> => {
    const at = new Map<number, 1 | -1>();
    for (const m of plan.milestones) {
      const y = years[m.id];
      if (y === null || y === undefined) continue;
      for (const e of m.effects)
        if ((e.type === 'start' || e.type === 'stop') && e.target === target && e.targetId === id)
          at.set(y, e.type === 'start' ? 1 : -1);
    }
    return at;
  };
  const refs = (...list: (YearRef | undefined)[]): boolean =>
    !!selected && list.some((r) => r?.type === 'milestone' && r.milestoneId === selected);
  const sel = plan.milestones.find((m) => m.id === selected);
  const effectOn = (target: string, id: string): boolean =>
    !!sel?.effects.some((e) => 'targetId' in e && e.target === target && e.targetId === id);

  const lanes: Lane[] = [];
  const incomeActive = new Map<string, boolean[]>();
  for (const inc of plan.incomes) {
    const from = resolve(inc.start, first);
    const end = resolve(inc.end, Infinity);
    const at = forces('income', inc.id);
    let force = 0;
    const active = Array.from({ length: n }, (_, i) => {
      const y = first + i;
      force = at.get(y) ?? force;
      return force === -1 ? false : force === 1 ? y < end : y >= from && y < end;
    });
    incomeActive.set(inc.id, active);
    lanes.push({
      id: `inc:${inc.id}`,
      group: 'income',
      icon: INCOME_ICON[inc.kind] ?? 'coin',
      name: inc.name,
      note: `${formatCompact(inc.amount / 100)}/yr`,
      to: `/plan/income?edit=${inc.id}`,
      segs: runs(first, active),
      linked: refs(inc.start, inc.end) || effectOn('income', inc.id),
    });
  }
  for (const p of plan.people) {
    if (p.socialSecurity.mode === 'none') continue;
    const born = Number(p.birthDate.slice(0, 4));
    const from = Math.max(first, born + p.socialSecurity.claimAge.years);
    const to = Math.min(last, born + p.longevity.age) + 1;
    if (to <= from) continue;
    lanes.push({
      id: `ss:${p.id}`,
      group: 'income',
      icon: 'bank',
      name: `${p.name}: Social Security`,
      note: `from age ${p.socialSecurity.claimAge.years}`,
      to: '/plan/household',
      segs: [{ from, to }],
      linked: false,
    });
  }
  for (const e of plan.expenses) {
    const from = resolve(e.start, first);
    const end = resolve(e.end, Infinity);
    const at = forces('expense', e.id);
    let force = 0;
    const active = Array.from({ length: n }, (_, i) => {
      const y = first + i;
      force = at.get(y) ?? force;
      if (force === -1) return false;
      if (e.recurrence.type === 'once') return y === from;
      if (force === 1) return y < end;
      if (y < from || y >= end) return false;
      return e.recurrence.type === 'interval' ? (y - from) % e.recurrence.everyYears === 0 : true;
    });
    const dots = e.recurrence.type !== 'annual';
    lanes.push({
      id: `exp:${e.id}`,
      group: 'spending',
      icon: EXPENSE_ICON[e.category] ?? 'spending',
      name: e.name,
      note:
        e.recurrence.type === 'once'
          ? `${formatCompact(e.amount / 100)} once`
          : e.recurrence.type === 'interval'
            ? `${formatCompact(e.amount / 100)} every ${e.recurrence.everyYears} yr`
            : `${formatCompact(e.amount / 100)}/yr`,
      to: `/plan/spending?edit=${e.id}`,
      segs: dots
        ? active.flatMap((on, i) => (on ? [{ from: first + i, to: first + i + 1, point: true }] : []))
        : runs(first, active),
      linked: refs(e.start, e.end) || effectOn('expense', e.id),
    });
  }
  plan.people.forEach((p, i) => {
    const segs: Seg[] = [];
    for (const r of result.records) {
      const type = r.alive[i] ? r.coverage[i] : 'none';
      if (!type || type === 'none') continue;
      const prev = segs.at(-1);
      if (prev && prev.tone === type && prev.to === r.year) prev.to += 1;
      else segs.push({ from: r.year, to: r.year + 1, tone: type, label: COVERAGE_LABEL[type] ?? type });
    }
    if (!segs.length) return;
    const entries = plan.healthcare.people.find((h) => h.personId === p.id)?.coverage ?? [];
    lanes.push({
      id: `cov:${p.id}`,
      group: 'coverage',
      icon: 'health',
      name: p.name,
      note: '',
      to: '/plan/healthcare',
      segs,
      linked: refs(...entries.map((c) => c.from)),
    });
  });
  const earned = plan.incomes.filter((x) => ['wages', 'bonus', 'selfEmployment'].includes(x.kind));
  for (const a of plan.accounts) {
    const c = a.contribution;
    if (!c) continue;
    const saves =
      c.maxOut || c.employeePct > 0 || c.employeeAmount > 0 || c.employerFixedPct > 0 || c.employerMatch.length;
    if (!saves) continue;
    const pay = c.incomeId
      ? [incomeActive.get(c.incomeId)]
      : earned.filter((x) => x.ownerId === a.ownerId).map((x) => incomeActive.get(x.id));
    const at = forces('contribution', a.id);
    let stopped = false;
    const active = Array.from({ length: n }, (_, i) => {
      if (at.get(first + i) === -1) stopped = true;
      return !stopped && pay.some((x) => x?.[i]);
    });
    lanes.push({
      id: `save:${a.id}`,
      group: 'saving',
      icon: 'piggy',
      name: a.name,
      note: c.maxOut
        ? 'up to the limit'
        : c.employeePct > 0
          ? `${formatPct(c.employeePct, Number.isInteger(+(c.employeePct * 100).toFixed(4)) ? 0 : 1)} of pay`
          : c.employeeAmount > 0
            ? `${formatCompact(c.employeeAmount / 100)}/yr`
            : 'employer only',
      to: '/plan/snapshot',
      segs: runs(first, active),
      linked:
        effectOn('contribution', a.id) ||
        (!!c.incomeId &&
          refs(
            plan.incomes.find((x) => x.id === c.incomeId)?.start,
            plan.incomes.find((x) => x.id === c.incomeId)?.end,
          )),
    });
  }
  return lanes;
}

const PIN_H = 40;
const PITCH = 50;
const STEM = 14;

export function TimelineBoard({
  base,
  plan,
  result,
  selected,
  onSelect,
}: {
  base: Plan;
  plan: Plan;
  result: ProjectionResult;
  selected: string | null;
  onSelect: (id: string) => void;
}): ReactNode {
  const track = useRef<HTMLDivElement>(null);
  const [trackWidth, setTrackWidth] = useState(760);
  useEffect(() => {
    const node = track.current;
    if (!node) return;
    const observer = new ResizeObserver(() => setTrackWidth(node.clientWidth || 760));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);

  const first = result.records[0].year;
  const last = result.records.at(-1)!.year;
  // The axis runs to the end of the last year, so a span that lasts for life reaches the edge.
  const span = last + 1 - first;
  const x = (year: number): number => ((Math.max(first, Math.min(last + 1, year)) - first) / span) * 100;

  const years = useMemo(() => {
    const out: Record<string, number | null> = {};
    for (const m of plan.milestones) out[m.id] = milestoneYear(plan, m, result);
    return out;
  }, [plan, result]);
  const lanes = useMemo(() => buildLanes(plan, result, selected, years), [plan, result, selected, years]);

  const agesAt = (year: number): string =>
    plan.people
      .map((p) => {
        const age = year - Number(p.birthDate.slice(0, 4));
        return age < 0 || age > p.longevity.age ? '–' : String(age);
      })
      .join(' / ');

  const move = (id: string, year: number): void => {
    const y = Math.max(first, Math.min(last, Math.round(year)));
    useDraft.getState().edit(base, 'Milestone timing changed', (d) => {
      const m = d.milestones.find((q) => q.id === id);
      if (m?.when.type === 'year') m.when.year = y;
      else if (m?.when.type === 'age') {
        const pid = m.when.personId;
        const person = d.people.find((p) => p.id === pid);
        if (person) m.when.age = Math.max(0, Math.min(130, y - Number(person.birthDate.slice(0, 4))));
      }
    });
  };

  // Ticks every 1, 2, 5 or 10 years, whichever keeps the labels apart.
  const step = [1, 2, 5, 10, 20].find((s) => (trackWidth / span) * s >= 54) ?? 20;
  const ticks: number[] = [];
  for (let y = first; y <= last; y++)
    if (y === first || (y % step === 0 && ((y - first) / span) * trackWidth >= 44)) ticks.push(y);

  // Pins: a dot on the line at the true year, a stem, and a medallion with its label. Neighbours take the
  // next free slot (above, below, further above, …) so nothing overprints.
  const placed = plan.milestones
    .map((m) => ({ m, year: years[m.id] }))
    .filter((e): e is { m: Milestone; year: number } => e.year !== null && e.year >= first && e.year <= last)
    .sort((a, b) => a.year - b.year);
  const unreached = plan.milestones.filter((m) => {
    const y = years[m.id];
    return y === null || y === undefined || y < first || y > last;
  });
  const slots: [number, number][][] = [];
  const pins = placed.map((e) => {
    const sub = `${e.year} · age ${agesAt(e.year)}`;
    const text = Math.min(150, Math.max(e.m.name.length * 7.2, sub.length * 6)) + 6;
    const width = Math.min(trackWidth, PIN_H + 8 + text + 10);
    const cx = (x(e.year) / 100) * trackWidth;
    const flip = cx - PIN_H / 2 + width > trackWidth;
    const left = Math.max(0, flip ? cx + PIN_H / 2 - width : cx - PIN_H / 2);
    let slot = slots.findIndex((taken) => taken.every(([a, b]) => left > b + 8 || left + width < a - 8));
    if (slot < 0) slot = slots.length;
    (slots[slot] ??= []).push([left, left + width]);
    return { ...e, sub, width, cx, flip, left, above: slot % 2 === 0, level: Math.floor(slot / 2) };
  });
  const levelsAbove = Math.max(1, Math.ceil(slots.length / 2));
  const levelsBelow = Math.floor(slots.length / 2);
  const lineY = 4 + STEM + PIN_H + (levelsAbove - 1) * PITCH;
  const lifeHeight = lineY + (levelsBelow ? STEM + PIN_H + (levelsBelow - 1) * PITCH + 4 : 14);
  const selectedYear = selected ? years[selected] : null;

  return (
    <section className="tl-board" aria-label="Plan timeline" style={{ ['--tl-n' as string]: plan.people.length }}>
      <div className="tl-scroll">
        <div className="tl-inner">
          <div className="tl-life lv-night">
            <div className="tl-row">
              <div className="tl-label tl-life-label">
                <h2>Life line</h2>
                <p>Drag a pin, or focus it and press ← →. Escape cancels a drag.</p>
                {unreached.length ? (
                  <div className="tl-unreached">
                    <span>Not reached in this projection</span>
                    {unreached.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        aria-pressed={selected === m.id}
                        onClick={() => onSelect(m.id)}
                      >
                        <Icon name={KIND_ICON[m.kind] ?? 'flag'} size={13} />
                        {m.name}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="tl-track" ref={track} style={{ height: lifeHeight }}>
                <div className="tl-line" style={{ top: lineY }} aria-hidden="true">
                  {ticks.map((y) => (
                    <i key={y} style={{ left: `${x(y)}%` }} />
                  ))}
                </div>
                {!placed.length ? (
                  <p className="tl-empty">
                    No milestones on the line yet. Add retirement first: income can then end “at
                    retirement” rather than in a fixed year.
                  </p>
                ) : null}
                {pins.map(({ m, year, sub, width, cx, flip, left, above, level }) => {
                  const top = above ? lineY - STEM - PIN_H - level * PITCH : lineY + STEM + level * PITCH;
                  const derived = m.when.type === 'condition';
                  return (
                    <div key={m.id} className="tl-pin-wrap" data-selected={selected === m.id}>
                      <span
                        className="tl-stem"
                        aria-hidden="true"
                        style={{
                          left: cx,
                          top: above ? top + PIN_H : lineY,
                          height: above ? lineY - top - PIN_H : top - lineY,
                        }}
                      />
                      <span
                        className="tl-dot"
                        data-kind={m.kind}
                        aria-hidden="true"
                        style={{ left: cx, top: lineY }}
                      />
                      <button
                        type="button"
                        className="tl-pin"
                        data-tour="timeline-pin"
                        data-kind={m.kind}
                        data-derived={derived}
                        data-flip={flip}
                        aria-pressed={selected === m.id}
                        style={{ left, top, width }}
                        title={derived ? 'Follows a condition: edit the condition to move it' : undefined}
                        onClick={() => onSelect(m.id)}
                        onKeyDown={(e) => {
                          if (!derived && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
                            e.preventDefault();
                            move(m.id, year + (e.key === 'ArrowRight' ? 1 : -1));
                            onSelect(m.id);
                          }
                        }}
                        onPointerDown={(ev) => {
                          if (derived || !track.current) return;
                          const before = useDraft.getState().transaction;
                          const button = ev.currentTarget;
                          const rect = track.current.getBoundingClientRect();
                          const origin = ev.clientX;
                          let newest = year;
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
                            button.dataset.dragging = 'true';
                            newest = year + ((e.clientX - origin) / rect.width) * span;
                            if (!timer) timer = setTimeout(preview, 75);
                          };
                          const finish = (cancelled: boolean): void => {
                            if (timer) clearTimeout(timer);
                            if (cancelled) useDraft.getState().restore(before);
                            else if (moved) preview();
                            delete button.dataset.dragging;
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
                        <span className="tl-medal" aria-hidden="true">
                          <Icon name={KIND_ICON[m.kind] ?? 'flag'} size={19} />
                        </span>
                        {/* The pin is named by what it shows (so voice control can say what is on screen),
                            followed by a hint only assistive tech hears. */}
                        <span className="tl-pin-text">
                          <b>{m.name}</b> <small>{sub}</small>
                        </span>
                        <span className="lv-sr">
                          {derived ? ', condition based' : ', arrow keys move one year'}
                        </span>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="tl-row tl-axis" aria-hidden="true">
              <div className="tl-label">
                <span>Year</span>
                <span>Age{plan.people.length > 1 ? ` · ${plan.people.map((p) => p.name).join(' / ')}` : ''}</span>
              </div>
              <div className="tl-track">
                {ticks.map((y) => (
                  <span key={y} className="tl-tick" style={{ left: `${x(y)}%` }}>
                    <b>{y}</b>
                    <small>{agesAt(y)}</small>
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="tl-lanes" data-focus={!!selected}>
            <div className="tl-lanes-inner">
              <div className="tl-grid" aria-hidden="true">
                {ticks.map((y) => (
                  <i key={y} style={{ left: `${x(y)}%` }} />
                ))}
                {placed.map(({ m, year }) => (
                  <i key={m.id} data-mark="" style={{ left: `${x(year)}%` }} />
                ))}
                {selectedYear !== null && selectedYear !== undefined && selectedYear >= first ? (
                  <i data-mark="selected" style={{ left: `${x(selectedYear)}%` }} />
                ) : null}
              </div>
              {GROUPS.map((g) => {
                const rows = lanes.filter((l) => l.group === g.id);
                if (!rows.length) return null;
                return (
                  <div key={g.id} className="tl-group" data-group={g.id} role="group" aria-label={g.label}>
                    <div className="tl-row tl-group-head">
                      <div className="tl-label">
                        <h3>{g.label}</h3>
                        <Link to={g.to}>Edit</Link>
                      </div>
                      <div className="tl-track" />
                    </div>
                    {rows.map((lane) => (
                      <div key={lane.id} className="tl-row tl-lane" data-linked={lane.linked}>
                        <div className="tl-label">
                          <span className="tl-lane-icon" aria-hidden="true">
                            <Icon name={lane.icon} size={14} />
                          </span>
                          <Link to={lane.to} className="lv-ellipsis" title={lane.name}>
                            {lane.name}
                          </Link>
                          {lane.note ? <small>{lane.note}</small> : null}
                        </div>
                        <div className="tl-track">
                          {lane.segs.map((s, i) => {
                            const until = s.to > last ? 'for life' : `to ${s.to - 1}`;
                            const title = s.point
                              ? `${lane.name}: ${s.from}`
                              : `${lane.name}${s.label ? ` · ${s.label}` : ''}: ${s.from} ${until}`;
                            if (s.point)
                              return (
                                <span
                                  key={i}
                                  className="tl-point"
                                  title={title}
                                  style={{ left: `${x(s.from + 0.5)}%` }}
                                />
                              );
                            const px = ((x(s.to) - x(s.from)) / 100) * trackWidth;
                            const text = s.label ?? (s.to - s.from > 1 ? `${s.from}–${s.to - 1}` : `${s.from}`);
                            return (
                              <span
                                key={i}
                                className="tl-bar"
                                data-tone={s.tone}
                                title={title}
                                style={{ left: `${x(s.from)}%`, width: `${x(s.to) - x(s.from)}%` }}
                              >
                                {px > text.length * 6.4 + 14 ? text : null}
                              </span>
                            );
                          })}
                          {!lane.segs.length ? <span className="tl-never">Not active in this projection</span> : null}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
              {!lanes.length ? (
                <p className="lv-muted lv-small" style={{ padding: 12 }}>
                  Income, spending and coverage appear here once the plan has some.
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
