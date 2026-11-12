import type { EngineData, Plan, ProjectionResult, YearRecord } from '@fisim/engine';
import { formatMoney, formatPct } from '@fisim/ui';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { loadDataBundle } from '../../engine/load';
import { taxBracketView } from '../../lib/metrics/tax';

export function TaxBrackets({
  plan,
  result,
  record,
  real,
}: {
  plan: Plan;
  result: ProjectionResult;
  record: YearRecord;
  real: boolean;
}) {
  const [data, setData] = useState<EngineData | null>(null);
  useEffect(() => {
    let live = true;
    void loadDataBundle().then((bundle) => {
      if (live) setData(bundle.bundledEngineData());
    });
    return () => {
      live = false;
    };
  }, []);
  if (!data) return <p role="status">Loading bracket detail…</p>;
  const view = taxBracketView(data, plan, result, record);
  const money = (v: number) => formatMoney(v / (real ? record.cpi : 1));
  return (
    <details>
      <summary>Ordinary federal bracket detail</summary>
      <div className="lv-table-wrap" tabIndex={0} role="region" aria-label="Ordinary federal brackets">
        <table className="lv-table">
          <thead>
            <tr>
              <th>Rate</th>
              <th>Income range</th>
              <th>Your income in bracket</th>
              <th>Ordinary tax</th>
            </tr>
          </thead>
          <tbody>
            {view.rows.map((r) => (
              <tr key={r.rate}>
                <th scope="row">{formatPct(r.rate)}</th>
                <td>
                  {money(r.bottom)}–{Number.isFinite(r.top) ? money(r.top) : 'and above'}
                </td>
                <td>{money(r.amount)}</td>
                <td>{money(r.tax)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="lv-small lv-muted">
        {record.year} {record.filingStatus.toUpperCase()} · {view.status} parameters from {view.dataYear},
        indexed using this projection’s inflation. Amounts in {real ? 'today’s dollars' : 'future dollars'}.
        This table excludes capital-gains tax, credits, NIIT and AMT.{' '}
        <Link to="/help/methods">Definitions and original dataset sources</Link>.
      </p>
    </details>
  );
}
