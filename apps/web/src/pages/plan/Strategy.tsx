import { resolvedCustomOrder, type WaterfallStep } from '@fisim/engine';
import { Button, Card, MoneyField, NumberField, PercentField, SelectField, Switch } from '@fisim/ui';
import type { ReactNode } from 'react';
import { ACCOUNT_LABELS, WhenField } from '../../lib/fields';
import { PageHead } from '../../shell/Shell';
import { usePlan } from '../../state/store';
import { useDraft, usePreviewPlan } from '../../state/draft';
import { useProjection, useProjectionOf } from '../../engine/useResults';
import { DraftActions } from '../workspace/PlanningTools';
import { Chart, axis, short, tooltip } from '../../charts/Chart';
import { formatMoney } from '@fisim/ui';
import { CalculationStatus } from '../workspace/CalculationStatus';

const PRETAX = ['trad401k', 'trad403b', 'tradIra', 'sepIra', 'simpleIra', 'solo401k'];
const WATERFALL_OK = ['taxable', 'cash', 'rothIra', 'tradIra', 'hsa', 'plan529', 'iBond', 'annuity', 'tBill'];

export function StrategyPage(): ReactNode {
  const base = usePlan()!;
  const plan = usePreviewPlan()!;
  const update = (recipe: (p: typeof plan) => void): void =>
    useDraft.getState().edit(base, 'Strategy changed', recipe);
  const { result, stale } = useProjection();
  const baseline = useProjectionOf(plan !== base ? base : null, null);
  const S = plan.strategies;
  const steps = S.surplusWaterfall;
  const name = (st: WaterfallStep): string =>
    st.type === 'debt'
      ? `Extra payments on ${plan.debts.find((d) => d.id === st.debtId)?.name ?? 'a removed debt'}`
      : st.type === 'emergencyFund'
        ? `Emergency fund in ${plan.accounts.find((a) => a.id === st.accountId)?.name ?? 'a removed account'}`
        : (plan.accounts.find((a) => a.id === st.accountId)?.name ?? 'a removed account');
  const move = (i: number, by: number): void =>
    update((d) => {
      const a = d.strategies.surplusWaterfall;
      const j = i + by;
      if (j < 0 || j >= a.length) return;
      [a[i], a[j]] = [a[j], a[i]];
    });
  // Accounts added after the order was set slot in at their default place, exactly as the engine runs them.
  const order = resolvedCustomOrder(plan);
  const conv = S.rothConversion;
  const rule = S.spendingRule;

  return (
    <>
      <PageHead
        group="plan"
        title="Strategy"
        intro="The rules the plan follows each year: where spare money goes, where spending money comes from, and how taxes and subsidies are managed along the way."
      />

      <CalculationStatus />
      {result && (
        <Card title="Strategy preview">
          <Chart
            label="Annual Roth conversions"
            height={240}
            deps={[result]}
            table={() => ({
              columns: ['Year', 'Roth conversion', 'Taxes'],
              rows: result.records.map((r) => [
                r.year,
                formatMoney(r.rothConversion / r.cpi),
                formatMoney(r.taxes.total / r.cpi),
              ]),
            })}
            build={(c) => ({
              grid: { left: 60, right: 12, top: 16, bottom: 32 },
              tooltip: { ...tooltip(c), trigger: 'axis' },
              xAxis: { type: 'category', data: result.records.map((r) => r.year), ...axis(c) },
              yAxis: { type: 'value', ...axis(c), axisLabel: { formatter: short } },
              series: [
                {
                  id: 'conversions',
                  name: 'Roth conversions',
                  type: 'bar',
                  data: result.records.map((r) => r.rothConversion / r.cpi),
                  itemStyle: { color: c.primary },
                },
              ],
            })}
          />
          <p className="lv-small lv-muted">
            Annual amounts in today's dollars. Preview the existing strategy rules and compare taxes and
            ending wealth before applying.
          </p>
          <DraftActions base={base} result={result} baseline={baseline} stale={stale} />
        </Card>
      )}
      <Card title="Where spare money goes" data-tour="waterfall">
        <p className="lv-muted lv-small" style={{ marginBottom: 12 }}>
          Savings from pay (401(k), HSA) come out first and are set on each account. Whatever is left after
          tax and spending flows down this list, top to bottom, with every legal limit applied. Anything still
          left lands in your default account.
        </p>
        <ol className="lv-list" style={{ listStyle: 'none' }}>
          {steps.map((st, i) => (
            <li key={i} data-tour="waterfall-step">
              <span className="lv-num lv-muted" style={{ width: 20 }}>
                {i + 1}
              </span>
              <div className="lv-grow">
                <strong>{name(st)}</strong>
                <div className="lv-row" style={{ marginTop: 6 }}>
                  {st.type === 'emergencyFund' ? (
                    <div style={{ width: 150 }}>
                      <NumberField
                        label="Months of spending"
                        value={st.months}
                        min={0}
                        max={60}
                        onChange={(v) =>
                          update((d) => {
                            const x = d.strategies.surplusWaterfall[i];
                            if (x.type === 'emergencyFund') x.months = v;
                          })
                        }
                      />
                    </div>
                  ) : (
                    <div style={{ width: 200 }}>
                      <MoneyField
                        label="At most per year (0 = up to the limit)"
                        cents={st.maxAnnual ?? 0}
                        onChange={(v) =>
                          update((d) => {
                            const x = d.strategies.surplusWaterfall[i];
                            if (x.type !== 'emergencyFund') x.maxAnnual = v > 0 ? v : undefined;
                          })
                        }
                      />
                    </div>
                  )}
                </div>
              </div>
              <Button
                variant="ghost"
                icon="up"
                label={`Move ${name(st)} up`}
                disabled={i === 0}
                onClick={() => move(i, -1)}
              />
              <Button
                variant="ghost"
                icon="down"
                label={`Move ${name(st)} down`}
                disabled={i === steps.length - 1}
                onClick={() => move(i, 1)}
              />
              <Button
                variant="ghost"
                icon="trash"
                label={`Remove ${name(st)}`}
                onClick={() =>
                  update((d) => {
                    d.strategies.surplusWaterfall.splice(i, 1);
                  })
                }
              />
            </li>
          ))}
        </ol>
        <div className="form-grid" style={{ marginTop: 12 }}>
          <SelectField
            label="Add a step"
            value="none"
            data-tour="waterfall-add"
            options={[
              { value: 'none', label: 'Choose…' },
              ...plan.accounts
                .filter((a) => a.type === 'cash')
                .map((a) => ({ value: `ef:${a.id}`, label: `Emergency fund in ${a.name}` })),
              ...plan.accounts
                .filter((a) => WATERFALL_OK.includes(a.type))
                .map((a) => ({ value: `ac:${a.id}`, label: `${a.name} (${ACCOUNT_LABELS[a.type]})` })),
              ...plan.debts.map((d) => ({ value: `db:${d.id}`, label: `Extra payments on ${d.name}` })),
            ]}
            onChange={(v) =>
              update((d) => {
                const [k, id] = v.split(':');
                if (k === 'ef')
                  d.strategies.surplusWaterfall.push({ type: 'emergencyFund', accountId: id, months: 6 });
                else if (k === 'ac') d.strategies.surplusWaterfall.push({ type: 'account', accountId: id });
                else if (k === 'db') d.strategies.surplusWaterfall.push({ type: 'debt', debtId: id });
              })
            }
          />
          <SelectField
            label="Default account for anything left"
            value={S.surplusDefaultAccountId ?? 'auto'}
            options={[
              { value: 'auto', label: 'First taxable or cash account' },
              ...plan.accounts
                .filter((a) => a.type === 'taxable' || a.type === 'cash')
                .map((a) => ({ value: a.id, label: a.name })),
            ]}
            onChange={(v) =>
              update((d) => {
                d.strategies.surplusDefaultAccountId = v === 'auto' ? undefined : v;
              })
            }
          />
        </div>
        <div style={{ marginTop: 12 }}>
          <Switch
            label="Backdoor Roth: when income is too high for a direct Roth IRA contribution, contribute after-tax and convert (pro-rata rule applied)"
            checked={S.backdoorRoth}
            onChange={(v) =>
              update((d) => {
                d.strategies.backdoorRoth = v;
              })
            }
          />
        </div>
      </Card>

      <Card title="Where spending money comes from" data-tour="withdrawal-order" id="withdrawal-order">
        <div className="form-grid">
          <SelectField
            label="Withdrawal strategy"
            value={S.withdrawalOrder.strategy}
            data-tour="withdrawal-strategy"
            options={[
              { value: 'taxableFirst', label: 'Taxable first, then pre-tax, then Roth' },
              { value: 'proportional', label: 'In proportion to each account' },
              { value: 'bracketTargeted', label: 'Fill a tax bracket with pre-tax money first' },
              { value: 'custom', label: 'My own order' },
            ]}
            onChange={(v) =>
              update((d) => {
                d.strategies.withdrawalOrder.strategy = v;
                if (v === 'custom') d.strategies.withdrawalOrder.customOrder = resolvedCustomOrder(d);
              })
            }
          />
          {S.withdrawalOrder.strategy === 'bracketTargeted' ? (
            <SelectField
              label="Fill up to the top of the"
              value={String(S.withdrawalOrder.bracketRate)}
              options={['0.1', '0.12', '0.22', '0.24', '0.32'].map((r) => ({
                value: r,
                label: `${Math.round(+r * 100)}% bracket`,
              }))}
              onChange={(v) =>
                update((d) => {
                  d.strategies.withdrawalOrder.bracketRate = +v;
                })
              }
            />
          ) : null}
          <SelectField
            label="Health savings account"
            value={S.hsaUse}
            options={[
              { value: 'spend', label: 'Pay medical bills from it' },
              { value: 'save', label: 'Leave it invested' },
            ]}
            onChange={(v) =>
              update((d) => {
                d.strategies.hsaUse = v;
              })
            }
          />
        </div>
        {S.withdrawalOrder.strategy === 'custom' ? (
          <ol className="lv-list" style={{ listStyle: 'none', marginTop: 8 }}>
            {order.map((id, i) => {
              const a = plan.accounts.find((x) => x.id === id);
              if (!a) return null;
              const mv = (by: number): void =>
                update((d) => {
                  const o = [...order];
                  const j = i + by;
                  if (j < 0 || j >= o.length) return;
                  [o[i], o[j]] = [o[j], o[i]];
                  d.strategies.withdrawalOrder.customOrder = o;
                });
              return (
                <li key={id}>
                  <span className="lv-num lv-muted" style={{ width: 20 }}>
                    {i + 1}
                  </span>
                  <span className="lv-grow">{a.name}</span>
                  <Button
                    variant="ghost"
                    icon="up"
                    label={`Move ${a.name} up`}
                    disabled={i === 0}
                    onClick={() => mv(-1)}
                  />
                  <Button
                    variant="ghost"
                    icon="down"
                    label={`Move ${a.name} down`}
                    disabled={i === order.length - 1}
                    onClick={() => mv(1)}
                  />
                </li>
              );
            })}
          </ol>
        ) : null}
        <p className="lv-muted lv-small" style={{ marginTop: 12 }}>
          Penalty-free money is always used before money that would trigger the 10% early-withdrawal penalty.
          Required distributions come out first whatever the order.
        </p>
        <h3 style={{ marginTop: 16 }}>Early access with 72(t) payments</h3>
        <p className="lv-muted lv-small">
          A fixed yearly payment from one pre-tax account, penalty-free, that must continue for five years or
          until 59½, whichever is later.
        </p>
        {S.sepp.map((sp, i) => (
          <div
            key={i}
            className="lv-stack"
            style={{ borderTop: '1px solid var(--line)', paddingTop: 12, marginTop: 12 }}
          >
            <div className="lv-row" style={{ alignItems: 'flex-end' }}>
              <div style={{ flex: 2, minWidth: 160 }}>
                <SelectField
                  label="Account"
                  value={sp.accountId}
                  options={plan.accounts
                    .filter((a) => PRETAX.includes(a.type))
                    .map((a) => ({ value: a.id, label: a.name }))}
                  onChange={(v) =>
                    update((d) => {
                      d.strategies.sepp[i].accountId = v;
                    })
                  }
                />
              </div>
              <div style={{ flex: 1, minWidth: 100 }}>
                <PercentField
                  label="Interest rate used"
                  value={sp.interestRate}
                  onChange={(v) =>
                    update((d) => {
                      d.strategies.sepp[i].interestRate = Math.max(0, v);
                    })
                  }
                />
              </div>
              <Button
                variant="ghost"
                icon="trash"
                label="Remove this schedule"
                onClick={() =>
                  update((d) => {
                    d.strategies.sepp.splice(i, 1);
                  })
                }
              />
            </div>
            <WhenField
              plan={plan}
              label="Payments start"
              value={sp.start}
              onChange={(v) =>
                update((d) => {
                  if (v) d.strategies.sepp[i].start = v;
                })
              }
            />
          </div>
        ))}
        {plan.accounts.some((a) => PRETAX.includes(a.type)) ? (
          <div style={{ marginTop: 12 }}>
            <Button
              size="sm"
              icon="plus"
              data-tour="add-sepp"
              onClick={() =>
                update((d) => {
                  const a = d.accounts.find((x) => PRETAX.includes(x.type))!;
                  d.strategies.sepp.push({
                    accountId: a.id,
                    start: { type: 'year', year: d.settings.startYear + 1 },
                    interestRate: 0.05,
                  });
                })
              }
            >
              Add a 72(t) schedule
            </Button>
          </div>
        ) : null}
      </Card>

      <Card title="Roth conversions" data-tour="roth-conversions">
        <div className="form-grid">
          <SelectField
            label="Convert pre-tax money to Roth"
            value={conv.mode}
            data-tour="conversion-mode"
            options={[
              { value: 'none', label: 'No conversions' },
              { value: 'fillBracket', label: 'Fill a tax bracket each year' },
              { value: 'fixed', label: 'A fixed amount each year' },
              { value: 'ladder', label: 'A ladder: fixed amount, spent five years later' },
              { value: 'magiTarget', label: 'Up to my income target for health subsidies' },
            ]}
            onChange={(v) =>
              update((d) => {
                d.strategies.rothConversion.mode = v;
              })
            }
          />
          {conv.mode === 'fillBracket' ? (
            <SelectField
              label="Fill up to the top of the"
              value={String(conv.bracketRate)}
              options={['0.1', '0.12', '0.22', '0.24', '0.32'].map((r) => ({
                value: r,
                label: `${Math.round(+r * 100)}% bracket`,
              }))}
              onChange={(v) =>
                update((d) => {
                  d.strategies.rothConversion.bracketRate = +v;
                })
              }
              data-tour="conversion-bracket"
            />
          ) : null}
          {conv.mode === 'fixed' || conv.mode === 'ladder' ? (
            <MoneyField
              label="Amount per year (today's dollars)"
              cents={conv.amount}
              onChange={(v) =>
                update((d) => {
                  d.strategies.rothConversion.amount = Math.max(0, v);
                })
              }
            />
          ) : null}
        </div>
        {conv.mode !== 'none' ? (
          <div className="lv-stack" style={{ marginTop: 12 }}>
            <WhenField
              plan={plan}
              label="From"
              optional
              emptyLabel="Now"
              value={conv.start}
              onChange={(v) =>
                update((d) => {
                  d.strategies.rothConversion.start = v;
                })
              }
            />
            <WhenField
              plan={plan}
              label="Until"
              optional
              emptyLabel="For life"
              value={conv.end}
              onChange={(v) =>
                update((d) => {
                  d.strategies.rothConversion.end = v;
                })
              }
            />
            <p className="lv-muted lv-small">
              Each conversion is tracked as its own lot. A lot can be spent penalty-free five tax years after
              it was converted, or at any time after 59½.
            </p>
          </div>
        ) : null}
      </Card>

      <Card title="Gains, losses and health-subsidy income" data-tour="harvesting">
        <div className="lv-stack">
          <Switch
            label="Harvest gains in the 0% bracket: sell and rebuy to raise cost basis when it is tax-free"
            checked={S.gainHarvest.enabled}
            onChange={(v) =>
              update((d) => {
                d.strategies.gainHarvest.enabled = v;
              })
            }
            data-tour="gain-harvest"
          />
          <Switch
            label="Harvest losses: bank losses in down years (offsets gains, then up to $3,000 of other income a year)"
            checked={S.lossHarvest.enabled}
            onChange={(v) =>
              update((d) => {
                d.strategies.lossHarvest.enabled = v;
              })
            }
          />
          <Switch
            label="Manage income while on marketplace coverage"
            checked={S.magiTarget.enabled}
            onChange={(v) =>
              update((d) => {
                d.strategies.magiTarget.enabled = v;
              })
            }
            data-tour="magi-target"
          />
          {S.magiTarget.enabled ? (
            <div className="form-grid">
              <PercentField
                label="Keep income under (share of the poverty line)"
                hint="Under current law the premium credit ends above 400%."
                digits={0}
                value={S.magiTarget.maxFplPct}
                onChange={(v) =>
                  update((d) => {
                    d.strategies.magiTarget.maxFplPct = Math.max(1, v);
                  })
                }
              />
              <PercentField
                label="Keep income above (0 = no floor)"
                hint="Above 138% keeps you out of Medicaid in expansion states; above 100% avoids the coverage gap elsewhere."
                digits={0}
                value={S.magiTarget.minFplPct}
                onChange={(v) =>
                  update((d) => {
                    d.strategies.magiTarget.minFplPct = Math.max(0, v);
                  })
                }
              />
            </div>
          ) : null}
        </div>
      </Card>

      <Card title="Flexible spending" data-tour="spending-rule">
        <div className="form-grid">
          <SelectField
            label="Spending rule"
            value={rule.type}
            data-tour="spending-rule-type"
            options={[
              { value: 'fixed', label: 'Spend the plan, adjusted for inflation' },
              { value: 'guardrails', label: 'Guardrails: cut or raise when the withdrawal rate drifts' },
              { value: 'percentOfPortfolio', label: 'A fixed share of the portfolio' },
              { value: 'floorCeiling', label: 'Share of the portfolio, with a floor and ceiling' },
            ]}
            onChange={(v) =>
              update((d) => {
                d.strategies.spendingRule.type = v;
              })
            }
          />
          {rule.type === 'percentOfPortfolio' || rule.type === 'floorCeiling' ? (
            <PercentField
              label="Share of portfolio per year"
              value={rule.pct}
              onChange={(v) =>
                update((d) => {
                  d.strategies.spendingRule.pct = Math.max(0, Math.min(1, v));
                })
              }
            />
          ) : null}
          {rule.type === 'guardrails' ? (
            <>
              <PercentField
                label="Guardrail width"
                hint="Act when the withdrawal rate moves this far from where it started."
                digits={0}
                value={rule.guardrailBand}
                onChange={(v) =>
                  update((d) => {
                    d.strategies.spendingRule.guardrailBand = Math.max(0, Math.min(1, v));
                  })
                }
              />
              <PercentField
                label="Adjustment each time"
                digits={0}
                value={rule.guardrailAdjust}
                onChange={(v) =>
                  update((d) => {
                    d.strategies.spendingRule.guardrailAdjust = Math.max(0, Math.min(1, v));
                  })
                }
              />
            </>
          ) : null}
          {rule.type === 'guardrails' || rule.type === 'floorCeiling' ? (
            <>
              <PercentField
                label="Never spend less than (share of plan)"
                digits={0}
                value={rule.floor}
                onChange={(v) =>
                  update((d) => {
                    d.strategies.spendingRule.floor = Math.max(0, Math.min(1, v));
                  })
                }
                data-tour="spending-floor"
              />
              <PercentField
                label="Never spend more than (share of plan)"
                digits={0}
                value={rule.ceiling}
                onChange={(v) =>
                  update((d) => {
                    d.strategies.spendingRule.ceiling = Math.max(1, Math.min(5, v));
                  })
                }
              />
            </>
          ) : null}
        </div>
        {rule.type !== 'fixed' ? (
          <div style={{ marginTop: 12 }}>
            <WhenField
              plan={plan}
              label="Rule applies from"
              optional
              emptyLabel="Retirement"
              value={rule.start}
              onChange={(v) =>
                update((d) => {
                  d.strategies.spendingRule.start = v;
                })
              }
            />
          </div>
        ) : null}
      </Card>

      <Card title="Rebalancing and estate" data-tour="rebalance">
        <div className="form-grid">
          <SelectField
            label="Rebalance accounts"
            value={S.rebalance.mode}
            options={[
              { value: 'annual', label: 'Every year' },
              { value: 'threshold', label: 'Only when the mix drifts' },
              { value: 'none', label: 'Never' },
            ]}
            onChange={(v) =>
              update((d) => {
                d.strategies.rebalance.mode = v;
              })
            }
          />
          {S.rebalance.mode === 'threshold' ? (
            <PercentField
              label="Drift that triggers it"
              digits={0}
              value={S.rebalance.band}
              onChange={(v) =>
                update((d) => {
                  d.strategies.rebalance.band = Math.max(0, Math.min(1, v));
                })
              }
            />
          ) : null}
          <PercentField
            label="Tax rate heirs pay on inherited pre-tax accounts"
            digits={0}
            value={S.estate.heirMarginalRate}
            onChange={(v) =>
              update((d) => {
                d.strategies.estate.heirMarginalRate = Math.max(0, Math.min(1, v));
              })
            }
            data-tour="heir-rate"
          />
          <MoneyField
            label="Leave at least (today's dollars)"
            cents={S.estate.legacyGoal}
            onChange={(v) =>
              update((d) => {
                d.strategies.estate.legacyGoal = Math.max(0, v);
              })
            }
            data-tour="legacy-goal"
          />
        </div>
        {S.estate.legacyGoal > 0 ? (
          <div style={{ marginTop: 12 }}>
            <Switch
              label="Count the goal in the chance of success"
              checked={S.estate.legacyGoalForSuccess}
              onChange={(v) =>
                update((d) => {
                  d.strategies.estate.legacyGoalForSuccess = v;
                })
              }
            />
          </div>
        ) : null}
      </Card>
    </>
  );
}
