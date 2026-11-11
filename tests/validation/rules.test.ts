/** V-05 (SSA PIA), V-06 (premium tax credit), V-08 (IRMAA tiers, RMDs). */
import { readFileSync } from 'node:fs';
import {
  applicablePercentage,
  applyColas,
  claimFactor,
  computePia,
  fplAmount,
  fraMonths,
  irmaaTier,
  ownerRmd,
  premiumTaxCredit,
  rmdStartAge,
} from '@fisim/engine';
import { describe, expect, it } from 'vitest';
import { data } from './harness';

interface SsaCase {
  id: string;
  birthYear: number;
  earnings: Record<string, number>;
  expected: {
    aime: number;
    bendPoints: [number, number];
    piaAtEligibility: number;
    piaInJanuary2027: number;
    monthlyBenefit: number;
  };
}
const ssa = JSON.parse(readFileSync(new URL('./fixtures/ssa-pia-2027.json', import.meta.url), 'utf8')) as {
  cases: SsaCase[];
};

describe('V-05 Social Security PIA against SSA worked examples (within $1 per month)', () => {
  for (const c of ssa.cases) {
    it(`case ${c.id}, born ${c.birthYear}`, () => {
      const earnings: Record<number, number> = {};
      for (const y in c.earnings) earnings[+y] = c.earnings[y];
      const r = computePia({
        birthYear: c.birthYear,
        earnings,
        series: data.ssSeries,
        futureWageGrowth: 0.035,
      });
      expect(r.bendPoints).toEqual(c.expected.bendPoints);
      expect(r.aime).toBe(c.expected.aime);
      expect(Math.abs(r.pia - c.expected.piaAtEligibility)).toBeLessThanOrEqual(1);
      const jan2027 = applyColas(r.pia, data.ssSeries, r.eligibilityYear, 2026);
      expect(Math.abs(jan2027 - c.expected.piaInJanuary2027)).toBeLessThanOrEqual(1);
      const fra = fraMonths(data.ssSeries, c.birthYear);
      const claimMonths = c.id === 'A' ? 62 * 12 : fra;
      const benefit = Math.floor(jan2027 * claimFactor(claimMonths, fra));
      expect(Math.abs(benefit - c.expected.monthlyBenefit)).toBeLessThanOrEqual(1);
    });
  }
});

describe('V-06 premium tax credit follows the Form 8962 arithmetic', () => {
  const ap = data.applicablePct[2026];
  const fpl = fplAmount(data.fpl[2025], 'TX', 2);
  it('uses the prior-year poverty guideline for a household of two', () => {
    expect(fpl).toBe(data.fpl[2025].contiguous.base + data.fpl[2025].contiguous.perAdditional);
  });
  it('interpolates the applicable percentage inside a band', () => {
    const band = ap.bands.find((b) => b.fplFrom === 2 && b.fplTo === 2.5)!;
    expect(applicablePercentage(ap, 2.25)).toBeCloseTo((band.initial + band.final) / 2, 10);
    expect(applicablePercentage(ap, 2)).toBeCloseTo(band.initial, 10);
  });
  it('credit = benchmark - applicable % x MAGI, never above the plan premium', () => {
    const magi = 2.25 * fpl;
    const pct = applicablePercentage(ap, 2.25)!;
    expect(premiumTaxCredit(ap, 24000, 30000, magi, fpl)).toBeCloseTo(24000 - pct * magi, 6);
    expect(premiumTaxCredit(ap, 24000, 9000, magi, fpl)).toBe(9000);
  });
  it('applies the 400% cliff in force for 2026 and 2027, and gives nothing below 100%', () => {
    expect(ap.hasCliff).toBe(true);
    expect(premiumTaxCredit(ap, 24000, 24000, 4.0 * fpl, fpl)).toBeGreaterThan(0);
    expect(premiumTaxCredit(ap, 24000, 24000, 4.0 * fpl + 1, fpl)).toBe(0);
    expect(premiumTaxCredit(data.applicablePct[2027], 24000, 24000, 4.01 * fpl, fpl)).toBe(0);
    expect(premiumTaxCredit(ap, 24000, 24000, 0.99 * fpl, fpl)).toBe(0);
  });
  it.todo(
    'SLCSP premiums against HealthCare.gov lookups for sample ZIPs and ages (needs live lookups; not automated)',
  );
});

describe('V-07 unsubsidized ACA cost against the BiggerPockets Money estimator', () => {
  it.todo(
    'compare the unsubsidized premium and out-of-pocket estimate (the estimator has no machine-readable interface; not automated)',
  );
});

describe('V-08 IRMAA tier assignment and RMDs (exact)', () => {
  const m = data.medicare[2026];
  it('assigns every IRMAA tier at and just above each threshold', () => {
    for (const status of ['single', 'mfj', 'mfs'] as const) {
      const table = m.irmaa[status];
      table.forEach((row, i) => {
        if (i === 0) return;
        expect(irmaaTier(m, 1, status, row.magiOver).tier).toBe(i - 1);
        expect(irmaaTier(m, 1, status, row.magiOver + 1).tier).toBe(i);
      });
      expect(irmaaTier(m, 1, status, 0).row.partBMonthly).toBe(m.partB.standardMonthlyPremium);
    }
    expect(irmaaTier(m, 1, 'qss', m.irmaa.mfj[1].magiOver + 1).tier).toBe(1);
    expect(irmaaTier(m, 1, 'hoh', m.irmaa.single[1].magiOver + 1).tier).toBe(1);
  });
  it('RMD = prior year-end balance / Uniform Lifetime Table divisor at every age', () => {
    for (const age of Object.keys(data.rmd.uniformLifetime).map(Number)) {
      if (age < 75) continue;
      expect(ownerRmd(data.rmd, 1940, age, 500000)).toBe(500000 / data.rmd.uniformLifetime[String(age)]);
    }
    expect(data.rmd.uniformLifetime['73']).toBe(26.5);
    expect(data.rmd.uniformLifetime['75']).toBe(24.6);
    expect(data.rmd.uniformLifetime['90']).toBe(12.2);
  });
  it('starts at 73 for people born 1951-1959 and 75 for 1960 or later', () => {
    expect(rmdStartAge(data.rmd, 1955)).toBe(73);
    expect(rmdStartAge(data.rmd, 1959)).toBe(73);
    expect(rmdStartAge(data.rmd, 1960)).toBe(75);
    expect(ownerRmd(data.rmd, 1960, 74, 100000)).toBe(0);
    expect(ownerRmd(data.rmd, 1960, 75, 100000)).toBeGreaterThan(0);
  });
});
