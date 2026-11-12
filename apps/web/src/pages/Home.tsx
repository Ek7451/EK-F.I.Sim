import { Card, Notice, Stat, formatCompact, formatPct } from '@fisim/ui';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Chart, axis, short, tooltip } from '../charts/Chart';
import { useProjection } from '../engine/useResults';
import { fundedStat } from '../lib/outcome';
import { PageHead } from '../shell/Shell';
import { usePlan, useStore } from '../state/store';
import { StartPage } from './StartWizard';

export function HomePage(): ReactNode {
  const plan = usePlan();
  const { result } = useProjection();
  const settings = useStore((s) => s.settings);
  const prev = useRef<{ nw: number; fi: number | null } | null>(null);
  const [changed, setChanged] = useState<string | null>(null);
  useEffect(() => {
    if (!result) return;
    const now = { nw: result.summary.endingNetWorthReal, fi: result.summary.fiYear };
    if (prev.current && Math.abs(prev.current.nw - now.nw) > 500) {
      const d = now.nw - prev.current.nw;
      setChanged(
        `Since your last change, net worth at the end of the plan is ${d > 0 ? 'up' : 'down'} ${formatCompact(Math.abs(d))}${prev.current.fi !== now.fi && now.fi && prev.current.fi ? `, and financial independence moves from ${prev.current.fi} to ${now.fi}` : ''}.`,
      );
    }
    prev.current = now;
  }, [result]);
  if (!plan) return <StartPage />;
  const s = result?.summary;
  const covered = result ? fundedStat(result) : null;
  const backupAge = settings.lastBackupAt
    ? Math.floor((Date.now() - Date.parse(settings.lastBackupAt)) / 86400000)
    : null;
  return (
    <>
      <PageHead
        title={plan.name}
        intro="The headline numbers for this plan. Everything here is an estimate that updates as you edit."
      />
      {changed ? (
        <Notice tone="ok">
          <span data-tour="what-changed">{changed}</span>
        </Notice>
      ) : null}
      <Card data-tour="home-stats">
        <div className="lv-grid">
          <Stat label="Net worth today" value={s ? formatCompact(s.currentNetWorth) : '…'} />
          <Stat
            label="Financially independent"
            value={s ? (s.fiYear ?? 'Not reached') : '…'}
            note="Investments reach 25× yearly spending"
          />
          <Stat label="Saving this year" value={s ? formatPct(s.savingsRate) : '…'} note="Share of income" />
          <Stat
            label="Left at the end of the plan"
            value={s ? formatCompact(s.endingNetWorthReal) : '…'}
            note={s ? `Net worth in ${s.endYear}, today's dollars` : undefined}
          />
          <Stat
            label="Spending covered"
            value={covered ? covered.value : '…'}
            note={covered?.note}
            data-tour="home-covered"
          />
        </div>
      </Card>
      {result ? (
        <Card
          title="Net worth"
          actions={<Link to="/explore/projection">Open the projection →</Link>}
          data-tour="home-chart"
        >
          <Chart
            label="Net worth over the plan, in today's dollars"
            deps={[result]}
            height={240}
            table={() => ({
              columns: ['Year', 'Net worth'],
              rows: result.records.map((r) => [r.year, formatCompact(r.netWorth / r.cpiEnd)]),
            })}
            build={(c) => ({
              grid: { left: 52, right: 12, top: 12, bottom: 28 },
              tooltip: { ...tooltip(c), trigger: 'axis', valueFormatter: (v: number) => formatCompact(v) },
              xAxis: {
                type: 'category',
                data: result.records.map((r) => r.year),
                boundaryGap: false,
                ...axis(c),
                splitLine: { show: false },
              },
              yAxis: { type: 'value', ...axis(c), axisLabel: { color: c.ink3, formatter: short } },
              series: [
                {
                  name: 'Net worth',
                  type: 'line',
                  symbol: 'none',
                  smooth: 0.2,
                  lineStyle: { width: 2.5, color: c.primary },
                  areaStyle: { color: c.primary, opacity: 0.12 },
                  data: result.records.map((r) => Math.round(r.netWorth / r.cpiEnd)),
                },
              ],
            })}
          />
        </Card>
      ) : null}
      <div className="lv-grid">
        <Card title="Build the plan">
          <p className="lv-muted lv-small">Accounts, income, spending and the milestones that shape them.</p>
          <p style={{ marginTop: 12 }}>
            <Link className="lv-btn" to="/plan/snapshot">
              Go to Plan
            </Link>
          </p>
        </Card>
        <Card title="Test it">
          <p className="lv-muted lv-small">Thousands of possible futures, and every start year in history.</p>
          <p style={{ marginTop: 12 }}>
            <Link className="lv-btn" to="/explore/success">
              Chance of success
            </Link>
          </p>
        </Card>
        <Card title="Try a what-if">
          <p className="lv-muted lv-small">Retire earlier, spend more, move state: side by side.</p>
          <p style={{ marginTop: 12 }}>
            <Link className="lv-btn" to="/compare">
              Compare
            </Link>
          </p>
        </Card>
      </div>
      <Card title="Your data" data-tour="data-home">
        <p className="lv-small">
          Plans are stored on this device only, unless you turn on encrypted sync.{' '}
          {backupAge === null
            ? 'You have not made a backup yet.'
            : backupAge > 90
              ? `Your last backup was ${backupAge} days ago.`
              : `Last backup ${backupAge === 0 ? 'today' : `${backupAge} days ago`}.`}
        </p>
        <p style={{ marginTop: 12 }}>
          <Link className="lv-btn" to="/settings" data-tour="backup-link">
            Backups and sync
          </Link>
        </p>
      </Card>
    </>
  );
}
