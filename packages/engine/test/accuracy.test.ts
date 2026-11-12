/**
 * Phase 2 accuracy fixes: one test (or more) per fix. IDs follow the review plan (C1, H1, H3, M1..M8, and the
 * low-severity batch).
 */
import { loadEngineData } from '@fisim/data/src/node';
import { describe, expect, it } from 'vitest';
import {
  compilePlan,
  earningsTestWithholding,
  emptyFederalInput,
  estateTax,
  federalTax,
  generatePath,
  lognormalParams,
  PlanZ,
  prepare,
  project,
  recordsToCsv,
  runMonteCarlo,
  sampleBasic,
  sampleEarlyRetiree,
  survivalProbability,
  survivorBase,
  survivorFactor,
  toReal,
  type Plan,
  type YearRecord,
} from '../src';

const data = loadEngineData();
const D = (n: number): number => Math.round(n * 100);

type Over = Record<string, unknown>;
const person = (id: string, birthDate: string, extra: Over = {}): Over => ({
  id,
  name: id,
  birthDate,
  residence: [{ state: 'TX', fromYear: 2026 }],
  socialSecurity: { mode: 'none' },
  longevity: { age: 95 },
  ...extra,
});
const pia = (monthly: number, years: number, months = 0): Over => ({
  socialSecurity: { mode: 'pia', piaMonthly: D(monthly), claimAge: { years, months } },
});
const mk = (o: Over): Plan =>
  PlanZ.parse({
    id: 't',
    schemaVersion: 2,
    name: 't',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    settings: { startYear: 2026, timing: 'end' },
    healthcare: { enabled: false },
    ...o,
  });
const rec = (recs: YearRecord[], year: number): YearRecord => recs.find((r) => r.year === year)!;
const ssReal = (recs: YearRecord[], year: number): number => {
  const r = rec(recs, year);
  return toReal(r.income.socialSecurity, r, 'flow');
};

// ------------------------------------------------------------------------------------------------ C1
describe('C1 expected returns are geometric everywhere', () => {
  const growthPlan = (stocks: number): Plan =>
    mk({
      settings: { startYear: 2026, timing: 'start' },
      people: [person('p1', '1990-01-01', { longevity: { age: 65 } })],
      accounts: [
        {
          id: 'a',
          ownerId: 'p1',
          name: 'Roth',
          type: 'rothIra',
          balance: D(1e6),
          rothBasis: { contributions: D(1e6), firstContributionYear: 2000 },
          allocation: { usStocks: stocks, usBonds: 1 - stocks },
        },
      ],
    });
  it('the lognormal median is 1 + the geometric mean', () => {
    const [mu, sigma] = lognormalParams(0.07, 0.19);
    expect(Math.exp(mu)).toBeCloseTo(1.07, 12);
    // Implied arithmetic mean is about g + sigma^2 / 2.
    expect(1.07 * Math.exp((sigma * sigma) / 2) - 1).toBeCloseTo(0.0863, 3);
    // and the simple-return variance matches the input sd.
    const v = (Math.exp(sigma * sigma) - 1) * Math.exp(2 * mu + sigma * sigma);
    expect(Math.sqrt(v)).toBeCloseTo(0.19, 10);
  });
  it('the median Monte Carlo path tracks the deterministic path for each method (single asset class)', () => {
    const plan = growthPlan(1);
    const det = project(plan, data).records;
    const last = det[det.length - 1];
    const detReal = toReal(last.investable, last);
    const c = compilePlan(plan, data);
    for (const method of ['bootstrap', 'parametric'] as const) {
      const s = runMonteCarlo(c, { runs: 2000, method });
      const ratio = s.bands.p50[s.bands.p50.length - 1] / detReal;
      // Parametric: exact in expectation (sampling error ~3%). Bootstrap: the negative skew of history puts the
      // median of a 30-year sum of log returns a few percent above its mean.
      expect(ratio, method).toBeGreaterThan(0.95);
      expect(ratio, method).toBeLessThan(method === 'parametric' ? 1.06 : 1.1);
      expect(s.meansUsed.basis).toBe('assumptions');
      expect(s.meansUsed.usStocks).toBe(plan.assumptions.returns.fixed.usStocks);
    }
  });
  it('a rebalanced mix beats the constant-rate path only by the diversification return', () => {
    const plan = growthPlan(0.6);
    const det = project(plan, data).records;
    const last = det[det.length - 1];
    const detReal = toReal(last.investable, last);
    const s = runMonteCarlo(compilePlan(plan, data), { runs: 2000, method: 'parametric' });
    const ratio = s.bands.p50[s.bands.p50.length - 1] / detReal;
    // 60/40: (sum w sigma^2 - sigma_p^2) / 2 is about 0.4% a year, so about 13% over 30 years.
    expect(ratio).toBeGreaterThan(1.0);
    expect(ratio).toBeLessThan(Math.pow(1.007, det.length));
  });
  it('the bootstrap uses the plan means unless raw history is chosen, and reports the means used', () => {
    const plan = growthPlan(1);
    plan.assumptions.returns.fixed.usStocks = 0.05;
    const c = compilePlan(plan, data);
    const p = prepare(c);
    const lowered = runMonteCarlo(c, { runs: 400, method: 'bootstrap' });
    const raw = runMonteCarlo(c, { runs: 400, method: 'bootstrap', bootstrapMeans: 'historical' });
    expect(raw.meansUsed.basis).toBe('historical');
    expect(raw.meansUsed.usStocks).toBeCloseTo(Math.exp(p.histLogMean[0] + p.histInflLogMean) - 1, 12);
    expect(raw.meansUsed.usStocks).toBeGreaterThan(0.08); // history: about 9.4% nominal, 7.1% real
    expect(lowered.meansUsed.usStocks).toBe(0.05);
    expect(raw.endingPercentiles.p50).toBeGreaterThan(lowered.endingPercentiles.p50 * 1.5);
  });
  it('intl stocks and REITs use the plan means in both models (one consistent convention)', () => {
    const plan = growthPlan(1);
    plan.accounts[0].allocation = { usStocks: 0, usBonds: 0, cash: 0, intlStocks: 1, reits: 0 };
    const det = project(plan, data).records;
    const detReal = toReal(det[det.length - 1].investable, det[det.length - 1]);
    const c = compilePlan(plan, data);
    for (const method of ['bootstrap', 'parametric'] as const) {
      const s = runMonteCarlo(c, { runs: 2000, method });
      const ratio = s.bands.p50[s.bands.p50.length - 1] / detReal;
      expect(ratio, method).toBeGreaterThan(0.94);
      expect(ratio, method).toBeLessThan(1.06);
    }
  });
});

