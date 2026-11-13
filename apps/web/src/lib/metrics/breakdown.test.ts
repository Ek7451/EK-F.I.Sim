import { loadEngineData } from '@fisim/data/src/node';
import { project, SAMPLE_PLANS } from '@fisim/engine';
import { describe, expect, it } from 'vitest';
import { buildBreakdown, breakdownTotal, type BreakdownKey } from './breakdown';
import { annualMetrics } from './index';

const data = loadEngineData();
const KEYS: BreakdownKey[] = [
  'spending',
  'living',
  'housing',
  'healthcare',
  'taxes',
  'federal',
  'payroll',
  'state',
  'penalties',
];

describe('category breakdowns', () => {
  it.each(Object.entries(SAMPLE_PLANS))('%s: lines add up to the bar in every year', (_, sample) => {
    const plan = sample(2026);
    const result = project(plan, data);
    result.records.forEach((record, i) => {
      const previous = i > 0 ? result.records[i - 1] : null;
      for (const basis of ['real', 'nominal'] as const) {
        const k = basis === 'real' ? record.cpi : 1;
        for (const key of KEYS) {
          const b = buildBreakdown(key, record, previous, { basis, plan });
          const sum = b.lines.reduce((s, l) => s + l.amount, 0);
          // Lines under 50 cents are dropped from view, so allow that much per possible line.
          expect(Math.abs(sum - b.total), `${record.year} ${key} ${basis}`).toBeLessThan(5.01);
          expect(b.total).toBeCloseTo(breakdownTotal(key, record) / k, 6);
          expect(b.previousYear).toBe(previous?.year ?? null);
          for (const c of b.changes) expect(Number.isFinite(c.delta)).toBe(true);
        }
        // The bars the charts draw.
        expect(buildBreakdown('living', record, previous, { basis }).total).toBeCloseTo(
          record.expenses.living / k,
          6,
        );
        expect(buildBreakdown('housing', record, previous, { basis }).total).toBeCloseTo(
          annualMetrics.housing.nominal(record) / k,
          6,
        );
        expect(buildBreakdown('healthcare', record, previous, { basis }).total).toBeCloseTo(
          record.expenses.healthcare.total / k,
          6,
        );
        expect(buildBreakdown('taxes', record, previous, { basis }).total).toBeCloseTo(
          record.taxes.total / k,
          6,
        );
      }
    });
  });

  it('explains a healthcare jump by the change in coverage', () => {
    const plan = SAMPLE_PLANS['sample-early-retiree'](2026);
    const result = project(plan, data);
    const i = result.records.findIndex(
      (r, k) => k > 0 && r.coverage.some((c, p) => c !== result.records[k - 1].coverage[p]),
    );
    expect(i).toBeGreaterThan(0);
    const b = buildBreakdown('healthcare', result.records[i], result.records[i - 1], {
      basis: 'real',
      plan,
    });
    expect(b.changes.length).toBeGreaterThan(0);
    expect(b.changes.some((c) => /moves from/.test(c.reason ?? ''))).toBe(true);
    expect(b.facts.some((f) => f.label === plan.people[0].name)).toBe(true);
  });

  it('has nothing to compare in the first year', () => {
    const plan = SAMPLE_PLANS['sample-basic'](2026);
    const result = project(plan, data);
    const b = buildBreakdown('taxes', result.records[0], null, { basis: 'real', plan });
    expect(b.changes).toEqual([]);
    expect(b.previousTotal).toBeNull();
  });
});
