import { explainTax, type YearRecord } from '@fisim/engine';
import { Badge, Button, Card, Explain, Stat, formatCompact, formatMoney, formatPct } from '@fisim/ui';
import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Chart, axis, short, tooltip } from '../../charts/Chart';
import { useProjection } from '../../engine/useResults';
import { PageHead } from '../../shell/Shell';
import { usePreviewPlan } from '../../state/draft';
import { useSelectedYear } from '../../state/workspace';
import { TaxBrackets } from '../workspace/TaxBrackets';
import { useMoney, Loading, RecomputeError, ProjectedBadge, YearPicker } from './shared';

export function TaxesPage(): ReactNode {
  const plan = usePreviewPlan()!;
  const { result, error, stale, retry } = useProjection();
  const m = useMoney();
  const [year, setYear] = useSelectedYear();
  if (!result)
    return (
      <>
        <PageHead group="explore" title="Taxes" />
        <Loading error={error} />
      </>
    );
  const recs = result.records;
  const r = recs.find((x) => x.year === year) ?? recs[0];
  const ex = explainTax(r, m.real ? 'real' : 'nominal');
  const parts: [string, (x: YearRecord) => number][] = [
    ['Federal income tax', (x) => Math.max(0, x.taxes.federalIncome)],
    ['Payroll tax', (x) => x.taxes.fica + x.taxes.selfEmployment],
    ['State income tax', (x) => x.taxes.state],
    ['Penalties', (x) => x.taxes.penalties],
  ];
  const moves = recs.filter((x, i) => i > 0 && x.state !== recs[i - 1].state);
  return (
    <>
      <PageHead
        group="explore"
        title="Taxes"
        intro={`Estimated federal, payroll and state tax each year, in ${m.unit}. For planning only; this is not a tax return.`}
        actions={
          <span className="lv-row">
            {recs.some((x) => x.taxes.state > 0.5) ? (
              <span
                title="State tax uses each state's brackets, deductions and main retirement exclusions, but not every credit or local tax. Treat it as a rough estimate."
                data-tour="state-tax-estimate"
              >
                <Badge tone="warn">State tax is a rough estimate</Badge>
              </span>
            ) : null}
            <ProjectedBadge result={result} />
          </span>
        }
      />
      <RecomputeError error={error} />
      {stale && (
        <p className="lv-muted" role="status">
          {error ? 'Last successful result' : 'Updating results…'}{' '}
          {error && (
            <Button size="sm" onClick={retry}>
              Retry
            </Button>
          )}
        </p>
      )}
      <Card data-tour="tax-stats">
        <div className="lv-grid">
          <Stat
            label="Lifetime tax"
            value={formatCompact(result.summary.lifetimeTaxReal)}
            note="Today's dollars, after credits"
            data-tour="lifetime-tax"
          />
          <Stat
            label="Average rate"
            value={formatPct(result.summary.averageEffectiveTaxRate, 1)}
            note="Tax as a share of income and withdrawals"
          />
          <Stat
            label={`Marginal rate in ${r.year}`}
            value={formatPct(r.taxes.marginalRate)}
            note="Federal bracket on the next dollar"
            data-tour="marginal-rate"
          />
          <Stat
            label="Roth conversions"
            value={formatCompact(recs.reduce((t, x) => t + x.rothConversion / x.cpi, 0))}
            note="Total over the plan"
          />
        </div>
      </Card>
      <Card title="Tax by type" data-tour="tax-chart">
        <Chart
          label="Tax by type each year, with effective and marginal rates"
          deps={[result, m.real]}
          height="var(--chart-h)"
          onClick={(p) => setYear(recs[p.dataIndex]?.year ?? null)}
          table={() => ({
            columns: [
              'Year',
              ...parts.map((p) => p[0]),
              'Premium credit',
              'Effective rate',
              'Marginal rate',
              'Tables',
            ],
            rows: recs.map((x) => [
              x.year,
              ...parts.map((p) => formatMoney(m.flow(x, p[1](x)))),
              formatMoney(m.flow(x, x.taxes.ptc)),
              formatPct(x.taxes.effectiveRate, 1),
              formatPct(x.taxes.marginalRate),
              x.dataStatus,
            ]),
          })}
          build={(c) => ({
            // Two panels sharing the years, each with one value axis: tax in dollars above, rates below.
            grid: [
              { left: 56, right: 12, top: 34, bottom: '34%' },
              { left: 56, right: 12, height: '18%', bottom: 28 },
            ],
            axisPointer: { link: [{ xAxisIndex: 'all' }] },
            legend: { type: 'scroll', top: 0, left: 0 },
            tooltip: { ...tooltip(c), trigger: 'axis' },
            xAxis: [
              {
                type: 'category',
                data: recs.map((x) => x.year),
                ...axis(c),
                axisLabel: { show: false },
                splitLine: { show: false },
              },
              {
                type: 'category',
                gridIndex: 1,
                data: recs.map((x) => x.year),
                ...axis(c),
                splitLine: { show: false },
              },
            ],
            yAxis: [
              { type: 'value', ...axis(c), axisLabel: { color: c.ink3, fontSize: 11, formatter: short } },
              {
                type: 'value',
                gridIndex: 1,
                max: (extent: { max: number }) => Math.max(0.5, extent.max),
                splitNumber: 2,
                ...axis(c),
                axisLabel: {
                  color: c.ink3,
                  fontSize: 11,
                  formatter: (v: number) => `${Math.round(v * 100)}%`,
                },
              },
            ],
            series: [
              ...parts.map(([name, f]) => ({
                name,
                type: 'bar',
                stack: 't',
                barCategoryGap: '24%',
                itemStyle: { borderColor: c.surface, borderWidth: 1 },
                data: recs.map((x) => m.flow(x, f(x))),
                tooltip: { valueFormatter: (v: number) => formatMoney(v) },
              })),
              {
                name: 'Effective rate',
                type: 'line',
                xAxisIndex: 1,
                yAxisIndex: 1,
                symbol: 'none',
                lineStyle: { width: 2, color: c.ink },
                itemStyle: { color: c.ink },
                data: recs.map((x) => x.taxes.effectiveRate),
                tooltip: { valueFormatter: (v: number) => formatPct(v, 1) },
              },
              {
                name: 'Marginal rate',
                type: 'line',
                xAxisIndex: 1,
                yAxisIndex: 1,
                step: 'middle',
                symbol: 'none',
                lineStyle: { width: 1.5, type: 'dashed', color: c.ink3 },
                itemStyle: { color: c.ink3 },
                data: recs.map((x) => x.taxes.marginalRate),
                tooltip: { valueFormatter: (v: number) => formatPct(v) },
              },
            ],
          })}
        />
      </Card>
      <div className="two-col">
        <Card
          title={`Breakdown for ${r.year}`}
          actions={
            <Explain
              title={`tax in ${r.year}`}
              lines={ex.lines}
              total={ex.result}
              source={`Tables: ${r.dataStatus}. In ${m.unit}.`}
            />
          }
          data-tour="tax-breakdown"
        >
          <YearPicker records={recs} year={r.year} onChange={setYear} />
          <p className="lv-small">
            Ordinary taxable income {formatMoney(m.flow(r, r.taxes.ordinaryTaxable))} · marginal federal
            bracket {formatPct(r.taxes.marginalRate)}. Ordinary tax{' '}
            {formatMoney(m.flow(r, r.taxes.ordinaryTax))}; capital-gains tax{' '}
            {formatMoney(m.flow(r, r.taxes.capitalGainsTax))}.
          </p>
          <p className="lv-small">
            <Link to="/plan/strategy">Preview a Roth conversion</Link> ·{' '}
            <Link to="/help/methods">Tax methods and dataset sources</Link>
          </p>
          <TaxBrackets plan={plan} result={result} record={r} real={m.real} />
          <div
            className="lv-table-wrap"
            tabIndex={0}
            role="region"
            aria-label="Tax worked out for the selected year"
            style={{ marginTop: 12 }}
          >
            <table className="lv-table">
              <tbody>
                {(
                  [
                    ['Adjusted gross income', r.taxes.agi],
                    ['Deduction', -r.taxes.deduction],
                    ['Taxable income', r.taxes.taxableIncome],
                    ['Taxable Social Security', r.taxes.taxableSocialSecurity],
                    ['Income for health subsidies (MAGI)', r.taxes.magi],
                    ['Roth conversion', r.rothConversion],
                    ['Gains realized', r.realizedGains],
                    ['Required distributions', r.withdrawals.rmd],
                  ] as [string, number][]
                ).map(([k, v]) => (
                  <tr key={k}>
                    <th scope="row">{k}</th>
                    <td>{formatMoney(m.flow(r, v))}</td>
                  </tr>
                ))}
                <tr>
                  <th scope="row">Filing status, state</th>
                  <td>
                    {r.filingStatus.toUpperCase()}, {r.state}
                  </td>
                </tr>
                <tr>
                  <th scope="row">Medicare income tier (IRMAA)</th>
                  <td>{r.taxes.irmaaTier === 0 ? 'Standard' : `Tier ${r.taxes.irmaaTier}`}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
        <Card title={`Healthcare in ${r.year}`}>
          <ul className="lv-list">
            {r.coverage.map((coverage, i) => (
              <li key={i}>
                <span>{plan.people[i]?.name ?? `Person ${i + 1}`}</span>
                <strong>{coverage}</strong>
              </li>
            ))}
          </ul>
          <dl className="year-ledger">
            <div>
              <dt>Gross modeled cost</dt>
              <dd>{formatMoney(m.flow(r, r.expenses.healthcare.total))}</dd>
            </div>
            <div>
              <dt>Premium tax credit</dt>
              <dd>{formatMoney(m.flow(r, r.taxes.ptc))}</dd>
            </div>
            <div>
              <dt>Cost after credit</dt>
              <dd>{formatMoney(m.flow(r, r.expenses.healthcare.total - r.taxes.ptc))}</dd>
            </div>
            <div>
              <dt>HSA payments (included above)</dt>
              <dd>{formatMoney(m.flow(r, r.expenses.healthcare.hsaPaid))}</dd>
            </div>
            <div>
              <dt>MAGI / poverty guideline</dt>
              <dd>{formatPct(r.taxes.fplRatio, 0)}</dd>
            </div>
            <div>
              <dt>Medicare surcharge</dt>
              <dd>{formatMoney(m.flow(r, r.expenses.healthcare.irmaa))}</dd>
            </div>
          </dl>
          <p className="lv-small lv-muted">
            Premium credits are already included in net taxes. This after-credit view does not subtract them
            again from the cash-flow ledger. Medicare income tiers use the modeled two-year lookback.
          </p>
          <Link to="/plan/healthcare">Edit coverage and cost assumptions →</Link>
        </Card>
        <Card title="Things to know" data-tour="tax-notes">
          <ul style={{ margin: 0, paddingLeft: 18 }} className="lv-stack">
            <li>
              {recs.some((x) => x.dataStatus === 'projected')
                ? `Years from ${recs.find((x) => x.dataStatus === 'projected')!.year} use projected tables: the latest enacted figures indexed for inflation.`
                : 'All years use enacted tables.'}
            </li>
            {moves.map((x) => (
              <li key={x.year}>
                In {x.year} you move to {x.state}; state tax switches to that state's tables from that year.
              </li>
            ))}
            {recs.some((x) => x.taxes.penalties > 1) ? (
              <li>
                Early-withdrawal penalties apply in {recs.filter((x) => x.taxes.penalties > 1).length} years.
                See Strategy for penalty-free options.
              </li>
            ) : null}
            {recs.some((x) => x.taxes.irmaaTier > 0) ? (
              <li>
                Medicare income surcharges apply in {recs.filter((x) => x.taxes.irmaaTier > 0).length} years,
                based on income two years earlier.
              </li>
            ) : null}
            <li>
              State figures are simplified where a state's rules have phase-outs this model does not carry.
              Each state's notes are under How this is calculated.
            </li>
          </ul>
        </Card>
      </div>
    </>
  );
}
