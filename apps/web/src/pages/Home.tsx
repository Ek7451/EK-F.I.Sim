import { PlanZ, type PlanInput, type SamplePlanId } from '@fisim/engine';
import {
  Button,
  Card,
  MoneyField,
  Notice,
  NumberField,
  SelectField,
  Stat,
  Switch,
  TextField,
  formatCompact,
  formatPct,
} from '@fisim/ui';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Chart, axis, short, tooltip } from '../charts/Chart';
import { useProjection } from '../engine/useResults';
import { STATES } from '../lib/fields';
import { PageHead } from '../shell/Shell';
import { usePlan, useStore } from '../state/store';
import { useTour } from '../tours/TourEngine';

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
            label="At the end of the plan"
            value={s ? formatCompact(s.endingNetWorthReal) : '…'}
            note={
              s
                ? s.success
                  ? "Every year's spending is funded"
                  : `Money runs short in ${s.failedYear}`
                : undefined
            }
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
              rows: result.records.map((r) => [r.year, formatCompact(r.netWorth / r.cpi)]),
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
                  data: result.records.map((r) => Math.round(r.netWorth / r.cpi)),
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

// ------------------------------------------------------------------ start / first-plan wizard (UX-05)

const D = (n: number): number => Math.round(n * 100);

interface Draft {
  name: string;
  birthYear: number;
  state: string;
  partner: boolean;
  partnerName: string;
  partnerBirthYear: number;
  salary: number;
  partnerSalary: number;
  cash: number;
  brokerage: number;
  pretax: number;
  roth: number;
  saveRate: number;
  spending: number;
  retireAge: number;
}

function buildPlan(d: Draft, year: number): PlanInput {
  const people: PlanInput['people'] = [
    {
      id: 'p1',
      name: d.name || 'You',
      birthDate: `${d.birthYear}-06-15`,
      residence: [{ state: d.state, fromYear: year }],
    },
  ];
  if (d.partner)
    people.push({
      id: 'p2',
      name: d.partnerName || 'Partner',
      birthDate: `${d.partnerBirthYear}-06-15`,
      residence: [{ state: d.state, fromYear: year }],
    });
  const incomes: PlanInput['incomes'] = [];
  const end = { type: 'milestone' as const, milestoneId: 'm-retire', offset: 0 };
  if (d.salary > 0)
    incomes.push({
      id: 'i1',
      ownerId: 'p1',
      name: `${d.name || 'Your'} salary`,
      kind: 'wages',
      amount: D(d.salary),
      growth: { rate: 0.01, basis: 'real' },
      end,
    });
  if (d.partner && d.partnerSalary > 0)
    incomes.push({
      id: 'i2',
      ownerId: 'p2',
      name: `${d.partnerName || 'Partner'}'s salary`,
      kind: 'wages',
      amount: D(d.partnerSalary),
      growth: { rate: 0.01, basis: 'real' },
      end,
    });
  const accounts: PlanInput['accounts'] = [
    {
      id: 'a-cash',
      ownerId: 'p1',
      name: 'Savings',
      type: 'cash',
      balance: D(d.cash),
      fixedYield: { rate: 0.035, basis: 'nominal' },
    },
    {
      id: 'a-brokerage',
      ownerId: d.partner ? 'joint' : 'p1',
      name: 'Brokerage',
      type: 'taxable',
      balance: D(d.brokerage),
      costBasis: D(d.brokerage * 0.7),
      allocation: { usStocks: 0.7, usBonds: 0.2, intlStocks: 0.1 },
    },
    {
      id: 'a-401k',
      ownerId: 'p1',
      name: 'Retirement plan (pre-tax)',
      type: 'trad401k',
      balance: D(d.pretax),
      allocation: { usStocks: 0.7, usBonds: 0.2, intlStocks: 0.1 },
      ruleOf55: true,
      contribution:
        d.salary > 0
          ? {
              incomeId: 'i1',
              employeePct: d.saveRate,
              employerMatch: [{ matchPct: 0.5, upToPctOfSalary: 0.06 }],
            }
          : undefined,
    },
    {
      id: 'a-roth',
      ownerId: 'p1',
      name: 'Roth IRA',
      type: 'rothIra',
      balance: D(d.roth),
      rothBasis: { contributions: D(d.roth * 0.7), firstContributionYear: year - 6 },
      allocation: { usStocks: 0.8, intlStocks: 0.2 },
    },
  ];
  return {
    id: 'new',
    schemaVersion: 1,
    name: d.partner ? `${d.name || 'Our'} plan` : 'My plan',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    settings: { startYear: year },
    people,
    household: { filingStatus: [{ fromYear: year, status: d.partner ? 'mfj' : 'single' }] },
    accounts,
    incomes,
    expenses: [
      { id: 'e-core', name: 'Everyday living', category: 'food', amount: D(d.spending * 0.85) },
      {
        id: 'e-fun',
        name: 'Travel and fun',
        category: 'travel',
        amount: D(d.spending * 0.15),
        essential: false,
        followsPhases: true,
      },
    ],
    milestones: [
      {
        id: 'm-retire',
        name: 'Retire',
        kind: 'retirement',
        personId: 'p1',
        when: { type: 'age', personId: 'p1', age: d.retireAge },
      },
      {
        id: 'm-fi',
        name: 'Financially independent',
        kind: 'fi',
        when: { type: 'condition', metric: 'fi', fiMultiple: 25 },
      },
    ],
    strategies: {
      surplusWaterfall: [
        { type: 'emergencyFund', accountId: 'a-cash', months: 6 },
        { type: 'account', accountId: 'a-roth' },
        { type: 'account', accountId: 'a-brokerage' },
      ],
      spendingPhases: [
        { name: 'Go-go', fromAge: d.retireAge, multiplier: 1.1 },
        { name: 'Slow-go', fromAge: Math.max(d.retireAge + 10, 75), multiplier: 0.9 },
        { name: 'No-go', fromAge: 85, multiplier: 0.75 },
      ],
    },
  };
}