// ------------------------------------------------------------------------------------------------ H1
describe("H1 today's dollars: balances deflate by year-end CPI, flows by start-of-year CPI", () => {
  const r = project(sampleBasic(2026), data);
  it('cpiEnd is the next year’s cpi', () => {
    for (let i = 0; i + 1 < r.records.length; i++)
      expect(r.records[i].cpiEnd).toBeCloseTo(r.records[i + 1].cpi, 12);
    expect(r.records[0].cpiEnd).toBeCloseTo(1 + sampleBasic(2026).assumptions.inflation.rate, 12);
  });
  it('toReal picks the right deflator', () => {
    const x = r.records[5];
    expect(toReal(100, x)).toBe(100 / x.cpiEnd);
    expect(toReal(100, x, 'flow')).toBe(100 / x.cpi);
  });
  it('an expense entered in today’s dollars reads back unchanged, and summaries use year-end CPI', () => {
    const plan = mk({
      people: [person('p1', '1980-01-01', { longevity: { age: 60 } })],
      accounts: [{ id: 'c', ownerId: 'p1', name: 'Cash', type: 'cash', balance: D(2e6) }],
      expenses: [{ id: 'e', name: 'Living', category: 'other', amount: D(50000) }],
    });
    const res = project(plan, data);
    for (const x of res.records) expect(toReal(x.expenses.living, x, 'flow')).toBeCloseTo(50000, 6);
    const last = res.records[res.records.length - 1];
    expect(res.summary.endingNetWorthReal).toBeCloseTo(last.netWorth / last.cpiEnd, 6);
    const lines = recordsToCsv(res.records).trim().split('\n');
    const head = lines[0].split(',');
    const row = lines[lines.length - 1].split(',');
    expect(+row[head.indexOf('net_worth_todays_dollars')]).toBeCloseTo(last.netWorth / last.cpiEnd, 1);
    expect(+row[head.indexOf('cpi_end_factor')]).toBeCloseTo(last.cpiEnd, 5);
  });
});

