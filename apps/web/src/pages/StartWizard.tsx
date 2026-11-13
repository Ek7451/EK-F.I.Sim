/** Start page and first-plan wizard (UX-05): five short steps, one block per person, nothing assumed silently. */
import { contributionLimits } from '@fisim/data/src/light';
import type { Plan, PlanInput, SamplePlanId } from '@fisim/engine';
import {
  Button,
  Card,
  MoneyField,
  Notice,
  NumberField,
  PercentField,
  SelectField,
  Switch,
  TextField,
  formatMoney,
  formatPct,
} from '@fisim/ui';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { STATES } from '../lib/fields';
import { survivalNote } from '../lib/lifespan';
import { HorizonArt, PageHead } from '../shell/Shell';
import { useStore } from '../state/store';
import { useTour } from '../tours/TourEngine';
import { loadEngine } from '../engine/load';

const D = (n: number): number => Math.round(n * 100);

/** Defaults the wizard uses without asking. Every one of these is listed on the review screen. */
const ASSUMED = {
  salaryGrowthReal: 0.01,
  mix: { usStocks: 0.7, usBonds: 0.2, intlStocks: 0.1 },
  rothMix: { usStocks: 0.8, intlStocks: 0.2 },
  brokerageBasisShare: 0.7,
  rothContributionShare: 0.7,
  emergencyMonths: 6,
  coreShare: 0.85,
} as const;

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

interface PersonDraft {
  name: string;
  birthYear: number;
  /** 1 to 12. Pay ending at a retirement age runs to this birthday, and 59½ and 65 fall in this month. */
  birthMonth: number;
  sex: '' | 'female' | 'male';
  planUntil: number;
  salary: number;
  deferPct: number;
  roth: boolean;
  matchPct: number;
  matchUpTo: number;
  pretax: number;
  rothBalance: number;
  retireAge: number;
}
interface Draft {
  state: string;
  partner: boolean;
  people: [PersonDraft, PersonDraft];
  cash: number;
  brokerage: number;
  spending: number;
  phases: boolean;
}

const pid = (i: number): string => `p${i + 1}`;
const possessive = (name: string): string => (name.endsWith('s') ? `${name}'` : `${name}'s`);

function displayName(p: PersonDraft, i: number): string {
  return p.name.trim() || (i === 0 ? 'You' : 'Your partner');
}

/** 2026 (or the latest bundled year's) deferral limit for someone reaching `age` this year. */
function deferralLimit(
  year: number,
  age: number,
): { limit: number; base: number; catchUp: number; dataYear: number } {
  const all = contributionLimits();
  const dataYear = Math.max(
    ...Object.keys(all)
      .map(Number)
      .filter((y) => y <= year),
    Math.min(...Object.keys(all).map(Number)),
  );
  const l = all[dataYear];
  const catchUp = age >= 60 && age <= 63 ? l.catchUp60to63 : age >= 50 ? l.catchUp50 : 0;
  return { limit: l.electiveDeferral + catchUp, base: l.electiveDeferral, catchUp, dataYear };
}

/** What this person and their employer put in this year, after the legal limit. */
export function contributionPreview(
  p: PersonDraft,
  year: number,
): { own: number; employer: number; wanted: number; limit: number; capped: boolean; dataYear: number } {
  const { limit, dataYear } = deferralLimit(year, year - p.birthYear);
  const wanted = p.salary * p.deferPct;
  const own = Math.min(wanted, limit, p.salary);
  const employer = Math.min(own, p.matchUpTo * p.salary) * p.matchPct;
  return { own, employer, wanted, limit, capped: wanted > limit, dataYear };
}

