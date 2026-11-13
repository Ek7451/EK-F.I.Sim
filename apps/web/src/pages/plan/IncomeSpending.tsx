import './inputs-c.css';
import type { Expense, Income, YearRecord } from '@fisim/engine';
import {
  Badge,
  Button,
  Card,
  Fold,
  IconTile,
  KpiStrip,
  MoneyField,
  NumberField,
  PercentField,
  SelectField,
  Stat,
  Switch,
  TextField,
  formatMoney,
  formatPct,
} from '@fisim/ui';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useProjection } from '../../engine/useResults';
import { Chart, axis, barFill, short, tooltip } from '../../charts/Chart';
import { EditDialog, EmptyState, GrowthField, WhenField, describeWhen, ownerOptions } from '../../lib/fields';
import { helpText } from '../../lib/help';
import { PageHead } from '../../shell/Shell';
import { newId, usePlan, useUpdate } from '../../state/store';
import { CalculationStatus } from '../workspace/CalculationStatus';

const INCOME_KINDS: { value: Income['kind']; label: string; tax: Income['taxCharacter'] }[] = [
  { value: 'wages', label: 'Salary or wages', tax: 'earned' },
  { value: 'bonus', label: 'Bonus', tax: 'earned' },
  { value: 'selfEmployment', label: 'Self-employment', tax: 'selfEmployment' },
  { value: 'rental', label: 'Rental income', tax: 'ordinary' },
  { value: 'pension', label: 'Pension', tax: 'ordinary' },
  { value: 'annuity', label: 'Annuity payments', tax: 'ordinary' },
  { value: 'other', label: 'Other', tax: 'ordinary' },
];
const TAX_LABELS: Record<Income['taxCharacter'], string> = {
  earned: 'Wages (income and payroll tax)',
  selfEmployment: 'Self-employment',
  ordinary: 'Ordinary income',
  qualifiedDividend: 'Qualified dividends',
  capitalGain: 'Long-term gains',
  taxFree: 'Not taxed',
};

/** Icon for each spending category. */
const EXPENSE_ICON: Record<string, string> = {
  housing: 'estate',
  food: 'spending',
  transport: 'car',
  travel: 'sparkle',
  education: 'school',
  giving: 'gift',
  healthcare: 'heart',
  insurance: 'shield',
  childcare: 'household',
};

/** The parts of a year's income, in the order they stack on the chart. */
const INCOME_PARTS: [string, (r: YearRecord) => number][] = [
  ['Wages', (r) => r.income.wages],
  ['Self-employment', (r) => r.income.selfEmployment],
  ['Social Security', (r) => r.income.socialSecurity],
  ['Pension', (r) => r.income.pension],
  ['Annuity', (r) => r.income.annuity],
  ['Rental', (r) => r.income.rental],
  ['Other', (r) => r.income.other],
  ['Windfalls and sales', (r) => r.income.windfall + r.income.assetSales],
];

/**
 * A range slider that previews while it is dragged and saves once, on release (the browser's own `change`
 * event), so one drag is one step of undo rather than fifty.
 */
function ReleaseRange({
  label,
  value,
  min,
  max,
  step,
  format,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onCommit: (v: number) => void;
}): ReactNode {
  const el = useRef<HTMLInputElement>(null);
  const [live, setLive] = useState<number | null>(null);
  const latest = useRef({ live, value, onCommit });
  latest.current = { live, value, onCommit };
  useEffect(() => {
    const node = el.current;
    if (!node) return;
    const commit = (): void => {
      const { live: v, value: saved, onCommit: save } = latest.current;
      if (v !== null && v !== saved) save(v);
      setLive(null);
    };
    node.addEventListener('change', commit);
    return () => node.removeEventListener('change', commit);
  }, []);
  const shown = Math.min(max, Math.max(min, live ?? value));
  return (
    <input
      ref={el}
      type="range"
      className="lv-range"
      aria-label={label}
      title={`${label}: ${format(live ?? value)}`}
      min={min}
      max={max}
      step={step}
      value={shown}
      aria-valuetext={format(live ?? value)}
      onChange={(e) => setLive(+Number(e.target.value).toFixed(4))}
      style={{ ['--fill' as string]: `${((shown - min) / (max - min)) * 100}%` }}
    />
  );
}

