import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type {
  Bracket,
  ByStatus,
  DataHeader,
  FederalTaxParams,
  LimitsParams,
  RmdTables,
  SocialSecurityParams,
  SocialSecuritySeries,
  StateTaxParams,
} from '../src/types';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = <T>(...parts: string[]): T => JSON.parse(readFileSync(join(root, ...parts), 'utf8')) as T;

const STATUSES = ['single', 'mfj', 'mfs', 'hoh'] as const;

const STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA',
  'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR',
  'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
]; // prettier-ignore
const NO_TAX = ['AK', 'FL', 'NV', 'NH', 'SD', 'TN', 'TX', 'WA', 'WY'];

function checkHeader(file: { header: DataHeader }, schema: string): void {
  const h = file.header;
  expect(h.schema).toBe(schema);
  expect(h.source).toMatch(/^https:\/\//);
  expect(h.publisher.length).toBeGreaterThan(0);
  expect(h.retrieved).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(['enacted', 'projected']).toContain(h.status);
  expect(Array.isArray(h.lawRefs)).toBe(true);
  expect(h.lawRefs.length).toBeGreaterThan(0);
  expect(h.sha256).toMatch(/^[0-9a-f]{64}$/);
  // every file says what the hash covers; when it is the canonical body, it must reproduce
  expect(h.notes).toMatch(/sha256 is of the (raw|canonical JSON body)/);
  if (/sha256 is of the canonical JSON body/.test(h.notes ?? '')) {
    const { header: _header, ...body } = file as { header: DataHeader } & Record<string, unknown>;
    expect(createHash('sha256').update(JSON.stringify(body)).digest('hex')).toBe(h.sha256);
  }
  // an unverified field may never ship in a file marked enacted
  const unverified = Object.values(h.flags ?? {}).some((v) => /unverified/i.test(v));
  if (unverified) expect(h.status).toBe('projected');
}

function checkBrackets(brackets: Bracket[], allowEmpty = false): void {
  if (allowEmpty && brackets.length === 0) return;
  expect(brackets.length).toBeGreaterThan(0);
  expect(brackets[brackets.length - 1]!.upTo).toBeNull();
  let prev = 0;
  brackets.forEach((b, i) => {
    expect(b.rate).toBeGreaterThanOrEqual(0);
    expect(b.rate).toBeLessThanOrEqual(1);
    if (i < brackets.length - 1) {
      expect(typeof b.upTo).toBe('number');
      expect(b.upTo as number).toBeGreaterThan(prev);
      prev = b.upTo as number;
    }
  });
}

function checkByStatus<T>(obj: ByStatus<T>, each: (v: T) => void): void {
  expect(Object.keys(obj).sort()).toEqual([...STATUSES].sort());
  for (const s of STATUSES) each(obj[s]);
}

const isRate = (x: number) => typeof x === 'number' && x >= 0 && x <= 1;
const isDollars = (x: number) => Number.isInteger(x) && x >= 0;

// ---------------------------------------------------------------- federal

describe.each([2026, 2027])('tax/us-federal/%i.json', (year) => {
  const f = load<FederalTaxParams>('tax', 'us-federal', `${year}.json`);

  it('has a valid header and year', () => {
    checkHeader(f, 'federal-tax.v1');
    expect(f.year).toBe(year);
  });

  it('has seven ascending ordinary brackets per status with TCJA rates', () => {
    checkByStatus(f.ordinaryBrackets, (b) => {
      checkBrackets(b);
      expect(b.map((x) => x.rate)).toEqual([0.1, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37]);
    });
    // MFJ 10% and 12% brackets are exactly double single
    expect(f.ordinaryBrackets.mfj[0]!.upTo).toBe(2 * (f.ordinaryBrackets.single[0]!.upTo as number));
    expect(f.ordinaryBrackets.mfj[1]!.upTo).toBe(2 * (f.ordinaryBrackets.single[1]!.upTo as number));
  });

  it('has three capital-gains brackets per status (0/15/20)', () => {
    checkByStatus(f.capitalGainsBrackets, (b) => {
      checkBrackets(b);
      expect(b.map((x) => x.rate)).toEqual([0, 0.15, 0.2]);
    });
  });

  it('has plausible deductions, credits and thresholds', () => {
    checkByStatus(f.standardDeduction, (v) => expect(isDollars(v)).toBe(true));
    expect(f.standardDeduction.mfj).toBe(2 * f.standardDeduction.single);
    expect(f.standardDeduction.mfs).toBe(f.standardDeduction.single);
    expect(f.additionalStandardDeduction.unmarried).toBeGreaterThan(f.additionalStandardDeduction.married);
    expect(f.seniorDeduction).toEqual({
      perPerson: 6000,
      phaseoutStart: { single: 75000, mfj: 150000 },
      phaseoutRate: 0.06,
    });
    expect(f.salt.phaseDownRate).toBe(0.3);
    expect(f.salt.floor).toBe(10000);
    expect(f.niit).toEqual({
      rate: 0.038,
      threshold: { single: 200000, mfj: 250000, mfs: 125000, hoh: 200000 },
    });
    checkByStatus(f.amt.exemption, (v) => expect(isDollars(v)).toBe(true));
    checkByStatus(f.amt.phaseoutStart, (v) => expect(isDollars(v)).toBe(true));
    expect(f.amt.phaseoutRate).toBe(0.5);
    expect(f.amt.rates).toEqual([0.26, 0.28]);
    checkByStatus(f.childTaxCredit.phaseoutStart, (v) => expect(isDollars(v)).toBe(true));
    expect(f.childTaxCredit.otherDependent).toBe(500);
    expect(f.childTaxCredit.refundableRate).toBe(0.15);
    expect(f.childTaxCredit.refundableMax).toBeLessThan(f.childTaxCredit.perChild);
    expect(f.fica.socialSecurityRate).toBe(0.062);
    expect(f.fica.medicareRate).toBe(0.0145);
    expect(f.fica.additionalMedicareRate).toBe(0.009);
    expect(f.fica.seNetEarningsFactor).toBe(0.9235);
    checkByStatus(f.fica.additionalMedicareThreshold, (v) => expect(isDollars(v)).toBe(true));
    expect(f.socialSecurityTaxation.base).toEqual({ single: 25000, mfj: 32000, mfs: 0, hoh: 25000 });
    expect(f.socialSecurityTaxation.adjusted).toEqual({ single: 34000, mfj: 44000, mfs: 0, hoh: 34000 });
    expect(f.capitalLossLimit).toEqual({ default: 3000, mfs: 1500 });
    expect(f.estate.rate).toBe(0.4);
    expect(f.homeSaleExclusion).toEqual({ single: 250000, mfj: 500000 });
    expect(f.penalties).toEqual({ earlyRetirement: 0.1, hsaNonQualified: 0.2, education529: 0.1 });
  });

  it('lists indexed fields that exist, and leaves frozen ones out', () => {
    expect(f.indexed.length).toBeGreaterThan(5);
    for (const path of f.indexed) {
      const v = path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], f);
      expect(v, path).toBeDefined();
    }
    for (const frozen of [
      'niit',
      'socialSecurityTaxation',
      'homeSaleExclusion',
      'fica.additionalMedicareThreshold',
    ]) {
      expect(f.indexed.some((p) => p === frozen || p.startsWith(`${frozen}.`))).toBe(false);
    }
    for (const must of [
      'ordinaryBrackets',
      'standardDeduction',
      'capitalGainsBrackets',
      'estate.exemption',
    ]) {
      expect(f.indexed).toContain(must);
    }
  });
});

