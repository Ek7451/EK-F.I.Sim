/** Feature-level engine tests: milestones, strategies, healthcare, schema migrations. */
import { readdirSync, readFileSync } from 'node:fs';
import { loadEngineData } from '@fisim/data/src/node';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  applyScenario,
  blankPlan,
  compilePlan,
  loadPlan,
  methodology,
  PlanZ,
  project,
  recordsToCsv,
  runBacktest,
  runMonteCarlo,
  sampleBasic,
  sampleCoupleSs,
  sampleEarlyRetiree,
  SCHEMA_VERSION,
  type Plan,
} from '../src';

const data = loadEngineData();
const D = (n: number): number => Math.round(n * 100);

describe('milestones and triggers (PLAN-08)', () => {
  it('retirement stops the salary and switches health coverage', () => {
    const r = project(sampleBasic(2026), data);
    const retire = r.milestoneYears['m-retire'];
    expect(retire).toBe(1992 + 60);
    const before = r.records.find((x) => x.year === retire - 1)!;
    const after = r.records.find((x) => x.year === retire)!;
    expect(before.income.wages).toBeGreaterThan(0);
    expect(after.income.wages).toBe(0);
    expect(before.coverage[0]).toBe('employer');
    expect(after.coverage[0]).toBe('aca');
    expect(after.milestones).toContain('Retire');
  });
  it('a condition milestone fires the first year the condition holds', () => {
    const p = structuredClone(sampleBasic(2026));
    p.milestones.push({
      id: 'm-half',
      name: 'Half a million',
      kind: 'custom',
      when: { type: 'condition', metric: 'investable', value: D(500000), fiMultiple: 25 },
      effects: [{ type: 'scaleAmount', target: 'expense', targetId: 'e-fun', factor: 2 }],
    });
    const r = project(PlanZ.parse(p), data);
    const y = r.milestoneYears['m-half'];
    expect(y).toBeGreaterThan(2026);
    const rec = r.records.find((x) => x.year === y)!;
    const prev = r.records.find((x) => x.year === y - 1)!;
    expect(prev.investable).toBeGreaterThanOrEqual(500000 * rec.cpi * 0.999);
    expect(rec.expenses.byCategory.travel).toBeGreaterThan(prev.expenses.byCategory.travel * 1.9);
  });
  it('windfalls, relocation and filing-status effects apply in their year', () => {
    const p = structuredClone(sampleBasic(2026));
    p.milestones.push({
      id: 'm-w',
      name: 'Inheritance',
      kind: 'windfall',
      when: { type: 'year', year: 2030 },
      effects: [
        { type: 'windfall', accountId: 'a-brokerage', amount: D(100000), taxable: false },
        { type: 'relocate', state: 'CA' },
        { type: 'filingStatus', status: 'hoh' },
      ],
    });
    const r = project(PlanZ.parse(p), data);
    const y = r.records.find((x) => x.year === 2030)!;
    const prev = r.records.find((x) => x.year === 2029)!;
    expect(y.income.windfall).toBeCloseTo(100000 * y.cpi, 4);
    expect(prev.state).toBe('CO');
    expect(y.state).toBe('CA');
    expect(y.filingStatus).toBe('hoh');
    expect(y.taxes.state).not.toBeCloseTo(prev.taxes.state, 0);
  });
});