// ------------------------------------------------------------------------------------------------ H3
describe('H3 survivor Social Security', () => {
  it('survivor reduction: 71.5% at 60, 100% at the survivor FRA, linear between', () => {
    expect(survivorFactor(720, 804)).toBeCloseTo(0.715, 12);
    expect(survivorFactor(804, 804)).toBe(1);
    expect(survivorFactor(762, 804)).toBeCloseTo(1 - 0.285 / 2, 12);
    expect(survivorFactor(700, 804)).toBeCloseTo(0.715, 12); // floor at 60
  });
  it('survivor base: delayed credits stop at death; early claimers are held to the 82.5% floor rule', () => {
    // Claimed at 70: PIA + 24% (FRA 67).
    expect(survivorBase(1000, 804, true, 840, 900).base).toBeCloseTo(1240, 9);
    // Died at 68 without claiming: credits only to 68.
    expect(survivorBase(1000, 804, false, 840, 816).base).toBeCloseTo(1080, 9);
    // Died before FRA without claiming: the full PIA.
    expect(survivorBase(1000, 804, false, 840, 760)).toEqual({ base: 1000, limit: Infinity });
    // Claimed at 62 (70%): the survivor's benefit is the PIA, capped at max(70%, 82.5%) of it.
    const early = survivorBase(1000, 804, true, 744, 900);
    expect(early.base).toBe(1000);
    expect(early.limit).toBeCloseTo(825, 9);
  });
  it('a spouse who dies at 68 before claiming at 70 leaves credits to 68, not 70', () => {
    const plan = mk({
      people: [
        person('p1', '1960-01-15', { ...pia(3000, 70), longevity: { age: 68 } }),
        person('p2', '1960-01-15', pia(1000, 67)),
      ],
    });
    const recs = project(plan, data).records;
    // Died mid-2028 at 68.5: 18 months past FRA (67) -> +12%.
    expect(ssReal(recs, 2029)).toBeCloseTo(36000 * 1.12, 0);
  });
  it('an early claimer’s survivor gets the larger of their benefit and 82.5% of the PIA', () => {
    const plan = mk({
      people: [
        person('p1', '1955-01-15', { ...pia(3000, 62), longevity: { age: 75 } }),
        person('p2', '1955-01-15', pia(500, 62)),
      ],
    });
    const recs = project(plan, data).records;
    expect(ssReal(recs, 2031)).toBeCloseTo(36000 * 0.825, 0);
  });
  it('a survivor who starts before the survivor FRA is reduced, and not before 60', () => {
    const plan = mk({
      people: [
        person('p1', '1950-01-15', { ...pia(2000, 66), longevity: { age: 80 } }),
        person('p2', '1970-01-15', pia(0, 62)),
      ],
    });
    const recs = project(plan, data).records;
    expect(ssReal(recs, 2031)).toBe(0); // the survivor is 61 and plans to claim at 62
    // Survivor FRA for 1970 is 67 (804 months): at 62, 1 - 0.285 x 60/84.
    expect(ssReal(recs, 2032)).toBeCloseTo(24000 * (1 - (0.285 * 60) / 84), 0);
    expect(ssReal(recs, 2035)).toBeCloseTo(24000 * (1 - (0.285 * 60) / 84), 0);
  });
});

// ------------------------------------------------------------------------------------------------ M1
describe('M1 the Social Security earnings projection follows milestone stops and condition ends', () => {
  const base = (incomeExtra: Over, milestones: unknown[] = []): Plan =>
    mk({
      people: [person('p1', '1980-06-15', { socialSecurity: { mode: 'earnings' } })],
      accounts: [{ id: 'b', ownerId: 'p1', name: 'Brokerage', type: 'taxable', balance: D(200000) }],
      incomes: [
        { id: 'sal', ownerId: 'p1', name: 'Salary', kind: 'wages', amount: D(150000), ...incomeExtra },
      ],
      expenses: [{ id: 'e', name: 'Living', category: 'other', amount: D(40000) }],
      milestones,
    });
  const piaOf = (p: Plan): number => compilePlan(p, data).people[0].ssPiaAnnualToday;
  it('a stop effect ends the projected earnings like an end date does', () => {
    const stop = base({}, [
      {
        id: 'm',
        name: 'Retire',
        kind: 'retirement',
        when: { type: 'age', personId: 'p1', age: 50 },
        effects: [{ type: 'stop', target: 'income', targetId: 'sal' }],
      },
    ]);
    const ended = base({ end: { type: 'age', personId: 'p1', age: 50 } });
    expect(piaOf(stop)).toBeCloseTo(piaOf(ended), 6);
    expect(piaOf(stop)).toBeLessThan(piaOf(base({})) - 1);
  });
  it('an end on a condition milestone uses the year it fires in the deterministic projection', () => {
    const cond = base({ end: { type: 'milestone', milestoneId: 'fi', offset: 0 } }, [
      {
        id: 'fi',
        name: 'FI',
        kind: 'fi',
        when: { type: 'condition', metric: 'investable', value: D(1500000) },
        effects: [],
      },
    ]);
    const fired = project(cond, data).milestoneYears.fi;
    expect(fired).toBeGreaterThan(2027);
    expect(fired).toBeLessThan(1980 + 67);
    expect(piaOf(cond)).toBeCloseTo(piaOf(base({ end: { type: 'year', year: fired } })), 6);
  });
});

