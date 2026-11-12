import type { Expense, Income } from '@fisim/engine';
import {
  Badge,
  Button,
  Card,
  MoneyField,
  NumberField,
  PercentField,
  SelectField,
  Stat,
  Switch,
  TextField,
  formatMoney,
  IconTile,
} from '@fisim/ui';
import { useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useProjection } from '../../engine/useResults';
import { Chart, axis, short, tooltip } from '../../charts/Chart';
import { EditDialog, EmptyState, GrowthField, WhenField, describeWhen, ownerOptions } from '../../lib/fields';
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

export function IncomePage(): ReactNode {
  const plan = usePlan()!;
  const update = useUpdate();
  const [query] = useSearchParams();
  const [id, setId] = useState<string | null>(query.get('edit'));
  const { result } = useProjection();
  const inc = plan.incomes.find((x) => x.id === id);
  const i = plan.incomes.findIndex((x) => x.id === id);
  const set = (fn: (x: Income) => void): void => update((d) => fn(d.incomes[i]));
  const now = result?.records[0]?.income.total ?? 0;
  return (
    <>
      <PageHead
        group="plan"
        title="Income"
        intro="Each stream has an amount in today's dollars, a growth rate, a start and an end. Social Security is set per person under Household."
      />
      <CalculationStatus />
      <Card data-tour="income-total">
        <Stat
          label="Income this year"
          value={formatMoney(now)}
          note="Projected first-year income before tax, including Social Security"
        />
      </Card>
      <Card
        title="Income streams"
        data-tour="incomes"
        actions={
          <Button
            variant="primary"
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
        <ul className="lv-list">
          {plan.incomes.map((x) => (
            <li key={x.id} data-tour="income-row">
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
              <div className="lv-grow">
                <strong>{x.name}</strong>
                <div className="lv-muted lv-small">
                  {plan.people.find((p) => p.id === x.ownerId)?.name} · {describeWhen(plan, x.start, 'Now')} →{' '}
                  {describeWhen(plan, x.end, 'for life')} · grows {(x.growth.rate * 100).toFixed(1)}%{' '}
                  {x.growth.basis === 'real' ? 'above inflation' : 'a year'}
                </div>
              </div>
              <span className="lv-num">{formatMoney(x.amount / 100)}</span>
              <Button size="sm" icon="edit" label={`Edit ${x.name}`} onClick={() => setId(x.id)} />
            </li>
          ))}
        </ul>
      </Card>
      {result && (
        <details className="schedule-preview">
          <summary>Preview income over time</summary>
          <Card title="Projected annual income">
            <Chart
              label="Annual income schedule"
              deps={[result]}
              height={280}
              table={() => ({
                columns: ['Year', 'Amount'],
                rows: result.records.map((r) => [r.year, formatMoney(r.income.total / r.cpi)]),
              })}
              build={(c) => ({
                grid: { left: 60, right: 12, top: 16, bottom: 32 },
                tooltip: { ...tooltip(c), trigger: 'axis' },
                xAxis: { type: 'category', data: result.records.map((r) => r.year), ...axis(c) },
                yAxis: { type: 'value', ...axis(c), axisLabel: { formatter: short } },
                series: [
                  {
                    id: 'income',
                    name: 'Income',
                    type: 'line',
                    step: 'end',
                    symbol: 'none',
                    data: result.records.map((r) => r.income.total / r.cpi),
                    lineStyle: { color: c.primary },
                  },
                ],
              })}
            />
            <p className="lv-small lv-muted">
              Today's dollars.{' '}
              <Link to="/plan/timeline">Edit linked life events and change-over-time effects</Link>.
            </p>
          </Card>
        </details>
      )}
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
          <>
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
            {inc.kind === 'pension' && inc.pension ? (
              <>
                <GrowthField
                  label="Cost-of-living increase"
                  value={inc.pension.cola}
                  onChange={(v) =>
                    set((x) => {
                      x.pension!.cola = v;
                    })
                  }
                />
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
              </>
            ) : null}
            {inc.kind === 'annuity' ? (
              <PercentField
                label="Share of each payment that is your own money back (not taxed)"
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
          </>
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

export function SpendingPage(): ReactNode {
  const plan = usePlan()!;
  const update = useUpdate();
  const [query] = useSearchParams();
  const [id, setId] = useState<string | null>(query.get('edit'));
  const { result } = useProjection();
  const e = plan.expenses.find((x) => x.id === id);
  const i = plan.expenses.findIndex((x) => x.id === id);
  const set = (fn: (x: Expense) => void): void => update((d) => fn(d.expenses[i]));
  const yearly = result?.records[0]?.expenses.living ?? 0;
  const phases = plan.strategies.spendingPhases;
  return (
    <>
      <PageHead
        group="plan"
        title="Spending"
        intro="What life costs, in today's dollars. Each item rises with its own inflation rate. Taxes, loan payments and healthcare are worked out separately."
      />
      <Card data-tour="spending-total">
        <CalculationStatus />
        <div className="lv-grid">
          <Stat label="Regular spending per year" value={formatMoney(yearly)} />
          <Stat label="Per month" value={formatMoney(yearly / 12)} />
        </div>
      </Card>
      <Card
        title="Expenses"
        data-tour="expenses"
        actions={
          <Button
            variant="primary"
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
        <ul className="lv-list">
          {plan.expenses.map((x) => (
            <li key={x.id} data-tour="expense-row">
              <IconTile icon={EXPENSE_ICON[x.category] ?? 'spending'} kind="expense" />
              <div className="lv-grow">
                <strong>{x.name}</strong>{' '}
                {x.recurrence.type === 'once' ? (
                  <Badge>One time</Badge>
                ) : x.recurrence.type === 'interval' ? (
                  <Badge>Every {x.recurrence.everyYears} years</Badge>
                ) : null}{' '}
                {!x.essential ? <Badge tone="warn">Flexible</Badge> : null}
                <div className="lv-muted lv-small">
                  {CATEGORIES.find((c) => c.value === x.category)?.label} ·{' '}
                  {describeWhen(plan, x.start, 'Now')}
                  {x.recurrence.type === 'once' ? '' : ` → ${describeWhen(plan, x.end, 'for life')}`}
                </div>
              </div>
              <span className="lv-num">{formatMoney(x.amount / 100)}</span>
              <Button size="sm" icon="edit" label={`Edit ${x.name}`} onClick={() => setId(x.id)} />
            </li>
          ))}
        </ul>
      </Card>
      <Card
        title="Spending phases"
        data-tour="phases"
        actions={
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
        }
      >
        <p className="lv-muted lv-small" style={{ marginBottom: 12 }}>
          Many people spend more in early retirement and less later. A phase scales every expense marked
          “follows phases”, from the age you set.
        </p>
        {phases.length === 0 ? (
          <p className="lv-muted">No phases: spending stays level apart from inflation.</p>
        ) : null}
        <div className="lv-stack">
          {phases.map((ph, k) => (
            <div className="lv-row" key={k} style={{ alignItems: 'flex-end' }}>
              <div style={{ flex: 2, minWidth: 120 }}>
                <TextField
                  label="Name"
                  value={ph.name}
                  onChange={(v) =>
                    update((d) => {
                      d.strategies.spendingPhases[k].name = v;
                    })
                  }
                />
              </div>
              <div style={{ flex: 1, minWidth: 80 }}>
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
              </div>
              <div style={{ flex: 1, minWidth: 90 }}>
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
              </div>
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
        {plan.people.length > 1 ? (
          <div style={{ marginTop: 16, maxWidth: 320 }}>
            <PercentField
              label="Spending after one partner dies"
              digits={0}
              value={plan.strategies.survivorSpendingPct}
              onChange={(v) =>
                update((d) => {
                  d.strategies.survivorSpendingPct = Math.max(0, Math.min(1.5, v));
                })
              }
            />
          </div>
        ) : null}
      </Card>
      {result && (
        <details className="schedule-preview">
          <summary>Preview spending over time</summary>
          <Card title="Projected annual spending">
            <Chart
              label="Annual spending schedule"
              deps={[result]}
              height={280}
              table={() => ({
                columns: ['Year', 'Amount'],
                rows: result.records.map((r) => [r.year, formatMoney(r.expenses.living / r.cpi)]),
              })}
              build={(c) => ({
                grid: { left: 60, right: 12, top: 16, bottom: 32 },
                tooltip: { ...tooltip(c), trigger: 'axis' },
                xAxis: { type: 'category', data: result.records.map((r) => r.year), ...axis(c) },
                yAxis: { type: 'value', ...axis(c), axisLabel: { formatter: short } },
                series: [
                  {
                    id: 'spending',
                    name: 'Spending',
                    type: 'line',
                    step: 'end',
                    symbol: 'none',
                    data: result.records.map((r) => r.expenses.living / r.cpi),
                    lineStyle: { color: c.primary },
                  },
                ],
              })}
            />
            <p className="lv-small lv-muted">
              Today's dollars.{' '}
              <Link to="/plan/timeline">Edit linked life events and change-over-time effects</Link>.
            </p>
          </Card>
        </details>
      )}
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
          <>
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
          </>
        ) : null}
      </EditDialog>
    </>
  );
}
