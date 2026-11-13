import { applyScenario } from '@fisim/engine';
import { Button, Card, Notice, SelectField, Stat, formatMoney, formatShare } from '@fisim/ui';
import { useEffect, useState, type ReactNode } from 'react';
import { useMonteCarlo, useProjection } from '../../engine/useResults';
import { exportCsv, exportPdf } from '../../lib/files';
import { DISCLAIMER } from '../../shell/nav';
import { PageHead } from '../../shell/Shell';
import { useStore } from '../../state/store';
import { useDraft, usePreviewPlan } from '../../state/draft';

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
  const label = scenarioId
    ? (plan.scenarios.find((s) => s.id === scenarioId)?.name ?? 'what-if')
    : draft?.plan === plan
      ? 'Unsaved draft preview'
      : 'as planned';
  const rows = result ? result.records.filter((_, i) => i % 5 === 0 || i === result.records.length - 1) : [];
  return (
    <>
      <PageHead
        title="Reports"
        intro="Take the plan with you. Reports are made on this device; nothing is uploaded."
      />
      {error && (
        <Notice tone="danger">
          {error} <Button onClick={retry}>Retry calculation</Button>
        </Notice>
      )}
      {draft?.plan === plan && (
        <Notice>Apply your draft or save it as a scenario before exporting a report.</Notice>
      )}
      {stale && <p role="status">Updating report… Export is available when this revision finishes.</p>}
      <Card title="What to include" data-tour="report-options">
        <div className="form-grid">
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
        <label className="lv-switch" style={{ marginTop: 12 }}>
          <input
            type="checkbox"
            role="switch"
            checked={withMc}
            onChange={(e) => setWithMc(e.target.checked)}
          />
          <span>Include the chance of success (runs the simulation first)</span>
        </label>
        {withMc && mc.running ? (
          <>
            <div
              className="lv-progress"
              style={{ marginTop: 8 }}
              role="progressbar"
              aria-label="Report simulation progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(mc.progress * 100)}
            >
              <div style={{ width: `${mc.progress * 100}%` }} />
            </div>
            <Button onClick={mc.cancel}>Stop simulation</Button>
          </>
        ) : null}
        {withMc && !mc.running && (mc.error || mc.partial || !mc.summary) && (
          <Notice tone={mc.error ? 'danger' : 'warn'}>
            {mc.error
              ? `Simulation failed: ${mc.error}.`
              : `Simulation stopped with ${(mc.summary?.runs ?? 0).toLocaleString()} completed runs.`}{' '}
            A completed simulation is required for the PDF. <Button onClick={mc.rerun}>Run again</Button>
          </Notice>
        )}
      </Card>
      <div className="lv-grid">
        <Card title="PDF report" data-tour="report-pdf">
          <p className="lv-muted lv-small">
            Summary, net-worth chart, a year-by-year table, assumptions and the disclaimers.
          </p>
          <p style={{ marginTop: 12 }}>
            <Button
              variant="primary"
              icon="download"
              disabled={
                !result ||
                draft?.plan === plan ||
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
          </p>
        </Card>
        <Card title="Spreadsheet (CSV)" data-tour="report-csv">
          <p className="lv-muted lv-small">
            One row per year with income, withdrawals, spending, taxes and balances, in future dollars with
            the inflation factor alongside.
          </p>
          <p style={{ marginTop: 12 }}>
            <Button
              icon="download"
              disabled={!result || stale || draft?.plan === plan}
              onClick={() => result && exportCsv(plan, result, label)}
              data-tour="download-csv"
            >
              Download CSV
            </Button>
          </p>
        </Card>
        <Card title="Print">
          <p className="lv-muted lv-small">Prints this page's preview using your browser.</p>
          <p style={{ marginTop: 12 }}>
            <Button onClick={() => window.print()}>Print</Button>
          </p>
        </Card>
      </div>
      {result ? (
        <Card title={`Preview: ${plan.name} (${label})`} data-tour="report-preview">
          <Notice>{DISCLAIMER}</Notice>
          <div className="lv-grid" style={{ margin: '16px 0' }}>
            <Stat label="Net worth today" value={formatMoney(result.summary.currentNetWorth)} />
            <Stat
              label="At the end of the plan"
              value={formatMoney(result.summary.endingNetWorthReal)}
              note="Today's dollars"
            />
            <Stat label="Lifetime tax" value={formatMoney(result.summary.lifetimeTaxReal)} />
            {withMc && mc.summary ? (
              <Stat
                label="Chance of success"
                value={formatShare(mc.summary.successRate)}
                note={`${mc.summary.runs.toLocaleString()} runs`}
              />
            ) : null}
          </div>
          <div className="lv-table-wrap" tabIndex={0} role="region" aria-label="Report preview, year by year">
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
                {rows.map((r) => (
                  <tr key={r.year}>
                    <th scope="row">{r.year}</th>
                    <td>{r.ages.join('/')}</td>
                    <td>{formatMoney(r.income.total / r.cpi)}</td>
                    <td>{formatMoney(r.withdrawals.total / r.cpi)}</td>
                    <td>{formatMoney(r.expenses.total / r.cpi)}</td>
                    <td>{formatMoney(r.taxes.total / r.cpi)}</td>
                    <td>{formatMoney(r.netWorth / r.cpiEnd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="lv-muted lv-small" style={{ marginTop: 8 }}>
            Every fifth year shown, in today's dollars. The PDF and CSV carry every year. Data release{' '}
            {result.dataRelease}.
          </p>
        </Card>
      ) : null}
    </>
  );
}