// ------------------------------------------------------------------------------------------------ M2
describe('M2 the spousal reduction uses the age when the spousal benefit starts', () => {
  it('a spouse who files at 62 gets a spousal top-up reduced for 66, when the worker files at 70', () => {
    const plan = mk({
      people: [person('p1', '1964-01-15', pia(400, 62)), person('p2', '1960-01-15', pia(3000, 70))],
    });
    const c = compilePlan(plan, data);
    expect(c.people[0].ssSpousalStartMonths).toBe(66 * 12);
    const recs = project(plan, data).records;
    const own1 = 4800 * 0.7; // 62 with FRA 67
    const spousal = (18000 - 4800) * (1 - (12 * 25) / 3600); // 12 months early
    expect(ssReal(recs, 2031)).toBeCloseTo(own1 + spousal + 36000 * 1.24, 0);
  });
});

// ------------------------------------------------------------------------------------------------ M3
describe('M3 the earnings test', () => {
  it('in the FRA year only the months before FRA count, and only their benefits can be withheld', () => {
    // Six months before FRA: only half the year's earnings count ($60,000 is under the $65,160 exempt amount).
    expect(earningsTestWithholding(24000, 120000, 798, 804, 24480, 65160)).toBe(0);
    // $200,000 counted for the year: (200,000 - 65,160) / 3 = 44,947, capped at the six months of benefits.
    expect(earningsTestWithholding(24000, 400000, 798, 804, 24480, 65160)).toBeCloseTo(12000, 9);
    expect(earningsTestWithholding(24000, 180000, 798, 804, 24480, 65160)).toBeCloseTo(
      (90000 - 65160) / 3,
      9,
    );
    expect(earningsTestWithholding(24000, 300000, 804, 804, 24480, 65160)).toBe(0);
  });
  it('withheld months are credited back at FRA', () => {
    const plan = mk({
      people: [person('p1', '1964-01-15', pia(2000, 62))],
      accounts: [{ id: 'c', ownerId: 'p1', name: 'Cash', type: 'cash', balance: D(500000) }],
      incomes: [
        {
          id: 'w',
          ownerId: 'p1',
          name: 'Job',
          kind: 'wages',
          amount: D(200000),
          end: { type: 'year', year: 2028 },
        },
      ],
    });
    const recs = project(plan, data).records;
    expect(ssReal(recs, 2026)).toBe(0); // fully withheld
    expect(ssReal(recs, 2027)).toBe(0);
    expect(ssReal(recs, 2030)).toBeCloseTo(24000 * 0.7, 0);
    // 23 months withheld (Feb 2026 - Dec 2027): refigured as if claimed at 62 + 23 months.
    expect(ssReal(recs, 2031)).toBeCloseTo(24000 * (1 - (36 * 5) / 900 - (1 * 5) / 1200), 0);
  });
});

// ------------------------------------------------------------------------------------------------ M4
describe('M4 pension COLA compounds from the pension start', () => {
  const pensionPlan = (cola: { rate: number; basis: 'real' | 'nominal' }): YearRecord[] =>
    project(
      mk({
        people: [person('p1', '1970-01-15')],
        incomes: [
          {
            id: 'pen',
            ownerId: 'p1',
            name: 'Pension',
            kind: 'pension',
            amount: D(30000),
            taxCharacter: 'ordinary',
            start: { type: 'age', personId: 'p1', age: 65 },
            pension: { cola, survivorPct: 0.5 },
          },
        ],
      }),
      data,
    ).records;
  it('nominal COLA: the first payment is the amount entered; the COLA starts after', () => {
    const recs = pensionPlan({ rate: 0.02, basis: 'nominal' });
    expect(rec(recs, 2034).income.pension).toBe(0);
    expect(rec(recs, 2035).income.pension).toBeCloseTo(30000, 6);
    expect(rec(recs, 2036).income.pension).toBeCloseTo(30600, 6);
  });
  it('real COLA: the amount is in today’s dollars, carried by inflation to the start', () => {
    const recs = pensionPlan({ rate: 0, basis: 'real' });
    const r = rec(recs, 2035);
    expect(r.income.pension).toBeCloseTo(30000 * r.cpi, 6);
  });
});

