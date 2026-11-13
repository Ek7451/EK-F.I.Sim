import { ACCOUNT_TYPES, type Account, type Asset, type Debt } from '@fisim/engine';
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
import { Link } from 'react-router-dom';
import {
  ACCOUNT_LABELS,
  AllocationEditor,
  EditDialog,
  EmptyState,
  GrowthField,
  WhenField,
  describeWhen,
  ownerOptions,
} from '../../lib/fields';
import { PageHead } from '../../shell/Shell';
import { newId, usePlan, useUpdate } from '../../state/store';

const PRETAX = [
  'trad401k',
  'trad403b',
  'gov457b',
  'tradIra',
  'sepIra',
  'simpleIra',
  'solo401k',
  'inheritedIra',
];
const HAS_BASIS = ['taxable', 'annuity', 'iBond', 'plan529'];
const PAYROLL = ['trad401k', 'trad403b', 'gov457b', 'roth401k', 'solo401k', 'simpleIra', 'sepIra', 'hsa'];
const CASHLIKE = ['cash', 'tBill', 'iBond'];

/** Icon for each account type, by what the account is for. */
const ACCOUNT_ICON: Record<string, string> = {
  taxable: 'trendUp',
  cash: 'piggy',
  tBill: 'piggy',
  iBond: 'shield',
  trad401k: 'briefcase',
  trad403b: 'briefcase',
  gov457b: 'briefcase',
  solo401k: 'briefcase',
  sepIra: 'briefcase',
  simpleIra: 'briefcase',
  tradIra: 'bank',
  inheritedIra: 'bank',
  roth401k: 'leaf',
  rothIra: 'leaf',
  hsa: 'heart',
  plan529: 'school',
  annuity: 'clock',
};