describe('federal spot checks', () => {
  const f26 = load<FederalTaxParams>('tax', 'us-federal', '2026.json');
  const f27 = load<FederalTaxParams>('tax', 'us-federal', '2027.json');

  it('2026 matches Rev. Proc. 2025-32 / OBBBA', () => {
    expect(f26.header.status).toBe('enacted');
    expect(f26.standardDeduction).toEqual({ single: 16100, mfj: 32200, mfs: 16100, hoh: 24150 });
    expect(f26.ordinaryBrackets.single.map((b) => b.upTo)).toEqual([
      12400,
      50400,
      105700,
      201775,
      256225,
      640600,
      null,
    ]);
    expect(f26.ordinaryBrackets.mfj.map((b) => b.upTo)).toEqual([
      24800,
      100800,
      211400,
      403550,
      512450,
      768700,
      null,
    ]);
    expect(f26.capitalGainsBrackets.mfj.map((b) => b.upTo)).toEqual([98900, 613700, null]);
    expect(f26.salt).toEqual({ cap: 40400, phaseDownStart: 505000, phaseDownRate: 0.3, floor: 10000 });
    expect(f26.amt.exemption.mfj).toBe(140200);
    expect(f26.amt.phaseoutStart.mfj).toBe(1000000);
    expect(f26.childTaxCredit.perChild).toBe(2200);
    expect(f26.estate.exemption).toBe(15000000);
    expect(f26.giftExclusion).toBe(19000);
    expect(f26.fica.socialSecurityWageBase).toBe(184500);
  });

  it('2027 is at or above 2026 on every indexed amount', () => {
    for (const s of STATUSES) {
      expect(f27.standardDeduction[s]).toBeGreaterThan(f26.standardDeduction[s]);
      f27.ordinaryBrackets[s].slice(0, -1).forEach((b, i) => {
        expect(b.upTo as number).toBeGreaterThan(f26.ordinaryBrackets[s][i]!.upTo as number);
      });
      expect(f27.amt.exemption[s]).toBeGreaterThan(f26.amt.exemption[s]);
    }
    expect(f27.salt.cap).toBe(Math.round(f26.salt.cap * 1.01));
    expect(f27.estate.exemption).toBeGreaterThan(f26.estate.exemption);
    expect(f27.fica.socialSecurityWageBase).toBe(192300);
  });
});

