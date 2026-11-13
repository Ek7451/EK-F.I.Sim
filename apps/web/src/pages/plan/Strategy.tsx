import { resolvedCustomOrder, type ProjectionResult, type WaterfallStep } from '@fisim/engine';
import {
  Button,
  Fold,
  HelpTip,
  MoneyField,
  NumberField,
  PercentField,
  SelectField,
  Stat,
  Switch,
  formatCompact,
  formatMoney,
  formatPct,
} from '@fisim/ui';
import type { ReactNode } from 'react';
import { ACCOUNT_LABELS, WhenField, describeWhen } from '../../lib/fields';
import { helpText } from '../../lib/help';
import { outcomeDelta } from '../../lib/metrics';
import { PageHead } from '../../shell/Shell';
import { usePlan } from '../../state/store';
import { useDraft, usePreviewPlan } from '../../state/draft';
import { useProjection, useProjectionOf } from '../../engine/useResults';
import { DraftActions } from '../workspace/PlanningTools';
import { Chart, alpha, short, tooltip } from '../../charts/Chart';
import { CalculationStatus } from '../workspace/CalculationStatus';
import { Choice, Dial, FoldColumns, Lead } from './InputsB';
import './inputs-b.css';

const PRETAX = ['trad401k', 'trad403b', 'tradIra', 'sepIra', 'simpleIra', 'solo401k'];
const WATERFALL_OK = ['taxable', 'cash', 'rothIra', 'tradIra', 'hsa', 'plan529', 'iBond', 'annuity', 'tBill'];
const BRACKETS = ['0.1', '0.12', '0.22', '0.24', '0.32'].map((r) => ({
  value: r,
  label: `${Math.round(+r * 100)}%`,
}));
const WITHDRAWAL_SHORT: Record<string, string> = {
  taxableFirst: 'Taxable first, then pre-tax, then Roth',
  proportional: 'In proportion to each account',
  bracketTargeted: 'Fill a tax bracket with pre-tax money first',
  custom: 'My own order',
};
const LEGEND_SHORT: Record<string, string> = {
  'From taxable and cash': 'Taxable, cash',
  'From pre-tax': 'Pre-tax',
  'From Roth': 'Roth',
  'From HSA and other': 'HSA, other',
  'Roth conversions': 'Conversions',
};
const RULE_SHORT: Record<string, string> = {
  fixed: 'Spend the plan, adjusted for inflation',
  guardrails: 'Guardrails',
  percentOfPortfolio: 'A fixed share of the portfolio',
  floorCeiling: 'Share of the portfolio, with limits',
};