export function SnapshotPage(): ReactNode {
  const plan = usePlan()!;
  const update = useUpdate();
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState('all');
  const accountGroup = (type: string): string =>
    PRETAX.includes(type)
      ? 'Pre-tax'
      : type.startsWith('roth')
        ? 'Roth'
        : type === 'hsa'
          ? 'HSA'
          : ['cash', 'tBill', 'iBond'].includes(type)
            ? 'Cash and bonds'
            : 'Taxable and other';
  const visible = plan.accounts.filter(
    (a) =>
      (group === 'all' || accountGroup(a.type) === group) &&
      `${a.name} ${ACCOUNT_LABELS[a.type]}`.toLowerCase().includes(search.toLowerCase()),
  );
  const [acct, setAcct] = useState<string | null>(null);
  const [asset, setAsset] = useState<string | null>(null);
  const [debt, setDebt] = useState<string | null>(null);
  const a = plan.accounts.find((x) => x.id === acct);
  const ai = plan.accounts.findIndex((x) => x.id === acct);
  const setA = (fn: (x: Account) => void): void => update((d) => fn(d.accounts[ai]));
  const s = plan.assets.find((x) => x.id === asset);
  const si = plan.assets.findIndex((x) => x.id === asset);
  const setS = (fn: (x: Asset) => void): void => update((d) => fn(d.assets[si]));
  const b = plan.debts.find((x) => x.id === debt);
  const bi = plan.debts.findIndex((x) => x.id === debt);
  const setB = (fn: (x: Debt) => void): void => update((d) => fn(d.debts[bi]));

  const invest = plan.accounts.reduce((t, x) => t + x.balance, 0) / 100;
  const owned = plan.assets.filter((x) => !x.purchase).reduce((t, x) => t + x.value, 0) / 100;
  const owed = plan.debts.filter((x) => !x.start).reduce((t, x) => t + x.principal, 0) / 100;
  const ownerName = (id: string): string =>
    id === 'joint' ? 'Joint' : (plan.people.find((p) => p.id === id)?.name ?? '');

  return (
    <>
      <PageHead
        group="plan"
        title="What you have"
        intro="Balances are typed in by hand and stay on this device. Nothing here connects to a bank."
      />
      <Card variant="hero" data-tour="snapshot-totals">
        <div className="lv-grid">
          <Stat label="Accounts" value={formatMoney(invest)} />
          <Stat label="Property and other" value={formatMoney(owned)} />
          <Stat label="Debts" value={formatMoney(owed)} />
          <Stat
            label="Net worth today"
            value={formatMoney(invest + owned - owed)}
            data-tour="net-worth-today"
          />
        </div>
      </Card>

      <Card
        title="Accounts"
        data-tour="accounts"
        actions={
          <Button
            variant="primary"
            icon="plus"
            data-tour="add-account"
            onClick={() => {
              const id = newId('a');
              update((d) => {
                d.accounts.push({
                  id,
                  ownerId: d.people[0].id,
                  name: 'New account',
                  type: 'taxable',
                  balance: 0,
                  costBasis: 0,
                  allocation: { usStocks: 0.6, usBonds: 0.4, cash: 0, intlStocks: 0, reits: 0 },
                  fees: { expenseRatio: 0, advisory: 0 },
                  ruleOf55: false,
                });
              });
              setAcct(id);
            }}
          >
            Add account
          </Button>
        }
      >
        {plan.accounts.length === 0 ? (
          <EmptyState title="No accounts yet">
            Add your savings, brokerage and retirement accounts to see a projection.
          </EmptyState>
        ) : null}
        <div className="form-grid" style={{ marginBottom: 16 }}>
          <TextField label="Search accounts" value={search} onChange={setSearch} />
          <SelectField
            label="Tax treatment"
            value={group}
            onChange={setGroup}
            options={[
              { value: 'all', label: 'All accounts' },
              ...['Pre-tax', 'Roth', 'HSA', 'Cash and bonds', 'Taxable and other'].map((x) => ({
                value: x,
                label: x,
              })),
            ]}
          />
        </div>
        <div className="lv-row" style={{ marginBottom: 12 }}>
          {['Pre-tax', 'Roth', 'HSA', 'Cash and bonds', 'Taxable and other']
            .filter((g) => plan.accounts.some((a) => accountGroup(a.type) === g))
            .map((g) => (
              <Badge key={g}>
                {g}:{' '}
                {formatMoney(
                  plan.accounts
                    .filter((a) => accountGroup(a.type) === g)
                    .reduce((sum, a) => sum + a.balance, 0) / 100,
                )}
              </Badge>
            ))}
        </div>
        {!visible.length && !!plan.accounts.length && <p>No accounts match these filters.</p>}
        <ul className="lv-list">
          {visible
            .sort((a, b) => accountGroup(a.type).localeCompare(accountGroup(b.type)))
            .map((x) => (
              <li key={x.id} data-tour="account-row">
                <IconTile icon={ACCOUNT_ICON[x.type] ?? 'bank'} />
                <div className="lv-grow">
                  <div>
                    <strong>{x.name}</strong>
                  </div>
                  <div className="lv-muted lv-small">
                    {ACCOUNT_LABELS[x.type]} · {ownerName(x.ownerId)}
                  </div>
                  <div className="lv-row lv-small">
                    {x.contribution && (
                      <Link
                        to={
                          x.contribution.incomeId
                            ? `/plan/income?edit=${encodeURIComponent(x.contribution.incomeId)}`
                            : '/plan/strategy'
                        }
                      >
                        Employee contributions:{' '}
                        {x.contribution.maxOut
                          ? 'legal maximum'
                          : x.contribution.employeePct
                            ? `${(x.contribution.employeePct * 100).toFixed(1)}% of pay`
                            : `${formatMoney(x.contribution.employeeAmount / 100)} / year`}
                      </Link>
                    )}
                    <Link to="/plan/strategy#withdrawal-order">Withdrawal rules</Link>
                  </div>
                </div>
                <span className="lv-num">{formatMoney(x.balance / 100)}</span>
                <Button size="sm" icon="edit" label={`Edit ${x.name}`} onClick={() => setAcct(x.id)} />
              </li>
            ))}
        </ul>
      </Card>

      <div className="two-col" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        <Card
          title="Property and other assets"
          data-tour="assets"
          actions={
            <Button
              icon="plus"
              data-tour="add-asset"
              onClick={() => {
                const id = newId('as');
                update((d) => {
                  d.assets.push({
                    id,
                    ownerId: d.people[0].id,
                    name: 'Home',
                    kind: 'primaryHome',
                    value: 0,
                    appreciation: { rate: 0, basis: 'real' },
                    property: {
                      propertyTaxRate: 0.011,
                      insuranceAnnual: 0,
                      maintenanceRate: 0.01,
                      hoaAnnual: 0,
                    },
                  });
                });
                setAsset(id);
              }}
            >
              Add
            </Button>
          }
        >
          {plan.assets.length === 0 ? (
            <p className="lv-muted">Homes, rentals, vehicles and anything else of value.</p>
          ) : null}
          <ul className="lv-list">
            {plan.assets.map((x) => (
              <li key={x.id}>
                <IconTile icon={x.kind === 'vehicle' ? 'car' : 'estate'} kind="milestone" />
                <div className="lv-grow">
                  <strong>{x.name}</strong>
                  <div className="lv-muted lv-small">
                    {x.purchase
                      ? `Planned purchase: ${describeWhen(plan, x.purchase.when)}`
                      : x.kind === 'primaryHome'
                        ? 'Primary home'
                        : x.kind}
                    {x.sale ? ` · sells ${describeWhen(plan, x.sale.when)}` : ''}
                  </div>
                </div>
                <span className="lv-num">{formatMoney(x.value / 100)}</span>
                <Button size="sm" icon="edit" label={`Edit ${x.name}`} onClick={() => setAsset(x.id)} />
              </li>
            ))}
          </ul>
        </Card>
        <Card
          title="Debts"
          data-tour="debts"
          actions={
            <Button
              icon="plus"
              data-tour="add-debt"
              onClick={() => {
                const id = newId('d');
                update((d) => {
                  d.debts.push({
                    id,
                    ownerId: d.people[0].id,
                    name: 'Loan',
                    kind: 'personal',
                    principal: 0,
                    rate: 0.06,
                    payment: 0,
                    termMonths: 60,
                    revolvingPayPct: 0.02,
                    refinance: [],
                  });
                });
                setDebt(id);
              }}
            >
              Add
            </Button>
          }
        >
          {plan.debts.length === 0 ? (
            <p className="lv-muted">Mortgages, student loans, car loans and card balances.</p>
          ) : null}
          <ul className="lv-list">
            {plan.debts.map((x) => (
              <li key={x.id}>
                <IconTile
                  icon={
                    x.kind === 'mortgage'
                      ? 'estate'
                      : x.kind === 'student'
                        ? 'school'
                        : x.kind === 'auto'
                          ? 'car'
                          : 'card'
                  }
                  kind="debt"
                />
                <div className="lv-grow">
                  <strong>{x.name}</strong>
                  <div className="lv-muted lv-small">
                    {(x.rate * 100).toFixed(2)}% ·{' '}
                    {x.payment
                      ? `${formatMoney(x.payment / 100)}/mo`
                      : x.termMonths
                        ? `${x.termMonths} months left`
                        : 'interest only'}
                  </div>
                </div>
                <span className="lv-num">{formatMoney(x.principal / 100)}</span>
                <Button size="sm" icon="edit" label={`Edit ${x.name}`} onClick={() => setDebt(x.id)} />
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <EditDialog
        open={!!a}
        title={a ? a.name : ''}
        onClose={() => setAcct(null)}
        onDelete={() =>
          update((d) => {
            d.accounts.splice(ai, 1);
          })
        }
      >
        {a ? (
          <>
            <div className="form-grid">
              <TextField
                label="Name"
                value={a.name}
                onChange={(v) =>
                  setA((x) => {
                    x.name = v;
                  })
                }
                data-tour="account-name"
              />
              <SelectField
                label="Type"
                value={a.type}
                options={ACCOUNT_TYPES.map((t) => ({ value: t, label: ACCOUNT_LABELS[t] }))}
                onChange={(v) =>
                  setA((x) => {
                    x.type = v;
                    if (!PAYROLL.includes(v)) x.contribution = undefined;
                  })
                }
                data-tour="account-type"
              />
              <SelectField
                label="Owner"
                value={a.ownerId}
                options={ownerOptions(plan, a.type === 'taxable' || a.type === 'cash')}
                onChange={(v) =>
                  setA((x) => {
                    x.ownerId = v;
                  })
                }
              />
              <MoneyField
                label="Balance today"
                cents={a.balance}
                onChange={(v) =>
                  setA((x) => {
                    x.balance = Math.max(0, v);
                  })
                }
                data-tour="account-balance"
              />
              {HAS_BASIS.includes(a.type) ? (
                <MoneyField
                  label="Cost basis"
                  hint="What you paid in. Only the growth above this is taxed when you sell."
                  cents={a.costBasis ?? a.balance}
                  onChange={(v) =>
                    setA((x) => {
                      x.costBasis = Math.max(0, v);
                    })
                  }
                  data-tour="account-basis"
                />
              ) : null}
              {a.type === 'rothIra' || a.type === 'roth401k' ? (
                <MoneyField
                  label="Contributions so far"
                  hint="Your own contributions can come out at any age without tax or penalty."
                  cents={a.rothBasis?.contributions ?? a.balance}
                  onChange={(v) =>
                    setA((x) => {
                      x.rothBasis = {
                        contributions: Math.max(0, v),
                        conversions: x.rothBasis?.conversions ?? [],
                        firstContributionYear: x.rothBasis?.firstContributionYear,
                      };
                    })
                  }
                />
              ) : null}
              {a.type === 'rothIra' || a.type === 'roth401k' ? (
                <NumberField
                  label="First contribution year"
                  value={a.rothBasis?.firstContributionYear ?? plan.settings.startYear - 5}
                  min={1998}
                  max={2150}
                  onChange={(v) =>
                    setA((x) => {
                      x.rothBasis = {
                        contributions: x.rothBasis?.contributions ?? x.balance,
                        conversions: x.rothBasis?.conversions ?? [],
                        firstContributionYear: v,
                      };
                    })
                  }
                />
              ) : null}
              <PercentField
                label="Fund expense ratio"
                value={a.fees.expenseRatio}
                digits={3}
                onChange={(v) =>
                  setA((x) => {
                    x.fees.expenseRatio = Math.max(0, v);
                  })
                }
              />
              <PercentField
                label="Advisory fee"
                value={a.fees.advisory}
                digits={3}
                onChange={(v) =>
                  setA((x) => {
                    x.fees.advisory = Math.max(0, v);
                  })
                }
              />
            </div>
            {CASHLIKE.includes(a.type) ? (
              <GrowthField
                label={a.type === 'iBond' ? 'Fixed rate' : 'Interest rate'}
                value={
                  a.fixedYield ?? {
                    rate: a.type === 'iBond' ? 0.01 : 0.035,
                    basis: a.type === 'iBond' ? 'real' : 'nominal',
                  }
                }
                onChange={(v) =>
                  setA((x) => {
                    x.fixedYield = v;
                  })
                }
              />
            ) : (
              <>
                <AllocationEditor
                  value={a.allocation}
                  onChange={(v) =>
                    setA((x) => {
                      x.allocation = v;
                    })
                  }
                />
                {plan.glidePaths.length ? (
                  <SelectField
                    label="Glide path"
                    hint="Shifts the mix as the owner ages. Set these up under Assumptions."
                    value={a.glidePathId ?? 'none'}
                    options={[
                      { value: 'none', label: 'None: keep this mix' },
                      ...plan.glidePaths.map((g) => ({ value: g.id, label: g.name })),
                    ]}
                    onChange={(v) =>
                      setA((x) => {
                        x.glidePathId = v === 'none' ? undefined : v;
                      })
                    }
                  />
                ) : null}
              </>
            )}
            {PRETAX.includes(a.type) && a.type !== 'inheritedIra' && a.type !== 'gov457b' ? (
              <Switch
                label="Rule of 55: I can draw on this penalty-free if I leave this employer at 55 or later"
                checked={a.ruleOf55}
                onChange={(v) =>
                  setA((x) => {
                    x.ruleOf55 = v;
                  })
                }
              />
            ) : null}
            {a.type === 'inheritedIra' ? (
              <div className="form-grid">
                <NumberField
                  label="Year the original owner died"
                  value={a.inherited?.yearOfDeath ?? plan.settings.startYear - 1}
                  min={2020}
                  max={2150}
                  onChange={(v) =>
                    setA((x) => {
                      x.inherited = {
                        yearOfDeath: v,
                        decedentHadStartedRmds: x.inherited?.decedentHadStartedRmds ?? false,
                      };
                    })
                  }
                />
                <Switch
                  label="They had started required distributions"
                  checked={a.inherited?.decedentHadStartedRmds ?? false}
                  onChange={(v) =>
                    setA((x) => {
                      x.inherited = {
                        yearOfDeath: x.inherited?.yearOfDeath ?? plan.settings.startYear - 1,
                        decedentHadStartedRmds: v,
                      };
                    })
                  }
                />
              </div>
            ) : null}
            {a.type === 'plan529' ? (
              <div className="form-grid">
                <NumberField
                  label="Year opened"
                  value={a.plan529?.openedYear ?? plan.settings.startYear}
                  min={1997}
                  max={2150}
                  onChange={(v) =>
                    setA((x) => {
                      x.plan529 = {
                        openedYear: v,
                        rollToRoth: x.plan529?.rollToRoth ?? false,
                        rothRolloverAccountId: x.plan529?.rothRolloverAccountId,
                      };
                    })
                  }
                />
                <Switch
                  label="Roll leftovers into a Roth IRA (after 15 years, within the lifetime cap)"
                  checked={a.plan529?.rollToRoth ?? false}
                  onChange={(v) =>
                    setA((x) => {
                      x.plan529 = {
                        openedYear: x.plan529?.openedYear ?? plan.settings.startYear,
                        rollToRoth: v,
                        rothRolloverAccountId: x.plan529?.rothRolloverAccountId,
                      };
                    })
                  }
                />
              </div>
            ) : null}
            {PAYROLL.includes(a.type) ? (
              <fieldset
                style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 16 }}
                data-tour="payroll-savings"
              >
                <legend className="lv-label">Savings from pay</legend>
                <div className="lv-stack">
                  <Switch
                    label="Contribute to this account from income"
                    checked={!!a.contribution}
                    onChange={(v) =>
                      setA((x) => {
                        x.contribution = v
                          ? {
                              employeePct: 0.06,
                              employeeAmount: 0,
                              maxOut: false,
                              employerMatch: [],
                              employerFixedPct: 0,
                              megaBackdoor: false,
                            }
                          : undefined;
                      })
                    }
                  />
                  {a.contribution ? (
                    <>
                      <div className="form-grid">
                        <SelectField
                          label="From which income"
                          value={a.contribution.incomeId ?? 'auto'}
                          options={[
                            { value: 'auto', label: "Owner's earnings" },
                            ...plan.incomes
                              .filter(
                                (i) => i.taxCharacter === 'earned' || i.taxCharacter === 'selfEmployment',
                              )
                              .map((i) => ({ value: i.id, label: i.name })),
                          ]}
                          onChange={(v) =>
                            setA((x) => {
                              x.contribution!.incomeId = v === 'auto' ? undefined : v;
                            })
                          }
                        />
                        <PercentField
                          label="Share of pay"
                          value={a.contribution.employeePct}
                          onChange={(v) =>
                            setA((x) => {
                              x.contribution!.employeePct = Math.max(0, Math.min(1, v));
                            })
                          }
                        />
                        <MoneyField
                          label="Plus a flat yearly amount"
                          cents={a.contribution.employeeAmount}
                          onChange={(v) =>
                            setA((x) => {
                              x.contribution!.employeeAmount = Math.max(0, v);
                            })
                          }
                        />
                        <PercentField
                          label="Employer adds (share of pay)"
                          hint="Paid whether or not you contribute."
                          value={a.contribution.employerFixedPct}
                          onChange={(v) =>
                            setA((x) => {
                              x.contribution!.employerFixedPct = Math.max(0, Math.min(1, v));
                            })
                          }
                        />
                      </div>
                      <Switch
                        label="Contribute the legal maximum, including catch-up amounts"
                        checked={a.contribution.maxOut}
                        onChange={(v) =>
                          setA((x) => {
                            x.contribution!.maxOut = v;
                          })
                        }
                      />
                      {a.type !== 'hsa' && a.type !== 'sepIra' ? (
                        <>
                          <div className="lv-spread">
                            <span className="lv-label">Employer match</span>
                            <Button
                              size="sm"
                              icon="plus"
                              onClick={() =>
                                setA((x) => {
                                  x.contribution!.employerMatch.push({
                                    matchPct: 0.5,
                                    upToPctOfSalary:
                                      (x.contribution!.employerMatch.at(-1)?.upToPctOfSalary ?? 0) + 0.06,
                                  });
                                })
                              }
                            >
                              Add a tier
                            </Button>
                          </div>
                          {a.contribution.employerMatch.map((t, i) => (
                            <div className="lv-row" key={i} style={{ alignItems: 'flex-end' }}>
                              <div style={{ flex: 1 }}>
                                <PercentField
                                  label="Employer matches"
                                  value={t.matchPct}
                                  digits={0}
                                  onChange={(v) =>
                                    setA((x) => {
                                      x.contribution!.employerMatch[i].matchPct = Math.max(0, v);
                                    })
                                  }
                                />
                              </div>
                              <div style={{ flex: 1 }}>
                                <PercentField
                                  label="…of contributions up to this share of pay"
                                  value={t.upToPctOfSalary}
                                  onChange={(v) =>
                                    setA((x) => {
                                      x.contribution!.employerMatch[i].upToPctOfSalary = Math.max(
                                        0,
                                        Math.min(1, v),
                                      );
                                    })
                                  }
                                />
                              </div>
                              <Button
                                variant="ghost"
                                icon="trash"
                                label="Remove tier"
                                onClick={() =>
                                  setA((x) => {
                                    x.contribution!.employerMatch.splice(i, 1);
                                  })
                                }
                              />
                            </div>
                          ))}
                          {a.type === 'trad401k' || a.type === 'trad403b' || a.type === 'roth401k' ? (
                            <Switch
                              label="Mega-backdoor Roth: after-tax contributions up to the plan limit, converted to Roth"
                              checked={a.contribution.megaBackdoor}
                              onChange={(v) =>
                                setA((x) => {
                                  x.contribution!.megaBackdoor = v;
                                })
                              }
                            />
                          ) : null}
                        </>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </fieldset>
            ) : null}
          </>
        ) : null}
      </EditDialog>

      <EditDialog
        open={!!s}
        title={s ? s.name : ''}
        onClose={() => setAsset(null)}
        onDelete={() =>
          update((d) => {
            d.assets.splice(si, 1);
          })
        }
      >
        {s ? (
          <>
            <div className="form-grid">
              <TextField
                label="Name"
                value={s.name}
                onChange={(v) =>
                  setS((x) => {
                    x.name = v;
                  })
                }
              />
              <SelectField
                label="Kind"
                value={s.kind}
                options={[
                  { value: 'primaryHome', label: 'Primary home' },
                  { value: 'rental', label: 'Rental property' },
                  { value: 'vehicle', label: 'Vehicle' },
                  { value: 'other', label: 'Other' },
                ]}
                onChange={(v) =>
                  setS((x) => {
                    x.kind = v;
                    if (v === 'vehicle' || v === 'other') x.property = undefined;
                    else
                      x.property ??= {
                        propertyTaxRate: 0.011,
                        insuranceAnnual: 0,
                        maintenanceRate: 0.01,
                        hoaAnnual: 0,
                      };
                  })
                }
              />
              <MoneyField
                label={s.purchase ? "Price in today's dollars" : 'Value today'}
                cents={s.value}
                onChange={(v) =>
                  setS((x) => {
                    x.value = Math.max(0, v);
                  })
                }
              />
              {!s.purchase ? (
                <MoneyField
                  label="What you paid (basis)"
                  cents={s.costBasis ?? s.value}
                  onChange={(v) =>
                    setS((x) => {
                      x.costBasis = Math.max(0, v);
                    })
                  }
                />
              ) : null}
            </div>
            <GrowthField
              label={
                s.kind === 'vehicle' ? 'Yearly change in value (negative loses value)' : 'Yearly appreciation'
              }
              value={s.appreciation}
              onChange={(v) =>
                setS((x) => {
                  x.appreciation = v;
                })
              }
            />
            {s.property ? (
              <div className="form-grid">
                <PercentField
                  label="Property tax (share of value)"
                  value={s.property.propertyTaxRate}
                  onChange={(v) =>
                    setS((x) => {
                      x.property!.propertyTaxRate = Math.max(0, v);
                    })
                  }
                />
                <PercentField
                  label="Upkeep (share of value)"
                  value={s.property.maintenanceRate}
                  onChange={(v) =>
                    setS((x) => {
                      x.property!.maintenanceRate = Math.max(0, v);
                    })
                  }
                />
                <MoneyField
                  label="Insurance per year"
                  cents={s.property.insuranceAnnual}
                  onChange={(v) =>
                    setS((x) => {
                      x.property!.insuranceAnnual = Math.max(0, v);
                    })
                  }
                />
                <MoneyField
                  label="HOA per year"
                  cents={s.property.hoaAnnual}
                  onChange={(v) =>
                    setS((x) => {
                      x.property!.hoaAnnual = Math.max(0, v);
                    })
                  }
                />
              </div>
            ) : null}
            <Switch
              label="This is a future purchase"
              checked={!!s.purchase}
              onChange={(v) =>
                setS((x) => {
                  x.purchase = v
                    ? {
                        when: { type: 'year', year: plan.settings.startYear + 3 },
                        downPaymentPct: 0.2,
                        closingCostPct: 0.03,
                        mortgageRate: 0.065,
                        mortgageTermYears: 30,
                      }
                    : undefined;
                })
              }
            />
            {s.purchase ? (
              <>
                <WhenField
                  plan={plan}
                  label="Buy"
                  value={s.purchase.when}
                  onChange={(v) =>
                    setS((x) => {
                      if (v) x.purchase!.when = v;
                    })
                  }
                />
                <div className="form-grid">
                  <PercentField
                    label="Down payment"
                    value={s.purchase.downPaymentPct}
                    digits={0}
                    onChange={(v) =>
                      setS((x) => {
                        x.purchase!.downPaymentPct = Math.max(0, Math.min(1, v));
                      })
                    }
                  />
                  <PercentField
                    label="Closing costs"
                    value={s.purchase.closingCostPct}
                    onChange={(v) =>
                      setS((x) => {
                        x.purchase!.closingCostPct = Math.max(0, Math.min(0.2, v));
                      })
                    }
                  />
                  <PercentField
                    label="Mortgage rate"
                    value={s.purchase.mortgageRate}
                    onChange={(v) =>
                      setS((x) => {
                        x.purchase!.mortgageRate = Math.max(0, v);
                      })
                    }
                  />
                  <NumberField
                    label="Mortgage years"
                    value={s.purchase.mortgageTermYears}
                    min={1}
                    max={40}
                    onChange={(v) =>
                      setS((x) => {
                        x.purchase!.mortgageTermYears = v;
                      })
                    }
                  />
                </div>
              </>
            ) : null}
            <Switch
              label="Plan to sell"
              checked={!!s.sale}
              onChange={(v) =>
                setS((x) => {
                  x.sale = v
                    ? { when: { type: 'year', year: plan.settings.startYear + 15 }, sellingCostPct: 0.06 }
                    : undefined;
                })
              }
            />
            {s.sale ? (
              <>
                <WhenField
                  plan={plan}
                  label="Sell"
                  value={s.sale.when}
                  onChange={(v) =>
                    setS((x) => {
                      if (v) x.sale!.when = v;
                    })
                  }
                />
                <PercentField
                  label="Selling costs"
                  hint={
                    s.kind === 'primaryHome'
                      ? 'The home-sale exclusion ($250,000, or $500,000 filing jointly) is applied to the gain.'
                      : undefined
                  }
                  value={s.sale.sellingCostPct}
                  onChange={(v) =>
                    setS((x) => {
                      x.sale!.sellingCostPct = Math.max(0, Math.min(0.2, v));
                    })
                  }
                />
              </>
            ) : null}
          </>
        ) : null}
      </EditDialog>

      <EditDialog
        open={!!b}
        title={b ? b.name : ''}
        onClose={() => setDebt(null)}
        onDelete={() =>
          update((d) => {
            d.debts.splice(bi, 1);
          })
        }
      >
        {b ? (
          <>
            <div className="form-grid">
              <TextField
                label="Name"
                value={b.name}
                onChange={(v) =>
                  setB((x) => {
                    x.name = v;
                  })
                }
              />
              <SelectField
                label="Kind"
                value={b.kind}
                options={[
                  { value: 'mortgage', label: 'Mortgage' },
                  { value: 'auto', label: 'Car loan' },
                  { value: 'student', label: 'Student loan' },
                  { value: 'personal', label: 'Personal loan' },
                  { value: 'revolving', label: 'Credit card / revolving' },
                  { value: 'other', label: 'Other' },
                ]}
                onChange={(v) =>
                  setB((x) => {
                    x.kind = v;
                  })
                }
              />
              <MoneyField
                label="Balance owed"
                cents={b.principal}
                onChange={(v) =>
                  setB((x) => {
                    x.principal = Math.max(0, v);
                  })
                }
              />
              <PercentField
                label="Interest rate"
                value={b.rate}
                onChange={(v) =>
                  setB((x) => {
                    x.rate = Math.max(0, v);
                  })
                }
              />
              {b.kind === 'revolving' ? (
                <PercentField
                  label="Balance paid down each year"
                  value={b.revolvingPayPct}
                  digits={0}
                  onChange={(v) =>
                    setB((x) => {
                      x.revolvingPayPct = Math.max(0, Math.min(1, v));
                    })
                  }
                />
              ) : (
                <>
                  <MoneyField
                    label="Monthly payment"
                    hint="Leave at 0 to work it out from the months left."
                    cents={b.payment}
                    onChange={(v) =>
                      setB((x) => {
                        x.payment = Math.max(0, v);
                      })
                    }
                  />
                  <NumberField
                    label="Months left"
                    value={b.termMonths}
                    min={0}
                    max={480}
                    onChange={(v) =>
                      setB((x) => {
                        x.termMonths = v;
                      })
                    }
                  />
                </>
              )}
              {plan.assets.length ? (
                <SelectField
                  label="Secured by"
                  value={b.linkedAssetId ?? 'none'}
                  options={[
                    { value: 'none', label: 'Nothing' },
                    ...plan.assets.map((x) => ({ value: x.id, label: x.name })),
                  ]}
                  onChange={(v) =>
                    setB((x) => {
                      x.linkedAssetId = v === 'none' ? undefined : v;
                    })
                  }
                />
              ) : null}
            </div>
            <Switch
              label="Interest is deductible (home mortgage)"
              checked={b.interestDeductible ?? b.kind === 'mortgage'}
              onChange={(v) =>
                setB((x) => {
                  x.interestDeductible = v;
                })
              }
            />
            <WhenField
              plan={plan}
              label="Starts"
              optional
              emptyLabel="Already have it"
              value={b.start}
              onChange={(v) =>
                setB((x) => {
                  x.start = v;
                })
              }
            />
            <div className="lv-spread">
              <span className="lv-label">Refinancing</span>
              <Button
                size="sm"
                icon="plus"
                onClick={() =>
                  setB((x) => {
                    x.refinance.push({
                      when: { type: 'year', year: plan.settings.startYear + 2 },
                      rate: Math.max(0, x.rate - 0.01),
                      termYears: 30,
                      costPct: 0.02,
                    });
                  })
                }
              >
                Add a refinance
              </Button>
            </div>
            {b.refinance.map((r, i) => (
              <div
                key={i}
                className="lv-stack"
                style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}
              >
                <WhenField
                  plan={plan}
                  label="Refinance"
                  value={r.when}
                  onChange={(v) =>
                    setB((x) => {
                      if (v) x.refinance[i].when = v;
                    })
                  }
                />
                <div className="lv-row" style={{ alignItems: 'flex-end' }}>
                  <div style={{ flex: 1 }}>
                    <PercentField
                      label="New rate"
                      value={r.rate}
                      onChange={(v) =>
                        setB((x) => {
                          x.refinance[i].rate = Math.max(0, v);
                        })
                      }
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <NumberField
                      label="New term (years)"
                      value={r.termYears}
                      min={1}
                      max={40}
                      onChange={(v) =>
                        setB((x) => {
                          x.refinance[i].termYears = v;
                        })
                      }
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <PercentField
                      label="Cost"
                      value={r.costPct}
                      onChange={(v) =>
                        setB((x) => {
                          x.refinance[i].costPct = Math.max(0, Math.min(0.1, v));
                        })
                      }
                    />
                  </div>
                  <Button
                    variant="ghost"
                    icon="trash"
                    label="Remove refinance"
                    onClick={() =>
                      setB((x) => {
                        x.refinance.splice(i, 1);
                      })
                    }
                  />
                </div>
              </div>
            ))}
            {b.principal > 0 && b.payment === 0 && b.termMonths === 0 && b.kind !== 'revolving' ? (
              <Badge tone="warn">With no payment and no term, this is treated as interest-only.</Badge>
            ) : null}
          </>
        ) : null}
      </EditDialog>
    </>
  );
}
