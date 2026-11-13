import './reports.css';
import { applyScenario } from '@fisim/engine';
import {
  Badge,
  Button,
  KpiStrip,
  Notice,
  SelectField,
  Stat,
  formatCompact,
  formatMoney,
  formatShare,
} from '@fisim/ui';
import { useEffect, useState, type ReactNode } from 'react';
import { Chart, areaSeries, axis, dawnFill, dawnLine, short, tooltip, tooltipCard } from '../../charts/Chart';
import { useMonteCarlo, useProjection } from '../../engine/useResults';
import { exportCsv, exportPdf } from '../../lib/files';
import { agesText, fundedStat } from '../../lib/outcome';
import { DISCLAIMER } from '../../shell/nav';
import { PageHead } from '../../shell/Shell';
import { useStore } from '../../state/store';
import { useDraft, usePreviewPlan } from '../../state/draft';

/** Money with a true minus sign in front of the dollar: "−$12,901". */
const money = (v: number): string => (Math.round(v) < 0 ? `−${formatMoney(-v)}` : formatMoney(v));

export function ReportsPage(): ReactNode {
  const plan = usePreviewPlan()!;
  const draft = useDraft((s) => s.transaction);
  const scenarioId = useStore((s) => s.scenarioId);
  const setScenario = useStore((s) => s.setScenario);
  const { result, stale, error, retry } = useProjection();
  const [withMc, setWithMc] = useState(false);
  const mc = useMonteCarlo(withMc);
  // The version picked here only applies to reports: go back to "as planned" on the way out.
  useEffect(() => () => setScenario(null), [setScenario]);
  const [busy, setBusy] = useState(false);
  const isDraft = draft?.plan === plan;
  const label = scenarioId
    ? (plan.scenarios.find((s) => s.id === scenarioId)?.name ?? 'what-if')
    : isDraft
      ? 'Unsaved draft preview'
      : 'as planned';
  const recs = result?.records ?? [];
  const funded = result ? fundedStat(result) : null;
  return (
    <>
      <PageHead
        title="Reports"
        intro="Take the plan with you. Reports are made on this device; nothing is uploaded."
      />
      {error && (
        <Notice tone="danger">
          {error}{' '}
          <Button size="sm" onClick={retry}>
            Retry calculation
          </Button>
        </Notice>
      )}
      {isDraft && <Notice>Apply your draft or save it as a scenario before exporting a report.</Notice>}
      <div className="rpt-bar no-print">
        <section className="lv-card rpt-options" data-tour="report-options" aria-label="What to include">
          <div className="rpt-version">
            <SelectField
              label="Version of the plan"
              value={scenarioId ?? ''}
              options={[
                { value: '', label: 'As planned' },
                ...plan.scenarios.map((s) => ({ value: s.id, label: s.name })),
              ]}
              onChange={(v) => setScenario(v || null)}
            />
          </div>
          <div className="rpt-mc">
            <label className="lv-switch">
              <input
                type="checkbox"
                role="switch"
                checked={withMc}
                onChange={(e) => setWithMc(e.target.checked)}
              />
              <span>Include the chance of success (runs the simulation first)</span>
            </label>
            {withMc && mc.running ? (
              <div className="rpt-progress">
                <div
                  className="lv-progress"
                  role="progressbar"
                  aria-label="Report simulation progress"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(mc.progress * 100)}
                >
                  <div style={{ width: `${Math.round(mc.progress * 100)}%` }} />
                </div>
                <Button size="sm" onClick={mc.cancel}>
                  Stop simulation
                </Button>
              </div>
            ) : null}
            {stale ? (
              <p className="lv-small lv-muted" role="status">
                Updating report… Export is available when this revision finishes.
              </p>
            ) : null}
          </div>
        </section>
        <div className="rpt-exports">
          <div className="rpt-tile" data-tour="report-pdf">
            <Button
              variant="primary"
              icon="download"
              disabled={
                !result ||
                isDraft ||
                stale ||
                busy ||
                (withMc && (mc.running || mc.partial || !mc.summary || !!mc.error))
              }
              onClick={() => {
                if (!result) return;
                setBusy(true);
                void exportPdf(applyScenario(plan, scenarioId), result, withMc ? mc.summary : null, label)
                  .catch(() => useStore.getState().notify('Report export failed. Please retry.', 'danger'))
                  .finally(() => setBusy(false));
              }}
              data-tour="download-pdf"
            >
              Download PDF
            </Button>
            <span title="Summary, net-worth chart, a year-by-year table, assumptions and the disclaimers.">
              Summary, chart, every year
            </span>
          </div>
          <div className="rpt-tile" data-tour="report-csv">
            <Button
              icon="download"
              disabled={!result || stale || isDraft}
              onClick={() => result && exportCsv(plan, result, label)}
              data-tour="download-csv"
            >
              Download CSV
            </Button>
            <span title="One row per year with income, withdrawals, spending, taxes and balances, in future dollars with the inflation factor alongside.">
              Every year, future dollars
            </span>
          </div>
          <div className="rpt-tile">
            <Button icon="reports" onClick={() => window.print()}>
              Print
            </Button>
            <span>The preview below</span>
          </div>
        </div>
      </div>
      {withMc && !mc.running && (mc.error || mc.partial || !mc.summary) && (
        <Notice tone={mc.error ? 'danger' : 'warn'}>
          {mc.error
            ? `Simulation failed: ${mc.error}.`
            : `Simulation stopped with ${(mc.summary?.runs ?? 0).toLocaleString()} completed runs.`}{' '}
          A completed simulation is required for the PDF.{' '}
          <Button size="sm" onClick={mc.rerun}>
            Run again
          </Button>
        </Notice>
      )}
      {result ? (
        <section className="lv-card rpt-paper" data-tour="report-preview" aria-label="Report preview">
          <header className="rpt-head">
            <div className="rpt-title">
              <span className="rpt-eyebrow">Report preview</span>
              <h2 title={plan.name}>{plan.name}</h2>
            </div>
            <div className="lv-row rpt-tags">
              <Badge tone={isDraft ? 'warn' : undefined}>
                {label.charAt(0).toUpperCase() + label.slice(1)}
              </Badge>
              <Badge>Today's dollars</Badge>
              <Badge>
                {recs[0].year}–{recs[recs.length - 1].year}
              </Badge>
              <Badge>{result.dataRelease}</Badge>
            </div>
          </header>
          <KpiStrip>
            <Stat
              label="Net worth today"
              value={formatCompact(result.summary.currentNetWorth)}
              note={money(result.summary.currentNetWorth)}
              icon="wallet"
            />
            <Stat
              label="At the end of the plan"
              value={formatCompact(result.summary.endingNetWorthReal)}
              note={money(result.summary.endingNetWorthReal)}
              icon="flag"
            />
            <Stat
              label="Lifetime tax"
              value={formatCompact(result.summary.lifetimeTaxReal)}
              note={money(result.summary.lifetimeTaxReal)}
              icon="taxes"
            />
            <Stat label="Spending covered" value={funded!.value} note={funded!.note} icon="check" />
            {withMc && mc.summary ? (
              <Stat
                label="Chance of success"
                value={formatShare(mc.summary.successRate)}
                note={`${mc.summary.runs.toLocaleString()} runs`}
                icon="success"
              />
            ) : null}
          </KpiStrip>
          <div className="rpt-body">
            <figure className="rpt-chart">
              <figcaption>Net worth over the plan</figcaption>
              <Chart
                label="Net worth over the plan, in today's dollars"
                deps={[result]}
                height="var(--rpt-body-h)"
                build={(c) => ({
                  grid: { left: 52, right: 12, top: 12, bottom: 26 },
                  tooltip: {
                    ...tooltip(c),
                    trigger: 'axis',
                    formatter: (ps: { dataIndex: number }[]) => {
                      const r = recs[ps[0]?.dataIndex ?? 0];
                      if (!r) return '';
                      return tooltipCard(c, {
                        title: `End of ${r.year}`,
                        subtitle: agesText(r),
                        rows: [{ name: 'Net worth', color: c.dawn[1], value: money(r.netWorth / r.cpiEnd) }],
                      });
                    },
                  },
                  xAxis: {
                    type: 'category',
                    data: recs.map((r) => r.year),
                    boundaryGap: false,
                    ...axis(c),
                    splitLine: { show: false },
                  },
                  yAxis: {
                    type: 'value',
                    ...axis(c),
                    axisLabel: { color: c.ink3, fontSize: 11, formatter: short },
                  },
                  series: [
                    {
                      ...areaSeries(
                        'Net worth',
                        c.dawn[1],
                        recs.map((r) => r.netWorth / r.cpiEnd),
                      ),
                      lineStyle: dawnLine(c, 3),
                      areaStyle: dawnFill(c),
                    },
                  ],
                })}
              />
            </figure>
            <div
              className="lv-table-wrap rpt-table"
              tabIndex={0}
              role="region"
              aria-label="Report preview, year by year"
            >
              <table className="lv-table">
                <thead>
                  <tr>
                    <th scope="col">Year</th>
                    <th scope="col">Age</th>
                    <th scope="col">Income</th>
                    <th scope="col">Withdrawn</th>
                    <th scope="col">Spending</th>
                    <th scope="col">Tax</th>
                    <th scope="col">Net worth</th>
                  </tr>
                </thead>
                <tbody>
                  {recs.map((r) => (
                    <tr key={r.year}>
                      <th scope="row">{r.year}</th>
                      <td>{r.ages.join('/')}</td>
                      <td>{money(r.income.total / r.cpi)}</td>
                      <td>{money(r.withdrawals.total / r.cpi)}</td>
                      <td>{money(r.expenses.total / r.cpi)}</td>
                      <td>{money(r.taxes.total / r.cpi)}</td>
                      <td>{money(r.netWorth / r.cpiEnd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="rpt-foot">{DISCLAIMER} Shown in today's dollars; the CSV carries future dollars.</p>
        </section>
      ) : null}
    </>
  );
}
