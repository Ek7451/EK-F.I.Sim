import type { Milestone, MilestoneEffect } from '@fisim/engine';
import {
  Badge,
  Button,
  Card,
  MoneyField,
  NumberField,
  PercentField,
  SelectField,
  Switch,
  TextField,
  formatMoney,
  IconTile,
} from '@fisim/ui';
import { useState, type ReactNode } from 'react';
import { useProjection, useProjectionOf } from '../../engine/useResults';
import { EditDialog, EmptyState, STATES, STATUS_LABELS, ownerOptions } from '../../lib/fields';
import { PageHead } from '../../shell/Shell';
import { newId, usePlan } from '../../state/store';

import { useDraft, usePreviewPlan } from '../../state/draft';
import { DraftActions, EventTimeline } from '../workspace/PlanningTools';
import { CalculationStatus } from '../workspace/CalculationStatus';

const KINDS: { value: Milestone['kind']; label: string }[] = [
  { value: 'retirement', label: 'Retirement' },
  { value: 'fi', label: 'Financial independence' },
  { value: 'homePurchase', label: 'Home purchase' },
  { value: 'child', label: 'Child' },
  { value: 'college', label: 'College' },
  { value: 'relocation', label: 'Relocation' },
  { value: 'careerChange', label: 'Career change' },
  { value: 'sabbatical', label: 'Sabbatical' },
  { value: 'windfall', label: 'Windfall' },
  { value: 'custom', label: 'Something else' },
];

function effectText(plan: ReturnType<typeof usePlan>, e: MilestoneEffect): string {
  const p = plan!;
  const nm = (t: string, id: string): string =>
    (t === 'income'
      ? p.incomes.find((x) => x.id === id)?.name
      : t === 'expense'
        ? p.expenses.find((x) => x.id === id)?.name
        : p.accounts.find((x) => x.id === id)?.name) ?? 'removed item';
  switch (e.type) {
    case 'start':
      return `Start ${nm(e.target, e.targetId)}`;
    case 'stop':
      return e.target === 'contribution'
        ? `Stop saving into ${nm('account', e.targetId)}`
        : `Stop ${nm(e.target, e.targetId)}`;
    case 'setAmount':
      return `Set ${nm(e.target, e.targetId)} to ${formatMoney(e.amount / 100)}`;
    case 'scaleAmount':
      return `Scale ${nm(e.target, e.targetId)} to ${Math.round(e.factor * 100)}%`;
    case 'windfall':
      return `Receive ${formatMoney(e.amount / 100)} into ${nm('account', e.accountId)}${e.taxable ? ' (taxable)' : ''}`;
    case 'relocate':
      return `Move to ${e.state}`;
    default:
      return `File as ${STATUS_LABELS[e.status]}`;
  }
}