// ---------------------------------------------------------------- limits

describe.each([2026, 2027])('limits/%i.json', (year) => {
  const l = load<LimitsParams>('limits', `${year}.json`);

  it('has a valid header and year', () => {
    checkHeader(l, 'limits.v1');
    expect(l.year).toBe(year);
  });

  it('has internally consistent limits', () => {
    for (const v of [
      l.electiveDeferral,
      l.catchUp50,
      l.catchUp60to63,
      l.rothCatchUpWageThreshold,
      l.annualAdditions,
      l.compensationCap,
    ]) {
      expect(isDollars(v)).toBe(true);
    }
    expect(l.catchUp60to63).toBeGreaterThanOrEqual(l.catchUp50);
    expect(l.annualAdditions).toBeGreaterThan(l.electiveDeferral);
    expect(l.compensationCap).toBeGreaterThan(l.annualAdditions);
    expect(l.sep.limit).toBe(l.annualAdditions);
    expect(l.sep.pctOfCompensation).toBe(0.25);
    expect(l.simple.limit).toBeLessThan(l.electiveDeferral);
    expect(l.simple.catchUp60to63).toBeGreaterThanOrEqual(l.simple.catchUp50);
    for (const range of [
      l.rothIraPhaseout.single,
      l.rothIraPhaseout.mfj,
      l.rothIraPhaseout.mfs,
      l.tradIraDeductionPhaseout.single,
      l.tradIraDeductionPhaseout.mfj,
      l.tradIraDeductionPhaseout.mfjSpouseNotCovered,
      l.tradIraDeductionPhaseout.mfs,
    ]) {
      expect(range).toHaveLength(2);
      expect(range[1]).toBeGreaterThan(range[0]);
    }
    expect(l.rothIraPhaseout.mfs).toEqual([0, 10000]);
    expect(l.tradIraDeductionPhaseout.mfs).toEqual([0, 10000]);
    expect(l.hsa.family).toBeGreaterThan(l.hsa.self);
    expect(l.hsa.catchUp55).toBe(1000);
    expect(l.hsa.hdhpMinDeductible.family).toBe(2 * l.hsa.hdhpMinDeductible.self);
    expect(l.hsa.hdhpMaxOop.family).toBe(2 * l.hsa.hdhpMaxOop.self);
    expect(l.rollover529ToRoth).toEqual({ lifetimeCap: 35000, minAccountAgeYears: 15 });
    expect(l.iBondPurchaseCap).toBe(10000);
  });
});

