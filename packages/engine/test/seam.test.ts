/**
 * The engine side of the UI/engine seam fixes (review plan 2c, 2d and 3c.4): one convention for expected returns,
 * essential expenses, the IRMAA appeal, the custom withdrawal order, explanations in display units, part-year pay,
 * and the ending net-worth goal.
 */
import { loadEngineData } from '@fisim/data/src/node';
import { describe, expect, it } from 'vitest';
import {
  compilePlan,
  expectedMeans,
  explainCashFlow,
  explainNetWorth,
  explainTax,
  PlanZ,
  project,
  resolvedCustomOrder,
  runMonteCarlo,
  sampleBasic,
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
const mk = (o: Over): Plan =>
  PlanZ.parse({
    id: 't',
    schemaVersion: 3,
    name: 't',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    settings: { startYear: 2026, timing: 'end' },
    healthcare: { enabled: false },
    ...o,
  });
const rec = (recs: YearRecord[], year: number): YearRecord => recs.find((r) => r.year === year)!;
const cashAccount = (balance: number): Over => ({
  id: 'a-cash',
  ownerId: 'p1',
  name: 'Savings',
  type: 'cash',
  balance: D(balance),
});

describe('expected returns: one outlook for the projection and the simulations', () => {
  it.each([0, 0.0425])('uses custom inflation of %s with the same historical nominal returns', (rate) => {
    const plan = sampleBasic(2026);
    plan.assumptions.returns.mode = 'historicalAverage';
    plan.assumptions.inflation.rate = rate;
    const historical = expectedMeans({ plan, data });
    plan.assumptions.inflation.useRateWithHistoricalReturns = true;
    const saved = PlanZ.parse(JSON.parse(JSON.stringify(plan)));
    expect(expectedMeans({ plan: saved, data })).toEqual({ classes: historical.classes, inflation: rate });
    expect(project(saved, data).records[1].cpi).toBeCloseTo(1 + rate, 12);
    saved.assumptions.inflation.useRateWithHistoricalReturns = false;
    expect(expectedMeans({ plan: saved, data })).toEqual(historical);
  });

  it('under long-run historical averages, Monte Carlo centres on the same history the projection uses', () => {
    const p = structuredClone(sampleBasic(2026));
    p.assumptions.returns.mode = 'historicalAverage';
    const plan = PlanZ.parse(p);
    const c = compilePlan(plan, data);
    const e = expectedMeans(c);
    expect(e.classes[0]).not.toBeCloseTo(plan.assumptions.returns.fixed.usStocks, 3);
    for (const method of ['bootstrap', 'parametric'] as const) {
      const s = runMonteCarlo(c, { runs: 50, method });
      expect(s.meansUsed.usStocks, method).toBeCloseTo(e.classes[0], 12);
      expect(s.meansUsed.inflation, method).toBeCloseTo(e.inflation, 12);
    }
  });
});

describe('annual contributions credited to each destination', () => {
  it('reconciles scheduled deposits and automatic surplus and applies one-year amounts and inclusive dates', () => {
    const p = sampleBasic(2026);
    p.expenses = [];
    const workplace = p.accounts.find((a) => a.contribution)!;
    workplace.contribution!.schedule = {
      firstYear: 2027,
      lastYear: 2029,
      amountByYear: { 2028: 0, 2029: D(1200) },
    };
    workplace.contribution!.employerAmountByYear = { 2028: D(2300) };
    workplace.contribution!.maxOut = true;
    p.strategies.surplusWaterfall = [
      {
        type: 'account',
        accountId: 'a-roth',
        maxAnnual: D(1400),
        schedule: { lastYear: 2028, amountByYear: { 2027: 0, 2028: D(900) } },
      },
    ];
    const result = project(PlanZ.parse(JSON.parse(JSON.stringify(p))), data);
    const [first, second, third, fourth, fifth] = result.records;
    expect(first.contributions.byAccount[workplace.id]).toBeUndefined();
    expect(second.contributions.byAccount[workplace.id].personal).toBeGreaterThan(20000);
    expect(third.contributions.byAccount[workplace.id].personal).toBe(0);
    expect(third.contributions.byAccount[workplace.id].employer / third.cpi).toBeCloseTo(2300);
    expect(fourth.contributions.byAccount[workplace.id].personal / fourth.cpi).toBeCloseTo(1200);
    expect(fifth.contributions.byAccount[workplace.id]).toBeUndefined();
    expect(first.contributions.byAccount['a-roth'].personal).toBeCloseTo(1400);
    expect(second.contributions.byAccount['a-roth']).toBeUndefined();
    expect(third.contributions.byAccount['a-roth'].personal / third.cpi).toBeCloseTo(900);
    expect(fourth.contributions.byAccount['a-roth']).toBeUndefined();
    expect(first.contributions.byAccount['a-brokerage'].automatic).toBeGreaterThan(0);
    for (const r of result.records) {
      const entries = Object.values(r.contributions.byAccount);
      expect(entries.reduce((s, e) => s + e.employer, 0)).toBeCloseTo(r.contributions.employer, 6);
      expect(entries.reduce((s, e) => s + e.employer + e.personal + e.automatic, 0)).toBeCloseTo(
        r.contributions.total,
        6,
      );
    }
  });
  it('credits the Roth deferral and its employer match to their actual receiving accounts', () => {
    const p = sampleBasic(2026);
    const pretax = p.accounts.find((a) => a.contribution)!;
    p.accounts.push({ ...pretax, id: 'a-roth-work', type: 'roth401k', balance: 0 });
    delete pretax.contribution;
    const r = project(p, data).records[0];
    expect(r.contributions.byAccount['a-roth-work']).toMatchObject({
      ownerId: 'p1',
      personal: 9200,
      employer: 0,
    });
    expect(r.contributions.byAccount[pretax.id]).toMatchObject({
      ownerId: 'p1',
      personal: 0,
      employer: 3680,
    });
  });
});

describe('essential expenses are never cut', () => {
  // Retired at the start (no pay), $500k in cash, a rule spending 4% of the portfolio: $20,000 against $40,000
  // planned. The $20,000 essential expense is paid in full and the flexible one takes the whole cut.
  const plan = (essentialFood: boolean): Plan =>
    mk({
      people: [person('p1', '1960-01-01')],
      accounts: [cashAccount(500000)],
      expenses: [
        { id: 'e-home', name: 'Home', category: 'housing', amount: D(20000), essential: true },
        { id: 'e-fun', name: 'Travel', category: 'travel', amount: D(20000), essential: essentialFood },
      ],
      strategies: { spendingRule: { type: 'percentOfPortfolio', pct: 0.04 } },
    });
  it('a cut comes out of the flexible expense only', () => {
    const r = project(plan(false), data).records[0];
    expect(r.expenses.byCategory.housing).toBeCloseTo(20000, 2);
    expect(r.expenses.byCategory.travel ?? 0).toBeCloseTo(0, 2);
    expect(r.expenses.living).toBeCloseTo(20000, 2);
    expect(r.spendingMultiplier).toBeCloseTo(0.5, 6);
  });
  it('when everything is essential the rule cannot cut at all', () => {
    const r = project(plan(true), data).records[0];
    expect(r.expenses.living).toBeCloseTo(40000, 2);
    expect(r.spendingMultiplier).toBeCloseTo(1, 6);
  });
});

describe('IRMAA life-changing-event appeal', () => {
  // Born 1958, on Medicare from 2026. $400k pay in 2026 and 2027, then retired. 2029 IRMAA looks back to 2027.
  const plan = (appeal: boolean): Plan =>
    mk({
      people: [person('p1', '1958-03-01')],
      accounts: [cashAccount(2e6)],
      incomes: [
        {
          id: 'i-pay',
          ownerId: 'p1',
          name: 'Pay',
          kind: 'wages',
          amount: D(400000),
          growth: { rate: 0, basis: 'real' },
          end: { type: 'year', year: 2028 },
        },
      ],
      expenses: [{ id: 'e', name: 'Living', category: 'food', amount: D(60000) }],
      healthcare: {
        enabled: true,
        people: [
          {
            personId: 'p1',
            coverage: [{ type: 'medicare', from: { type: 'year', year: 2026 } }],
            medicare: { irmaaAppeal: appeal },
          },
        ],
      },
    });
  it('uses this year’s lower income once pay stops, and changes nothing while pay continues', () => {
    const off = project(plan(false), data).records;
    const on = project(plan(true), data).records;
    expect(rec(off, 2029).expenses.healthcare.irmaa).toBeGreaterThan(1000);
    expect(rec(on, 2029).expenses.healthcare.irmaa).toBeLessThan(rec(off, 2029).expenses.healthcare.irmaa);
    expect(rec(on, 2027).expenses.healthcare.irmaa).toBeCloseTo(rec(off, 2027).expenses.healthcare.irmaa, 6);
  });
});

describe('custom withdrawal order', () => {
  it('keeps the user’s order, drops removed accounts and slots new ones in by type', () => {
    const p = sampleBasic(2026);
    const ids = p.accounts.map((a) => a.id);
    const last = ids[ids.length - 1];
    p.strategies.withdrawalOrder.customOrder = [last, 'a-removed'];
    const order = resolvedCustomOrder(p);
    expect(order[0]).toBe(last);
    expect(order).not.toContain('a-removed');
    expect([...order].sort()).toEqual([...ids].sort());
  });
});

describe('explanations in the dollars shown on screen', () => {
  const recs = project(sampleBasic(2026), data).records;
  it('net worth, cash flow and tax lines add up in today’s dollars', () => {
    for (const r of [recs[3], recs[20], recs[recs.length - 1]]) {
      const nw = explainNetWorth(r, 'real');
      expect(nw.result).toBeCloseTo(toReal(r.netWorth, r, 'balance'), 4);
      expect(nw.lines.reduce((s, l) => s + l.amount, 0)).toBeCloseTo(nw.result, 0);
      const cfN = explainCashFlow(r);
      const cfR = explainCashFlow(r, 'real');
      expect(cfR.result).toBeCloseTo(cfN.result / r.cpi, 4);
      expect(explainTax(r, 'real').result).toBeCloseTo(r.taxes.total / r.cpi, 4);
    }
  });
});

describe('pay that ends at an age runs to that birthday', () => {
  it('a 1 October birthday earns three quarters of the final year', () => {
    const plan = mk({
      people: [person('p1', '1970-10-01')],
      accounts: [cashAccount(100000)],
      incomes: [
        {
          id: 'i-pay',
          ownerId: 'p1',
          name: 'Pay',
          kind: 'wages',
          amount: D(80000),
          growth: { rate: 0, basis: 'nominal' },
          end: { type: 'age', personId: 'p1', age: 60 },
        },
      ],
    });
    const recs = project(plan, data).records;
    expect(rec(recs, 2029).income.wages).toBeCloseTo(80000, 2);
    expect(rec(recs, 2030).income.wages).toBeCloseTo(60000, 2);
    expect(rec(recs, 2031).income.wages).toBe(0);
  });
});

describe('ending net-worth goal (3c.4)', () => {
  it('is reported by the projection and, when it counts, lowers the success rate', () => {
    const p = structuredClone(sampleBasic(2026));
    p.strategies.estate.legacyGoal = D(1e9);
    const plain = PlanZ.parse(p);
    const s = project(plain, data).summary;
    expect(s.legacyGoalReal).toBe(1e9);
    expect(s.legacyGoalMet).toBe(false);
    const report = runMonteCarlo(compilePlan(plain, data), { runs: 60 });
    expect(report.legacyGoal).toEqual({ goal: 1e9, metRate: 0, countsForSuccess: false });
    expect(report.successRate).toBe(report.fundedRate);
    p.strategies.estate.legacyGoalForSuccess = true;
    const counted = runMonteCarlo(compilePlan(PlanZ.parse(p), data), { runs: 60 });
    expect(counted.fundedRate).toBe(report.fundedRate);
    expect(counted.successRate).toBe(0);
  });
  it('defaults to no goal', () => {
    const s = runMonteCarlo(compilePlan(sampleBasic(2026), data), { runs: 20 });
    expect(s.legacyGoal).toBeNull();
    expect(s.successRate).toBe(s.fundedRate);
  });
});

describe('income tax character defaults by kind', () => {
  it('pay is earned and everything else is ordinary income when the plan does not say', () => {
    const inc = (kind: string): Over => ({ id: kind, ownerId: 'p1', name: kind, kind, amount: D(1000) });
    const plan = mk({
      people: [person('p1', '1970-01-01')],
      incomes: ['wages', 'bonus', 'selfEmployment', 'pension', 'annuity', 'rental', 'other'].map(inc),
    });
    expect(plan.incomes.map((i) => i.taxCharacter)).toEqual([
      'earned',
      'earned',
      'selfEmployment',
      'ordinary',
      'ordinary',
      'ordinary',
      'ordinary',
    ]);
  });
});