/** A stacked bar per year, one layer per part that is ever non-zero, in today's dollars. */
function ScheduleChart({
  label,
  records,
  parts,
}: {
  label: string;
  records: YearRecord[];
  parts: [string, (r: YearRecord) => number][];
}): ReactNode {
  const used = parts.filter(([, f]) => records.some((r) => Math.abs(f(r)) >= 0.5));
  const shown = used.length ? used : parts.slice(0, 1);
  return (
    <Chart
      label={label}
      deps={[records]}
      height="var(--pic-chart-h)"
      table={() => ({
        columns: ['Year', ...shown.map(([n]) => n), 'Total'],
        rows: records.map((r) => [
          r.year,
          ...shown.map(([, f]) => formatMoney(f(r) / r.cpi)),
          formatMoney(shown.reduce((t, [, f]) => t + f(r), 0) / r.cpi),
        ]),
      })}
      build={(c) => ({
        grid: { left: 52, right: 12, top: shown.length > 1 ? 34 : 14, bottom: 28 },
        legend: shown.length > 1 ? { type: 'scroll', top: 0, icon: 'roundRect' } : undefined,
        tooltip: { ...tooltip(c), trigger: 'axis' },
        xAxis: {
          type: 'category',
          data: records.map((r) => r.year),
          ...axis(c),
          splitLine: { show: false },
        },
        yAxis: { type: 'value', ...axis(c), axisLabel: { color: c.ink3, fontSize: 11, formatter: short } },
        series: shown.map(([name, f], i) => ({
          id: name,
          name,
          type: 'bar',
          stack: 'all',
          barCategoryGap: '22%',
          itemStyle: { color: barFill(c.series[i % c.series.length]) },
          emphasis: { focus: 'series' },
          data: records.map((r) => Math.round(f(r) / r.cpi)),
        })),
      })}
    />
  );
}