describe('limits spot checks', () => {
  it('2026 matches Notice 2025-67 and Rev. Proc. 2025-19', () => {
    const l = load<LimitsParams>('limits', '2026.json');
    expect(l.header.status).toBe('enacted');
    expect(l.electiveDeferral).toBe(24500);
    expect(l.catchUp50).toBe(8000);
    expect(l.catchUp60to63).toBe(11250);
    expect(l.annualAdditions).toBe(72000);
    expect(l.compensationCap).toBe(360000);
    expect(l.ira).toEqual({ limit: 7500, catchUp50: 1100 });
    expect(l.rothIraPhaseout.mfj).toEqual([242000, 252000]);
    expect(l.hsa.self).toBe(4400);
    expect(l.hsa.family).toBe(8750);
  });

  it('2027 is not below 2026 and has final HSA amounts', () => {
    const a = load<LimitsParams>('limits', '2026.json');
    const b = load<LimitsParams>('limits', '2027.json');
    expect(b.electiveDeferral).toBeGreaterThanOrEqual(a.electiveDeferral);
    expect(b.annualAdditions).toBeGreaterThanOrEqual(a.annualAdditions);
    expect(b.ira.limit).toBeGreaterThanOrEqual(a.ira.limit);
    expect(b.hsa.self).toBe(4500);
    expect(b.hsa.family).toBe(9000);
    // projected values must be flagged
    if (b.header.status === 'projected')
      expect(Object.keys(b.header.flags ?? {})).toContain('electiveDeferral');
  });
});

// ---------------------------------------------------------------- social security

describe.each([2026, 2027])('ss/%i.json', (year) => {
  const s = load<SocialSecurityParams>('ss', `${year}.json`);
  const series = load<SocialSecuritySeries>('ss', 'series.json');

  it('has a valid header and plausible values', () => {
    checkHeader(s, 'social-security.v1');
    expect(s.year).toBe(year);
    expect(s.cola).toBeGreaterThanOrEqual(0);
    expect(s.cola).toBeLessThan(0.2);
    expect(s.piaFactors).toEqual([0.9, 0.32, 0.15]);
    expect(s.bendPoints[1]).toBeGreaterThan(s.bendPoints[0]);
    expect(s.earningsTest.yearOfFra).toBeGreaterThan(s.earningsTest.underFra);
    expect(s.earningsTest.underFra % 12).toBe(0);
    expect(s.wageBase % 300).toBe(0);
    expect(s.quarterOfCoverage % 10).toBe(0);
  });

  it('agrees with the long series and the federal file', () => {
    expect(series.wageBase[String(year)]).toBe(s.wageBase);
    expect(series.bendPoints[String(year)]).toEqual(s.bendPoints);
    expect(series.cola[String(year)]).toBe(s.cola);
    expect(load<FederalTaxParams>('tax', 'us-federal', `${year}.json`).fica.socialSecurityWageBase).toBe(
      s.wageBase,
    );
  });
});