// ------------------------------------------------------------------------------------------------ M5
describe('M5 IRMAA in the first plan years', () => {
  const retiree = (pension: number, prior?: Over): YearRecord[] =>
    project(
      mk({
        people: [person('p1', '1955-01-15')],
        accounts: [{ id: 'c', ownerId: 'p1', name: 'Cash', type: 'cash', balance: D(2e6) }],
        incomes: [
          {
            id: 'pen',
            ownerId: 'p1',
            name: 'Pension',
            kind: 'pension',
            amount: D(pension),
            taxCharacter: 'ordinary',
          },
        ],
        expenses: [{ id: 'e', name: 'Living', category: 'other', amount: D(40000) }],
        healthcare: { enabled: true, ...(prior ? { irmaaPriorMagi: prior } : {}) },
      }),
      data,
    ).records;
  it('uses MAGI entered for the two years before the start', () => {
    const recs = retiree(30000, { twoYearsBefore: D(800000), oneYearBefore: D(30000) });
    expect(recs[0].taxes.irmaaTier).toBeGreaterThan(0);
    expect(recs[0].expenses.healthcare.irmaa).toBeGreaterThan(1000);
    expect(recs[1].expenses.healthcare.irmaa).toBe(0);
  });
  it('defaults to the plan’s own first-year MAGI instead of zero', () => {
    expect(retiree(600000)[0].expenses.healthcare.irmaa).toBeGreaterThan(1000);
    expect(retiree(30000)[0].expenses.healthcare.irmaa).toBe(0);
  });
});

// ------------------------------------------------------------------------------------------------ M6
describe('M6 Monte Carlo reports spending cuts and the estate, and drops finished runs', () => {
  it('counts years below plan under a flexible rule, and none for a funded fixed plan', () => {
    const p = structuredClone(sampleEarlyRetiree(2026));
    p.strategies.spendingRule.type = 'guardrails';
    const s = runMonteCarlo(compilePlan(p, data), { runs: 300 });
    expect(s.spendingCuts.shareOfRuns).toBeGreaterThan(0);
    expect(s.spendingCuts.lowestVsPlan.p10).toBeLessThanOrEqual(s.spendingCuts.lowestVsPlan.p50);
    expect(s.spendingCuts.lowestVsPlan.p50).toBeLessThan(1);
    expect(s.spendingCuts.p90Years).toBeGreaterThanOrEqual(s.spendingCuts.medianYears);
    const rich = mk({
      people: [person('p1', '1960-01-01', { longevity: { age: 85 } })],
      accounts: [{ id: 'c', ownerId: 'p1', name: 'Cash', type: 'cash', balance: D(5e6) }],
      expenses: [{ id: 'e', name: 'Living', category: 'other', amount: D(30000) }],
    });
    const r = runMonteCarlo(compilePlan(rich, data), { runs: 100 });
    expect(r.spendingCuts.shareOfRuns).toBe(0);
    expect(r.spendingCuts.lowestVsPlan.p10).toBeCloseTo(1, 6);
  });
  it('reports a sorted net-estate distribution in today’s dollars', () => {
    const s = runMonteCarlo(compilePlan(sampleBasic(2026), data), { runs: 200 });
    expect(s.netEstate.length).toBe(200);
    for (let i = 1; i < s.netEstate.length; i++)
      expect(s.netEstate[i]).toBeGreaterThanOrEqual(s.netEstate[i - 1]);
    const q = s.netEstatePercentiles;
    expect(q.p10 <= q.p50 && q.p50 <= q.p90).toBe(true);
  });
  it('with stochastic longevity, finished runs leave the bands instead of carrying their balance forward', () => {
    const c = compilePlan(sampleBasic(2026), data, { stochasticLongevity: true });
    const s = runMonteCarlo(c, { runs: 300, stochasticLongevity: true });
    expect(s.activeShare[0]).toBe(1);
    for (let t = 1; t < s.activeShare.length; t++)
      expect(s.activeShare[t]).toBeLessThanOrEqual(s.activeShare[t - 1]);
    expect(s.activeShare[s.activeShare.length - 1]).toBeLessThan(0.1);
    expect(s.bands.p50.every((v) => Number.isFinite(v))).toBe(true);
  });
});

// ------------------------------------------------------------------------------------------------ M7
describe('M7 optional mortality improvement', () => {
  it('raises survival odds when switched on', () => {
    const t = data.mortality;
    const plain = survivalProbability(t, 'male', 40, 90);
    const improved = survivalProbability(t, 'male', 40, 90, { rate: 0.008, birthYear: 1986 });
    expect(improved).toBeGreaterThan(plain * 1.1);
    expect(survivalProbability(t, 'male', 40, 90, { rate: 0, birthYear: 1986 })).toBe(plain);
  });
  it('is applied to sampled lifespans', () => {
    const p = structuredClone(sampleBasic(2026));
    const avg = (rate: number): number => {
      p.assumptions.mortalityImprovement = rate;
      const c = compilePlan(p, data, { stochasticLongevity: true });
      let s = 0;
      for (let r = 0; r < 400; r++)
        s += generatePath(
          c,
          { method: 'parametric', blockLength: 1, inflation: 'fixed', stochasticLongevity: true },
          1,
          r,
        ).deathAge![0];
      return s / 400;
    };
    expect(avg(0.01)).toBeGreaterThan(avg(0) + 1);
  });
});

