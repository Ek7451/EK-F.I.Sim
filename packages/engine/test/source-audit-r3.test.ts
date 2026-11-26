import { describe, expect, it } from 'vitest';
import { loadEngineData } from '@fisim/data/src/node';
import {
  compilePlan,
  loadPlan,
  PlanZ,
  sampleBasic,
  expectedMeans,
  runMonteCarloChunk,
  summarizeMonteCarlo,
  mcSettings,
  projectCompiled,
} from '../src';

const data = loadEngineData();
describe('R3 input and result integrity', () => {
  it.each([
    [
      'impossible birthday',
      (p: ReturnType<typeof sampleBasic>) => {
        p.people[0].birthDate = '1985-02-30';
      },
    ],
    [
      'unknown owner',
      (p: ReturnType<typeof sampleBasic>) => {
        p.accounts[0].ownerId = 'missing';
      },
    ],
    [
      'duplicate account',
      (p: ReturnType<typeof sampleBasic>) => {
        p.accounts.push(p.accounts[0]);
      },
    ],
    [
      'synthetic account ID',
      (p: ReturnType<typeof sampleBasic>) => {
        p.accounts[0].id = '__sweep';
      },
    ],
    [
      'zero price index',
      (p: ReturnType<typeof sampleBasic>) => {
        p.assumptions.inflation.rate = -1;
      },
    ],
    [
      'fees consume the balance',
      (p: ReturnType<typeof sampleBasic>) => {
        p.accounts[0].fees = { expenseRatio: 0.6, advisory: 0.6 };
      },
    ],
    [
      'unbounded horizon',
      (p: ReturnType<typeof sampleBasic>) => {
        p.settings.startYear = -100000000;
      },
    ],
    [
      'invalid correlation',
      (p: ReturnType<typeof sampleBasic>) => {
        p.assumptions.returns.correlation = [[0.5]];
      },
    ],
    [
      'empty horizon',
      (p: ReturnType<typeof sampleBasic>) => {
        for (const person of p.people) person.birthDate = '1880-01-01';
      },
    ],
  ] as const)('N09–N11 reject %s on import and calculation', (_, change) => {
    const plan = sampleBasic(2026);
    change(plan);
    expect(PlanZ.safeParse(plan).success).toBe(false);
    expect(() => compilePlan(plan, data)).toThrow();
  });
  it('N35 preserves corrupt legacy records for recovery', () => {
    const raw = { schemaVersion: 0, accounts: 'damaged' };
    expect(loadPlan(raw)).toMatchObject({ plan: null, original: raw, error: expect.any(String) });
  });
});

describe('R3 decision metrics', () => {
  it('F09 stock shock shifts all three effective stock classes in both assumption modes', () => {
    for (const mode of ['fixed', 'historicalAverage'] as const) {
      const p = sampleBasic(2026);
      p.assumptions.returns.mode = mode;
      const before = expectedMeans({ plan: p, data });
      p.assumptions.returns.stockAdjustment = 0.02;
      const after = expectedMeans({ plan: p, data });
      for (const [i, value] of before.classes.entries())
        expect(after.classes[i] - value).toBeCloseTo([0, 3, 4].includes(i) ? 0.02 : 0, 10);
    }
  });
  it('F12 separates active funded, all-run funding and completed lifetimes', () => {
    const c = compilePlan(sampleBasic(2026), data);
    const settings = mcSettings(c);
    const chunk = runMonteCarloChunk(c, settings, 0, 100);
    for (let r = 0; r < 100; r++) {
      const active = r < 60,
        failed = (r >= 50 && r < 60) || r >= 90;
      chunk.lastYearIndex[r] = active ? 1 : 0;
      chunk.success[r] = failed ? 0 : 1;
      chunk.failYear[r] = failed ? c.startYear : -1;
      chunk.investable[r * c.maxYears] = 100;
      chunk.investable[r * c.maxYears + 1] = active ? 90 : NaN;
    }
    const result = summarizeMonteCarlo(c, [chunk], settings.seed, settings.method);
    expect(result.activeCount[1]).toBe(60);
    expect(result.activeFundedCount[1]).toBe(50);
    expect(result.solventShare[1]).toBe(0.8);
    expect(() => summarizeMonteCarlo(c, [], settings.seed, settings.method)).toThrow('No completed');
    expect(() => summarizeMonteCarlo(c, [chunk, chunk], settings.seed, settings.method)).toThrow(
      'overlapping',
    );
  });
  it('F03 routes only available sale cash after fees and linked debt', () => {
    const p = PlanZ.parse({
      id: 'sale',
      name: 'sale',
      schemaVersion: 3,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
      settings: { startYear: 2026, timing: 'end' },
      people: [
        {
          id: 'p',
          name: 'A',
          birthDate: '1976-02-15',
          residence: [{ state: 'TX', fromYear: 2026 }],
          socialSecurity: { mode: 'none' },
        },
      ],
      accounts: [
        { id: 'cash', type: 'cash', name: 'cash', ownerId: 'p', balance: 0 },
        { id: 'destination', type: 'taxable', name: 'held', ownerId: 'p', balance: 0 },
      ],
      assets: [
        {
          id: 'house',
          kind: 'primaryHome',
          ownerId: 'p',
          name: 'Home',
          value: 30000000,
          costBasis: 30000000,
          sale: {
            when: { type: 'year', year: 2026 },
            sellingCostPct: 0.06,
            proceedsToAccountId: 'destination',
          },
        },
      ],
      debts: [
        {
          id: 'loan',
          kind: 'mortgage',
          name: 'Loan',
          ownerId: 'p',
          linkedAssetId: 'house',
          principal: 10000000,
          rate: 0.04,
          termMonths: 360,
        },
      ],
      expenses: [{ id: 'bills', category: 'other', name: 'Bills', amount: 1000000 }],
      healthcare: { enabled: false },
      strategies: { surplusDefaultAccountId: 'cash' },
    });
    const r = projectCompiled(compilePlan(p, data)).records[0];
    expect(r.balances.destination).toBeCloseTo(172000, 2);
    expect(r.balances.cash).toBeCloseTo(0, 2);
    expect(r.debts).toBe(0);
  });
  it('N31 historical effective CPI is independent of the unused manual inflation input', () => {
    const p = sampleBasic(2026);
    p.assumptions.returns.mode = 'historicalAverage';
    const a = projectCompiled(compilePlan(p, data));
    p.assumptions.inflation.rate = 0.09;
    const b = projectCompiled(compilePlan(p, data));
    expect(b.summary.endingNetWorthReal).toBeCloseTo(a.summary.endingNetWorthReal, 3);
  });
});