describe('ss/series.json', () => {
  const s = load<SocialSecuritySeries>('ss', 'series.json');
  const years = (o: Record<string, unknown>) =>
    Object.keys(o)
      .map(Number)
      .sort((a, b) => a - b);
  const contiguous = (ys: number[]) => ys.every((y, i) => i === 0 || y === ys[i - 1]! + 1);

  it('has a valid header', () => checkHeader(s, 'social-security-series.v1'));

  it('has contiguous series from the documented start years', () => {
    const awi = years(s.awi);
    expect(awi[0]).toBe(1951);
    expect(awi[awi.length - 1]).toBeGreaterThanOrEqual(2025);
    expect(contiguous(awi)).toBe(true);
    const wb = years(s.wageBase);
    expect(wb[0]).toBe(1951);
    expect(wb[wb.length - 1]).toBeGreaterThanOrEqual(2027);
    expect(contiguous(wb)).toBe(true);
    const cola = years(s.cola);
    expect(cola[0]).toBe(1976); // SSA's 1975 COLA, keyed by the January it was first payable for
    expect(contiguous(cola)).toBe(true);
    const bp = years(s.bendPoints);
    expect(bp[0]).toBe(1979);
    expect(contiguous(bp)).toBe(true);
  });

  it('has sane values', () => {
    for (const v of Object.values(s.awi)) expect(v).toBeGreaterThan(2000);
    const wb = years(s.wageBase).map((y) => s.wageBase[String(y)]!);
    wb.forEach((v, i) => expect(v).toBeGreaterThanOrEqual(i ? wb[i - 1]! : 0));
    for (const v of Object.values(s.cola)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(0.2);
    }
    for (const [a, b] of Object.values(s.bendPoints)) expect(b).toBeGreaterThan(a);
    expect(s.trusteesShortfall.depletionYear).toBeGreaterThan(2026);
    expect(s.trusteesShortfall.depletionYear).toBeLessThan(2050);
    expect(s.trusteesShortfall.payablePct).toBeGreaterThan(0.5);
    expect(s.trusteesShortfall.payablePct).toBeLessThan(1);
  });

  it('spot-checks well-known values', () => {
    expect(s.awi['1951']).toBe(2799.16);
    expect(s.awi['2020']).toBe(55628.6);
    expect(s.awi['2023']).toBe(66621.8);
    expect(s.wageBase['1951']).toBe(3600);
    expect(s.wageBase['2023']).toBe(160200);
    expect(s.wageBase['2025']).toBe(176100);
    expect(s.cola['2023']).toBe(0.087); // the 8.7% COLA paid from January 2023
    expect(s.cola['2010']).toBe(0);
    expect(s.cola['1981']).toBe(0.143);
    expect(s.bendPoints['1979']).toEqual([180, 1085]);
    expect(s.bendPoints['2025']).toEqual([1226, 7391]);
    expect(s.fraMonthsByBirthYear['1937']).toBe(65 * 12);
    expect(s.fraMonthsByBirthYear['1943']).toBe(66 * 12);
    expect(s.fraMonthsByBirthYear['1954']).toBe(66 * 12);
    expect(s.fraMonthsByBirthYear['1957']).toBe(66 * 12 + 6);
    expect(s.fraMonthsByBirthYear['1960']).toBe(67 * 12);
  });
});

// ---------------------------------------------------------------- RMD

describe('tax/rmd/tables.json', () => {
  const r = load<RmdTables>('tax', 'rmd', 'tables.json');

  it('has a valid header', () => checkHeader(r, 'rmd-tables.v1'));

  it('has complete, decreasing tables', () => {
    for (let a = 72; a <= 120; a++) expect(typeof r.uniformLifetime[String(a)], `ULT ${a}`).toBe('number');
    for (let a = 0; a <= 120; a++) expect(typeof r.singleLife[String(a)], `SLE ${a}`).toBe('number');
    for (let a = 73; a <= 120; a++)
      expect(r.uniformLifetime[String(a)]!).toBeLessThan(r.uniformLifetime[String(a - 1)]!);
    for (let a = 1; a <= 120; a++)
      expect(r.singleLife[String(a)]!).toBeLessThanOrEqual(r.singleLife[String(a - 1)]!);
  });

  it('spot-checks well-known values', () => {
    expect(r.uniformLifetime['72']).toBe(27.4);
    expect(r.uniformLifetime['73']).toBe(26.5);
    expect(r.uniformLifetime['75']).toBe(24.6);
    expect(r.uniformLifetime['80']).toBe(20.2);
    expect(r.uniformLifetime['90']).toBe(12.2);
    expect(r.uniformLifetime['100']).toBe(6.4);
    expect(r.uniformLifetime['120']).toBe(2.0);
    expect(r.singleLife['0']).toBe(84.6);
    expect(r.singleLife['50']).toBe(36.2);
    expect(r.singleLife['72']).toBe(17.2);
    expect(r.singleLife['90']).toBe(5.7);
    expect(r.singleLife['120']).toBe(1.0);
  });

  it('has SECURE 2.0 start ages', () => {
    expect(r.startAge).toEqual([
      { bornThrough: 1950, age: 72 },
      { bornThrough: 1959, age: 73 },
      { bornThrough: null, age: 75 },
    ]);
  });
});

// ---------------------------------------------------------------- states