export function IncomePage(): ReactNode {
  const plan = usePlan()!;
  const update = useUpdate();
  const [query] = useSearchParams();
  const [id, setId] = useState<string | null>(query.get('edit'));
  const { result } = useProjection();
  const inc = plan.incomes.find((x) => x.id === id);
  const i = plan.incomes.findIndex((x) => x.id === id);
  const set = (fn: (x: Income) => void): void => update((d) => fn(d.incomes[i]));
  const recs = result?.records ?? [];
  const now = recs[0]?.income.total ?? 0;
  const lifetime = recs.reduce((t, r) => t + r.income.total / r.cpi, 0);
  const lastPaid = [...recs].reverse().find((r) => r.income.wages + r.income.selfEmployment > 0.5);
  const ssPeak = recs.reduce((t, r) => Math.max(t, r.income.socialSecurity / r.cpi), 0);
  const ssFirst = recs.find((r) => r.income.socialSecurity > 0.5);
  const claimers = plan.people.filter((p) => p.socialSecurity.mode !== 'none');
  const streamTotal = plan.incomes.reduce((t, x) => t + x.amount, 0);
  return (
    <>
      <PageHead
        group="plan"
        title="Income"
        intro="Each stream has an amount in today's dollars, a growth rate, a start and an end. Social Security is set per person under Household."
      />
      <CalculationStatus />
      <KpiStrip data-tour="income-total">
        <Stat
          label="Income this year"
          icon="income"
          value={formatMoney(now)}
          note="Before tax, including Social Security"
        />
        <Stat label="Per month" icon="calendar" value={formatMoney(now / 12)} note="This year, before tax" />
        <Stat
          label="Pay from work ends"
          icon="briefcase"
          value={lastPaid ? String(lastPaid.year) : '—'}
          note={lastPaid ? `Last year with wages, at age ${lastPaid.ages.join(' and ')}` : 'No wages in the plan'}
        />
        <Stat
          label="Lifetime income"
          icon="trendUp"
          value={result ? formatMoney(lifetime) : '—'}
          note="Whole plan, in today's dollars"
        />
      </KpiStrip>
      <div className="pic-split">
        <Card
          title="Income streams"
          data-tour="incomes"
          actions={
            <Button
              variant="primary"
              size="sm"
              icon="plus"
              data-tour="add-income"
              onClick={() => {
                const nid = newId('i');
                update((d) => {
                  d.incomes.push({
                    id: nid,
                    ownerId: d.people[0].id,
                    name: 'Salary',
                    kind: 'wages',
                    amount: 0,
                    growth: { rate: 0.01, basis: 'real' },
                    taxCharacter: 'earned',
                    annuityExclusionRatio: 0,
                  });
                });
                setId(nid);
              }}
            >
              Add income
            </Button>
          }
        >
          {plan.incomes.length === 0 ? (
            <EmptyState title="No income yet">Add a salary, pension or other income.</EmptyState>
          ) : null}
          <div className="pic-scroll">
            <ul className="pic-list">
              {plan.incomes.map((x) => (
                <li key={x.id} className="pic-item" data-tour="income-row">
                  <IconTile
                    icon={
                      x.kind === 'pension' || x.kind === 'annuity'
                        ? 'clock'
                        : x.kind === 'rental'
                          ? 'estate'
                          : x.kind === 'selfEmployment'
                            ? 'briefcase'
                            : 'income'
                    }
                    kind="income"
                  />
                  <div className="pic-item-body">
                    <div className="pic-item-name">
                      <span>{x.name}</span>
                    </div>
                    <div className="pic-item-meta">
                      {plan.people.find((p) => p.id === x.ownerId)?.name} · {describeWhen(plan, x.start, 'Now')}{' '}
                      → {describeWhen(plan, x.end, 'for life')} · grows {formatPct(x.growth.rate, 1)}{' '}
                      {x.growth.basis === 'real' ? 'above inflation' : 'a year'}
                    </div>
                  </div>
                  <span className="pic-amount">
                    {formatMoney(x.amount / 100)}
                    <small>a year</small>
                  </span>
                  <Button size="sm" icon="edit" label={`Edit ${x.name}`} onClick={() => setId(x.id)} />
                  <span
                    className="pic-share"
                    aria-hidden="true"
                    style={{ ['--share' as string]: `${streamTotal > 0 ? (x.amount / streamTotal) * 100 : 0}%` }}
                  />
                </li>
              ))}
              {claimers.length ? (
                <li className="pic-item" data-quiet="true">
                  <IconTile icon="shield" kind="income" />
                  <div className="pic-item-body">
                    <div className="pic-item-name">
                      <span>Social Security</span>
                    </div>
                    <div className="pic-item-meta">
                      {claimers.map((p) => `${p.name} claims at ${p.socialSecurity.claimAge.years}`).join(' · ')}
                      {' · '}
                      <Link to="/plan/household">Set under Household</Link>
                    </div>
                  </div>
                  <span className="pic-amount">
                    {result ? formatMoney(ssPeak) : '—'}
                    <small>{ssFirst ? `a year at most, from ${ssFirst.year}` : 'not paid in this plan'}</small>
                  </span>
                  <span />
                </li>
              ) : null}
            </ul>
          </div>
        </Card>
        <Card title="Income over the plan">
          {result ? (
            <>
              <ScheduleChart label="Annual income schedule" records={recs} parts={INCOME_PARTS} />
              <p className="lv-small lv-muted pic-chart-note">
                Before tax, in today's dollars.{' '}
                <Link to="/plan/timeline">Edit linked life events and change-over-time effects</Link>.
              </p>
            </>
          ) : (
            <p className="lv-muted" role="status" style={{ minHeight: 'var(--pic-chart-h)' }}>
              Working out the projection…
            </p>
          )}
        </Card>
      </div>
      <EditDialog
        open={!!inc}
        title={inc?.name ?? ''}
        onClose={() => setId(null)}
        onDelete={() =>
          update((d) => {
            d.incomes.splice(i, 1);
          })
        }
      >
        {inc ? (
          <div className="pic-editor">
            <div className="form-grid">
              <TextField
                label="Name"
                value={inc.name}
                onChange={(v) =>
                  set((x) => {
                    x.name = v;
                  })
                }
              />
              <SelectField
                label="Kind"
                value={inc.kind}
                options={INCOME_KINDS}
                onChange={(v) =>
                  set((x) => {
                    x.kind = v;
                    x.taxCharacter = INCOME_KINDS.find((k) => k.value === v)!.tax;
                    if (v === 'pension')
                      x.pension ??= { cola: { rate: 0, basis: 'nominal' }, survivorPct: 0.5 };
                  })
                }
              />
              <SelectField
                label="Whose"
                value={inc.ownerId}
                options={ownerOptions(plan, false)}
                onChange={(v) =>
                  set((x) => {
                    x.ownerId = v;
                  })
                }
              />
              <MoneyField
                label="Amount per year"
                hint="In today's dollars, before tax."
                cents={inc.amount}
                onChange={(v) =>
                  set((x) => {
                    x.amount = Math.max(0, v);
                  })
                }
                data-tour="income-amount"
              />
              {inc.kind === 'pension' && inc.pension ? (
                <PercentField
                  label="Paid to a surviving spouse"
                  digits={0}
                  value={inc.pension.survivorPct}
                  onChange={(v) =>
                    set((x) => {
                      x.pension!.survivorPct = Math.max(0, Math.min(1, v));
                    })
                  }
                />
              ) : null}
              {inc.kind === 'annuity' ? (
                <PercentField
                  label="Tax-free share"
                  hint="The part of each payment that is your own money coming back."
                  help={helpText('Share of each payment that is your own money back (not taxed)')}
                  digits={0}
                  value={inc.annuityExclusionRatio}
                  onChange={(v) =>
                    set((x) => {
                      x.annuityExclusionRatio = Math.max(0, Math.min(1, v));
                    })
                  }
                />
              ) : null}
              {inc.kind === 'rental' && plan.assets.some((a) => a.kind === 'rental') ? (
                <SelectField
                  label="From which property"
                  value={inc.linkedAssetId ?? 'none'}
                  options={[
                    { value: 'none', label: 'Not linked' },
                    ...plan.assets
                      .filter((a) => a.kind === 'rental')
                      .map((a) => ({ value: a.id, label: a.name })),
                  ]}
                  onChange={(v) =>
                    set((x) => {
                      x.linkedAssetId = v === 'none' ? undefined : v;
                    })
                  }
                />
              ) : null}
            </div>
            <div className="pic-pair">
              <div data-tour="income-growth">
                <GrowthField
                  label="Yearly raise"
                  value={inc.growth}
                  onChange={(v) =>
                    set((x) => {
                      x.growth = v;
                    })
                  }
                />
              </div>
              {inc.kind === 'pension' && inc.pension ? (
                <GrowthField
                  label="Cost-of-living increase"
                  value={inc.pension.cola}
                  onChange={(v) =>
                    set((x) => {
                      x.pension!.cola = v;
                    })
                  }
                />
              ) : null}
            </div>
            <div className="pic-pair">
              <WhenField
                plan={plan}
                label="Starts"
                optional
                emptyLabel="Already started"
                value={inc.start}
                onChange={(v) =>
                  set((x) => {
                    x.start = v;
                  })
                }
              />
              <div data-tour="income-end">
                <WhenField
                  plan={plan}
                  label="Ends"
                  optional
                  emptyLabel="Continues for life"
                  value={inc.end}
                  onChange={(v) =>
                    set((x) => {
                      x.end = v;
                    })
                  }
                />
              </div>
            </div>
            <details className="pic-more">
              <summary>
                More options <span>Taxed as: {TAX_LABELS[inc.taxCharacter]}</span>
              </summary>
              <div className="pic-more-body">
                <div className="form-grid">
                  <SelectField
                    label="Taxed as"
                    value={inc.taxCharacter}
                    options={Object.entries(TAX_LABELS).map(([value, label]) => ({
                      value: value as Income['taxCharacter'],
                      label,
                    }))}
                    onChange={(v) =>
                      set((x) => {
                        x.taxCharacter = v;
                      })
                    }
                  />
                </div>
              </div>
            </details>
          </div>
        ) : null}
      </EditDialog>
    </>
  );
}

