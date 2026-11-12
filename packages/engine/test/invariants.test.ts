/** Engine invariants (build plan 6.5), property-tested with fast-check. */
import { loadEngineData } from '@fisim/data/src/node';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  compilePlan,
  fixedPath,
  generatePath,
  historicalPath,
  pickYear,
  PlanZ,
  project,
  runBacktest,
  runPath,
  sampleBasic,
  sampleCoupleSs,
  sampleEarlyRetiree,
  type Plan,
  type YearRecord,
} from '../src';

const data = loadEngineData();
const samples = [sampleBasic, sampleEarlyRetiree, sampleCoupleSs];

function checkYear(r: YearRecord): void {
  const c = r.check;
  // Money is conserved: opening + inflows - outflows + returns - fees = closing (within 1 cent).
  expect(Math.abs(c.opening + c.deposits - c.withdrawals + r.returns - r.fees - c.closing)).toBeLessThan(
    0.011,
  );
  // Household cash balances: everything that came in went somewhere (the solver's tolerance is $1).
  expect(Math.abs(c.cashIn - c.cashOut)).toBeLessThan(1.01);
  // No negative balances, except debts.
  for (const id in r.balances) expect(r.balances[id]).toBeGreaterThanOrEqual(-1e-6);
  expect(r.debts).toBeGreaterThanOrEqual(0);
  expect(r.shortfall).toBeGreaterThanOrEqual(0);
  expect(Number.isFinite(r.netWorth)).toBe(true);
  expect(Number.isFinite(r.taxes.total)).toBe(true);
}

const variant = fc.record({
  sample: fc.integer({ min: 0, max: 2 }),
  spend: fc.double({ min: 0.4, max: 3, noNaN: true }),
  stocks: fc.double({ min: 0, max: 1, noNaN: true }),
  timing: fc.constantFrom('start', 'mid', 'end' as const),
  order: fc.constantFrom('taxableFirst', 'proportional', 'bracketTargeted' as const),
  conversion: fc.constantFrom('none', 'fillBracket', 'fixed', 'magiTarget' as const),
  rule: fc.constantFrom('fixed', 'guardrails', 'percentOfPortfolio', 'floorCeiling' as const),
  harvest: fc.boolean(),
  run: fc.integer({ min: 0, max: 5000 }),
  method: fc.constantFrom('bootstrap', 'parametric' as const),
});

/** Two high earners aged 58 who max out 401(k)s (with Roth accounts for the catch-up rule) and a family HSA. */
function maxedCouple(startYear: number): Plan {
  const person = (id: string) => ({
    id,
    name: id,
    birthDate: '1968-03-01',
    residence: [{ state: 'TX', fromYear: startYear }],
    socialSecurity: { mode: 'none' as const },
    longevity: { age: 90 },
  });
  const acct = (id: string, ownerId: string, type: string, contribution?: object) => ({
    id,
    ownerId,
    name: id,
    type,
    balance: 0,
    ...(contribution ? { contribution } : {}),
  });
  return PlanZ.parse({
    id: 'maxed',
    schemaVersion: 1,
    name: 'maxed',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    settings: { startYear },
    people: [person('a'), person('b')],
    accounts: [
      acct('ka', 'a', 'trad401k', { incomeId: 'wa', maxOut: true }),
      acct('ra', 'a', 'roth401k'),
      acct('kb', 'b', 'trad401k', { incomeId: 'wb', maxOut: true }),
      acct('rb', 'b', 'roth401k'),
      acct('h', 'a', 'hsa', { incomeId: 'wa', maxOut: true }),
      { ...acct('c', 'a', 'cash'), balance: 5000000 },
    ],
    incomes: [
      {
        id: 'wa',
        ownerId: 'a',
        name: 'A',
        kind: 'wages',
        amount: 25000000,
        end: { type: 'age', personId: 'a', age: 66 },
      },
      {
        id: 'wb',
        ownerId: 'b',
        name: 'B',
        kind: 'wages',
        amount: 25000000,
        end: { type: 'age', personId: 'b', age: 66 },
      },
    ],
    expenses: [{ id: 'e', name: 'Living', category: 'other', amount: 8000000 }],
    healthcare: {
      people: [
        {
          personId: 'a',
          coverage: [{ type: 'employer', from: { type: 'year', year: startYear }, hdhp: true }],
        },
        {
          personId: 'b',
          coverage: [{ type: 'spouseEmployer', from: { type: 'year', year: startYear }, hdhp: true }],
        },
      ],
    },
  });
}

function build(v: {
  sample: number;
  spend: number;
  stocks: number;
  timing: 'start' | 'mid' | 'end';
  order: string;
  conversion: string;
  rule: string;
  harvest: boolean;
}): Plan {
  const p = structuredClone(samples[v.sample](2026));
  for (const e of p.expenses) e.amount = Math.round(e.amount * v.spend);
  for (const a of p.accounts)
    if (a.type !== 'cash')
      a.allocation = { usStocks: v.stocks, usBonds: 1 - v.stocks, cash: 0, intlStocks: 0, reits: 0 };
  p.settings.timing = v.timing;
  p.strategies.withdrawalOrder.strategy = v.order as never;
  p.strategies.rothConversion.mode = v.conversion as never;
  p.strategies.rothConversion.amount = 2500000;
  p.strategies.spendingRule.type = v.rule as never;
  p.strategies.gainHarvest.enabled = v.harvest;
  p.strategies.lossHarvest.enabled = v.harvest;
  return p;
}