describe('cash-flow priorities and early access (PLAN-09, PLAN-12, PLAN-13)', () => {
  it('fills the waterfall in order and matches the employer formula', () => {
    const r = project(sampleBasic(2026), data);
    const y0 = r.records[0];
    // 10% of $92,000 deferred; employer matches 100% of the first 4%.
    expect(y0.contributions.pretax).toBeCloseTo(9200, 2);
    expect(y0.contributions.employer).toBeCloseTo(3680, 2);
    expect(y0.contributions.afterTax).toBeGreaterThan(0);
  });
  it('charges the 10% penalty on early pre-tax withdrawals only when no exception applies', () => {
    const mk = (ruleOf55: boolean, type: 'trad401k' | 'gov457b'): Plan =>
      PlanZ.parse({
        ...blankPlan('x', 'x', 2026, 1970),
        accounts: [{ id: 'a', ownerId: 'p1', name: 'Plan', type, balance: D(900000), ruleOf55 }],
        expenses: [{ id: 'e', name: 'Living', category: 'other', amount: D(50000) }],
        healthcare: { enabled: false },
      });
    const pen = (p: Plan): number => project(p, data).records[0].taxes.penalties;
    expect(pen(mk(false, 'trad401k'))).toBeGreaterThan(5000);
    expect(pen(mk(true, 'trad401k'))).toBe(0); // age 56, separated: Rule of 55
    expect(pen(mk(false, 'gov457b'))).toBe(0);
  });
  it('lets Roth contributions out first, then seasoned conversions, without penalty', () => {
    const p = PlanZ.parse({
      ...blankPlan('x', 'x', 2026, 1980),
      accounts: [
        {
          id: 'r',
          ownerId: 'p1',
          name: 'Roth',
          type: 'rothIra',
          balance: D(300000),
          rothBasis: {
            contributions: D(40000),
            conversions: [
              { year: 2019, amount: D(30000) },
              { year: 2025, amount: D(50000) },
            ],
            firstContributionYear: 2010,
          },
        },
      ],
      expenses: [{ id: 'e', name: 'Living', category: 'other', amount: D(60000) }],
      healthcare: { enabled: false },
    });
    const r = project(p, data);
    expect(r.records[0].taxes.penalties).toBe(0); // 40k basis + 30k seasoned lot cover year one
    expect(r.records[1].taxes.penalties).toBeGreaterThan(0); // then the unseasoned 2025 lot
  });
  it('runs a 72(t) schedule for at least five years without penalty', () => {
    const p = PlanZ.parse({
      ...blankPlan('x', 'x', 2026, 1976),
      accounts: [
        { id: 'a', ownerId: 'p1', name: 'IRA', type: 'tradIra', balance: D(1000000) },
        { id: 'c', ownerId: 'p1', name: 'Cash', type: 'cash', balance: D(400000) },
      ],
      expenses: [{ id: 'e', name: 'Living', category: 'other', amount: D(45000) }],
      strategies: { sepp: [{ accountId: 'a', start: { type: 'year', year: 2026 }, interestRate: 0.05 }] },
      healthcare: { enabled: false },
    });
    const r = project(p, data);
    const first = r.records[0].withdrawals.sepp;
    expect(first).toBeGreaterThan(40000);
    for (let i = 0; i < 9; i++) {
      expect(r.records[i].withdrawals.sepp).toBeCloseTo(first, 4);
      expect(r.records[i].taxes.penalties).toBe(0);
    }
    expect(r.records[10].withdrawals.sepp).toBe(0); // 59 1/2 reached in 2035
  });
});