const CATEGORIES: { value: Expense['category']; label: string }[] = [
  { value: 'housing', label: 'Housing' },
  { value: 'food', label: 'Food and everyday' },
  { value: 'transport', label: 'Transport' },
  { value: 'travel', label: 'Travel and leisure' },
  { value: 'healthcare', label: 'Health (outside the healthcare module)' },
  { value: 'education', label: 'Education' },
  { value: 'childcare', label: 'Childcare' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'giving', label: 'Giving' },
  { value: 'discretionary', label: 'Discretionary' },
  { value: 'other', label: 'Other' },
];
/** Short names for the chart legend. */
const CATEGORY_SHORT: Record<string, string> = { healthcare: 'Health', food: 'Food and everyday' };
const SPENDING_PARTS: [string, (r: YearRecord) => number][] = CATEGORIES.map((c) => [
  CATEGORY_SHORT[c.value] ?? c.label,
  (r: YearRecord): number => r.expenses.byCategory[c.value] ?? 0,
]);

export function SpendingPage(): ReactNode {
  const plan = usePlan()!;
  const update = useUpdate();
  const [query] = useSearchParams();
  const [id, setId] = useState<string | null>(query.get('edit'));
  const { result } = useProjection();
  const e = plan.expenses.find((x) => x.id === id);
  const i = plan.expenses.findIndex((x) => x.id === id);
  const set = (fn: (x: Expense) => void): void => update((d) => fn(d.expenses[i]));
  const recs = result?.records ?? [];
  const yearly = recs[0]?.expenses.living ?? 0;
  const lifetime = recs.reduce((t, r) => t + r.expenses.living / r.cpi, 0);
  const phases = plan.strategies.spendingPhases;
  // Items already running every year, as entered: what the share bars and the "flexible" figure are measured on.
  const running = plan.expenses.filter((x) => x.recurrence.type === 'annual' && !x.start);
  const runningTotal = running.reduce((t, x) => t + x.amount, 0);
  const flexible = running.filter((x) => !x.essential).reduce((t, x) => t + x.amount, 0);
  const survivor = plan.strategies.survivorSpendingPct;
  const phaseSummary = [
    phases.length
      ? phases.map((p) => `${p.name} ${formatPct(p.multiplier)} from ${p.fromAge}`).join(' · ')
      : 'Level spending',
    ...(plan.people.length > 1 ? [`survivor ${formatPct(survivor)}`] : []),
  ].join(' · ');
  return (
    <>
      <PageHead
        group="plan"
        title="Spending"
        intro="What life costs, in today's dollars. Each item rises with its own inflation rate. Taxes, loan payments and healthcare are worked out separately."
      />
      <CalculationStatus />
      <KpiStrip data-tour="spending-total">
        <Stat label="Regular spending per year" icon="spending" value={formatMoney(yearly)} />
        <Stat label="Per month" icon="calendar" value={formatMoney(yearly / 12)} />
        <Stat
          label="Flexible"
          icon="leaf"
          value={formatMoney(flexible / 100)}
          note={
            runningTotal > 0
              ? `${formatPct(flexible / runningTotal)} of yearly items can be cut in a bad year`
              : 'Nothing marked flexible'
          }
        />
        <Stat
          label="Lifetime spending"
          icon="trendUp"
          value={result ? formatMoney(lifetime) : '—'}
          note="Whole plan, in today's dollars"
        />
      </KpiStrip>
      <div className="pic-split">
        <div className="pic-col">
          <Card
            title="Expenses"
            data-tour="expenses"
            actions={
              <Button
                variant="primary"
                size="sm"
                icon="plus"
                data-tour="add-expense"
                onClick={() => {
                  const nid = newId('e');
                  update((d) => {
                    d.expenses.push({
                      id: nid,
                      name: 'New expense',
                      category: 'other',
                      amount: 0,
                      inflationIndex: 'cpi',
                      customRate: 0,
                      essential: true,
                      followsPhases: false,
                      recurrence: { type: 'annual' },
                    });
                  });
                  setId(nid);
                }}
              >
                Add expense
              </Button>
            }
          >
            {plan.expenses.length === 0 ? (
              <EmptyState title="No spending yet">
                Add your regular costs and any one-off items such as a new roof or a wedding.
              </EmptyState>
            ) : null}
            <div className="pic-scroll">
              <ul className="pic-list">
                {plan.expenses.map((x) => (
                  <li key={x.id} className="pic-item" data-tour="expense-row">
                    <IconTile icon={EXPENSE_ICON[x.category] ?? 'spending'} kind="expense" />
                    <div className="pic-item-body">
                      <div className="pic-item-name">
                        <span>{x.name}</span>
                        {x.recurrence.type === 'once' ? (
                          <Badge>One time</Badge>
                        ) : x.recurrence.type === 'interval' ? (
                          <Badge>Every {x.recurrence.everyYears} years</Badge>
                        ) : null}
                        {!x.essential ? <Badge tone="warn">Flexible</Badge> : null}
                        {x.followsPhases ? <Badge>Follows phases</Badge> : null}
                      </div>
                      <div className="pic-item-meta">
                        {CATEGORIES.find((c) => c.value === x.category)?.label} ·{' '}
                        {describeWhen(plan, x.start, 'Now')}
                        {x.recurrence.type === 'once' ? '' : ` → ${describeWhen(plan, x.end, 'for life')}`}
                      </div>
                    </div>
                    <span className="pic-amount">
                      {formatMoney(x.amount / 100)}
                      <small>{x.recurrence.type === 'annual' ? 'a year' : 'each time'}</small>
                    </span>
                    <Button size="sm" icon="edit" label={`Edit ${x.name}`} onClick={() => setId(x.id)} />
                    <span
                      className="pic-share"
                      aria-hidden="true"
                      style={{
                        ['--share' as string]: `${running.includes(x) && runningTotal > 0 ? (x.amount / runningTotal) * 100 : 0}%`,
                      }}
                    />
                  </li>
                ))}
              </ul>
            </div>
          </Card>
          <Fold
            title="Spending phases"
            icon="layers"
            kind="expense"
            summary={phaseSummary}
            storageKey="spending-phases"
            // Open where there is room for it: a short list on a tall window. Otherwise its summary row says it all.
            defaultOpen={plan.expenses.length <= 5 && window.innerHeight >= 860}
            data-tour="phases"
          >
            <p className="lv-muted lv-small" style={{ marginBottom: 8 }}>
              A phase scales every expense marked “follows phases”, from the age you set.
            </p>
            {phases.length === 0 ? (
              <p className="pic-empty">No phases: spending stays level apart from inflation.</p>
            ) : null}
            <div className="pic-phases">
              {phases.map((ph, k) => (
                <div className="pic-phase" key={k}>
                  <TextField
                    label="Name"
                    value={ph.name}
                    onChange={(v) =>
                      update((d) => {
                        d.strategies.spendingPhases[k].name = v;
                      })
                    }
                  />
                  <NumberField
                    label="From age"
                    value={ph.fromAge}
                    min={18}
                    max={110}
                    onChange={(v) =>
                      update((d) => {
                        d.strategies.spendingPhases[k].fromAge = v;
                      })
                    }
                  />
                  <PercentField
                    label="Spend"
                    digits={0}
                    value={ph.multiplier}
                    onChange={(v) =>
                      update((d) => {
                        d.strategies.spendingPhases[k].multiplier = Math.max(0, Math.min(3, v));
                      })
                    }
                  />
                  <ReleaseRange
                    label={`${ph.name} spending level`}
                    value={ph.multiplier}
                    min={0.4}
                    max={1.6}
                    step={0.05}
                    format={(v) => formatPct(v)}
                    onCommit={(v) =>
                      update((d) => {
                        d.strategies.spendingPhases[k].multiplier = v;
                      })
                    }
                  />
                  <Button
                    variant="ghost"
                    icon="trash"
                    label={`Remove ${ph.name}`}
                    onClick={() =>
                      update((d) => {
                        d.strategies.spendingPhases.splice(k, 1);
                      })
                    }
                  />
                </div>
              ))}
            </div>
            <div className="pic-add">
              <Button
                size="sm"
                icon="plus"
                onClick={() =>
                  update((d) => {
                    d.strategies.spendingPhases.push({
                      name: 'New phase',
                      fromAge: (phases.at(-1)?.fromAge ?? 55) + 10,
                      multiplier: 1,
                    });
                  })
                }
              >
                Add a phase
              </Button>
            </div>
            {plan.people.length > 1 ? (
              <div className="pic-dial">
                <PercentField
                  label="Survivor spending"
                  help={helpText('Spending after one partner dies')}
                  digits={0}
                  value={survivor}
                  onChange={(v) =>
                    update((d) => {
                      d.strategies.survivorSpendingPct = Math.max(0, Math.min(1.5, v));
                    })
                  }
                />
                <ReleaseRange
                  label="Survivor spending level"
                  value={survivor}
                  min={0.3}
                  max={1.2}
                  step={0.05}
                  format={(v) => formatPct(v)}
                  onCommit={(v) =>
                    update((d) => {
                      d.strategies.survivorSpendingPct = v;
                    })
                  }
                />
              </div>
            ) : null}
          </Fold>
        </div>
        <Card title="Spending over the plan">
          {result ? (
            <>
              <ScheduleChart label="Annual spending schedule" records={recs} parts={SPENDING_PARTS} />
              <p className="lv-small lv-muted pic-chart-note">
                Regular spending by category, in today's dollars.{' '}
                <Link to="/plan/timeline">Edit linked life events and change-over-time effects</Link>.
              </p>
            </>
          ) : (
            <p className="lv-muted" role="status" style={{ minHeight: 'var(--pic-chart-h)' }}>
              Working out the projection…
            </p>
          )}
        </Card>
      </div>
      <EditDialog
        open={!!e}
        title={e?.name ?? ''}
        onClose={() => setId(null)}
        onDelete={() =>
          update((d) => {
            d.expenses.splice(i, 1);
          })
        }
      >
        {e ? (
          <div className="pic-editor">
            <div className="form-grid">
              <TextField
                label="Name"
                value={e.name}
                onChange={(v) =>
                  set((x) => {
                    x.name = v;
                  })
                }
              />
              <SelectField
                label="Category"
                value={e.category}
                options={CATEGORIES}
                onChange={(v) =>
                  set((x) => {
                    x.category = v;
                    if (v === 'education') x.inflationIndex = 'education';
                  })
                }
              />
              <MoneyField
                label={e.recurrence.type === 'annual' ? 'Amount per year' : 'Amount each time'}
                hint="In today's dollars."
                cents={e.amount}
                onChange={(v) =>
                  set((x) => {
                    x.amount = Math.max(0, v);
                  })
                }
                data-tour="expense-amount"
              />
              <SelectField
                label="How often"
                value={e.recurrence.type}
                options={[
                  { value: 'annual', label: 'Every year' },
                  { value: 'once', label: 'One time' },
                  { value: 'interval', label: 'Every few years' },
                ]}
                onChange={(v) =>
                  set((x) => {
                    x.recurrence = v === 'interval' ? { type: 'interval', everyYears: 5 } : { type: v };
                  })
                }
                data-tour="expense-recurrence"
              />
              {e.recurrence.type === 'interval' ? (
                <NumberField
                  label="Every how many years"
                  value={e.recurrence.everyYears}
                  min={1}
                  max={50}
                  onChange={(v) =>
                    set((x) => {
                      x.recurrence = { type: 'interval', everyYears: v };
                    })
                  }
                />
              ) : null}
              <SelectField
                label="Rises with"
                value={e.inflationIndex}
                options={[
                  { value: 'cpi', label: 'General inflation' },
                  { value: 'healthcare', label: 'Healthcare inflation' },
                  { value: 'education', label: 'Education inflation' },
                  { value: 'custom', label: 'A rate I set' },
                  { value: 'none', label: 'Nothing: stays flat' },
                ]}
                onChange={(v) =>
                  set((x) => {
                    x.inflationIndex = v;
                  })
                }
                data-tour="expense-inflation"
              />
              {e.inflationIndex === 'custom' ? (
                <PercentField
                  label="Yearly increase"
                  value={e.customRate}
                  onChange={(v) =>
                    set((x) => {
                      x.customRate = v;
                    })
                  }
                />
              ) : null}
            </div>
            <div className="pic-pair">
              <WhenField
                plan={plan}
                label={e.recurrence.type === 'once' ? 'When' : 'Starts'}
                optional
                emptyLabel="Now"
                value={e.start}
                onChange={(v) =>
                  set((x) => {
                    x.start = v;
                  })
                }
              />
              {e.recurrence.type !== 'once' ? (
                <WhenField
                  plan={plan}
                  label="Ends"
                  optional
                  emptyLabel="Continues for life"
                  value={e.end}
                  onChange={(v) =>
                    set((x) => {
                      x.end = v;
                    })
                  }
                />
              ) : null}
            </div>
            <div className="pic-pair">
              <Switch
                label="Essential (cannot be cut in a bad year)"
                checked={e.essential}
                onChange={(v) =>
                  set((x) => {
                    x.essential = v;
                  })
                }
              />
              <Switch
                label="Follows the spending phases"
                checked={e.followsPhases}
                onChange={(v) =>
                  set((x) => {
                    x.followsPhases = v;
                  })
                }
              />
            </div>
          </div>
        ) : null}
      </EditDialog>
    </>
  );
}