/** The headline band: what the rules below add up to, and what they do year by year. */
function StrategyPreview({
  result,
  baseline,
  stale,
}: {
  result: ProjectionResult;
  baseline: ProjectionResult | null;
  stale: boolean;
}): ReactNode {
  const recs = result.records;
  const real = (r: (typeof recs)[number], x: number): number => x / r.cpi;
  const conversions = recs.reduce((s, r) => s + real(r, r.rothConversion), 0);
  const delta = (key: 'endingWealth' | 'lifetimeTaxes'): { dir: 'up' | 'down' | 'flat'; text: string } | undefined => {
    if (!baseline || stale) return undefined;
    const d = outcomeDelta(key, baseline, result);
    if (d === null) return undefined;
    if (Math.abs(d) < 0.5) return { dir: 'flat', text: 'Same as the saved plan' };
    return { dir: d > 0 ? 'up' : 'down', text: `${d > 0 ? '+' : '−'}${formatCompact(Math.abs(d))} vs saved plan` };
  };
  const series: [string, (r: (typeof recs)[number]) => number][] = [
    ['From taxable and cash', (r) => r.withdrawals.taxable + r.withdrawals.cash],
    ['From pre-tax', (r) => r.withdrawals.pretax],
    ['From Roth', (r) => r.withdrawals.roth],
    ['From HSA and other', (r) => r.withdrawals.hsa + r.withdrawals.other],
  ];
  return (
    <section className="lv-kpis pib-preview" aria-label="What this strategy does" data-tour="strategy-preview">
      <Stat
        label="Lifetime tax"
        value={formatCompact(result.summary.lifetimeTaxReal)}
        delta={delta('lifetimeTaxes')}
        note={baseline && !stale ? undefined : "Today's dollars, after credits"}
      />
      <Stat
        label="Ending net worth"
        value={formatCompact(result.summary.endingNetWorthReal)}
        delta={delta('endingWealth')}
        note={baseline && !stale ? undefined : `In ${result.summary.endYear}, today's dollars`}
      />
      <Stat
        label="Roth conversions"
        value={conversions > 0.5 ? formatCompact(conversions) : 'None'}
        note="Total over the plan"
      />
      <Stat
        label="Spending covered"
        value={result.summary.success ? 'Every year' : `Short from ${result.summary.failedYear ?? '—'}`}
        note="On the expected path"
      />
      <div className="pib-preview-chart">
        <p className="pib-preview-cap">Withdrawals by account type, and Roth conversions, each year</p>
        <Chart
          label="What the strategy does each year: withdrawals by account type and Roth conversions"
          height={100}
          deps={[result]}
          table={() => ({
            columns: ['Year', ...series.map(([n]) => n), 'Roth conversion', 'Taxes'],
            rows: recs.map((r) => [
              r.year,
              ...series.map(([, f]) => formatMoney(real(r, f(r)))),
              formatMoney(real(r, r.rothConversion)),
              formatMoney(real(r, r.taxes.total)),
            ]),
          })}
          build={(c) => {
            const hues = [c.financial.taxable, c.financial.pretax, c.financial.roth, c.financial.hsa];
            return {
              grid: { left: 44, right: 6, top: 24, bottom: 20 },
              legend: {
                type: 'scroll',
                top: 0,
                left: 0,
                right: 0,
                formatter: (n: string) => LEGEND_SHORT[n] ?? n,
                pageIconColor: '#d2d6f5',
                pageTextStyle: { color: '#a9aedb', fontSize: 10 },
                itemWidth: 8,
                itemHeight: 8,
                itemGap: 10,
                textStyle: { color: '#d2d6f5', fontSize: 11 },
                inactiveColor: 'rgba(190,196,255,0.34)',
              },
              tooltip: { ...tooltip(c), trigger: 'axis', axisPointer: { type: 'shadow' } },
              xAxis: {
                type: 'category',
                data: recs.map((r) => r.year),
                axisLine: { lineStyle: { color: 'rgba(190,196,255,0.34)' } },
                axisTick: { show: false },
                axisLabel: { color: '#a9aedb', fontSize: 10, margin: 6 },
              },
              yAxis: {
                type: 'value',
                splitNumber: 2,
                axisLabel: { color: '#a9aedb', fontSize: 10, formatter: short },
                splitLine: { lineStyle: { color: 'rgba(190,196,255,0.16)', type: [3, 5] } },
              },
              series: [
                ...series.map(([name, f], i) => ({
                  id: name,
                  name,
                  type: 'bar',
                  stack: 'withdrawals',
                  barCategoryGap: '30%',
                  itemStyle: { color: hues[i] },
                  data: recs.map((r) => real(r, f(r))),
                })),
                {
                  id: 'conversions',
                  name: 'Roth conversions',
                  type: 'line',
                  step: 'middle',
                  symbol: 'none',
                  lineStyle: { width: 2, color: c.dawn[3], shadowColor: alpha(c.dawn[3], 0.6), shadowBlur: 8 },
                  itemStyle: { color: c.dawn[3] },
                  areaStyle: { color: alpha(c.dawn[3], 0.18) },
                  data: recs.map((r) => real(r, r.rothConversion)),
                },
              ],
            };
          }}
        />
      </div>
    </section>
  );
}

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
  const pct = (v: number): string => formatPct(v, 0);

  const defaultAccount =
    plan.accounts.find((a) => a.id === S.surplusDefaultAccountId)?.name ?? 'first taxable or cash account';
  const waterfallSummary = steps.length
    ? `${steps.map(name).join(' → ')} → ${defaultAccount}`
    : `Everything left goes to the ${defaultAccount}`;
  const withdrawalSummary = [
    S.withdrawalOrder.strategy === 'bracketTargeted'
      ? `Fill the ${pct(S.withdrawalOrder.bracketRate)} bracket with pre-tax money first`
      : WITHDRAWAL_SHORT[S.withdrawalOrder.strategy],
    S.hsaUse === 'spend' ? 'HSA pays medical bills' : 'HSA stays invested',
    S.sepp.length ? `${S.sepp.length} 72(t) schedule${S.sepp.length > 1 ? 's' : ''}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const convSummary =
    conv.mode === 'none'
      ? 'No conversions'
      : [
          conv.mode === 'fillBracket'
            ? `Fill the ${pct(conv.bracketRate)} bracket`
            : conv.mode === 'fixed'
              ? `${formatMoney(conv.amount / 100)} a year`
              : conv.mode === 'ladder'
                ? `Ladder of ${formatMoney(conv.amount / 100)} a year`
                : 'Up to the health-subsidy income target',
          `from ${describeWhen(plan, conv.start, 'now')}`,
          conv.end ? `until ${describeWhen(plan, conv.end)}` : 'for life',
        ].join(' · ');
  const tactics = [
    S.gainHarvest.enabled ? 'Gain harvesting' : null,
    S.lossHarvest.enabled ? 'Loss harvesting' : null,
    S.magiTarget.enabled
      ? `Income kept ${S.magiTarget.minFplPct > 0 ? `${pct(S.magiTarget.minFplPct)}–` : 'under '}${pct(S.magiTarget.maxFplPct)} of the poverty line`
      : null,
    S.backdoorRoth ? 'Backdoor Roth' : null,
  ].filter(Boolean);
  const ruleSummary =
    rule.type === 'fixed'
      ? RULE_SHORT.fixed
      : rule.type === 'guardrails'
        ? `Guardrails ±${pct(rule.guardrailBand)} · adjust ${pct(rule.guardrailAdjust)} · floor ${pct(rule.floor)}, ceiling ${pct(rule.ceiling)}`
        : rule.type === 'percentOfPortfolio'
          ? `${formatPct(rule.pct, 1)} of the portfolio each year`
          : `${formatPct(rule.pct, 1)} of the portfolio · floor ${pct(rule.floor)}, ceiling ${pct(rule.ceiling)}`;
  const estateSummary = [
    S.rebalance.mode === 'annual'
      ? 'Rebalance every year'
      : S.rebalance.mode === 'threshold'
        ? `Rebalance on ${pct(S.rebalance.band)} drift`
        : 'Never rebalance',
    `heirs taxed at ${pct(S.estate.heirMarginalRate)}`,
    S.estate.legacyGoal > 0 ? `leave ${formatCompact(S.estate.legacyGoal / 100)}` : 'no legacy goal',
  ].join(' · ');

  return (
    <>
      <PageHead
        group="plan"
        title="Strategy"
        intro="The rules the plan follows each year: where spare money goes, where spending money comes from, and how taxes and subsidies are managed along the way."
      />

      <CalculationStatus />
      {result ? <StrategyPreview result={result} baseline={baseline} stale={stale} /> : null}
      {result ? <DraftActions base={base} result={result} baseline={baseline} stale={stale} /> : null}

      <FoldColumns
        left={
          <>
            <Fold
              title="Where spare money goes"
              icon="layers"
              summary={waterfallSummary}
              defaultOpen
              storageKey="strategy:waterfall"
              data-tour="waterfall"
            >
              <Lead more="Savings from pay (401(k), HSA) come out first and are set on each account. Whatever is left after tax and spending flows down this list, top to bottom, with every legal limit applied. Anything still left lands in your default account.">
                After tax and spending, what is left flows down this list from the top.
              </Lead>
              {steps.length ? (
                <div className="pib-rows-head">
                  Cap per year (0 = up to the limit), or months held
                  <HelpTip>
                    {`${helpText('At most per year (0 = up to the limit)')}\n\nEmergency fund: ${helpText('Months of spending')}`}
                  </HelpTip>
                </div>
              ) : null}
              <ol className="pib-rows">
                {steps.map((st, i) => (
                  <li key={i} data-tour="waterfall-step">
                    <span className="pib-rows-n">{i + 1}</span>
                    <span className="pib-rows-name" title={name(st)}>
                      {name(st)}
                    </span>
                    <div className="pib-rows-field">
                      {st.type === 'emergencyFund' ? (
                        <NumberField
                          label="Months of spending"
                          help={null}
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
                      ) : (
                        <MoneyField
                          label="At most per year (0 = up to the limit)"
                          help={null}
                          cents={st.maxAnnual ?? 0}
                          onChange={(v) =>
                            update((d) => {
                              const x = d.strategies.surplusWaterfall[i];
                              if (x.type !== 'emergencyFund') x.maxAnnual = v > 0 ? v : undefined;
                            })
                          }
                        />
                      )}
                    </div>
                    <div className="pib-rows-tools">
                      <Button
                        variant="ghost"
                        size="sm"
                        icon="up"
                        label={`Move ${name(st)} up`}
                        disabled={i === 0}
                        onClick={() => move(i, -1)}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        icon="down"
                        label={`Move ${name(st)} down`}
                        disabled={i === steps.length - 1}
                        onClick={() => move(i, 1)}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        icon="trash"
                        label={`Remove ${name(st)}`}
                        onClick={() =>
                          update((d) => {
                            d.strategies.surplusWaterfall.splice(i, 1);
                          })
                        }
                      />
                    </div>
                  </li>
                ))}
              </ol>
              <div className="form-grid" style={{ marginTop: 8 }}>
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
                  label="Anything left goes to"
                  help={helpText('Default account for anything left')}
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
            </Fold>

            <Fold
              title="Flexible spending"
              icon="spending"
              kind="expense"
              summary={ruleSummary}
              storageKey="strategy:spending-rule"
              data-tour="spending-rule"
            >
              <div className="form-grid">
                <div className="span-2">
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
                </div>
              </div>
              {rule.type !== 'fixed' ? (
                <div className="pib-dials" style={{ marginTop: 10 }}>
                  {rule.type === 'percentOfPortfolio' || rule.type === 'floorCeiling' ? (
                    <Dial
                      value={rule.pct}
                      min={0}
                      max={0.1}
                      step={0.001}
                      onChange={(v) =>
                        update((d) => {
                          d.strategies.spendingRule.pct = v;
                        })
                      }
                    >
                      <PercentField
                        label="Portfolio share per year"
                        help={helpText('Share of portfolio per year')}
                        value={rule.pct}
                        onChange={(v) =>
                          update((d) => {
                            d.strategies.spendingRule.pct = Math.max(0, Math.min(1, v));
                          })
                        }
                      />
                    </Dial>
                  ) : null}
                  {rule.type === 'guardrails' ? (
                    <>
                      <Dial
                        value={rule.guardrailBand}
                        min={0}
                        max={0.5}
                        step={0.01}
                        onChange={(v) =>
                          update((d) => {
                            d.strategies.spendingRule.guardrailBand = v;
                          })
                        }
                      >
                        <PercentField
                          label="Guardrail width"
                          help="Act when the withdrawal rate moves this far from where it started."
                          digits={0}
                          value={rule.guardrailBand}
                          onChange={(v) =>
                            update((d) => {
                              d.strategies.spendingRule.guardrailBand = Math.max(0, Math.min(1, v));
                            })
                          }
                        />
                      </Dial>
                      <Dial
                        value={rule.guardrailAdjust}
                        min={0}
                        max={0.3}
                        step={0.01}
                        onChange={(v) =>
                          update((d) => {
                            d.strategies.spendingRule.guardrailAdjust = v;
                          })
                        }
                      >
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
                      </Dial>
                    </>
                  ) : null}
                  {rule.type === 'guardrails' || rule.type === 'floorCeiling' ? (
                    <>
                      <Dial
                        value={rule.floor}
                        min={0}
                        max={1}
                        step={0.01}
                        onChange={(v) =>
                          update((d) => {
                            d.strategies.spendingRule.floor = v;
                          })
                        }
                        data-tour="spending-floor"
                      >
                        <PercentField
                          label="Floor (share of plan)"
                          help={helpText('Never spend less than (share of plan)')}
                          digits={0}
                          value={rule.floor}
                          onChange={(v) =>
                            update((d) => {
                              d.strategies.spendingRule.floor = Math.max(0, Math.min(1, v));
                            })
                          }
                        />
                      </Dial>
                      <Dial
                        value={rule.ceiling}
                        min={1}
                        max={2}
                        step={0.01}
                        onChange={(v) =>
                          update((d) => {
                            d.strategies.spendingRule.ceiling = v;
                          })
                        }
                      >
                        <PercentField
                          label="Ceiling (share of plan)"
                          help={helpText('Never spend more than (share of plan)')}
                          digits={0}
                          value={rule.ceiling}
                          onChange={(v) =>
                            update((d) => {
                              d.strategies.spendingRule.ceiling = Math.max(1, Math.min(5, v));
                            })
                          }
                        />
                      </Dial>
                    </>
                  ) : null}
                  <div className="span-all">
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
                </div>
              ) : null}
            </Fold>

            <Fold
              title="Rebalancing and estate"
              icon="estate"
              kind="milestone"
              summary={estateSummary}
              storageKey="strategy:estate"
              data-tour="rebalance"
            >
              <div className="pib-dials">
                <Choice
                  label="Rebalance accounts"
                  help={helpText('Rebalance accounts')}
                  value={S.rebalance.mode}
                  options={[
                    { value: 'annual', label: 'Every year' },
                    { value: 'threshold', label: 'On drift' },
                    { value: 'none', label: 'Never' },
                  ]}
                  onChange={(v) =>
                    update((d) => {
                      d.strategies.rebalance.mode = v;
                    })
                  }
                />
                {S.rebalance.mode === 'threshold' ? (
                  <Dial
                    value={S.rebalance.band}
                    min={0}
                    max={0.25}
                    step={0.01}
                    onChange={(v) =>
                      update((d) => {
                        d.strategies.rebalance.band = v;
                      })
                    }
                  >
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
                  </Dial>
                ) : null}
                <Dial
                  value={S.estate.heirMarginalRate}
                  min={0}
                  max={0.5}
                  step={0.01}
                  onChange={(v) =>
                    update((d) => {
                      d.strategies.estate.heirMarginalRate = v;
                    })
                  }
                  data-tour="heir-rate"
                >
                  <PercentField
                    label="Heirs' tax rate on pre-tax"
                    help={helpText('Tax rate heirs pay on inherited pre-tax accounts')}
                    digits={0}
                    value={S.estate.heirMarginalRate}
                    onChange={(v) =>
                      update((d) => {
                        d.strategies.estate.heirMarginalRate = Math.max(0, Math.min(1, v));
                      })
                    }
                  />
                </Dial>
                <MoneyField
                  label="Leave at least"
                  help={helpText("Leave at least (today's dollars)")}
                  hint="Today's dollars; 0 = no goal."
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
                <Switch
                  label="Count the goal in the chance of success"
                  checked={S.estate.legacyGoalForSuccess}
                  onChange={(v) =>
                    update((d) => {
                      d.strategies.estate.legacyGoalForSuccess = v;
                    })
                  }
                />
              ) : null}
            </Fold>
          </>
        }
        right={
          <>
            <Fold
              title="Where spending money comes from"
              icon="wallet"
              kind="income"
              summary={withdrawalSummary}
              defaultOpen
              storageKey="strategy:withdrawals"
              data-tour="withdrawal-order"
              id="withdrawal-order"
            >
              <div className="form-grid">
                <div className="span-2">
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
                </div>
                <Choice
                  label="Health savings account"
                  help={helpText('Health savings account')}
                  value={S.hsaUse}
                  options={[
                    { value: 'spend', label: 'Pay medical bills' },
                    { value: 'save', label: 'Leave invested' },
                  ]}
                  onChange={(v) =>
                    update((d) => {
                      d.strategies.hsaUse = v;
                    })
                  }
                />
                {S.withdrawalOrder.strategy === 'bracketTargeted' ? (
                  <div className="span-2">
                    <Choice
                      label="Fill up to the top of the bracket"
                      help={helpText('Fill up to the top of the')}
                      value={String(S.withdrawalOrder.bracketRate)}
                      options={BRACKETS}
                      onChange={(v) =>
                        update((d) => {
                          d.strategies.withdrawalOrder.bracketRate = +v;
                        })
                      }
                    />
                  </div>
                ) : null}
              </div>
              {S.withdrawalOrder.strategy === 'custom' ? (
                <ol className="pib-rows" style={{ marginTop: 8 }}>
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
                        <span className="pib-rows-n">{i + 1}</span>
                        <span className="pib-rows-name">{a.name}</span>
                        <span className="lv-muted lv-small">{ACCOUNT_LABELS[a.type]}</span>
                        <div className="pib-rows-tools">
                          <Button
                            variant="ghost"
                            size="sm"
                            icon="up"
                            label={`Move ${a.name} up`}
                            disabled={i === 0}
                            onClick={() => mv(-1)}
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            icon="down"
                            label={`Move ${a.name} down`}
                            disabled={i === order.length - 1}
                            onClick={() => mv(1)}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ol>
              ) : null}
              <p className="pib-lead" style={{ margin: '8px 0 0' }}>
                Penalty-free money is always used first; required distributions come out whatever the order.
              </p>
              <div className="pib-sub">
                <h3>Early access with 72(t) payments</h3>
                <HelpTip>
                  A fixed yearly payment from one pre-tax account, penalty-free, that must continue for five years
                  or until 59½, whichever is later.
                </HelpTip>
                {plan.accounts.some((a) => PRETAX.includes(a.type)) ? (
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
                ) : null}
              </div>
              {S.sepp.length === 0 ? <p className="lv-muted lv-small">None set up.</p> : null}
              {S.sepp.map((sp, i) => (
                <div key={i} className="pib-line">
                  <div className="pib-grow">
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
                  <div className="pib-narrow">
                    <PercentField
                      label="Rate used"
                      help={helpText('Interest rate used')}
                      value={sp.interestRate}
                      onChange={(v) =>
                        update((d) => {
                          d.strategies.sepp[i].interestRate = Math.max(0, v);
                        })
                      }
                    />
                  </div>
                  <div className="pib-when">
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
              ))}
            </Fold>

            <Fold
              title="Roth conversions"
              icon="taxes"
              kind="milestone"
              summary={convSummary}
              storageKey="strategy:roth"
              data-tour="roth-conversions"
            >
              <div className="form-grid">
                <div className="span-2">
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
                </div>
                {conv.mode === 'fillBracket' ? (
                  <div className="span-2">
                    <Choice
                      label="Fill up to the top of the bracket"
                      help={helpText('Fill up to the top of the')}
                      value={String(conv.bracketRate)}
                      options={BRACKETS}
                      onChange={(v) =>
                        update((d) => {
                          d.strategies.rothConversion.bracketRate = +v;
                        })
                      }
                      data-tour="conversion-bracket"
                    />
                  </div>
                ) : null}
                {conv.mode === 'fixed' || conv.mode === 'ladder' ? (
                  <MoneyField
                    label="Amount per year"
                    help={helpText("Amount per year (today's dollars)")}
                    hint="Today's dollars."
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
                <>
                  <div className="pib-stack" style={{ marginTop: 10 }}>
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
                  </div>
                  <p className="pib-lead" style={{ margin: '8px 0 0' }}>
                    Each conversion is its own lot: spendable penalty-free five tax years later, or any time after
                    59½.
                  </p>
                </>
              ) : null}
            </Fold>

            <Fold
              title="Taxes and health subsidies"
              icon="percent"
              kind="debt"
              summary={tactics.length ? tactics.join(' · ') : 'Nothing switched on'}
              storageKey="strategy:tactics"
              data-tour="harvesting"
            >
              <div className="pib-switches">
                <Switch
                  label="Harvest gains at 0%"
                  help={helpText(
                    'Harvest gains in the 0% bracket: sell and rebuy to raise cost basis when it is tax-free',
                  )}
                  checked={S.gainHarvest.enabled}
                  onChange={(v) =>
                    update((d) => {
                      d.strategies.gainHarvest.enabled = v;
                    })
                  }
                  data-tour="gain-harvest"
                />
                <Switch
                  label="Harvest losses in down years"
                  help={helpText(
                    'Harvest losses: bank losses in down years (offsets gains, then up to $3,000 of other income a year)',
                  )}
                  checked={S.lossHarvest.enabled}
                  onChange={(v) =>
                    update((d) => {
                      d.strategies.lossHarvest.enabled = v;
                    })
                  }
                />
                <Switch
                  label="Backdoor Roth contributions"
                  help={helpText(
                    'Backdoor Roth: when income is too high for a direct Roth IRA contribution, contribute after-tax and convert (pro-rata rule applied)',
                  )}
                  checked={S.backdoorRoth}
                  onChange={(v) =>
                    update((d) => {
                      d.strategies.backdoorRoth = v;
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
              </div>
              {S.magiTarget.enabled ? (
                <div className="pib-dials" style={{ marginTop: 6 }}>
                  <Dial
                    value={S.magiTarget.maxFplPct}
                    min={1}
                    max={6}
                    step={0.05}
                    onChange={(v) =>
                      update((d) => {
                        d.strategies.magiTarget.maxFplPct = Math.max(1, v);
                      })
                    }
                  >
                    <PercentField
                      label="Keep income under"
                      help={helpText('Keep income under (share of the poverty line)')}
                      hint="Share of the poverty line. The credit ends above 400%."
                      digits={0}
                      value={S.magiTarget.maxFplPct}
                      onChange={(v) =>
                        update((d) => {
                          d.strategies.magiTarget.maxFplPct = Math.max(1, v);
                        })
                      }
                    />
                  </Dial>
                  <Dial
                    value={S.magiTarget.minFplPct}
                    min={0}
                    max={3}
                    step={0.01}
                    onChange={(v) =>
                      update((d) => {
                        d.strategies.magiTarget.minFplPct = Math.max(0, v);
                      })
                    }
                  >
                    <PercentField
                      label="Keep income above"
                      help="Above 138% keeps you out of Medicaid in expansion states; above 100% avoids the coverage gap elsewhere."
                      hint="Share of the poverty line; 0 = no floor."
                      digits={0}
                      value={S.magiTarget.minFplPct}
                      onChange={(v) =>
                        update((d) => {
                          d.strategies.magiTarget.minFplPct = Math.max(0, v);
                        })
                      }
                    />
                  </Dial>
                </div>
              ) : null}
            </Fold>
          </>
        }
      />
    </>
  );
}