describe('tax strategies (TAX-06..09, STRAT-01..03)', () => {
  it('bracket-filling conversions stop at the top of the chosen bracket', () => {
    const p = sampleCoupleSs(2026);
    const r = project(p, data);
    const conv = r.records.filter((x) => x.rothConversion > 1000);
    expect(conv.length).toBeGreaterThan(2);
    for (const x of conv) {
      const fed = data.federal[Math.min(2027, x.year)];
      const k = x.year > 2027 ? x.cpi / r.records[1].cpi : 1;
      const top = fed.ordinaryBrackets.mfj.find((b) => b.rate === 0.22)!.upTo! * k;
      expect(x.taxes.ordinaryTaxable).toBeLessThanOrEqual(top + 2);
    }
  });
  it('MAGI targeting keeps marketplace years under the subsidy cliff', () => {
    const r = project(sampleEarlyRetiree(2026), data);
    const aca = r.records.filter((x) => x.coverage.every((c) => c === 'aca'));
    expect(aca.length).toBeGreaterThan(5);
    for (const x of aca) {
      expect(x.taxes.fplRatio).toBeLessThanOrEqual(4.0);
      expect(x.taxes.ptc).toBeGreaterThan(0);
    }
  });
  it('guardrails never breach the floor or ceiling', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 150 }),
        fc.double({ min: 0.5, max: 0.95, noNaN: true }),
        fc.double({ min: 1.05, max: 2, noNaN: true }),
        (start, floor, ceiling) => {
          const p = structuredClone(sampleEarlyRetiree(2026));
          p.strategies.spendingRule = { ...p.strategies.spendingRule, type: 'guardrails', floor, ceiling };
          const c = compilePlan(p, data);
          const b = runBacktest(c, { fromYear: 1871 + start, toYear: 1871 + start });
          expect(b.cohorts.length).toBe(1);
          const res = project(p, data);
          for (const r of res.records) {
            expect(r.spendingMultiplier).toBeGreaterThanOrEqual(floor - 1e-9);
            expect(r.spendingMultiplier).toBeLessThanOrEqual(ceiling + 1e-9);
          }
        },
      ),
      { numRuns: 12 },
    );
  });
  it('reports the estate, step-up and the tax drag on inherited pre-tax accounts', () => {
    const r = project(sampleCoupleSs(2026), data);
    expect(r.estate.value).toBeGreaterThan(0);
    expect(r.estate.heirPretaxDrag).toBeGreaterThanOrEqual(0);
    expect(r.estate.netToHeirs).toBeCloseTo(r.estate.value - r.estate.estateTax - r.estate.heirPretaxDrag, 6);
  });
  it('a survivor files jointly in the year of death, then single', () => {
    const r = project(sampleCoupleSs(2026), data);
    const death = 1963 + 90; // Pat dies at 90
    expect(r.records.find((x) => x.year === death)!.filingStatus).toBe('mfj');
    expect(r.records.find((x) => x.year === death + 1)!.filingStatus).toBe('single');
    expect(r.records.find((x) => x.year === death + 1)!.alive).toEqual([false, true]);
  });
});

describe('healthcare (HC)', () => {
  it('walks employer -> COBRA -> marketplace -> Medicare', () => {
    const r = project(sampleEarlyRetiree(2026), data);
    const seq = r.records.map((x) => x.coverage[0]);
    const order = ['employer', 'cobra', 'aca', 'medicare'];
    let idx = 0;
    for (const s of seq) {
      const i = order.indexOf(s);
      expect(i).toBeGreaterThanOrEqual(idx);
      idx = i;
    }
    expect(new Set(seq)).toEqual(new Set(order));
  });
  it('applies IRMAA from MAGI two years earlier', () => {
    const p = structuredClone(sampleCoupleSs(2026));
    const base = project(p, data);
    p.milestones.push({
      id: 'm-big',
      name: 'Big sale',
      kind: 'windfall',
      when: { type: 'year', year: 2040 },
      effects: [{ type: 'windfall', accountId: 'a-cash', amount: D(900000), taxable: true }],
    });
    const bumped = project(PlanZ.parse(p), data);
    const at = (res: typeof base, y: number): number =>
      res.records.find((x) => x.year === y)!.expenses.healthcare.irmaa;
    expect(at(bumped, 2041)).toBeCloseTo(at(base, 2041), 0);
    expect(at(bumped, 2042)).toBeGreaterThan(at(base, 2042) + 1000);
    expect(at(bumped, 2043)).toBeCloseTo(at(base, 2043), 0);
  });
  it('assumes Medicaid below 138% of the poverty line in an expansion state', () => {
    const p = PlanZ.parse({
      ...blankPlan('x', 'x', 2026, 1975),
      accounts: [
        {
          id: 'c',
          ownerId: 'p1',
          name: 'Cash',
          type: 'cash',
          balance: D(900000),
          fixedYield: { rate: 0, basis: 'nominal' },
        },
      ],
      expenses: [{ id: 'e', name: 'Living', category: 'other', amount: D(30000) }],
    });
    p.people[0].residence = [{ state: 'CO', fromYear: 2026 }];
    const co = project(p, data).records[0];
    expect(co.coverage[0]).toBe('aca');
    expect(co.expenses.healthcare.total).toBe(0);
    p.people[0].residence = [{ state: 'TX', fromYear: 2026 }];
    const tx = project(p, data).records[0];
    expect(tx.expenses.healthcare.premiums).toBeGreaterThan(3000); // coverage gap: full price, no credit
    expect(tx.taxes.ptc).toBe(0);
  });
});

