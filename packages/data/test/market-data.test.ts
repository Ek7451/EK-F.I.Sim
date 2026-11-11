import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { DamodaranHistory, DataHeader, MarketHistory, ReturnAssumptions } from '../src/types';

const marketDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'market');
const load = <T>(name: string): T => JSON.parse(readFileSync(join(marketDir, name), 'utf8')) as T;

const market = load<MarketHistory>('shiller-annual.json');
const damodaran = load<DamodaranHistory>('damodaran.json');
const assumptions = load<ReturnAssumptions>('assumptions.json');

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const geoMean = (xs: number[]) => Math.exp(mean(xs.map((x) => Math.log1p(x)))) - 1;
function correlation(xs: number[], ys: number[]): number {
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) ** 2;
    syy += (ys[i]! - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy);
}
const at = (series: number[], years: number[], year: number): number => {
  const i = years.indexOf(year);
  if (i < 0) throw new Error(`year ${year} not in series`);
  return series[i]!;
};
const expectContiguous = (years: number[]) => {
  for (let i = 1; i < years.length; i++) expect(years[i]).toBe(years[i - 1]! + 1);
};
const expectHeader = (h: DataHeader, schema: string) => {
  expect(h.schema).toBe(schema);
  expect(h.source).toMatch(/^https?:\/\//);
  expect(h.publisher.length).toBeGreaterThan(0);
  expect(h.retrieved).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(h.status).toBe('enacted');
  expect(h.lawRefs).toEqual([]);
  expect(h.sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(h.notes?.length ?? 0).toBeGreaterThan(100);
};

describe('market/shiller-annual.json', () => {
  const { years, usStocks, usBonds, cash, inflation } = market;

  it('has a complete header', () => {
    expectHeader(market.header, 'market-history.v1');
    expect(market.header.notes).toMatch(/January-to-January/);
  });

  it('covers 1871 through a recent complete year with equal-length, contiguous arrays', () => {
    expect(market.startYear).toBe(1871);
    expect(years[0]).toBe(1871);
    expect(years[years.length - 1]).toBeGreaterThanOrEqual(2025);
    expectContiguous(years);
    for (const series of [usStocks, usBonds, cash, inflation]) {
      expect(series).toHaveLength(years.length);
      for (const v of series) expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('keeps every value in a plausible range', () => {
    const within = (series: number[], lo: number, hi: number) => {
      expect(Math.min(...series)).toBeGreaterThanOrEqual(lo);
      expect(Math.max(...series)).toBeLessThan(hi);
    };
    within(usStocks, -0.6, 0.8);
    within(usBonds, -0.25, 0.5);
    within(cash, 0, 0.2);
    within(inflation, -0.2, 0.3);
  });

  it('flags cash as approximated before 1928', () => {
    expect(market.approximatedBefore.cash).toBe(1928);
    expect(market.header.flags?.cash).toMatch(/approximated before 1928/);
  });

  it('matches well-known stock years', () => {
    expect(at(usStocks, years, 1931)).toBeLessThan(-0.3); // Great Depression
    expect(at(usStocks, years, 2008)).toBeLessThan(-0.3); // financial crisis
    expect(at(usStocks, years, 1974)).toBeLessThan(-0.15);
    expect(at(usStocks, years, 1933)).toBeGreaterThan(0.3);
    expect(at(usStocks, years, 1954)).toBeGreaterThan(0.3);
    expect(at(usStocks, years, 1995)).toBeGreaterThan(0.25);
  });

  it('matches well-known bond, cash and inflation years', () => {
    expect(at(usBonds, years, 2008)).toBeGreaterThan(0.1); // flight to quality
    expect(at(usBonds, years, 1982)).toBeGreaterThan(0.25); // yields collapse from the 1981 peak
    expect(at(usBonds, years, 2022)).toBeLessThan(-0.08); // rate shock
    expect(at(cash, years, 1981)).toBeGreaterThan(0.12); // Volcker
    expect(at(cash, years, 2014)).toBeLessThan(0.002); // zero-rate era
    expect(at(inflation, years, 1979)).toBeGreaterThan(0.1);
    expect(at(inflation, years, 1931)).toBeLessThan(-0.05); // deflation
    expect(at(inflation, years, 2021)).toBeGreaterThan(0.06);
  });

  it('has a long-run geometric real stock return of roughly 6-7%', () => {
    const real = usStocks.map((r, i) => (1 + r) / (1 + inflation[i]!) - 1);
    const g = geoMean(real);
    // 7.1% over 1871-2025 with monthly dividend reinvestment; the usual quote is "6.5-7%".
    expect(g).toBeGreaterThan(0.06);
    expect(g).toBeLessThan(0.075);
  });

  it('has sensible long-run nominal means', () => {
    expect(mean(usStocks)).toBeGreaterThan(0.09);
    expect(mean(usStocks)).toBeLessThan(0.13);
    expect(mean(usBonds)).toBeGreaterThan(0.035);
    expect(mean(usBonds)).toBeLessThan(0.06);
    expect(mean(cash)).toBeGreaterThan(0.02);
    expect(mean(cash)).toBeLessThan(0.05);
    expect(mean(usBonds)).toBeGreaterThan(mean(cash));
    expect(mean(inflation)).toBeGreaterThan(0.015);
    expect(mean(inflation)).toBeLessThan(0.035);
  });
});

describe('market/damodaran.json', () => {
  const { years } = damodaran;

  it('has a complete header', () => {
    expectHeader(damodaran.header, 'damodaran-history.v1');
  });

  it('starts in 1928 with equal-length, contiguous arrays', () => {
    expect(years[0]).toBe(1928);
    expect(years[years.length - 1]).toBeGreaterThanOrEqual(2025);
    expectContiguous(years);
    for (const s of [
      damodaran.sp500,
      damodaran.tBill3m,
      damodaran.tBond10y,
      damodaran.baaCorporate,
      damodaran.inflation,
    ]) {
      expect(s).toHaveLength(years.length);
      for (const v of s) expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('matches values Damodaran publishes', () => {
    expect(at(damodaran.sp500, years, 1931)).toBeCloseTo(-0.4384, 3);
    expect(at(damodaran.sp500, years, 2008)).toBeCloseTo(-0.3655, 3);
    expect(at(damodaran.tBond10y, years, 2008)).toBeCloseTo(0.201, 3);
    expect(at(damodaran.tBill3m, years, 1981)).toBeGreaterThan(0.13);
    expect(at(damodaran.baaCorporate, years, 2008)).toBeLessThan(0);
  });
});

describe('shiller-annual vs damodaran cross-check (1928+)', () => {
  // Shiller-based series are January-average to January-average, Damodaran's are December to
  // December, so the match is close but not exact.
  const first = damodaran.years[0]!;
  const last = Math.min(damodaran.years[damodaran.years.length - 1]!, market.years[market.years.length - 1]!);
  const mine = (s: number[]) => s.slice(market.years.indexOf(first), market.years.indexOf(last) + 1);
  const theirs = (s: number[]) => s.slice(0, damodaran.years.indexOf(last) + 1);

  it('constructed 10-year bond series tracks the Damodaran 10-year T-bond return', () => {
    const a = mine(market.usBonds);
    const b = theirs(damodaran.tBond10y);
    expect(a).toHaveLength(b.length);
    expect(correlation(a, b)).toBeGreaterThan(0.9);
    expect(Math.abs(mean(a) - mean(b))).toBeLessThan(0.01);
  });

  it('stocks, cash and inflation track their Damodaran counterparts', () => {
    expect(correlation(mine(market.usStocks), theirs(damodaran.sp500))).toBeGreaterThan(0.9);
    expect(Math.abs(mean(mine(market.usStocks)) - mean(theirs(damodaran.sp500)))).toBeLessThan(0.01);
    expect(correlation(mine(market.cash), theirs(damodaran.tBill3m))).toBeGreaterThan(0.98);
    expect(Math.abs(mean(mine(market.cash)) - mean(theirs(damodaran.tBill3m)))).toBeLessThan(0.005);
    expect(correlation(mine(market.inflation), theirs(damodaran.inflation))).toBeGreaterThan(0.95);
  });

  it('uses the Damodaran T-bill return unchanged for 1928-1933', () => {
    for (let y = 1928; y <= 1933; y++)
      expect(at(market.cash, market.years, y)).toBeCloseTo(at(damodaran.tBill3m, damodaran.years, y), 6);
  });
});

describe('market/assumptions.json', () => {
  const { classes, correlation: corr } = assumptions;

  it('has a complete header that flags the non-ingested classes', () => {
    expectHeader(assumptions.header, 'return-assumptions.v1');
    expect(assumptions.header.flags?.intlStocks).toMatch(/assumption, user-editable/);
    expect(assumptions.header.flags?.reits).toMatch(/assumption, user-editable/);
  });

  it('lists the five classes with a mean and standard deviation each', () => {
    expect(classes).toEqual(['usStocks', 'usBonds', 'cash', 'intlStocks', 'reits']);
    for (const c of classes) {
      expect(assumptions.mean[c]).toBeGreaterThan(0);
      expect(assumptions.mean[c]).toBeLessThan(0.2);
      expect(assumptions.stdDev[c]).toBeGreaterThan(0);
      expect(assumptions.stdDev[c]).toBeLessThan(0.4);
    }
    expect(assumptions.mean.usStocks!).toBeGreaterThan(assumptions.mean.usBonds!);
    expect(assumptions.mean.usBonds!).toBeGreaterThan(assumptions.mean.cash!);
    expect(assumptions.inflationMean).toBeGreaterThan(0.02);
    expect(assumptions.inflationMean).toBeLessThan(0.04);
    expect(assumptions.inflationStdDev).toBeGreaterThan(0);
  });

  it('has a symmetric positive-definite correlation matrix with a unit diagonal', () => {
    const n = classes.length;
    expect(corr).toHaveLength(n);
    for (let i = 0; i < n; i++) {
      expect(corr[i]).toHaveLength(n);
      expect(corr[i]![i]).toBe(1);
      for (let j = 0; j < n; j++) {
        expect(corr[i]![j]).toBe(corr[j]![i]);
        if (i !== j) expect(Math.abs(corr[i]![j]!)).toBeLessThan(1);
      }
    }
    // Cholesky: every pivot must be strictly positive.
    const l = corr.map(() => new Array<number>(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) {
        let s = corr[i]![j]!;
        for (let k = 0; k < j; k++) s -= l[i]![k]! * l[j]![k]!;
        if (i === j) {
          expect(s).toBeGreaterThan(1e-6);
          l[i]![j] = Math.sqrt(s);
        } else {
          l[i]![j] = s / l[j]![j]!;
        }
      }
    }
  });

  it('agrees with the US series it was computed from (1928 onward)', () => {
    const i0 = market.years.indexOf(1928);
    expect(assumptions.mean.usStocks!).toBeCloseTo(mean(market.usStocks.slice(i0)), 3);
    expect(assumptions.mean.usBonds!).toBeCloseTo(mean(market.usBonds.slice(i0)), 3);
    expect(assumptions.mean.cash!).toBeCloseTo(mean(market.cash.slice(i0)), 3);
    expect(corr[0]![1]!).toBeCloseTo(correlation(market.usStocks.slice(i0), market.usBonds.slice(i0)), 3);
  });
});