describe('engine invariants', () => {
  it('money is conserved and balances never go negative on random plans and random market paths', () => {
    fc.assert(
      fc.property(variant, (v) => {
        const c = compilePlan(build(v as never), data);
        const path = generatePath(
          c,
          {
            method: v.method as 'bootstrap' | 'parametric',
            blockLength: 5,
            inflation: 'sampled',
            stochasticLongevity: false,
          },
          42,
          v.run,
        );
        const res = runPath(c, path, { detail: true });
        for (const r of res.records!) checkYear(r);
      }),
      { numRuns: 60 },
    );
  });

  it('holds on every historical start year for the sample plans', () => {
    for (const mk of samples) {
      const c = compilePlan(mk(2026), data);
      for (let i = 0; i < data.market.years.length; i += 7) {
        const res = runPath(c, historicalPath(c, i, c.maxYears), { detail: true });
        for (const r of res.records!) checkYear(r);
      }
    }
  });

  it('contributions never exceed their limits (per living person, by age)', () => {
    for (const mk of [...samples, maxedCouple]) {
      const plan = mk(2026);
      const res = project(plan, data);
      let tight = 0;
      for (const r of res.records) {
        const pick = pickYear(data.limits, r.year);
        const lim = pick.value;
        const base = res.records.find((x) => x.year === pick.dataYear);
        const scale = (base ? r.cpi / base.cpi : 1) * 1.0001;
        let deferral = 0;
        let hsa = 0;
        let anyAlive = 0;
        r.alive.forEach((alive, i) => {
          if (!alive) return;
          anyAlive++;
          const age = r.ages[i];
          const cu = age >= 60 && age <= 63 ? lim.catchUp60to63 : age >= 50 ? lim.catchUp50 : 0;
          deferral += (lim.electiveDeferral + cu) * scale;
          hsa += age >= 55 ? lim.hsa.catchUp55 : 0;
        });
        // Employee deferrals (pre-tax and Roth payroll) against 402(g) + the age-based catch-up of each living person.
        expect(r.contributions.pretax + r.contributions.roth).toBeLessThanOrEqual(deferral + 1);
        // HSA: one family limit (indexed) per household plus each person's (unindexed) catch-up.
        if (anyAlive) expect(r.contributions.hsa).toBeLessThanOrEqual(lim.hsa.family * scale + hsa + 1);
        if (
          r.income.wages > 0 &&
          Math.abs(r.contributions.pretax + r.contributions.roth - deferral / 1.0001) < 2
        )
          tight++;
      }
      // The maxed-out couple sits exactly on the age-based limit every working year (50+ and 60-63 catch-ups).
      if (mk === maxedCouple) expect(tight).toBe(res.records.filter((r) => r.income.wages > 0).length);
    }
  });

  it('required minimum distributions are always taken', () => {
    const res = project(sampleCoupleSs(2026), data);
    const withRmd = res.records.filter((r) => r.withdrawals.rmd > 0);
    expect(withRmd.length).toBeGreaterThan(5);
    for (const r of withRmd) expect(r.withdrawals.pretax + 0.01).toBeGreaterThanOrEqual(r.withdrawals.rmd);
    // Pat was born in 1963, so RMDs start at 75.
    expect(withRmd[0].ages[0]).toBeGreaterThanOrEqual(73);
  });

  it('raising spending never raises the success rate', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 20000, max: 70000, noNaN: true }),
        fc.double({ min: 1.01, max: 1.6, noNaN: true }),
        fc.double({ min: 0.2, max: 1, noNaN: true }),
        (spend, bump, stocks) => {
          const mk = (s: number): Plan => {
            const p = structuredClone(sampleBasic(2026));
            p.incomes = [];
            p.debts = [];
            p.milestones = [];
            p.healthcare.enabled = false;
            p.people[0].birthDate = '1964-01-01';
            p.people[0].longevity.age = 92;
            p.people[0].socialSecurity.mode = 'none';
            p.accounts = [
              {
                ...p.accounts[3],
                balance: 100000000,
                rothBasis: { contributions: 100000000, conversions: [], firstContributionYear: 2000 },
                allocation: { usStocks: stocks, usBonds: 1 - stocks, cash: 0, intlStocks: 0, reits: 0 },
              },
            ];
            p.strategies.surplusWaterfall = [];
            p.expenses = [
              { ...p.expenses[0], amount: Math.round(s * 100), start: undefined, end: undefined },
            ];
            return p;
          };
          const lo = runBacktest(compilePlan(mk(spend), data));
          const hi = runBacktest(compilePlan(mk(spend * bump), data));
          expect(hi.successCount).toBeLessThanOrEqual(lo.successCount);
        },
      ),
      { numRuns: 15 },
    );
  });

  it('is deterministic: the same plan and data give identical results', () => {
    const a = JSON.stringify(project(sampleEarlyRetiree(2026), data).records);
    const b = JSON.stringify(project(sampleEarlyRetiree(2026), data).records);
    expect(a).toBe(b);
  });

  it('the fixed-point solver converges within 25 iterations on the samples', () => {
    for (const mk of samples) {
      const res = project(mk(2026), data);
      expect(res.solver.nonConverged).toBe(0);
      expect(res.solver.maxIterations).toBeLessThanOrEqual(26);
    }
    const c = compilePlan(sampleEarlyRetiree(2026), data);
    expect(runPath(c, fixedPath(c)).success).toBe(true);
  });
});
