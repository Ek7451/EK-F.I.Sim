/**
 * Regression tests for the November 2026 accuracy review. One test (or more) per defect found, each with the
 * hand-computed figure it must reproduce. IDs: T = tax rules, P = projection engine, S = simulations.
 */
import { loadEngineData } from '@fisim/data/src/node';
import { describe, expect, it } from 'vitest';
import {
  compilePlan,
  emptyFederalInput,
  federalTax,
  fiSpending,
  generatePath,
  irmaaTier,
  PlanZ,
  project,
  qbiThreshold,
  runMonteCarlo,
  runPath,
  sampleBasic,
  sampleCoupleSs,
  stateTax,
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

// ------------------------------------------------------------------------------------------------ tax rules
describe('T1 a state that starts from federal taxable income is taxed on it, not on AGI', () => {
  const base = {
    status: 'single' as const,
    federalAgi: 100000,
    federalTaxableIncome: 83900,
    federalDeduction: 16100,
    taxableSocialSecurity: 0,
    retirementIncome: [0, 0] as [number, number],
    ages: [40],
    longTermGains: 0,
    dependents: 0,
  };
  it('Colorado: 4.4% of $83,900 is $3,691.60 (it was $4,400, 4.4% of AGI)', () => {
    expect(stateTax(data.states.CO[2026], 1, base)).toBeCloseTo(0.044 * 83900, 6);
  });
  it('every such state gives the same tax for the same taxable income, whatever the deduction was', () => {
    for (const code of Object.keys(data.states)) {
      const p = data.states[code][2026];
      if (p.kind === 'none' || p.startingPoint !== 'federalTaxableIncome') continue;
      const a = stateTax(p, 1, base);
      const b = stateTax(p, 1, { ...base, federalAgi: 120000, federalDeduction: 36100 });
      expect(b, code).toBeCloseTo(a, 6);
    }
  });
});

describe('T2 the QBI threshold follows each year’s own table', () => {
  it('matches the published 2026 and 2027 figures', () => {
    expect(qbiThreshold(data.federal[2026], false)).toBe(201750);
    expect(qbiThreshold(data.federal[2026], true)).toBe(403500);
    expect(qbiThreshold(data.federal[2027], false)).toBe(208300);
    expect(qbiThreshold(data.federal[2027], true)).toBe(416600);
  });
});

describe('T3 the senior deduction phases out from $75,000 for a qualifying surviving spouse', () => {
  it('AGI $120,000 at 66: $6,000 less 6% of $45,000 is $3,300 (the joint $150,000 start gave $6,000)', () => {
    const x = emptyFederalInput();
    x.status = 'qss';
    x.ages = [66];
    x.otherOrdinary = 120000;
    const r = federalTax(data.federal[2026], 1, x);
    expect(r.agi).toBeCloseTo(120000, 6);
    expect(r.seniorDeduction).toBeCloseTo(6000 - 0.06 * 45000, 6);
    x.status = 'mfj';
    x.ages = [66, 50];
    expect(federalTax(data.federal[2026], 1, x).seniorDeduction).toBeCloseTo(6000, 6);
  });
});

describe('T4 the top IRMAA tier starts at its threshold, the others above theirs', () => {
  it('2026: single $500,000 and joint $750,000 are in the top tier; one dollar less is not', () => {
    const m = data.medicare[2026];
    const top = m.irmaa.single.length - 1;
    expect(irmaaTier(m, 1, 'single', 500000).tier).toBe(top);
    expect(irmaaTier(m, 1, 'single', 499999).tier).toBe(top - 1);
    expect(irmaaTier(m, 1, 'mfj', 750000).tier).toBe(m.irmaa.mfj.length - 1);
    // A lower tier still needs more than its threshold.
    expect(irmaaTier(m, 1, 'single', m.irmaa.single[1].magiOver).tier).toBe(0);
  });
});

// ------------------------------------------------------------------------------------------------ projection
describe('P1 a year’s tax rate counts required distributions as income', () => {
  it('a 76-year-old living on Social Security and RMDs is not shown a 77% rate', () => {
    const r = project(
      mk({
        people: [
          person('p1', '1950-01-15', {
            socialSecurity: { mode: 'pia', piaMonthly: D(2700), claimAge: { years: 67, months: 0 } },
          }),
        ],
        accounts: [
          { id: 'ira', ownerId: 'p1', name: 'IRA', type: 'tradIra', balance: D(3e6) },
          { id: 'c', ownerId: 'p1', name: 'Cash', type: 'cash', balance: D(50000) },
        ],
        expenses: [{ id: 'e', name: 'Living', category: 'other', amount: D(60000) }],
      }),
      data,
    ).records[0];
    expect(r.withdrawals.rmd).toBeGreaterThan(100000);
    const base = r.income.total + r.withdrawals.pretax + r.rothConversion + Math.max(0, r.realizedGains);
    expect(r.taxes.effectiveRate).toBeCloseTo(r.taxes.total / base, 9);
    expect(r.taxes.effectiveRate).toBeLessThan(0.3);
  });
});

describe('P2 the independence milestone counts housing, debt payments and healthcare', () => {
  const plan = (withMilestone: boolean): Plan =>
    mk({
      people: [person('p1', '1986-01-15')],
      healthcare: { enabled: true },
      accounts: [{ id: 'tx', ownerId: 'p1', name: 'Brokerage', type: 'taxable', balance: D(900000) }],
      assets: [{ id: 'home', ownerId: 'p1', name: 'Home', kind: 'primaryHome', value: D(600000) }],
      debts: [
        {
          id: 'm',
          ownerId: 'p1',
          name: 'Mortgage',
          kind: 'mortgage',
          principal: D(400000),
          rate: 0.065,
          termMonths: 360,
          linkedAssetId: 'home',
        },
      ],
      incomes: [{ id: 'w', ownerId: 'p1', name: 'Job', kind: 'wages', amount: D(120000) }],
      expenses: [{ id: 'e', name: 'Living', category: 'other', amount: D(40000) }],
      milestones: withMilestone
        ? [
            {
              id: 'm-fi',
              name: 'Financially independent',
              kind: 'fi',
              when: { type: 'condition', metric: 'fi', fiMultiple: 25 },
            },
          ]
        : [],
    });
  it('fires only once investments cover 25 times all recurring spending, not living costs alone', () => {
    const res = project(plan(true), data);
    const y = res.summary.fiYear!;
    expect(y).not.toBeNull();
    // 25 x $40,000 of living costs is $1.0M, which $900k reaches within a year or two. The mortgage payment
    // (about $30,300 a year) and healthcare add more than $25,000 a year to what must be covered.
    const prev = rec(res.records, y - 1);
    expect(fiSpending(prev) - prev.expenses.living).toBeGreaterThan(25000);
    expect(prev.investable).toBeGreaterThanOrEqual(25 * fiSpending(prev));
    // The year before that it did not hold (the milestone tests the start of each year against last year's spending).
    const before = rec(res.records, y - 2);
    if (before) expect(before.investable).toBeLessThan(25 * fiSpending(before) * 1.05);
  });
  it('agrees with the summary’s own 25x test to within a year', () => {
    const withMs = project(plan(true), data).summary.fiYear!;
    const without = project(plan(false), data).summary.fiYear!;
    expect(Math.abs(withMs - without)).toBeLessThanOrEqual(1);
  });
});

describe('P3 net worth today is all start-of-year values', () => {
  it('$50k cash + $500k home - $300k mortgage is $250,000, before any appreciation or payment', () => {
    const s = project(
      mk({
        people: [person('p1', '1985-01-15')],
        accounts: [{ id: 'c', ownerId: 'p1', name: 'Cash', type: 'cash', balance: D(50000) }],
        assets: [
          {
            id: 'home',
            ownerId: 'p1',
            name: 'Home',
            kind: 'primaryHome',
            value: D(500000),
            appreciation: { rate: 0.03, basis: 'nominal' },
          },
        ],
        debts: [
          {
            id: 'm',
            ownerId: 'p1',
            name: 'Mortgage',
            kind: 'mortgage',
            principal: D(300000),
            rate: 0.06,
            termMonths: 360,
            linkedAssetId: 'home',
          },
        ],
        incomes: [{ id: 'w', ownerId: 'p1', name: 'Job', kind: 'wages', amount: D(150000) }],
      }),
      data,
    ).summary;
    expect(s.currentNetWorth).toBeCloseTo(250000, 6);
  });
});

describe('P4 the Rule of 55 needs separation at 55 or later', () => {
  const plan = (lastWorkAge: number): Plan =>
    mk({
      people: [person('p1', '1976-01-15', { longevity: { age: 62 } })],
      accounts: [
        { id: 'k', ownerId: 'p1', name: '401k', type: 'trad401k', balance: D(1.5e6), ruleOf55: true },
        { id: 'c', ownerId: 'p1', name: 'Cash', type: 'cash', balance: D(1000) },
      ],
      incomes: [
        {
          id: 'w',
          ownerId: 'p1',
          name: 'Job',
          kind: 'wages',
          amount: D(90000),
          end: { type: 'age', personId: 'p1', age: lastWorkAge },
        },
      ],
      expenses: [{ id: 'e', name: 'Living', category: 'other', amount: D(60000) }],
    });
  it('leaving at 52 and waiting until 55 still pays the 10% penalty', () => {
    const recs = project(plan(52), data).records;
    for (const r of recs.filter((x) => x.ages[0] >= 55 && x.ages[0] <= 58)) {
      expect(r.withdrawals.pretax, String(r.year)).toBeGreaterThan(10000);
      expect(r.taxes.penalties, String(r.year)).toBeCloseTo(0.1 * r.withdrawals.pretax, 0);
    }
  });
  it('leaving at 56 does not', () => {
    const recs = project(plan(56), data).records;
    for (const r of recs.filter((x) => x.ages[0] >= 57 && x.ages[0] <= 58)) {
      expect(r.withdrawals.pretax, String(r.year)).toBeGreaterThan(10000);
      expect(r.taxes.penalties, String(r.year)).toBe(0);
    }
  });
});

describe('P5 a couple shares one HSA family limit, whichever account is listed first', () => {
  const plan = (order: 'ab' | 'ba'): Plan => {
    const hsa = (id: string, ownerId: string, incomeId: string): Over => ({
      id,
      ownerId,
      name: id,
      type: 'hsa',
      balance: 0,
      contribution: { incomeId, maxOut: true },
    });
    const ha = hsa('ha', 'a', 'wa');
    const hb = hsa('hb', 'b', 'wb');
    return mk({
      people: [person('a', '1985-03-01'), person('b', '1985-03-01')],
      accounts: [
        ...(order === 'ab' ? [ha, hb] : [hb, ha]),
        { id: 'c', ownerId: 'a', name: 'Cash', type: 'cash', balance: D(50000) },
      ],
      incomes: [
        { id: 'wa', ownerId: 'a', name: 'A', kind: 'wages', amount: D(150000) },
        { id: 'wb', ownerId: 'b', name: 'B', kind: 'wages', amount: D(150000) },
      ],
      expenses: [{ id: 'e', name: 'Living', category: 'other', amount: D(80000) }],
      healthcare: {
        people: [
          { personId: 'a', coverage: [{ type: 'employer', from: { type: 'year', year: 2026 }, hdhp: true }] },
          {
            personId: 'b',
            coverage: [{ type: 'spouseEmployer', from: { type: 'year', year: 2026 }, hdhp: true }],
          },
        ],
      },
    });
  };
  it('both orders put in exactly the family limit (the second order put in twice that)', () => {
    const family = data.limits[2026].hsa.family;
    expect(project(plan('ab'), data).records[0].contributions.hsa).toBeCloseTo(family, 6);
    expect(project(plan('ba'), data).records[0].contributions.hsa).toBeCloseTo(family, 6);
  });
});

describe('P6 a drained account cannot poison the year’s arithmetic', () => {
  it('conserves cash on the path that used to return NaN (a 1e-323 stock weight, seed 42, run 3565)', () => {
    const p = structuredClone(sampleCoupleSs(2026));
    for (const e of p.expenses) e.amount = Math.round(e.amount * 1.6373941406249999);
    for (const a of p.accounts)
      if (a.type !== 'cash')
        a.allocation = { usStocks: 1e-323, usBonds: 1, cash: 0, intlStocks: 0, reits: 0 };
    p.settings.timing = 'end';
    p.strategies.withdrawalOrder.strategy = 'taxableFirst';
    p.strategies.rothConversion.mode = 'fillBracket';
    p.strategies.rothConversion.amount = 2500000;
    p.strategies.spendingRule.type = 'guardrails';
    const c = compilePlan(p, data);
    const path = generatePath(
      c,
      { method: 'parametric', blockLength: 5, inflation: 'sampled', stochasticLongevity: false },
      42,
      3565,
    );
    for (const r of runPath(c, path, { detail: true }).records!) {
      expect(Number.isFinite(r.withdrawals.total), String(r.year)).toBe(true);
      expect(Math.abs(r.check.cashIn - r.check.cashOut), String(r.year)).toBeLessThan(1.01);
    }
  });
});

// ------------------------------------------------------------------------------------------------ simulations
describe('S1 only runs that ran short appear in the failure-year histogram', () => {
  it('a funded run that misses the ending goal is not counted under a year', () => {
    const p = structuredClone(sampleBasic(2026));
    p.strategies.estate.legacyGoal = D(3e6);
    const s = runMonteCarlo(compilePlan(p, data), { runs: 300, method: 'bootstrap' });
    const listed = s.failureYears.reduce((n, f) => n + f.count, 0);
    expect(listed).toBe(Math.round((1 - s.fundedRate) * s.runs));
    for (const f of s.failureYears) expect(f.year).toBeGreaterThanOrEqual(2026);
  });
});