export function buildPlan(d: Draft, year: number): PlanInput {
  const n = d.partner ? 2 : 1;
  const ppl = d.people.slice(0, n);
  const people: PlanInput['people'] = ppl.map((p, i) => ({
    id: pid(i),
    name: displayName(p, i),
    birthDate: `${p.birthYear}-${String(p.birthMonth).padStart(2, '0')}-15`,
    sex: p.sex || undefined,
    longevity: { mode: 'fixed', age: p.planUntil },
    residence: [{ state: d.state, fromYear: year }],
  }));
  const incomes: PlanInput['incomes'] = [];
  const accounts: PlanInput['accounts'] = [
    {
      id: 'a-cash',
      ownerId: 'p1',
      name: 'Savings',
      type: 'cash',
      balance: D(d.cash),
      // No fixed yield: cash earns the cash return under Assumptions and follows short-term rates in simulations.
    },
    {
      id: 'a-brokerage',
      ownerId: d.partner ? 'joint' : 'p1',
      name: 'Brokerage',
      type: 'taxable',
      balance: D(d.brokerage),
      costBasis: D(d.brokerage * ASSUMED.brokerageBasisShare),
      allocation: { ...ASSUMED.mix },
    },
  ];
  const milestones: PlanInput['milestones'] = [];
  const rothIras: string[] = [];
  ppl.forEach((p, i) => {
    const id = pid(i);
    const who = displayName(p, i);
    const label = i === 0 && !p.name.trim() ? 'Your' : possessive(who);
    const working = p.salary > 0;
    if (working) {
      milestones.push({
        id: `m-retire-${id}`,
        name: i === 0 && !p.name.trim() ? 'You retire' : `${who} retires`,
        kind: 'retirement',
        personId: id,
        when: { type: 'age', personId: id, age: p.retireAge },
      });
      incomes.push({
        id: `i-${id}`,
        ownerId: id,
        name: `${label} pay`,
        kind: 'wages',
        amount: D(p.salary),
        growth: { rate: ASSUMED.salaryGrowthReal, basis: 'real' },
        end: { type: 'milestone', milestoneId: `m-retire-${id}`, offset: 0 },
      });
    }
    const contribution =
      working && (p.deferPct > 0 || p.matchPct > 0)
        ? {
            incomeId: `i-${id}`,
            employeePct: p.deferPct,
            employerMatch: p.matchPct > 0 ? [{ matchPct: p.matchPct, upToPctOfSalary: p.matchUpTo }] : [],
          }
        : undefined;
    if (p.pretax > 0 || (contribution && !p.roth)) {
      accounts.push({
        id: `a-401k-${id}`,
        ownerId: id,
        name: `${label} retirement plan (pre-tax)`,
        type: 'trad401k',
        balance: D(p.pretax),
        allocation: { ...ASSUMED.mix },
        ruleOf55: true,
        contribution: p.roth ? undefined : contribution,
      });
    }
    if (contribution && p.roth) {
      // Roth deferrals go here; the employer match lands in the pre-tax account above, as most plans pay it.
      if (!accounts.some((a) => a.id === `a-401k-${id}`))
        accounts.push({
          id: `a-401k-${id}`,
          ownerId: id,
          name: `${label} retirement plan (pre-tax)`,
          type: 'trad401k',
          balance: 0,
          allocation: { ...ASSUMED.mix },
          ruleOf55: true,
        });
      accounts.push({
        id: `a-roth401k-${id}`,
        ownerId: id,
        name: `${label} Roth 401(k)`,
        type: 'roth401k',
        balance: 0,
        allocation: { ...ASSUMED.mix },
        ruleOf55: true,
        contribution,
      });
    }
    if (p.rothBalance > 0 || working) {
      accounts.push({
        id: `a-rothira-${id}`,
        ownerId: id,
        name: `${label} Roth IRA`,
        type: 'rothIra',
        balance: D(p.rothBalance),
        rothBasis: {
          contributions: D(p.rothBalance * ASSUMED.rothContributionShare),
          firstContributionYear: year - 6,
        },
        allocation: { ...ASSUMED.rothMix },
      });
      rothIras.push(`a-rothira-${id}`);
    }
  });
  milestones.push({
    id: 'm-fi',
    name: 'Financially independent',
    kind: 'fi',
    when: { type: 'condition', metric: 'fi', fiMultiple: 25 },
  });
  const firstRetire = ppl[0].salary > 0 ? ppl[0].retireAge : year - ppl[0].birthYear;
  return {
    id: 'new',
    schemaVersion: 2,
    name: d.partner ? `${ppl[0].name.trim() ? possessive(ppl[0].name.trim()) : 'Our'} plan` : 'My plan',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    settings: { startYear: year },
    people,
    household: { filingStatus: [{ fromYear: year, status: d.partner ? 'mfj' : 'single' }] },
    accounts,
    incomes,
    expenses: [
      {
        id: 'e-core',
        name: 'Everyday living',
        category: 'housing',
        amount: D(d.spending * ASSUMED.coreShare),
      },
      {
        id: 'e-fun',
        name: 'Travel and fun',
        category: 'travel',
        amount: D(d.spending * (1 - ASSUMED.coreShare)),
        essential: false,
        followsPhases: true,
      },
    ],
    milestones,
    strategies: {
      surplusWaterfall: [
        { type: 'emergencyFund', accountId: 'a-cash', months: ASSUMED.emergencyMonths },
        ...rothIras.map((accountId) => ({ type: 'account' as const, accountId })),
        { type: 'account', accountId: 'a-brokerage' },
      ],
      spendingPhases: d.phases
        ? [
            { name: 'Active years', fromAge: firstRetire, multiplier: 1.1 },
            { name: 'Slower years', fromAge: Math.max(firstRetire + 10, 75), multiplier: 0.9 },
            { name: 'Later years', fromAge: 85, multiplier: 0.75 },
          ]
        : [],
    },
  };
}