describe('plan schema and migrations (plan 5.2)', () => {
  const dir = new URL('./fixtures/plans/', import.meta.url);
  it('migrates every fixture of every schema version to the latest and validates it', () => {
    let count = 0;
    for (const v of readdirSync(dir)) {
      for (const f of readdirSync(new URL(`${v}/`, dir))) {
        const loaded = loadPlan(JSON.parse(readFileSync(new URL(`${v}/${f}`, dir), 'utf8')));
        expect(loaded.error, `${v}/${f}`).toBeUndefined();
        expect(loaded.plan!.schemaVersion).toBe(SCHEMA_VERSION);
        expect(loaded.migrated).toBe(v !== `v${SCHEMA_VERSION}`);
        expect(project(loaded.plan!, data).records.length).toBeGreaterThan(10);
        count++;
      }
    }
    expect(count).toBeGreaterThanOrEqual(4);
  });
  it('opens a plan from a newer schema read-only', () => {
    const loaded = loadPlan({ ...sampleBasic(2026), schemaVersion: SCHEMA_VERSION + 1 });
    expect(loaded.readOnly).toBe(true);
    expect(loaded.plan).toBeNull();
  });
  it('scenarios apply as overrides without touching the base plan', () => {
    const p = structuredClone(sampleBasic(2026));
    p.scenarios.push({
      id: 's1',
      name: 'Retire at 55',
      patches: [{ path: ['milestones', 1, 'when', 'age'], value: 55 }],
    });
    const s = applyScenario(p, 's1');
    expect((s.milestones[1].when as { age: number }).age).toBe(55);
    expect((p.milestones[1].when as { age: number }).age).toBe(60);
    expect(project(p, data, 's1').summary.retirementYear).toBe(1992 + 55);
  });
});

describe('simulation and reporting', () => {
  it('Monte Carlo reports ordered percentile bands and a success rate', () => {
    const c = compilePlan(sampleBasic(2026), data);
    for (const method of ['bootstrap', 'parametric'] as const) {
      const s = runMonteCarlo(c, { runs: 200, method });
      expect(s.successRate).toBeGreaterThan(0.2);
      expect(s.successRate).toBeLessThanOrEqual(1);
      for (let t = 0; t < s.years.length; t++) {
        expect(s.bands.p10[t]).toBeLessThanOrEqual(s.bands.p25[t] + 1e-6);
        expect(s.bands.p25[t]).toBeLessThanOrEqual(s.bands.p50[t] + 1e-6);
        expect(s.bands.p50[t]).toBeLessThanOrEqual(s.bands.p75[t] + 1e-6);
        expect(s.bands.p75[t]).toBeLessThanOrEqual(s.bands.p90[t] + 1e-6);
      }
      expect(s.endingWealth.length).toBe(200);
    }
  });
  it('stochastic longevity changes how long runs last', () => {
    const c = compilePlan(sampleCoupleSs(2026), data, { stochasticLongevity: true });
    const s = runMonteCarlo(c, { runs: 100, stochasticLongevity: true });
    expect(s.years.length).toBeGreaterThan(20);
    expect(s.runs).toBe(100);
  });
  it('CSV export has one row per year and matches the records', () => {
    const r = project(sampleBasic(2026), data);
    const lines = recordsToCsv(r.records).trim().split('\n');
    expect(lines.length).toBe(r.records.length + 1);
    const head = lines[0].split(',');
    const row = lines[1].split(',');
    expect(+row[head.indexOf('net_worth')]).toBeCloseTo(r.records[0].netWorth, 1);
    expect(+row[head.indexOf('tax_total')]).toBeCloseTo(r.records[0].taxes.total, 1);
  });
  it('every methodology entry cites a dated, versioned source', () => {
    const m = methodology(data, 2026);
    expect(m.length).toBeGreaterThan(10);
    for (const e of m)
      for (const s of e.sources) {
        expect(s.header.source).toMatch(/^https?:/);
        expect(s.header.retrieved).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(['enacted', 'projected']).toContain(s.header.status);
      }
  });
});