export function StartPage(): ReactNode {
  const nav = useNavigate();
  const tour = useTour();
  const { createPlan, createFromSample, setSettings } = useStore.getState();
  const hasPlans = useStore((s) => Object.keys(s.plans).length > 0);
  const year = new Date().getFullYear();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [d, setD] = useState<Draft>({
    name: '',
    birthYear: year - 35,
    state: 'TX',
    partner: false,
    partnerName: '',
    partnerBirthYear: year - 35,
    salary: 80000,
    partnerSalary: 60000,
    cash: 15000,
    brokerage: 20000,
    pretax: 60000,
    roth: 15000,
    saveRate: 0.08,
    spending: 55000,
    retireAge: 62,
  });
  const up = (p: Partial<Draft>): void => setD((x) => ({ ...x, ...p }));
  const titles = ['About you', 'Income', 'What you have', 'Spending', 'Retirement'];
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [step]);

  const finish = async (takeTour: boolean): Promise<void> => {
    setBusy(true);
    const plan = PlanZ.parse(buildPlan(d, year));
    await createPlan(plan.name, plan);
    setSettings({ onboarded: true });
    nav('/');
    if (takeTour) tour.start('T-B01');
  };
  const sample = async (id: SamplePlanId): Promise<void> => {
    await createFromSample(id);
    setSettings({ onboarded: true });
    nav('/');
  };

  return (
    <>
      <PageHead
        title={hasPlans ? 'New plan' : 'Welcome to Longview'}
        intro="Answer five short questions to get a first plan in a few minutes. Rough numbers are fine: you can refine everything afterwards."
      />
      <Card data-tour="wizard">
        <div
          className="lv-progress"
          role="progressbar"
          aria-label="Setup progress"
          aria-valuemin={1}
          aria-valuemax={6}
          aria-valuenow={step + 1}
        >
          <div style={{ width: `${((step + 1) / 6) * 100}%` }} />
        </div>
        <h2 ref={heading} tabIndex={-1} style={{ margin: '20px 0 16px' }}>
          {step < 5 ? `Step ${step + 1} of 5: ${titles[step]}` : 'Your plan is ready'}
        </h2>
        {step === 0 ? (
          <div className="lv-stack">
            <div className="form-grid">
              <TextField
                label="Your first name"
                value={d.name}
                onChange={(v) => up({ name: v })}
                data-tour="wizard-name"
              />
              <NumberField
                label="Year you were born"
                value={d.birthYear}
                min={1930}
                max={year - 16}
                onChange={(v) => up({ birthYear: v })}
              />
              <SelectField
                label="State you live in"
                value={d.state}
                options={STATES.map((s) => ({ value: s, label: s }))}
                onChange={(v) => up({ state: v })}
              />
            </div>
            <Switch label="Plan with a partner" checked={d.partner} onChange={(v) => up({ partner: v })} />
            {d.partner ? (
              <div className="form-grid">
                <TextField
                  label="Partner's first name"
                  value={d.partnerName}
                  onChange={(v) => up({ partnerName: v })}
                />
                <NumberField
                  label="Year they were born"
                  value={d.partnerBirthYear}
                  min={1930}
                  max={year - 16}
                  onChange={(v) => up({ partnerBirthYear: v })}
                />
              </div>
            ) : null}
          </div>
        ) : null}
        {step === 1 ? (
          <div className="form-grid">
            <MoneyField
              label="Your yearly pay before tax"
              cents={D(d.salary)}
              onChange={(v) => up({ salary: Math.max(0, v / 100) })}
            />
            {d.partner ? (
              <MoneyField
                label="Partner's yearly pay before tax"
                cents={D(d.partnerSalary)}
                onChange={(v) => up({ partnerSalary: Math.max(0, v / 100) })}
              />
            ) : null}
            <NumberField
              label="Share of pay saved to a retirement plan (%)"
              value={Math.round(d.saveRate * 100)}
              min={0}
              max={60}
              onChange={(v) => up({ saveRate: v / 100 })}
            />
          </div>
        ) : null}
        {step === 2 ? (
          <div className="form-grid">
            <MoneyField
              label="Cash and savings"
              cents={D(d.cash)}
              onChange={(v) => up({ cash: Math.max(0, v / 100) })}
            />
            <MoneyField
              label="Brokerage (taxable investments)"
              cents={D(d.brokerage)}
              onChange={(v) => up({ brokerage: Math.max(0, v / 100) })}
            />
            <MoneyField
              label="Pre-tax retirement (401(k), IRA)"
              cents={D(d.pretax)}
              onChange={(v) => up({ pretax: Math.max(0, v / 100) })}
            />
            <MoneyField
              label="Roth accounts"
              cents={D(d.roth)}
              onChange={(v) => up({ roth: Math.max(0, v / 100) })}
            />
          </div>
        ) : null}
        {step === 3 ? (
          <div style={{ maxWidth: 360 }}>
            <MoneyField
              label="What you spend in a year"
              hint="Everything except taxes and retirement savings. Housing included."
              cents={D(d.spending)}
              onChange={(v) => up({ spending: Math.max(0, v / 100) })}
            />
          </div>
        ) : null}
        {step === 4 ? (
          <div style={{ maxWidth: 360 }}>
            <NumberField
              label="Age you would like to retire"
              value={d.retireAge}
              min={30}
              max={80}
              onChange={(v) => up({ retireAge: v })}
            />
          </div>
        ) : null}
        {step === 5 ? (
          <div className="lv-stack">
            <p>
              Next comes a two-minute tour of how to get around. It runs on a sample plan, so nothing you do
              in it changes yours.
            </p>
            <div className="lv-row">
              <Button
                variant="primary"
                disabled={busy}
                onClick={() => void finish(true)}
                data-tour="wizard-take-tour"
              >
                Create my plan and take the tour
              </Button>
              <Button disabled={busy} onClick={() => void finish(false)} data-tour="wizard-skip-tour">
                Create my plan
              </Button>
            </div>
          </div>
        ) : null}
        <div className="lv-spread" style={{ marginTop: 24 }}>
          <Button disabled={step === 0} onClick={() => setStep((x) => x - 1)}>
            Back
          </Button>
          {step < 5 ? (
            <Button variant="primary" onClick={() => setStep((x) => x + 1)} data-tour="wizard-next">
              {step === 4 ? 'Review' : 'Next'}
            </Button>
          ) : (
            <span />
          )}
        </div>
      </Card>
      <Card title="Or start from an example" data-tour="samples">
        <p className="lv-muted lv-small" style={{ marginBottom: 12 }}>
          A copy is made for you to edit. The people and figures are invented.
        </p>
        <div className="lv-row">
          <Button onClick={() => void sample('sample-basic')}>Single, mid-career</Button>
          <Button onClick={() => void sample('sample-early-retiree')}>Couple retiring at 50</Button>
          <Button onClick={() => void sample('sample-couple-ss')}>Couple near retirement</Button>
          <Link className="lv-btn" to="/settings">
            Import a backup
          </Link>
        </div>
      </Card>
    </>
  );
}
