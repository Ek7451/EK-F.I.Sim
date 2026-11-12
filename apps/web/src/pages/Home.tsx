import { Card, Icon, IconTile, Skeleton, Stat, formatCompact, formatMoney, formatPct } from '@fisim/ui';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Chart, areaSeries, axis, short, tooltip, tooltipCard } from '../charts/Chart';
import { useProjection } from '../engine/useResults';
import { agesText, fundedStat } from '../lib/outcome';
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
  const actions: { to: string; icon: string; title: string; text: string; tour?: string }[] = [
    {
      to: '/plan/snapshot',
      icon: 'wallet',
      title: 'Build the plan',
      text: 'Accounts, income, spending, milestones',
    },
    {
      to: '/explore/success',
      icon: 'success',
      title: 'Test it',
      text: 'Thousands of futures and every start year',
    },
    {
      to: '/compare',
      icon: 'compare',
      title: 'Try a what-if',
      text: 'Retire earlier, spend more, move state',
    },
    {
      to: '/settings',
      icon: 'shield',
      title: 'Your data',
      text:
        backupAge === null
          ? 'Stored on this device. No backup yet'
          : backupAge > 90
            ? `Last backup ${backupAge} days ago`
            : `Last backup ${backupAge === 0 ? 'today' : `${backupAge} days ago`}`,
      tour: 'backup-link',
    },
  ];
  return (
    <>
      <PageHead
        title={plan.name}
        intro="The headline numbers for this plan, in today's dollars. Every figure is an estimate that updates as you edit."
      />
      <div className="home-hero">
        <Card variant="hero" data-tour="home-stats">
          <div className="lv-stack" style={{ gap: 16 }}>
            <Stat
              size="hero"
              label="Net worth today"
              value={s ? formatCompact(s.currentNetWorth) : <Skeleton height={44} width={180} />}
              note={s ? `Start of ${s.startYear}` : undefined}
            />
            {changed ? (
              <p className="home-changed" data-tour="what-changed">
                <Icon name="sparkle" size={16} />
                <span>{changed}</span>
              </p>
            ) : null}
            <dl className="home-facts">
              <div>
                <dt>Financially independent</dt>
                <dd>{s ? (s.fiYear ?? 'Not reached') : '…'}</dd>
              </div>
              <div>
                <dt>Saving this year</dt>
                <dd>{s ? formatPct(s.savingsRate) : '…'}</dd>
              </div>
              <div>
                <dt>Left at the end of the plan</dt>
                <dd>{s ? formatCompact(s.endingNetWorthReal) : '…'}</dd>
              </div>
              <div data-tour="home-covered">
                <dt>Spending covered</dt>
                <dd>{covered ? covered.value : '…'}</dd>
              </div>
            </dl>
            <p className="lv-small lv-muted">
              {covered?.note ? `${covered.note}. ` : ''}Financially independent means investments reach 25× a
              year's spending, with housing and healthcare.
            </p>
          </div>
        </Card>
        <Card
          title="Net worth over the plan"
          actions={
            <Link className="lv-small" to="/explore/projection">
              Open the projection →
            </Link>
          }
          data-tour="home-chart"
        >
          {result ? (
            <Chart
              label="Net worth over the plan, in today's dollars"
              deps={[result]}
              height="var(--chart-h-home)"
              table={() => ({
                columns: ['Year', 'Net worth'],
                rows: result.records.map((r) => [r.year, formatCompact(r.netWorth / r.cpiEnd)]),
              })}
              build={(c) => ({
                grid: { left: 52, right: 12, top: 12, bottom: 28 },
                tooltip: {
                  ...tooltip(c),
                  trigger: 'axis',
                  formatter: (ps: { dataIndex: number }[]) => {
                    const r = result.records[ps[0]?.dataIndex ?? 0];
                    if (!r) return '';
                    return tooltipCard(c, {
                      title: `End of ${r.year}`,
                      subtitle: agesText(r),
                      rows: [
                        { name: 'Net worth', color: c.primary, value: formatMoney(r.netWorth / r.cpiEnd) },
                      ],
                    });
                  },
                },
                xAxis: {
                  type: 'category',
                  data: result.records.map((r) => r.year),
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
                      c.primary,
                      result.records.map((r) => Math.round(r.netWorth / r.cpiEnd)),
                      { smooth: true },
                    ),
                    lineStyle: { width: 2.5, color: c.primary },
                  },
                ],
              })}
            />
          ) : (
            <Skeleton height={260} />
          )}
        </Card>
      </div>
      <nav className="home-actions" aria-label="Next steps" data-tour="data-home">
        {actions.map((a) => (
          <Link key={a.to} className="home-action" to={a.to} data-tour={a.tour}>
            <IconTile icon={a.icon} />
            <span className="lv-stack" style={{ gap: 0, minWidth: 0 }}>
              <strong>{a.title}</strong>
              <span className="lv-small lv-muted lv-ellipsis">{a.text}</span>
            </span>
            <Icon name="chevron" size={16} />
          </Link>
        ))}
      </nav>
    </>
  );
}
