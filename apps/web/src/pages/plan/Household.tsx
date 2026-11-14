import type { Person } from '@fisim/engine';
import {
  Badge,
  Button,
  Card,
  Fold,
  KpiStrip,
  MoneyField,
  NumberField,
  SelectField,
  Stat,
  TextField,
  formatMoney,
} from '@fisim/ui';
import { useState, type ReactNode } from 'react';
import { EditDialog, STATES, STATUS_LABELS } from '../../lib/fields';
import { helpText } from '../../lib/help';
import { LifespanSwitch, lifespansVary, survivalNote } from '../../lib/lifespan';
import { PageHead } from '../../shell/Shell';
import { newId, usePlan, useUpdate } from '../../state/store';
import { Dial, FoldColumns, Lead } from './InputsB';
import './inputs-b.css';

export function HouseholdPage(): ReactNode {
  const plan = usePlan()!;
  const update = useUpdate();
  const [editing, setEditing] = useState<string | null>(null);
  const [earningsFor, setEarningsFor] = useState<string | null>(null);
  const person = plan.people.find((p) => p.id === editing);
  const idx = plan.people.findIndex((p) => p.id === editing);
  const set = (fn: (p: Person) => void): void => update((d) => fn(d.people[idx]));
  const status = plan.household.filingStatus.length
    ? plan.household.filingStatus
    : [
        {
          fromYear: plan.settings.startYear,
          status: plan.people.length > 1 ? ('mfj' as const) : ('single' as const),
        },
      ];
  const ePerson = plan.people.find((p) => p.id === earningsFor);
  const eIdx = plan.people.findIndex((p) => p.id === earningsFor);
  const deps = plan.household.dependents;
  // The headline band: who, where, how they file and how long the plan runs, read straight from the inputs.
  const start = plan.settings.startYear;
  const born = (p: Person): number => Number(p.birthDate.slice(0, 4));
  const endYear = Math.max(...plan.people.map((p) => born(p) + p.longevity.age));
  const filingNow = [...status].reverse().find((f) => f.fromYear <= start) ?? status[0];
  const home = plan.people[0]?.residence.filter((r) => r.fromYear <= start).at(-1) ?? plan.people[0]?.residence[0];
  const moves = new Set(plan.people.flatMap((p) => p.residence.map((r) => r.state))).size - 1;

  return (
    <>
      <PageHead
        group="plan"
        title="Household"
        intro="Who the plan covers, where you live, how you file, and how long the plan should run."
      />
      <KpiStrip data-tour="household-summary">
        <Stat
          icon="household"
          label={plan.people.length > 1 ? 'Two people' : 'One person'}
          value={plan.people.map((p) => p.name).join(' & ')}
          note={plan.people.map((p) => `${p.name}, age ${start - born(p)}`).join(' · ')}
        />
        <Stat
          icon="taxes"
          label="Files as"
          value={STATUS_LABELS[filingNow.status] ?? filingNow.status}
          note={status.length > 1 ? `${status.length - 1} change${status.length > 2 ? 's' : ''} later` : 'For the whole plan'}
        />
        <Stat
          icon="home"
          label="Lives in"
          value={home?.state ?? '—'}
          note={moves > 0 ? `${moves} move${moves > 1 ? 's' : ''} planned` : 'No move planned'}
        />
        <Stat
          icon="calendar"
          label="Plan runs"
          value={`${start}–${endYear}`}
          note={`${endYear - start + 1} years · ${deps.length ? `${deps.length} dependent${deps.length > 1 ? 's' : ''}` : 'no dependents'}`}
        />
      </KpiStrip>
      <FoldColumns
        left={
          <Card
            title="People"
            data-tour="people"
            actions={
              plan.people.length < 2 ? (
                <Button
                  size="sm"
                  icon="plus"
                  data-tour="add-person"
                  onClick={() =>
                    update((d) => {
                      const y = d.settings.startYear;
                      d.people.push({
                        id: newId('p'),
                        name: 'Partner',
                        birthDate: `${y - 35}-06-15`,
                        longevity: { mode: 'fixed', age: 95 },
                        residence: structuredClone(d.people[0].residence),
                        socialSecurity: {
                          mode: 'earnings',
                          earnings: [],
                          piaMonthly: 0,
                          claimAge: { years: 67, months: 0 },
                        },
                      });
                      if (!d.household.filingStatus.length)
                        d.household.filingStatus = [{ fromYear: y, status: 'mfj' }];
                    })
                  }
                >
                  Add a partner
                </Button>
              ) : null
            }
          >
            <ul className="pib-people">
              {plan.people.map((p, pi) => {
                const ss = p.socialSecurity;
                return (
                  <li key={p.id} className="pib-person">
                    <span className="pib-person-avatar" aria-hidden="true">
                      {p.name.trim().charAt(0).toUpperCase() || '?'}
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <strong>{p.name}</strong>
                      <div className="pib-person-facts">
                        <Badge>Born {p.birthDate.slice(0, 4)}</Badge>
                        <Badge>{p.residence[p.residence.length - 1]?.state ?? 'No state set'}</Badge>
                        <Badge>
                          {ss.mode === 'none'
                            ? 'No Social Security'
                            : `Social Security at ${ss.claimAge.years}${ss.claimAge.months ? ` + ${ss.claimAge.months} mo` : ''}`}
                        </Badge>
                        {lifespansVary(plan) ? <Badge tone="warn">Lifespan varies in simulations</Badge> : null}
                      </div>
                    </div>
                    <Dial
                      value={p.longevity.age}
                      min={70}
                      max={110}
                      step={1}
                      onChange={(v) =>
                        update((d) => {
                          d.people[pi].longevity.age = v;
                        })
                      }
                      data-tour={pi === 0 ? 'plan-until-age' : undefined}
                    >
                      <NumberField
                        label="Plan until age"
                        hint={
                          survivalNote(
                            +p.birthDate.slice(0, 4),
                            p.sex,
                            p.longevity.age,
                            plan.settings.startYear,
                          ) ?? undefined
                        }
                        value={p.longevity.age}
                        min={50}
                        max={115}
                        onChange={(v) =>
                          update((d) => {
                            d.people[pi].longevity.age = v;
                          })
                        }
                      />
                    </Dial>
                    <Button size="sm" icon="edit" onClick={() => setEditing(p.id)} data-tour="edit-person">
                      Edit
                    </Button>
                  </li>
                );
              })}
            </ul>
            <div style={{ marginTop: 6 }}>
              <LifespanSwitch plan={plan} />
            </div>
          </Card>
        }
        right={
          <>
            <Fold
              title="Filing status over time"
              icon="taxes"
              kind="expense"
              summary={status
                .map((f, i) => (i === 0 ? STATUS_LABELS[f.status] : `${STATUS_LABELS[f.status]} from ${f.fromYear}`))
                .join(' → ')}
              defaultOpen
              storageKey="household:filing"
              data-tour="filing-status"
            >
              <Lead more="After a spouse dies the plan switches by itself: joint in that year, then qualifying surviving spouse for two years if there are dependents, then single.">
                Changes you plan for. A death in the plan is handled automatically.
              </Lead>
              {status.map((f, i) => (
                <div className="pib-line" key={i}>
                  <div className="pib-narrow">
                    <NumberField
                      label="From year"
                      value={f.fromYear}
                      min={1990}
                      max={2150}
                      onChange={(v) =>
                        update((d) => {
                          d.household.filingStatus = status.map((x, j) => (j === i ? { ...x, fromYear: v } : x));
                        })
                      }
                    />
                  </div>
                  <div className="pib-grow">
                    <SelectField
                      label="Status"
                      value={f.status}
                      options={Object.entries(STATUS_LABELS).map(([value, label]) => ({
                        value: value as typeof f.status,
                        label,
                      }))}
                      onChange={(v) =>
                        update((d) => {
                          d.household.filingStatus = status.map((x, j) => (j === i ? { ...x, status: v } : x));
                        })
                      }
                    />
                  </div>
                  {status.length > 1 ? (
                    <Button
                      variant="ghost"
                      icon="trash"
                      label="Remove this change"
                      onClick={() =>
                        update((d) => {
                          d.household.filingStatus = status.filter((_, j) => j !== i);
                        })
                      }
                    />
                  ) : null}
                </div>
              ))}
              <div style={{ marginTop: 8 }}>
                <Button
                  size="sm"
                  icon="plus"
                  onClick={() =>
                    update((d) => {
                      d.household.filingStatus = [
                        ...status,
                        {
                          fromYear: (status[status.length - 1]?.fromYear ?? d.settings.startYear) + 5,
                          status: 'single',
                        },
                      ];
                    })
                  }
                >
                  Add a change
                </Button>
              </div>
            </Fold>

            <Fold
              title="Children and dependents"
              icon="user"
              kind="income"
              summary={deps.length ? deps.map((d) => `${d.name} (${d.birthYear})`).join(' · ') : 'None'}
              defaultOpen={deps.length > 0}
              storageKey="household:dependents"
              data-tour="dependents"
            >
              <Lead>
                Dependents affect the child tax credit, household size for health subsidies, and filing status
                after a death.
              </Lead>
              {deps.map((dep, i) => (
                <div className="pib-line" key={i}>
                  <div className="pib-grow">
                    <TextField
                      label="Name"
                      value={dep.name}
                      onChange={(v) =>
                        update((d) => {
                          d.household.dependents[i].name = v;
                        })
                      }
                    />
                  </div>
                  <div className="pib-narrow">
                    <NumberField
                      label="Born"
                      value={dep.birthYear}
                      min={1980}
                      max={2150}
                      onChange={(v) =>
                        update((d) => {
                          d.household.dependents[i].birthYear = v;
                        })
                      }
                    />
                  </div>
                  <Button
                    variant="ghost"
                    icon="trash"
                    label={`Remove ${dep.name}`}
                    onClick={() =>
                      update((d) => {
                        d.household.dependents.splice(i, 1);
                      })
                    }
                  />
                </div>
              ))}
              <div style={{ marginTop: 8 }}>
                <Button
                  size="sm"
                  icon="plus"
                  onClick={() =>
                    update((d) => {
                      d.household.dependents.push({ name: 'Child', birthYear: d.settings.startYear - 5 });
                    })
                  }
                >
                  Add a dependent
                </Button>
              </div>
            </Fold>
          </>
        }
      />

      <EditDialog
        open={!!person}
        title={person ? `Edit ${person.name}` : ''}
        onClose={() => setEditing(null)}
        onDelete={
          idx === 1
            ? () =>
                update((d) => {
                  const id = d.people[1].id;
                  d.people.splice(1, 1);
                  d.accounts.forEach((a) => {
                    if (a.ownerId === id || a.ownerId === 'joint') a.ownerId = d.people[0].id;
                  });
                  d.incomes = d.incomes.filter((i) => i.ownerId !== id);
                  d.healthcare.people = d.healthcare.people.filter((h) => h.personId !== id);
                })
            : undefined
        }
      >
        {person ? (
          <>
            <div className="form-grid">
              <TextField
                label="Name"
                value={person.name}
                onChange={(v) =>
                  set((p) => {
                    p.name = v;
                  })
                }
              />
              <TextField
                label="Date of birth"
                type="date"
                value={person.birthDate}
                onChange={(v) => {
                  if (/^\d{4}-\d{2}-\d{2}$/.test(v))
                    set((p) => {
                      p.birthDate = v;
                    });
                }}
              />
              <SelectField
                label="Sex (for life tables)"
                value={person.sex ?? 'unset'}
                options={[
                  { value: 'unset', label: 'Prefer not to say' },
                  { value: 'female', label: 'Female' },
                  { value: 'male', label: 'Male' },
                ]}
                onChange={(v) =>
                  set((p) => {
                    p.sex = v === 'unset' ? undefined : (v as 'male' | 'female');
                  })
                }
              />
              <NumberField
                label="Plan until age"
                hint={
                  survivalNote(
                    +person.birthDate.slice(0, 4),
                    person.sex,
                    person.longevity.age,
                    plan.settings.startYear,
                  ) ?? undefined
                }
                value={person.longevity.age}
                min={50}
                max={115}
                onChange={(v) =>
                  set((p) => {
                    p.longevity.age = v;
                  })
                }
              />
            </div>
            <LifespanSwitch plan={plan} />
            <div className="pib-sub">
              <h3>Where they live</h3>
              <Button
                size="sm"
                icon="plus"
                onClick={() =>
                  set((p) => {
                    p.residence.push({
                      state: p.residence[p.residence.length - 1]?.state ?? 'TX',
                      fromYear: (p.residence[p.residence.length - 1]?.fromYear ?? plan.settings.startYear) + 10,
                    });
                  })
                }
              >
                Add a move
              </Button>
            </div>
            {person.residence.map((r, i) => (
              <div className="pib-line" key={i}>
                <div className="pib-narrow">
                  <NumberField
                    label="From year"
                    value={r.fromYear}
                    min={1950}
                    max={2150}
                    onChange={(v) =>
                      set((p) => {
                        p.residence[i].fromYear = v;
                      })
                    }
                  />
                </div>
                <div className="pib-narrow">
                  <SelectField
                    label="State"
                    value={r.state}
                    options={STATES.map((s) => ({ value: s, label: s }))}
                    onChange={(v) =>
                      set((p) => {
                        p.residence[i].state = v;
                        p.residence[i].countyFips = undefined;
                      })
                    }
                  />
                </div>
                <div className="pib-grow">
                  <TextField
                    label="County FIPS (optional)"
                    value={r.countyFips ?? ''}
                    onChange={(v) =>
                      set((p) => {
                        p.residence[i].countyFips = /^\d{5}$/.test(v)
                          ? v
                          : v === ''
                            ? undefined
                            : p.residence[i].countyFips;
                      })
                    }
                  />
                </div>
                {person.residence.length > 1 ? (
                  <Button
                    variant="ghost"
                    icon="trash"
                    label="Remove this residence"
                    onClick={() =>
                      set((p) => {
                        p.residence.splice(i, 1);
                      })
                    }
                  />
                ) : null}
              </div>
            ))}
            <div className="pib-sub">
              <h3>Social Security</h3>
            </div>
            <div className="form-grid" data-tour="ss-settings">
              <SelectField
                label="Benefit comes from"
                value={person.socialSecurity.mode}
                options={[
                  { value: 'earnings', label: 'My earnings record' },
                  { value: 'pia', label: 'A benefit estimate I enter' },
                  { value: 'none', label: 'No Social Security' },
                ]}
                onChange={(v) =>
                  set((p) => {
                    p.socialSecurity.mode = v;
                  })
                }
              />
              {person.socialSecurity.mode === 'pia' ? (
                <MoneyField
                  label="Monthly benefit"
                  help={helpText('Monthly benefit at full retirement age')}
                  hint="At full retirement age, today's dollars."
                  cents={person.socialSecurity.piaMonthly}
                  onChange={(v) =>
                    set((p) => {
                      p.socialSecurity.piaMonthly = v;
                    })
                  }
                />
              ) : null}
              <NumberField
                label="Claim at age"
                value={person.socialSecurity.claimAge.years}
                min={62}
                max={70}
                onChange={(v) =>
                  set((p) => {
                    p.socialSecurity.claimAge.years = v;
                    if (v === 70) p.socialSecurity.claimAge.months = 0;
                  })
                }
              />
              <NumberField
                label="…plus months"
                value={person.socialSecurity.claimAge.months}
                min={0}
                max={11}
                onChange={(v) =>
                  set((p) => {
                    p.socialSecurity.claimAge.months = p.socialSecurity.claimAge.years === 70 ? 0 : v;
                  })
                }
              />
            </div>
            {person.socialSecurity.mode === 'earnings' ? (
              <div className="lv-row">
                <Button
                  size="sm"
                  onClick={() => {
                    setEarningsFor(person.id);
                    setEditing(null);
                  }}
                >
                  Edit earnings record ({person.socialSecurity.earnings.length} years)
                </Button>
                {person.socialSecurity.earnings.length === 0 ? (
                  <span className="lv-muted lv-small">Empty: the benefit is estimated from current wages.</span>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
      </EditDialog>

      <EditDialog
        open={!!ePerson}
        title={ePerson ? `${ePerson.name}: Social Security earnings` : ''}
        onClose={() => setEarningsFor(null)}
      >
        {ePerson ? (
          <>
            <p className="lv-muted lv-small">
              Copy the taxed Social Security earnings from your statement at ssa.gov. Future years come from the
              income you enter in the plan.
            </p>
            <div className="lv-row">
              <Button
                size="sm"
                icon="plus"
                onClick={() =>
                  update((d) => {
                    const e = d.people[eIdx].socialSecurity.earnings;
                    const last = e.length
                      ? Math.max(...e.map((x) => x.year))
                      : +ePerson.birthDate.slice(0, 4) + 21;
                    if (last + 1 < d.settings.startYear)
                      e.push({ year: last + 1, amount: e.length ? e[e.length - 1].amount : 3000000 });
                  })
                }
              >
                Add a year
              </Button>
              <span className="lv-muted lv-small">
                Total entered:{' '}
                {formatMoney(ePerson.socialSecurity.earnings.reduce((s, x) => s + x.amount, 0) / 100)}
              </span>
            </div>
            <div className="form-grid">
              {[...ePerson.socialSecurity.earnings]
                .sort((a, b) => b.year - a.year)
                .map((e) => {
                  const i = ePerson.socialSecurity.earnings.findIndex((x) => x.year === e.year);
                  return (
                    <div className="lv-row" key={e.year} style={{ alignItems: 'flex-end', flexWrap: 'nowrap' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <MoneyField
                          label={`${e.year}`}
                          cents={e.amount}
                          onChange={(v) =>
                            update((d) => {
                              d.people[eIdx].socialSecurity.earnings[i].amount = Math.max(0, v);
                            })
                          }
                        />
                      </div>
                      <Button
                        variant="ghost"
                        icon="trash"
                        label={`Remove ${e.year}`}
                        onClick={() =>
                          update((d) => {
                            d.people[eIdx].socialSecurity.earnings.splice(i, 1);
                          })
                        }
                      />
                    </div>
                  );
                })}
            </div>
          </>
        ) : null}
      </EditDialog>
    </>
  );
}