describe('state income tax 2026', () => {
  it('has a file for every state and DC', () => {
    for (const st of STATES)
      expect(existsSync(join(root, 'tax', `us-${st.toLowerCase()}`, '2026.json')), st).toBe(true);
  });

  describe.each(STATES)('tax/us-%s/2026.json', (st) => {
    const s = load<StateTaxParams>('tax', `us-${st.toLowerCase()}`, '2026.json');

    it('matches the contract', () => {
      checkHeader(s, 'state-tax.v1');
      expect(s.year).toBe(2026);
      expect(s.state).toBe(st);
      expect(s.name.length).toBeGreaterThan(3);
      expect(['none', 'flat', 'graduated']).toContain(s.kind);
      checkByStatus(s.brackets, (b) => checkBrackets(b, s.kind === 'none'));
      checkByStatus(s.standardDeduction, (v) => expect(isDollars(v)).toBe(true));
      expect(isDollars(s.personalExemption)).toBe(true);
      expect(isDollars(s.personalExemptionCredit)).toBe(true);
      expect(isDollars(s.seniorExtraDeduction)).toBe(true);
      expect(['federalAGI', 'federalTaxableIncome']).toContain(s.startingPoint);
      expect(typeof s.taxesSocialSecurity).toBe('boolean');
      const amt = s.retirementIncomeExclusion.amountPerPerson;
      expect(amt === 'all' || isDollars(amt)).toBe(true);
      expect(s.retirementIncomeExclusion.minAge).toBeGreaterThanOrEqual(0);
      expect(s.retirementIncomeExclusion.minAge).toBeLessThan(100);
      expect(isRate(s.longTermGainExclusionPct)).toBe(true);
      expect(typeof s.indexed).toBe('boolean');
      for (const x of s.surtax ?? []) {
        expect(isDollars(x.threshold)).toBe(true);
        expect(isRate(x.rate)).toBe(true);
      }
    });

    it('has brackets consistent with its kind', () => {
      if (s.kind === 'none') {
        for (const k of STATUSES) expect(s.brackets[k]).toEqual([]);
      } else if (s.kind === 'flat') {
        // one positive rate, optionally preceded by a 0% band
        for (const k of STATUSES) {
          const positive = s.brackets[k].filter((b) => b.rate > 0);
          expect(positive).toHaveLength(1);
          expect(s.brackets[k].length).toBeLessThanOrEqual(2);
        }
      } else {
        for (const k of STATUSES) expect(s.brackets[k].length).toBeGreaterThan(1);
      }
      // no state has a top marginal rate above 15%
      for (const k of STATUSES) for (const b of s.brackets[k]) expect(b.rate).toBeLessThan(0.15);
    });
  });

  it('classifies the no-income-tax states as none', () => {
    const none = STATES.filter(
      (st) => load<StateTaxParams>('tax', `us-${st.toLowerCase()}`, '2026.json').kind === 'none',
    );
    expect(none.sort()).toEqual([...NO_TAX].sort());
  });

  it('spot-checks well-known values', () => {
    const st = (c: string) => load<StateTaxParams>('tax', `us-${c}`, '2026.json');
    const top = (s: StateTaxParams) => s.brackets.single[s.brackets.single.length - 1]!.rate;
    expect(top(st('ca'))).toBe(0.123);
    expect(st('ca').surtax).toEqual([{ threshold: 1000000, rate: 0.01 }]);
    expect(top(st('ny'))).toBe(0.109);
    expect(top(st('nj'))).toBe(0.1075);
    expect(top(st('ma'))).toBe(0.05);
    expect(st('ma').surtax).toEqual([{ threshold: 1107750, rate: 0.04 }]);
    expect(top(st('il'))).toBe(0.0495);
    expect(top(st('pa'))).toBe(0.0307);
    expect(top(st('mi'))).toBe(0.0425);
    expect(top(st('co'))).toBe(0.044);
    expect(top(st('nc'))).toBe(0.0399);
    expect(top(st('va'))).toBe(0.0575);
    expect(top(st('mn'))).toBe(0.0985);
    expect(top(st('or'))).toBe(0.099);
    expect(top(st('hi'))).toBe(0.11);
    expect(top(st('dc'))).toBe(0.1075);
    expect(st('il').retirementIncomeExclusion.amountPerPerson).toBe('all');
    expect(st('pa').retirementIncomeExclusion.amountPerPerson).toBe('all');
    expect(st('ca').taxesSocialSecurity).toBe(false);
    expect(st('mn').taxesSocialSecurity).toBe(true);
    expect(st('co').startingPoint).toBe('federalTaxableIncome');
  });
});
