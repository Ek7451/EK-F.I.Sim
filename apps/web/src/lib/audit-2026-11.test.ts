/** Display regressions from the November 2026 accuracy review: what the screen prints must match the figure behind it. */
import { loadEngineData } from '@fisim/data/src/node';
import { project, sampleEarlyRetiree } from '@fisim/engine';
import { formatCompact, formatMoney, formatShare } from '@fisim/ui';
import { describe, expect, it } from 'vitest';
import { short } from '../charts/Chart';
import { cashFlowView } from './metrics/cashFlow';

describe('formatShare', () => {
  it('never rounds a near-certain share to 100% or a rare one to 0%', () => {
    expect(formatShare(0.996)).toBe('99.6%');
    expect(formatShare(0.9999)).toBe('99.9%');
    expect(formatShare(1)).toBe('100%');
    expect(formatShare(0.004)).toBe('0.4%');
    expect(formatShare(0.0001)).toBe('0.1%');
    expect(formatShare(0)).toBe('0%');
    expect(formatShare(0.86)).toBe('86%');
    expect(formatShare(0.994)).toBe('99%');
  });
});

describe('money formats', () => {
  it('a few cents below zero is $0, not -$0', () => {
    expect(formatMoney(-0.4)).toBe('$0');
    expect(formatCompact(-0.3)).toBe('$0');
    expect(formatMoney(-1234)).toBe('-$1,234');
  });
  it('axis labels put the sign first and roll over at each unit', () => {
    expect(short(-1_000_000)).toBe('-$1.0M');
    expect(short(999_500)).toBe('$1.0M');
    expect(short(999_499)).toBe('$999k');
    expect(short(2.5e9)).toBe('$2.5B');
    expect(short(-0.2)).toBe('$0');
    expect(short(41_200)).toBe('$41k');
  });
});

describe('cash-flow groups', () => {
  it('compact groups never share a name across the two sides (a shared name broke the flow diagram)', () => {
    const result = project(sampleEarlyRetiree(2026), loadEngineData());
    let checkedCreditYear = false;
    for (const r of result.records) {
      const v = cashFlowView(r, true);
      const inNames = new Set(v.sources.map((x) => x.label));
      for (const u of v.uses) expect(inNames.has(u.label), `${r.year}: ${u.label}`).toBe(false);
      if (v.sources.some((x) => x.label === 'Tax credits and refunds')) checkedCreditYear = true;
      // The two sides still add up to each other.
      const sum = (xs: { amount: number }[]): number => xs.reduce((n, x) => n + x.amount, 0);
      expect(Math.abs(sum(v.sources) - sum(v.uses))).toBeLessThan(1.01);
    }
    expect(checkedCreditYear).toBe(true);
  });
});