// ------------------------------------------------------------------------------------------------ M8
describe('M8 children on marketplace coverage are costed', () => {
  const parent = (kids: number[]): YearRecord =>
    project(
      mk({
        people: [person('p1', '1985-01-15')],
        household: { dependents: kids.map((y, i) => ({ name: `k${i}`, birthYear: y })) },
        accounts: [{ id: 'c', ownerId: 'p1', name: 'Cash', type: 'cash', balance: D(3e6) }],
        expenses: [{ id: 'e', name: 'Living', category: 'other', amount: D(60000) }],
        healthcare: { enabled: true },
      }),
      data,
    ).records[0];
  it('adds each child’s age-rated premium, counting at most three under 21', () => {
    const none = parent([]).expenses.healthcare.premiums;
    const two = parent([2014, 2018]).expenses.healthcare.premiums;
    const three = parent([2012, 2014, 2018]).expenses.healthcare.premiums;
    const four = parent([2012, 2014, 2018, 2022]).expenses.healthcare.premiums;
    expect(parent([]).coverage[0]).toBe('aca');
    expect(two).toBeGreaterThan(none * 1.3);
    expect(three).toBeGreaterThan(two);
    expect(four).toBeCloseTo(three, 6);
  });
});

// ------------------------------------------------------------------------------------------------ low-severity batch
describe('low-severity fixes', () => {
  const fp = data.federal[2026];
  it('payroll health premiums are exempt from FICA as well as income tax', () => {
    const r = project(
      mk({
        people: [person('p1', '1985-01-15')],
        incomes: [{ id: 'w', ownerId: 'p1', name: 'Job', kind: 'wages', amount: D(100000) }],
        healthcare: { enabled: true },
      }),
      data,
    ).records[0];
    expect(r.coverage[0]).toBe('employer');
    const prem = r.expenses.healthcare.premiums;
    expect(prem).toBeGreaterThan(500);
    expect(r.taxes.fica).toBeCloseTo((100000 - prem) * 0.0765, 2);
  });
  const sePlan = (contribution: Over): YearRecord =>
    project(
      mk({
        people: [person('p1', '1985-01-15')],
        accounts: [
          { id: 'sep', ownerId: 'p1', name: 'SEP', type: 'sepIra', balance: 0, contribution },
          { id: 'c', ownerId: 'p1', name: 'Cash', type: 'cash', balance: D(10000) },
        ],
        incomes: [
          {
            id: 'se',
            ownerId: 'p1',
            name: 'Business',
            kind: 'selfEmployment',
            amount: D(100000),
            taxCharacter: 'selfEmployment',
          },
        ],
      }),
      data,
    ).records[0];
  it('SEP: 0% contributes nothing; the maximum is 20% of profit less half the SE tax (taken once)', () => {
    expect(sePlan({ employeePct: 0 }).contributions.pretax).toBe(0);
    const halfSe = (100000 * 0.9235 * 0.153) / 2;
    expect(sePlan({ maxOut: true }).contributions.pretax).toBeCloseTo(0.2 * (100000 - halfSe), 2);
  });
  it('the SECURE 2.0 Roth catch-up rule applies in the first plan year', () => {
    const r = project(
      mk({
        people: [person('p1', '1970-01-15')],
        accounts: [
          {
            id: 'k',
            ownerId: 'p1',
            name: '401k',
            type: 'trad401k',
            balance: 0,
            contribution: { incomeId: 'w', maxOut: true },
          },
          { id: 'kr', ownerId: 'p1', name: 'Roth 401k', type: 'roth401k', balance: 0 },
          { id: 'c', ownerId: 'p1', name: 'Cash', type: 'cash', balance: D(10000) },
        ],
        incomes: [{ id: 'w', ownerId: 'p1', name: 'Job', kind: 'wages', amount: D(200000) }],
      }),
      data,
    ).records[0];
    const lim = data.limits[2026];
    expect(r.contributions.pretax).toBeCloseTo(lim.electiveDeferral, 6);
    expect(r.contributions.roth).toBeCloseTo(lim.catchUp50, 6);
  });
  it('the child tax credit per child and refundable cap are indexed (rounded down to $100)', () => {
    const x = emptyFederalInput();
    x.status = 'mfj';
    x.ages = [40, 40];
    x.childrenUnder17 = 2;
    x.wages = [150000, 0];
    x.ficaWages = [150000, 0];
    const at1 = federalTax(fp, 1, x);
    const at11 = federalTax(fp, 1.1, x);
    expect(at1.childTaxCredit + at1.additionalChildTaxCredit).toBeCloseTo(2 * 2200, 6);
    expect(at11.childTaxCredit + at11.additionalChildTaxCredit).toBeCloseTo(2 * 2400, 6);
  });
  it('the IRA catch-up is indexed with the base limit', () => {
    const plan = mk({
      people: [person('p1', '1980-01-15')],
      accounts: [
        {
          id: 'r',
          ownerId: 'p1',
          name: 'Roth IRA',
          type: 'rothIra',
          balance: 0,
          fixedYield: { rate: 0, basis: 'nominal' },
        },
        { id: 'c', ownerId: 'p1', name: 'Cash', type: 'cash', balance: D(10000) },
      ],
      incomes: [{ id: 'w', ownerId: 'p1', name: 'Job', kind: 'wages', amount: D(60000) }],
      strategies: { surplusWaterfall: [{ type: 'account', accountId: 'r' }], surplusDefaultAccountId: 'c' },
    });
    const recs = project(plan, data).records;
    const a = rec(recs, 2034).balances.r;
    const b = rec(recs, 2035).balances.r; // age 55
    const lim = data.limits[2027].ira;
    const kLim = rec(recs, 2035).cpi / rec(recs, 2027).cpi;
    expect(b - a).toBeCloseTo((lim.limit + lim.catchUp50) * kLim, 2);
  });
  it('Roth IRA eligibility uses Roth MAGI, which leaves out conversion income', () => {
    const plan = mk({
      people: [person('p1', '1980-01-15')],
      accounts: [
        {
          id: 't',
          ownerId: 'p1',
          name: 'IRA',
          type: 'tradIra',
          balance: D(1e6),
          fixedYield: { rate: 0, basis: 'nominal' },
        },
        {
          id: 'r',
          ownerId: 'p1',
          name: 'Roth IRA',
          type: 'rothIra',
          balance: 0,
          fixedYield: { rate: 0, basis: 'nominal' },
        },
        { id: 'c', ownerId: 'p1', name: 'Cash', type: 'cash', balance: D(10000) },
      ],
      incomes: [{ id: 'w', ownerId: 'p1', name: 'Job', kind: 'wages', amount: D(120000) }],
      expenses: [{ id: 'e', name: 'Living', category: 'other', amount: D(20000) }],
      strategies: {
        surplusWaterfall: [{ type: 'account', accountId: 'r' }],
        surplusDefaultAccountId: 'c',
        rothConversion: { mode: 'fixed', amount: D(100000), targetAccountId: 'r' },
      },
    });
    const r0 = project(plan, data).records[0];
    expect(r0.taxes.agi).toBeGreaterThan(data.limits[2026].rothIraPhaseout.single[1]);
    expect(r0.balances.r).toBeCloseTo(100000 + data.limits[2026].ira.limit, 2);
  });
  it('REIT distributions are taxed as ordinary dividends', () => {
    const r = project(
      mk({
        people: [person('p1', '1960-01-15')],
        accounts: [
          {
            id: 'b',
            ownerId: 'p1',
            name: 'REITs',
            type: 'taxable',
            balance: D(1e6),
            allocation: { reits: 1 },
          },
        ],
      }),
      data,
    ).records[0];
    expect(r.taxes.ordinaryTaxable).toBeGreaterThan(10000);
    expect(r.taxes.taxableIncome - r.taxes.ordinaryTaxable).toBeCloseTo(0, 2);
  });
  it('taxable annuity gains count toward the net investment income tax', () => {
    const x = emptyFederalInput();
    x.pensions = 400000;
    const without = federalTax(fp, 1, x).niit;
    x.annuityGains = 300000;
    expect(without).toBe(0);
    expect(federalTax(fp, 1, x).niit).toBeCloseTo(0.038 * (400000 - 200000), 6);
  });
  it('the first year’s SALT deduction includes that year’s state income tax', () => {
    const recs = project(
      mk({
        people: [person('p1', '1985-01-15', { residence: [{ state: 'CA', fromYear: 2026 }] })],
        accounts: [{ id: 'c', ownerId: 'p1', name: 'Cash', type: 'cash', balance: D(50000) }],
        incomes: [{ id: 'w', ownerId: 'p1', name: 'Job', kind: 'wages', amount: D(400000) }],
        debts: [
          {
            id: 'm',
            ownerId: 'p1',
            name: 'Mortgage',
            kind: 'mortgage',
            principal: D(600000),
            rate: 0.065,
            termMonths: 360,
          },
        ],
      }),
      data,
    ).records;
    const interest = recs[0].expenses.debtInterest;
    expect(recs[0].taxes.deduction).toBeGreaterThan(interest + 30000);
    expect(recs[0].taxes.deduction / recs[1].taxes.deduction).toBeGreaterThan(0.9);
  });
  it('a surviving spouse uses the first spouse’s unused estate exemption (portability)', () => {
    expect(estateTax(fp, 1, 20e6, false)).toBeCloseTo(0.4 * 5e6, 6);
    expect(estateTax(fp, 1, 20e6, false, 15e6)).toBe(0);
    const couple = (age2: number, single = false): number =>
      project(
        mk({
          people: [
            person('p1', '1950-01-15', { longevity: { age: 80 } }),
            ...(single ? [] : [person('p2', '1950-01-15', { longevity: { age: age2 } })]),
          ],
          accounts: [
            {
              id: 'r',
              ownerId: 'p1',
              name: 'Roth',
              type: 'rothIra',
              balance: D(20e6),
              rothBasis: { contributions: D(20e6), firstContributionYear: 2000 },
              fixedYield: { rate: 0, basis: 'real' },
            },
          ],
        }),
        data,
      ).estate.estateTax;
    expect(couple(85, true)).toBeGreaterThan(1e6);
    expect(couple(85)).toBe(0);
  });
  it('parametric inflation is persistent (AR(1) with the historical autocorrelation)', () => {
    const c = compilePlan(sampleBasic(2026), data);
    const phi = prepare(c).inflPhi;
    expect(phi).toBeGreaterThan(0.4);
    expect(phi).toBeLessThan(0.8);
    let num = 0;
    let den = 0;
    const mu = c.plan.assumptions.inflation.rate;
    for (let r = 0; r < 400; r++) {
      const p = generatePath(
        c,
        { method: 'parametric', blockLength: 1, inflation: 'sampled', stochasticLongevity: false },
        3,
        r,
      );
      for (let t = 1; t < p.years; t++) {
        num += (p.inflation[t] - mu) * (p.inflation[t - 1] - mu);
        den += (p.inflation[t - 1] - mu) ** 2;
      }
    }
    expect(num / den).toBeGreaterThan(phi - 0.06);
    expect(num / den).toBeLessThan(phi + 0.06);
  });
  it('the trust-fund cut defaults follow the bundled Trustees Report', () => {
    const cut = mk({ people: [person('p1', '1980-01-15')] }).assumptions.socialSecurityCut;
    expect(cut.fromYear).toBe(data.ssSeries.trusteesShortfall.depletionYear);
    expect(cut.payablePct).toBe(data.ssSeries.trusteesShortfall.payablePct);
  });
  it('a survivor with a dependent child files as a qualifying surviving spouse for two years', () => {
    const recs = project(
      mk({
        people: [person('p1', '1980-01-15', { longevity: { age: 50 } }), person('p2', '1980-01-15')],
        household: { dependents: [{ name: 'k', birthYear: 2020 }] },
        accounts: [{ id: 'c', ownerId: 'p1', name: 'Cash', type: 'cash', balance: D(2e6) }],
        expenses: [{ id: 'e', name: 'Living', category: 'other', amount: D(40000) }],
      }),
      data,
    ).records;
    expect(rec(recs, 2030).filingStatus).toBe('mfj');
    expect(rec(recs, 2031).filingStatus).toBe('qss');
    expect(rec(recs, 2032).filingStatus).toBe('qss');
    expect(rec(recs, 2033).filingStatus).toBe('single');
  });
  it('the mortgage “interest is deductible” flag is honoured (unset = deductible for a mortgage)', () => {
    const run = (flag?: boolean): YearRecord =>
      project(
        mk({
          people: [person('p1', '1985-01-15')],
          accounts: [{ id: 'c', ownerId: 'p1', name: 'Cash', type: 'cash', balance: D(50000) }],
          incomes: [{ id: 'w', ownerId: 'p1', name: 'Job', kind: 'wages', amount: D(200000) }],
          debts: [
            {
              id: 'm',
              ownerId: 'p1',
              name: 'Mortgage',
              kind: 'mortgage',
              principal: D(500000),
              rate: 0.065,
              termMonths: 360,
              ...(flag === undefined ? {} : { interestDeductible: flag }),
            },
          ],
        }),
        data,
      ).records[0];
    expect(run().taxes.deduction).toBeGreaterThan(run(false).taxes.deduction + 10000);
    expect(run(true).taxes.deduction).toBeCloseTo(run().taxes.deduction, 6);
  });
});