export function TimelinePage(): ReactNode {
  const base = usePlan()!;
  const plan = usePreviewPlan()!;
  const update = (recipe: (p: typeof plan) => void): void =>
    useDraft.getState().edit(base, 'Milestones changed', recipe);
  const { result, stale } = useProjection();
  const baseline = useProjectionOf(plan !== base ? base : null, null);
  const [id, setId] = useState<string | null>(null);
  const m = plan.milestones.find((x) => x.id === id);
  const mi = plan.milestones.findIndex((x) => x.id === id);
  const set = (fn: (x: Milestone) => void): void => update((d) => fn(d.milestones[mi]));

  const start = plan.settings.startYear;
  const end = Math.max(start + 10, ...plan.people.map((p) => +p.birthDate.slice(0, 4) + p.longevity.age));
  const birth = (pid: string): number =>
    +(plan.people.find((p) => p.id === pid) ?? plan.people[0]).birthDate.slice(0, 4);
  const yearOf = (x: Milestone): number | null =>
    x.when.type === 'year'
      ? x.when.year
      : x.when.type === 'age'
        ? birth(x.when.personId) + x.when.age
        : (result?.milestoneYears[x.id] ?? null);
  const sorted = [...plan.milestones].sort((a, b) => (yearOf(a) ?? 9999) - (yearOf(b) ?? 9999));

  return (
    <>
      <PageHead
        group="plan"
        title="Timeline"
        intro="Milestones are the turning points of the plan. Income, spending and coverage can start or stop at a milestone, so moving one moves everything tied to it."
        actions={
          <Button
            variant="primary"
            icon="plus"
            data-tour="add-milestone"
            onClick={() => {
              const nid = newId('m');
              update((d) => {
                d.milestones.push({
                  id: nid,
                  name: 'New milestone',
                  kind: 'custom',
                  when: { type: 'year', year: d.settings.startYear + 5 },
                  effects: [],
                });
              });
              setId(nid);
            }}
          >
            Add milestone
          </Button>
        }
      />
      <CalculationStatus />
      {result && (
        <div data-tour="timeline">
          <EventTimeline base={base} plan={plan} result={result} onSelect={setId} selected={id} />
        </div>
      )}
      {result && <DraftActions base={base} result={result} baseline={baseline} stale={stale} />}
      <Card title="Milestones" data-tour="milestone-list">
        {plan.milestones.length === 0 ? (
          <EmptyState title="No milestones yet">
            Add retirement first: income can then end “at retirement” rather than in a fixed year.
          </EmptyState>
        ) : null}
        <ul className="lv-list">
          {sorted.map((x) => {
            const y = yearOf(x);
            return (
              <li key={x.id} data-tour="milestone-row">
                <IconTile
                  icon={
                    x.kind === 'retirement'
                      ? 'sun'
                      : x.kind === 'fi'
                        ? 'target'
                        : x.when.type === 'condition'
                          ? 'sparkle'
                          : 'flag'
                  }
                  kind="milestone"
                />
                <div className="lv-grow">
                  <strong>{x.name}</strong>{' '}
                  {x.when.type === 'condition' ? <Badge tone="warn">When a condition is met</Badge> : null}
                  <div className="lv-muted lv-small">
                    {y ?? 'Not reached in this projection'}
                    {x.effects.length ? ` · ${x.effects.map((e) => effectText(plan, e)).join('; ')}` : ''}
                  </div>
                </div>
                <Button size="sm" icon="edit" label={`Edit ${x.name}`} onClick={() => setId(x.id)} />
              </li>
            );
          })}
        </ul>
      </Card>

      <EditDialog
        open={!!m}
        title={m?.name ?? ''}
        onClose={() => setId(null)}
        onDelete={() =>
          update((d) => {
            d.milestones.splice(mi, 1);
          })
        }
      >
        {m ? (
          <>
            <div className="form-grid">
              <TextField
                label="Name"
                value={m.name}
                onChange={(v) =>
                  set((x) => {
                    x.name = v;
                  })
                }
              />
              <SelectField
                label="Kind"
                value={m.kind}
                options={KINDS}
                onChange={(v) =>
                  set((x) => {
                    x.kind = v;
                  })
                }
              />
              <SelectField
                label="Happens"
                value={m.when.type}
                options={[
                  { value: 'year', label: 'In a year' },
                  { value: 'age', label: 'At an age' },
                  { value: 'condition', label: 'When a condition is met' },
                ]}
                onChange={(v) =>
                  set((x) => {
                    x.when =
                      v === 'year'
                        ? { type: 'year', year: start + 5 }
                        : v === 'age'
                          ? { type: 'age', personId: plan.people[0].id, age: 60 }
                          : { type: 'condition', metric: 'fi', value: 0, fiMultiple: 25 };
                  })
                }
                data-tour="milestone-when"
              />
              {m.when.type === 'year' ? (
                <NumberField
                  label="Year"
                  value={m.when.year}
                  min={start}
                  max={end}
                  onChange={(v) =>
                    set((x) => {
                      if (x.when.type === 'year') x.when.year = v;
                    })
                  }
                />
              ) : null}
              {m.when.type === 'age' ? (
                <>
                  {plan.people.length > 1 ? (
                    <SelectField
                      label="Who"
                      value={m.when.personId}
                      options={ownerOptions(plan, false)}
                      onChange={(v) =>
                        set((x) => {
                          if (x.when.type === 'age') x.when.personId = v;
                        })
                      }
                    />
                  ) : null}
                  <NumberField
                    label="Age"
                    value={m.when.age}
                    min={0}
                    max={115}
                    onChange={(v) =>
                      set((x) => {
                        if (x.when.type === 'age') x.when.age = v;
                      })
                    }
                  />
                </>
              ) : null}
              {m.when.type === 'condition' ? (
                <>
                  <SelectField
                    label="Condition"
                    value={m.when.metric}
                    options={[
                      { value: 'fi', label: 'Investments cover spending (FI)' },
                      { value: 'netWorth', label: 'Net worth reaches' },
                      { value: 'investable', label: 'Investments reach' },
                    ]}
                    onChange={(v) =>
                      set((x) => {
                        if (x.when.type === 'condition') x.when.metric = v;
                      })
                    }
                  />
                  {m.when.metric === 'fi' ? (
                    <NumberField
                      label="Years of spending saved"
                      hint="25 is the classic 4% rule."
                      value={m.when.fiMultiple}
                      min={5}
                      max={100}
                      onChange={(v) =>
                        set((x) => {
                          if (x.when.type === 'condition') x.when.fiMultiple = v;
                        })
                      }
                    />
                  ) : (
                    <MoneyField
                      label="Amount (today's dollars)"
                      cents={m.when.value}
                      onChange={(v) =>
                        set((x) => {
                          if (x.when.type === 'condition') x.when.value = Math.max(0, v);
                        })
                      }
                    />
                  )}
                </>
              ) : null}
            </div>
            <div className="lv-spread" data-tour="milestone-effects">
              <span className="lv-label">What changes at this milestone</span>
              <SelectField
                label="Add a change"
                value="none"
                options={[
                  { value: 'none', label: 'Choose…' },
                  { value: 'stop', label: 'Stop an income or expense' },
                  { value: 'start', label: 'Start an income or expense' },
                  { value: 'setAmount', label: 'Set a new amount' },
                  { value: 'scaleAmount', label: 'Scale an amount' },
                  { value: 'windfall', label: 'Receive a lump sum' },
                  { value: 'relocate', label: 'Move to another state' },
                  { value: 'filingStatus', label: 'Change filing status' },
                ]}
                onChange={(v) =>
                  set((x) => {
                    const firstInc = plan.incomes[0]?.id;
                    const firstExp = plan.expenses[0]?.id;
                    const target = firstInc ? ('income' as const) : ('expense' as const);
                    const tid = firstInc ?? firstExp;
                    if (v === 'windfall' && plan.accounts[0])
                      x.effects.push({
                        type: 'windfall',
                        accountId: plan.accounts[0].id,
                        amount: 5000000,
                        taxable: false,
                      });
                    else if (v === 'relocate') x.effects.push({ type: 'relocate', state: 'FL' });
                    else if (v === 'filingStatus') x.effects.push({ type: 'filingStatus', status: 'single' });
                    else if (tid && v === 'stop') x.effects.push({ type: 'stop', target, targetId: tid });
                    else if (tid && v === 'start') x.effects.push({ type: 'start', target, targetId: tid });
                    else if (tid && v === 'setAmount')
                      x.effects.push({ type: 'setAmount', target, targetId: tid, amount: 0 });
                    else if (tid && v === 'scaleAmount')
                      x.effects.push({ type: 'scaleAmount', target, targetId: tid, factor: 0.5 });
                  })
                }
              />
            </div>
            <p className="lv-muted lv-small">
              Tip: an income or expense can also name this milestone as its start or end. Those links are
              shown on the Income and Spending screens.
            </p>
            {m.effects.map((e, k) => {
              const items = [
                ...plan.incomes.map((x) => ({ value: `income:${x.id}`, label: `Income: ${x.name}` })),
                ...plan.expenses.map((x) => ({ value: `expense:${x.id}`, label: `Expense: ${x.name}` })),
              ];
              const withContrib =
                e.type === 'stop'
                  ? [
                      ...items,
                      ...plan.accounts
                        .filter((a) => a.contribution)
                        .map((a) => ({ value: `contribution:${a.id}`, label: `Savings into: ${a.name}` })),
                    ]
                  : items;
              return (
                <div
                  key={k}
                  className="lv-row"
                  style={{ alignItems: 'flex-end', borderTop: '1px solid var(--line)', paddingTop: 12 }}
                >
                  <div style={{ flex: 2, minWidth: 180 }}>
                    {e.type === 'start' ||
                    e.type === 'stop' ||
                    e.type === 'setAmount' ||
                    e.type === 'scaleAmount' ? (
                      <SelectField
                        label={
                          e.type === 'start'
                            ? 'Start'
                            : e.type === 'stop'
                              ? 'Stop'
                              : e.type === 'setAmount'
                                ? 'Set amount of'
                                : 'Scale'
                        }
                        value={`${e.target}:${e.targetId}`}
                        options={withContrib}
                        onChange={(v) =>
                          set((x) => {
                            const [t, tid] = v.split(':');
                            const ef = x.effects[k];
                            if (
                              ef.type === 'start' ||
                              ef.type === 'stop' ||
                              ef.type === 'setAmount' ||
                              ef.type === 'scaleAmount'
                            ) {
                              (ef as { target: string }).target = t;
                              ef.targetId = tid;
                            }
                          })
                        }
                      />
                    ) : e.type === 'windfall' ? (
                      <SelectField
                        label="Lump sum into"
                        value={e.accountId}
                        options={plan.accounts.map((a) => ({ value: a.id, label: a.name }))}
                        onChange={(v) =>
                          set((x) => {
                            const ef = x.effects[k];
                            if (ef.type === 'windfall') ef.accountId = v;
                          })
                        }
                      />
                    ) : e.type === 'relocate' ? (
                      <SelectField
                        label="Move to"
                        value={e.state}
                        options={STATES.map((s) => ({ value: s, label: s }))}
                        onChange={(v) =>
                          set((x) => {
                            const ef = x.effects[k];
                            if (ef.type === 'relocate') ef.state = v;
                          })
                        }
                      />
                    ) : (
                      <SelectField
                        label="File as"
                        value={e.status}
                        options={Object.entries(STATUS_LABELS).map(([value, label]) => ({
                          value: value as typeof e.status,
                          label,
                        }))}
                        onChange={(v) =>
                          set((x) => {
                            const ef = x.effects[k];
                            if (ef.type === 'filingStatus') ef.status = v;
                          })
                        }
                      />
                    )}
                  </div>
                  {e.type === 'setAmount' || e.type === 'windfall' ? (
                    <div style={{ flex: 1, minWidth: 120 }}>
                      <MoneyField
                        label="Amount"
                        cents={e.amount}
                        onChange={(v) =>
                          set((x) => {
                            const ef = x.effects[k];
                            if (ef.type === 'setAmount' || ef.type === 'windfall') ef.amount = Math.max(0, v);
                          })
                        }
                      />
                    </div>
                  ) : null}
                  {e.type === 'scaleAmount' ? (
                    <div style={{ flex: 1, minWidth: 100 }}>
                      <PercentField
                        label="To"
                        digits={0}
                        value={e.factor}
                        onChange={(v) =>
                          set((x) => {
                            const ef = x.effects[k];
                            if (ef.type === 'scaleAmount') ef.factor = Math.max(0, v);
                          })
                        }
                      />
                    </div>
                  ) : null}
                  {e.type === 'windfall' ? (
                    <Switch
                      label="Taxable"
                      checked={e.taxable}
                      onChange={(v) =>
                        set((x) => {
                          const ef = x.effects[k];
                          if (ef.type === 'windfall') ef.taxable = v;
                        })
                      }
                    />
                  ) : null}
                  <Button
                    variant="ghost"
                    icon="trash"
                    label="Remove this change"
                    onClick={() =>
                      set((x) => {
                        x.effects.splice(k, 1);
                      })
                    }
                  />
                </div>
              );
            })}
          </>
        ) : null}
      </EditDialog>
    </>
  );
}