function newPerson(year: number, partner: boolean): PersonDraft {
  return {
    name: '',
    birthYear: year - 35,
    birthMonth: 6,
    sex: '',
    planUntil: 95,
    salary: partner ? 60000 : 80000,
    deferPct: partner ? 0.06 : 0.08,
    roth: false,
    matchPct: 0.5,
    matchUpTo: 0.06,
    pretax: partner ? 40000 : 60000,
    rothBalance: partner ? 10000 : 15000,
    retireAge: 62,
  };
}

/** One fieldset per person, so the same question can be asked of each without confusion. */
function PersonBlock({ title, children }: { title: string; children: ReactNode }): ReactNode {
  return (
    <fieldset className="wizard-person">
      <legend>{title}</legend>
      <div className="form-grid">{children}</div>
    </fieldset>
  );
}

const SEX_OPTIONS: { value: PersonDraft['sex']; label: string }[] = [
  { value: '', label: 'Prefer not to say' },
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
];

export function StartPage(): ReactNode {
  const nav = useNavigate();
  const tour = useTour();
  const { createPlan, createFromSample, setSettings } = useStore.getState();
  const hasPlans = useStore((s) => Object.keys(s.plans).length > 0);
  const year = new Date().getFullYear();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);
  const [d, setD] = useState<Draft>(() => ({
    state: 'TX',
    partner: false,
    people: [newPerson(year, false), newPerson(year, true)],
    cash: 15000,
    brokerage: 20000,
    spending: 55000,
    phases: false,
  }));
  const up = (p: Partial<Draft>): void => setD((x) => ({ ...x, ...p }));
  const upP = (i: number, p: Partial<PersonDraft>): void =>
    setD((x) => {
      const people = [...x.people] as Draft['people'];
      people[i] = { ...people[i], ...p };
      return { ...x, people };
    });
  const ppl = d.people.slice(0, d.partner ? 2 : 1);
  const partnerSwitch = (
    <div className="lv-stack">
      <Switch label="Plan with a partner" checked={d.partner} onChange={(v) => up({ partner: v })} />
      {d.partner ? (
        <p className="lv-muted lv-small">
          Longview plans for partners as a married couple filing one joint tax return. Unmarried partners who
          file separately are not modelled yet.
        </p>
      ) : null}
    </div>
  );
  const titles = ['About you', 'Income and retirement saving', 'What you have', 'Spending', 'Retirement'];
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [step]);

  // The parsed plan, for the review screen: it shows the defaults the plan will really use.
  const [preview, setPreview] = useState<Plan | null>(null);
  useEffect(() => {
    if (step < 5) return;
    let live = true;
    void loadEngine().then(({ PlanZ }) => {
      const r = PlanZ.safeParse(buildPlan(d, year));
      if (live) setPreview(r.success ? r.data : null);
    });
    return () => {
      live = false;
    };
  }, [d, step, year]);
  // Fetch the engine while the person fills in the first steps: a moment after the screen has drawn, so the
  // download does not compete with it (the same delay main.tsx uses for sync), or at once on the first input.
  useEffect(() => {
    const go = (): void => void loadEngine();
    const t = setTimeout(go, 1500);
    window.addEventListener('pointerdown', go, { once: true });
    window.addEventListener('keydown', go, { once: true });
    return () => {
      clearTimeout(t);
      window.removeEventListener('pointerdown', go);
      window.removeEventListener('keydown', go);
    };
  }, []);

  const finish = async (takeTour: boolean): Promise<void> => {
    setBusy(true);
    setFinishError(null);
    try {
      const plan = (await loadEngine()).PlanZ.parse(buildPlan(d, year));
      await createPlan(plan.name, plan);
      setSettings({ onboarded: true });
      nav('/');
      if (takeTour) tour.start('T-B01');
    } catch (e: unknown) {
      setFinishError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const sample = async (id: SamplePlanId): Promise<void> => {
    await createFromSample(id);
    setSettings({ onboarded: true });
    nav('/');
  };

  return (
    <>
      <div className="start-hero lv-night">
        <PageHead
          title={hasPlans ? 'New plan' : 'Welcome to Longview Planner'}
          intro="Five short steps to a first plan. Rough numbers are fine: you can refine everything afterwards."
        />
        <HorizonArt />
      </div>
      <Card data-tour="wizard">
        <div
          className="lv-progress"
          role="progressbar"
          aria-label="Setup progress"
          aria-valuemin={1}
          aria-valuemax={6}
          aria-valuenow={step + 1}
          aria-valuetext={step < 5 ? `Step ${step + 1} of 5` : 'Review'}
        >
          <div style={{ width: `${((step + 1) / 6) * 100}%` }} />
        </div>
        <h2 ref={heading} tabIndex={-1} className="wizard-heading">
          {step < 5 ? `Step ${step + 1} of 5: ${titles[step]}` : 'Check what we assumed'}
        </h2>

        {step === 0 ? (
          <div className="lv-stack">
            <div className="form-grid">
              <SelectField
                label="State you live in"
                value={d.state}
                options={STATES.map((s) => ({ value: s, label: s }))}
                onChange={(v) => up({ state: v })}
              />
            </div>
            {ppl.map((p, i) => (
              <Fragment key={i}>
                {i === 1 ? partnerSwitch : null}
                <PersonBlock title={i === 0 ? 'You' : 'Your partner'}>
                  <TextField
                    label={i === 0 ? 'Your first name' : "Partner's first name"}
                    help={i === 0 ? undefined : null}
                    value={p.name}
                    onChange={(v) => upP(i, { name: v })}
                    data-tour={i === 0 ? 'wizard-name' : undefined}
                  />
                  <NumberField
                    label={i === 0 ? 'Year you were born' : 'Year they were born'}
                    value={p.birthYear}
                    min={1930}
                    max={year - 16}
                    onChange={(v) => upP(i, { birthYear: v })}
                  />
                  <SelectField
                    label={i === 0 ? 'Month you were born' : 'Month they were born'}
                    value={String(p.birthMonth)}
                    options={MONTHS.map((m, k) => ({ value: String(k + 1), label: m }))}
                    onChange={(v) => upP(i, { birthMonth: +v })}
                  />
                  <SelectField
                    label="Sex (for life tables)"
                    value={p.sex}
                    options={SEX_OPTIONS}
                    onChange={(v) => upP(i, { sex: v })}
                  />
                  <NumberField
                    label="Plan until age"
                    hint={survivalNote(p.birthYear, p.sex || undefined, p.planUntil, year) ?? undefined}
                    value={p.planUntil}
                    min={Math.max(50, year - p.birthYear + 1)}
                    max={115}
                    onChange={(v) => upP(i, { planUntil: v })}
                  />
                </PersonBlock>
              </Fragment>
            ))}
            {d.partner ? null : partnerSwitch}
          </div>
        ) : null}

        {step === 1 ? (
          <div className="lv-stack">
            {ppl.map((p, i) => {
              const c = contributionPreview(p, year);
              return (
                <PersonBlock key={i} title={displayName(p, i)}>
                  <MoneyField
                    label="Yearly pay before tax"
                    cents={D(p.salary)}
                    onChange={(v) => upP(i, { salary: Math.max(0, v / 100) })}
                  />
                  <PercentField
                    label="Contribution (share of pay)"
                    digits={1}
                    value={p.deferPct}
                    onChange={(v) => upP(i, { deferPct: Math.max(0, Math.min(1, v)) })}
                  />
                  <SelectField
                    label="Goes in as"
                    value={p.roth ? 'roth' : 'pretax'}
                    options={[
                      { value: 'pretax', label: 'Pre-tax (traditional)' },
                      { value: 'roth', label: 'Roth' },
                    ]}
                    onChange={(v) => upP(i, { roth: v === 'roth' })}
                  />
                  <PercentField
                    label="Employer matches"
                    digits={0}
                    value={p.matchPct}
                    onChange={(v) => upP(i, { matchPct: Math.max(0, Math.min(2, v)) })}
                  />
                  <PercentField
                    label="Up to (share of pay)"
                    digits={1}
                    value={p.matchUpTo}
                    onChange={(v) => upP(i, { matchUpTo: Math.max(0, Math.min(1, v)) })}
                  />
                  <div
                    className="wizard-readout"
                    aria-live="polite"
                    data-tour={i === 0 ? 'wizard-contribution' : undefined}
                  >
                    {p.salary > 0 ? (
                      <>
                        <strong>{formatMoney(c.own)}</strong> a year from{' '}
                        {i === 0 && !p.name.trim() ? 'you' : displayName(p, i)}
                        {c.employer > 0 ? (
                          <>
                            {' '}
                            plus <strong>{formatMoney(c.employer)}</strong> from the employer
                          </>
                        ) : null}
                        .
                        {c.capped ? (
                          <span className="lv-warn-text">
                            {' '}
                            {formatMoney(c.wanted)} is over the {c.dataYear} limit of {formatMoney(c.limit)}{' '}
                            at age {year - p.birthYear}, so Longview puts in the limit.
                          </span>
                        ) : null}
                      </>
                    ) : (
                      'No pay entered, so nothing is saved from a paycheck.'
                    )}
                  </div>
                </PersonBlock>
              );
            })}
          </div>
        ) : null}

        {step === 2 ? (
          <div className="lv-stack">
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
            </div>
            {ppl.map((p, i) => (
              <PersonBlock
                key={i}
                title={
                  d.partner
                    ? `Retirement accounts in ${possessive(displayName(p, i))} name`
                    : 'Retirement accounts'
                }
              >
                <MoneyField
                  label="Pre-tax retirement (401(k), IRA)"
                  cents={D(p.pretax)}
                  onChange={(v) => upP(i, { pretax: Math.max(0, v / 100) })}
                />
                <MoneyField
                  label="Roth accounts"
                  cents={D(p.rothBalance)}
                  onChange={(v) => upP(i, { rothBalance: Math.max(0, v / 100) })}
                />
              </PersonBlock>
            ))}
          </div>
        ) : null}

        {step === 3 ? (
          <div className="lv-stack wizard-narrow">
            <MoneyField
              label="What you spend in a year"
              hint="Leave out taxes, retirement savings, and health insurance and medical costs."
              cents={D(d.spending)}
              onChange={(v) => up({ spending: Math.max(0, v / 100) })}
            />
            <Switch
              label="Spend differently as you age"
              checked={d.phases}
              onChange={(v) => up({ phases: v })}
            />
          </div>
        ) : null}

        {step === 4 ? (
          <div className="lv-stack">
            {ppl.map((p, i) => {
              const now = year - p.birthYear;
              return (
                <PersonBlock key={i} title={displayName(p, i)}>
                  {p.salary > 0 ? (
                    <NumberField
                      label="Age you would like to retire"
                      value={p.retireAge}
                      min={30}
                      max={80}
                      onChange={(v) => upP(i, { retireAge: v })}
                    />
                  ) : (
                    <p className="lv-muted lv-small">
                      No pay was entered, so there is no retirement age to set.
                    </p>
                  )}
                  {p.salary > 0 && p.retireAge <= now ? (
                    <Notice tone="warn">
                      {displayName(p, i)} {i === 0 && !p.name.trim() ? 'are' : 'is'} {now} this year, so pay
                      stops straight away. Choose an age above {now} if still working.
                    </Notice>
                  ) : null}
                </PersonBlock>
              );
            })}
          </div>
        ) : null}

        {step === 5 ? (
          <div className="lv-stack" data-tour="wizard-review">
            {finishError ? (
              <Notice tone="danger">Your plan could not be created: {finishError}</Notice>
            ) : null}
            <p>
              These are the starting assumptions. They are all editable once the plan exists, under Plan and
              Assumptions.
            </p>
            {preview ? <Assumptions plan={preview} d={d} year={year} /> : null}
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

        <div className="lv-spread wizard-nav">
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

/** The review list: every default the new plan uses, read from the parsed plan so it cannot drift. */
function Assumptions({ plan, d, year }: { plan: Plan; d: Draft; year: number }): ReactNode {
  const A = plan.assumptions;
  const r = A.returns.fixed;
  const ppl = d.people.slice(0, d.partner ? 2 : 1);
  const names = ppl.map(displayName);
  const pct = (v: number, digits = 0): string => formatPct(v, digits);
  const items: [string, string][] = [
    [
      'Lifespan',
      ppl.map((p, i) => `${names[i]}: plan until ${p.planUntil}`).join('; ') +
        '. The same age is used in every simulation unless you let lifespans vary (Assumptions).',
    ],
    [
      'Investment returns',
      `${A.returns.mode === 'fixed' ? '' : 'Long-run historical averages. '}US stocks ${pct(r.usStocks, 1)}, international stocks ${pct(r.intlStocks, 1)}, bonds ${pct(r.usBonds, 1)} and cash ${pct(r.cash, 1)} a year, before inflation of ${pct(A.inflation.rate, 1)}.`,
    ],
    [
      'Investment mix',
      `Brokerage and workplace plans ${pct(ASSUMED.mix.usStocks)} US stocks, ${pct(ASSUMED.mix.usBonds)} bonds, ${pct(ASSUMED.mix.intlStocks)} international; Roth IRAs ${pct(ASSUMED.rothMix.usStocks)} US and ${pct(ASSUMED.rothMix.intlStocks)} international stocks.`,
    ],
    ['Pay', `Rises ${pct(ASSUMED.salaryGrowthReal)} a year above inflation until each person retires.`],
    [
      'Savings',
      `Cash earns the cash return under Assumptions (${pct(r.cash, 1)} a year) and follows short-term interest rates in simulations. ${ASSUMED.emergencyMonths} months of spending stays in cash; money left over each year goes to ${d.partner ? 'your Roth IRAs' : 'your Roth IRA'} (within the income limits), then the brokerage account.`,
    ],
    [
      'Tax history of what you have',
      `${pct(ASSUMED.brokerageBasisShare)} of the brokerage balance is what you paid for it (only the rest is a taxable gain). ${pct(ASSUMED.rothContributionShare)} of each Roth balance is your own contributions, first made more than five years ago, so that part can come out at any time.`,
    ],
    [
      'Social Security',
      'Estimated from current pay, as if it had been earned throughout a career, claimed at 67. Enter your earnings record or benefit estimate under Household for a better figure.',
    ],
    [
      'Healthcare',
      plan.healthcare.enabled
        ? 'Estimated separately: workplace cover while working, marketplace insurance with premium credits before 65, then Medicare.'
        : 'Not modelled.',
    ],
    [
      'Spending',
      `${pct(ASSUMED.coreShare)} everyday living, ${pct(1 - ASSUMED.coreShare)} travel and fun, rising with inflation.${d.phases ? ' Travel and fun changes with age as you chose.' : ' It stays level through retirement.'}${d.partner ? ' After one partner dies, household spending stays the same (you can lower it under Spending).' : ''}`,
    ],
    [
      'Taxes',
      `${d.partner ? 'Married filing jointly' : 'Single'}, living in ${d.state}. Federal and state tax use the ${year} rules and are projected forward with inflation.`,
    ],
  ];
  return (
    <dl className="wizard-assumptions">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
