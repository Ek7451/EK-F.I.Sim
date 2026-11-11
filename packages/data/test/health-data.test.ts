import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type {
  AcaAgeCurve,
  AcaCostSharingParams,
  AcaStateRules,
  ApplicablePctParams,
  DataHeader,
  FplParams,
  HealthInflationParams,
  IrmaaTier,
  LtcParams,
  MedicareParams,
  MortalityTable,
  SlcspStateFile,
} from '../src/types';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = <T>(...parts: string[]): T => JSON.parse(readFileSync(join(root, ...parts), 'utf8')) as T;

const STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA',
  'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR',
  'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
]; // prettier-ignore

function checkHeader(file: { header: DataHeader }, schema: string): void {
  const h = file.header;
  expect(h.schema).toBe(schema);
  expect(h.source).toMatch(/^https:\/\//);
  expect(h.publisher.length).toBeGreaterThan(0);
  expect(h.retrieved).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(['enacted', 'projected']).toContain(h.status);
  expect(h.lawRefs.length).toBeGreaterThan(0);
  expect(h.sha256).toMatch(/^[0-9a-f]{64}$/);
  // every file says what the hash covers; when it is the canonical body, it must reproduce
  expect(h.notes).toMatch(/sha256 is of the (raw|canonical JSON body)/);
  if (/sha256 is of the canonical JSON body/.test(h.notes ?? '')) {
    const { header: _header, ...body } = file as { header: DataHeader } & Record<string, unknown>;
    expect(createHash('sha256').update(JSON.stringify(body)).digest('hex')).toBe(h.sha256);
  }
}

const isMoney = (x: number) => Number.isFinite(x) && x >= 0 && Math.abs(x * 100 - Math.round(x * 100)) < 1e-6;

// ---------------------------------------------------------------- Medicare

describe.each([2026, 2027])('health/medicare/%i.json', (year) => {
  const m = load<MedicareParams>('health', 'medicare', `${year}.json`);

  it('has a valid header and year', () => {
    checkHeader(m, 'medicare.v1');
    expect(m.year).toBe(year);
    expect(m.header.notes).toMatch(/editable/i);
  });

  it('has plausible Part A / B / D amounts', () => {
    expect(m.partB.standardMonthlyPremium).toBeGreaterThan(150);
    expect(m.partB.standardMonthlyPremium).toBeLessThan(300);
    expect(m.partB.annualDeductible).toBeGreaterThan(200);
    expect(m.partB.annualDeductible).toBeLessThan(400);
    expect(m.partA.premiumUnder30Quarters).toBeGreaterThan(m.partA.premium30to39Quarters);
    expect(m.partA.premium30to39Quarters).toBeGreaterThan(200);
    expect(m.partA.inpatientDeductible).toBeGreaterThan(1500);
    expect(m.partD.nationalBaseBeneficiaryPremium).toBeGreaterThan(30);
    expect(m.partD.nationalBaseBeneficiaryPremium).toBeLessThan(60);
    expect(m.partD.outOfPocketCap).toBeGreaterThanOrEqual(2000);
    expect(m.partD.deductibleMax).toBeLessThan(m.partD.outOfPocketCap);
  });

  it.each(['single', 'mfj', 'mfs'] as const)('IRMAA %s tiers ascend from zero', (status) => {
    const tiers: IrmaaTier[] = m.irmaa[status];
    expect(tiers.length).toBe(status === 'mfs' ? 3 : 6);
    expect(tiers[0]!.magiOver).toBe(0);
    expect(tiers[0]!.partBMonthly).toBe(m.partB.standardMonthlyPremium);
    expect(tiers[0]!.partDSurchargeMonthly).toBe(0);
    for (let i = 1; i < tiers.length; i++) {
      expect(tiers[i]!.magiOver).toBeGreaterThan(tiers[i - 1]!.magiOver);
      expect(tiers[i]!.partBMonthly).toBeGreaterThan(tiers[i - 1]!.partBMonthly);
      expect(tiers[i]!.partDSurchargeMonthly).toBeGreaterThan(tiers[i - 1]!.partDSurchargeMonthly);
    }
    for (const t of tiers) {
      expect(isMoney(t.partBMonthly)).toBe(true);
      expect(isMoney(t.partDSurchargeMonthly)).toBe(true);
    }
  });

  it('IRMAA statuses are consistent with each other', () => {
    const { single, mfj, mfs } = m.irmaa;
    for (let i = 1; i <= 4; i++) expect(mfj[i]!.magiOver).toBe(2 * single[i]!.magiOver);
    expect(single[5]!.magiOver).toBe(500_000);
    expect(mfj[5]!.magiOver).toBe(750_000);
    single.forEach((t, i) => {
      expect(mfj[i]!.partBMonthly).toBe(t.partBMonthly);
      expect(mfj[i]!.partDSurchargeMonthly).toBe(t.partDSurchargeMonthly);
    });
    // married filing separately: first threshold as single, then straight to the two top tiers
    expect(mfs[1]!.magiOver).toBe(single[1]!.magiOver);
    expect(mfs[2]!.magiOver).toBe(500_000 - single[1]!.magiOver);
    expect(mfs[1]!.partBMonthly).toBe(single[4]!.partBMonthly);
    expect(mfs[2]!.partBMonthly).toBe(single[5]!.partBMonthly);
    // top tier pays 85% of cost vs 25% standard
    expect(single[5]!.partBMonthly / single[0]!.partBMonthly).toBeCloseTo(3.4, 2);
    // Part D surcharge formula: base beneficiary premium x (tier% - 25.5%) / 25.5%
    [9.5, 24.5, 39.5, 54.5, 59.5].forEach((pts, i) => {
      const expected = (m.partD.nationalBaseBeneficiaryPremium * pts) / 25.5;
      expect(Math.abs(single[i + 1]!.partDSurchargeMonthly - expected)).toBeLessThanOrEqual(0.051);
    });
  });

  it('has positive default estimates', () => {
    const d = m.defaults;
    for (const v of [
      d.medigapGMonthlyAt65,
      d.medigapNMonthlyAt65,
      d.advantageMonthly,
      d.advantageTypicalOop,
      d.advantageMaxOop,
      d.partDPlanMonthly,
      d.dentalVisionHearingAnnual,
      d.medigapGTypicalOop,
      d.medigapNTypicalOop,
    ])
      // prettier-ignore
      expect(v).toBeGreaterThan(0);
    expect(d.medigapGMonthlyAt65).toBeGreaterThan(d.medigapNMonthlyAt65);
    expect(d.medigapAgeRating).toBeGreaterThanOrEqual(0);
    expect(d.medigapAgeRating).toBeLessThan(0.1);
    expect(d.advantageTypicalOop).toBeLessThan(d.advantageMaxOop);
    expect(d.partDTypicalOop.low).toBeLessThanOrEqual(d.partDTypicalOop.typical);
    expect(d.partDTypicalOop.typical).toBeLessThanOrEqual(d.partDTypicalOop.high);
    expect(d.partDTypicalOop.high).toBeLessThanOrEqual(m.partD.outOfPocketCap);
  });
});

describe('Medicare 2026 published values', () => {
  const m = load<MedicareParams>('health', 'medicare', '2026.json');
  it('matches the CMS fact sheet', () => {
    expect(m.header.status).toBe('enacted');
    expect(m.partB).toEqual({ standardMonthlyPremium: 202.9, annualDeductible: 283 });
    expect(m.partA).toEqual({
      premiumUnder30Quarters: 565,
      premium30to39Quarters: 311,
      inpatientDeductible: 1736,
    });
    expect(m.irmaa.single.map((t) => t.magiOver)).toEqual([0, 109000, 137000, 171000, 205000, 500000]);
    expect(m.irmaa.single.map((t) => t.partBMonthly)).toEqual([202.9, 284.1, 405.8, 527.5, 649.2, 689.9]);
    expect(m.irmaa.single.map((t) => t.partDSurchargeMonthly)).toEqual([0, 14.5, 37.5, 60.4, 83.3, 91]);
    expect(m.irmaa.mfs.map((t) => t.magiOver)).toEqual([0, 109000, 391000]);
  });
});

// ---------------------------------------------------------------- FPL

describe.each([2025, 2026])('health/fpl/%i.json', (year) => {
  const f = load<FplParams>('health', 'fpl', `${year}.json`);
  it('is shaped and ordered sensibly', () => {
    checkHeader(f, 'fpl.v1');
    expect(f.header.status).toBe('enacted');
    expect(f.year).toBe(year);
    for (const g of [f.contiguous, f.alaska, f.hawaii]) {
      expect(Number.isInteger(g.base)).toBe(true);
      expect(Number.isInteger(g.perAdditional)).toBe(true);
      expect(g.base % 10).toBe(0);
      expect(g.perAdditional).toBeGreaterThan(4000);
      expect(g.perAdditional).toBeLessThan(g.base);
    }
    expect(f.contiguous.base).toBeGreaterThan(14000);
    expect(f.contiguous.base).toBeLessThan(20000);
    expect(f.alaska.base).toBeGreaterThan(f.hawaii.base);
    expect(f.hawaii.base).toBeGreaterThan(f.contiguous.base);
  });
});

it('FPL guidelines rise from 2025 to 2026 and match HHS', () => {
  const a = load<FplParams>('health', 'fpl', '2025.json');
  const b = load<FplParams>('health', 'fpl', '2026.json');
  expect(a.contiguous).toEqual({ base: 15650, perAdditional: 5500 });
  expect(b.contiguous).toEqual({ base: 15960, perAdditional: 5680 });
  expect(b.alaska.base).toBeGreaterThan(a.alaska.base);
  expect(b.hawaii.base).toBeGreaterThan(a.hawaii.base);
});

// ---------------------------------------------------------------- applicable percentage

describe.each([2026, 2027])('health/aca/applicable-pct/%i.json', (year) => {
  const p = load<ApplicablePctParams>('health', 'aca', 'applicable-pct', `${year}.json`);

  it('has contiguous, non-decreasing bands', () => {
    checkHeader(p, 'applicable-pct.v1');
    expect(p.year).toBe(year);
    expect(p.bands.length).toBeGreaterThanOrEqual(5);
    expect(p.bands[0]!.fplFrom).toBeLessThanOrEqual(p.minFpl);
    for (let i = 0; i < p.bands.length; i++) {
      const b = p.bands[i]!;
      const last = i === p.bands.length - 1;
      if (!last) {
        expect(b.fplTo).not.toBeNull();
        expect(p.bands[i + 1]!.fplFrom).toBe(b.fplTo);
        expect(p.bands[i + 1]!.initial).toBeGreaterThanOrEqual(b.initial);
      }
      if (b.fplTo !== null) expect(b.fplTo).toBeGreaterThan(b.fplFrom);
      expect(b.final).toBeGreaterThanOrEqual(b.initial);
      expect(b.initial).toBeGreaterThan(0);
      expect(b.final).toBeLessThan(0.2);
    }
  });

  it('encodes the cliff and the repayment rule consistently', () => {
    expect(p.minFpl).toBe(1);
    const lastTo = p.bands[p.bands.length - 1]!.fplTo;
    if (p.hasCliff) {
      expect(p.cliffFpl).toBe(4);
      expect(lastTo).toBe(p.cliffFpl);
    } else {
      expect(lastTo).toBeNull();
    }
    expect(p.repaymentCaps.length).toBeGreaterThan(0);
    expect(p.repaymentCaps[p.repaymentCaps.length - 1]!.fplTo).toBeNull();
    for (let i = 1; i < p.repaymentCaps.length; i++)
      expect(p.repaymentCaps[i]!.fplTo ?? Infinity).toBeGreaterThan(
        p.repaymentCaps[i - 1]!.fplTo ?? Infinity,
      );
    for (const c of p.repaymentCaps) {
      if (c.single !== null) expect(c.single).toBeGreaterThan(0);
      if (c.other !== null) expect(c.other).toBeGreaterThanOrEqual(c.single ?? 0);
    }
  });
});

it('applicable percentages match Rev. Proc. 2025-25 and 2026-26', () => {
  const a = load<ApplicablePctParams>('health', 'aca', 'applicable-pct', '2026.json');
  const b = load<ApplicablePctParams>('health', 'aca', 'applicable-pct', '2027.json');
  expect(a.bands.map((x) => [x.initial, x.final])).toEqual([[0.021, 0.021], [0.0314, 0.0419], [0.0419, 0.066], [0.066, 0.0844], [0.0844, 0.0996], [0.0996, 0.0996]]); // prettier-ignore
  expect(b.bands.map((x) => [x.initial, x.final])).toEqual([[0.0215, 0.0215], [0.0323, 0.043], [0.043, 0.0678], [0.0678, 0.0866], [0.0866, 0.1022], [0.1022, 0.1022]]); // prettier-ignore
  expect(a.bands.map((x) => x.fplFrom)).toEqual([0, 1.33, 1.5, 2, 2.5, 3]);
});

// ---------------------------------------------------------------- age curve

describe('health/aca/age-curve.json', () => {
  const c = load<AcaAgeCurve>('health', 'aca', 'age-curve.json');
  const ages = Array.from({ length: 65 }, (_, i) => String(i));

  it('federal curve covers 0-64 with 21 -> 1.0 and 64 -> 3.0', () => {
    checkHeader(c, 'aca-age-curve.v1');
    expect(Object.keys(c.federal).sort((a, b) => Number(a) - Number(b))).toEqual(ages);
    expect(c.federal['21']).toBe(1);
    expect(c.federal['64']).toBe(3);
    expect(c.federal['0']).toBe(0.765);
    expect(c.federal['14']).toBe(0.765);
    expect(c.federal['40']).toBe(1.278);
    for (let a = 1; a <= 64; a++)
      expect(c.federal[String(a)]!).toBeGreaterThanOrEqual(c.federal[String(a - 1)]!);
  });

  it('state curves are complete, relative to age 21 and within 3:1', () => {
    expect(Object.keys(c.states).sort()).toEqual(['AL', 'DC', 'MA', 'MN', 'MS', 'OR', 'UT']);
    for (const [st, curve] of Object.entries(c.states)) {
      expect(
        Object.keys(curve).sort((a, b) => Number(a) - Number(b)),
        st,
      ).toEqual(ages);
      expect(curve['21'], st).toBe(1);
      for (let a = 1; a <= 64; a++)
        expect(curve[String(a)]!, st).toBeGreaterThanOrEqual(curve[String(a - 1)]!);
      expect(curve['64']!, st).toBeGreaterThan(1.9);
      expect(curve['64']!, st).toBeLessThanOrEqual(3.0001);
      expect(c.communityRated).not.toContain(st);
    }
    expect(c.states.DC!['64']).toBeCloseTo(2.181 / 0.727, 3);
    expect(c.states.MA!['64']).toBeCloseTo(2.365 / 1.183, 3);
    expect(c.states.UT!['59']).toBe(3);
  });

  it('lists community-rated states and tobacco ratios', () => {
    expect([...c.communityRated].sort()).toEqual(['NY', 'VT']);
    expect(c.tobaccoMaxRatio.default).toBe(1.5);
    for (const [st, r] of Object.entries(c.tobaccoMaxRatio.states)) {
      expect(STATES, st).toContain(st);
      expect(r).toBeGreaterThanOrEqual(1);
      expect(r).toBeLessThanOrEqual(1.5);
    }
    for (const st of c.communityRated) expect(c.tobaccoMaxRatio.states[st]).toBe(1);
  });
});

// ---------------------------------------------------------------- state rules

describe('health/aca/state-rules.json', () => {
  const r = load<AcaStateRules>('health', 'aca', 'state-rules.json');
  it('lists valid, unique states', () => {
    checkHeader(r, 'aca-state-rules.v1');
    for (const list of [r.medicaidExpansion, r.stateBasedExchanges]) {
      expect(new Set(list).size).toBe(list.length);
      for (const st of list) expect(STATES).toContain(st);
    }
    expect(r.medicaidExpansion.length).toBe(41);
    for (const st of ['AL', 'FL', 'GA', 'KS', 'MS', 'SC', 'TN', 'TX', 'WI', 'WY'])
      expect(r.medicaidExpansion).not.toContain(st);
    expect(r.stateBasedExchanges.length).toBeGreaterThanOrEqual(20);
    expect(r.stateBasedExchanges).toContain('CA');
    expect(r.stateBasedExchanges).not.toContain('TX');
    expect(r.medicaidFplThreshold).toBe(1.38);
  });
});

// ---------------------------------------------------------------- cost sharing

describe.each([2026, 2027])('health/aca/cost-sharing/%i.json', (year) => {
  const c = load<AcaCostSharingParams>('health', 'aca', 'cost-sharing', `${year}.json`);
  it('is internally consistent', () => {
    checkHeader(c, 'aca-cost-sharing.v1');
    expect(c.year).toBe(year);
    expect(c.oopMax.family).toBe(2 * c.oopMax.self);
    expect(c.oopMax.self % 50).toBe(0);
    expect(c.oopMax.self).toBeGreaterThan(9000);
    const order = ['catastrophic', 'bronze', 'silver', 'gold', 'platinum'] as const;
    expect(Object.keys(c.tiers).sort()).toEqual([...order].sort());
    for (let i = 0; i < order.length; i++) {
      const t = c.tiers[order[i]!];
      expect(t.actuarialValue).toBeGreaterThan(0.5);
      expect(t.actuarialValue).toBeLessThan(1);
      expect(t.deductible).toBeGreaterThanOrEqual(0);
      expect(t.deductible).toBeLessThanOrEqual(t.oopMax);
      expect(t.oopMax).toBeLessThanOrEqual(c.oopMax.self);
      expect(t.premiumRatioToSilver).toBeGreaterThan(0.3);
      expect(t.premiumRatioToSilver).toBeLessThan(2.5);
      if (i > 0) {
        expect(t.actuarialValue).toBeGreaterThan(c.tiers[order[i - 1]!].actuarialValue);
        expect(t.deductible).toBeLessThanOrEqual(c.tiers[order[i - 1]!].deductible);
      }
    }
    expect(c.tiers.silver.premiumRatioToSilver).toBe(1);
    expect(c.tiers.bronze.premiumRatioToSilver).toBeLessThan(1);
    expect(c.csr.map((v) => v.actuarialValue)).toEqual([0.94, 0.87, 0.73]);
    expect(c.csr.map((v) => v.fplTo)).toEqual([1.5, 2, 2.5]);
    for (let i = 0; i < c.csr.length; i++) {
      const v = c.csr[i]!;
      expect(v.deductible).toBeLessThanOrEqual(v.oopMax);
      expect(v.oopMax).toBeLessThanOrEqual(c.tiers.silver.oopMax);
      expect(v.deductible).toBeLessThanOrEqual(c.tiers.silver.deductible);
      if (i > 0) expect(v.oopMax).toBeGreaterThanOrEqual(c.csr[i - 1]!.oopMax);
    }
    const u = c.utilization;
    expect(u.low.pctOfOopMax).toBeGreaterThanOrEqual(0);
    expect(u.low.pctOfOopMax).toBeLessThan(u.typical.pctOfOopMax);
    expect(u.typical.pctOfOopMax).toBeLessThan(u.high.pctOfOopMax);
    expect(u.high.pctOfOopMax).toBeLessThanOrEqual(1);
    const e = c.employerPremium;
    expect(e.family).toBeGreaterThan(e.single);
    expect(e.employeeShareSingle).toBeLessThan(e.single);
    expect(e.employeeShareFamily).toBeLessThan(e.family);
    expect(e.single).toBeGreaterThan(7000);
  });
});

it('federal out-of-pocket maxima match HHS', () => {
  expect(load<AcaCostSharingParams>('health', 'aca', 'cost-sharing', '2026.json').oopMax).toEqual({ self: 10600, family: 21200 }); // prettier-ignore
  expect(load<AcaCostSharingParams>('health', 'aca', 'cost-sharing', '2027.json').oopMax).toEqual({ self: 12000, family: 24000 }); // prettier-ignore
});

// ---------------------------------------------------------------- SLCSP

const slcspRoot = join(root, 'health', 'aca', 'slcsp');
const slcspYears = existsSync(slcspRoot) ? readdirSync(slcspRoot).filter((d) => /^\d{4}$/.test(d)).sort() : []; // prettier-ignore

describe('health/aca/slcsp', () => {
  it('has plan year 2026', () => {
    expect(slcspYears).toContain('2026');
  });

  describe.each(slcspYears)('plan year %s', (yearDir) => {
    const files = readdirSync(join(slcspRoot, yearDir)).filter((f) => f.endsWith('.json'));
    const all = files.map((f) => ({ f, d: load<SlcspStateFile>('health', 'aca', 'slcsp', yearDir, f) }));
    const sbe = load<AcaStateRules>('health', 'aca', 'state-rules.json').stateBasedExchanges;

    it('covers every state and DC exactly once', () => {
      expect(files.map((f) => f.replace('.json', '')).sort()).toEqual([...STATES].sort());
    });

    it('every file is well formed with positive premiums', () => {
      let counties = 0;
      for (const { f, d } of all) {
        checkHeader(d, 'slcsp-state.v1');
        expect(`${d.state}.json`, f).toBe(f);
        expect(d.year, f).toBe(Number(yearDir));
        expect(d.stateAverageAge21, f).toBeGreaterThan(150);
        expect(d.stateAverageAge21, f).toBeLessThan(2000);
        const entries = Object.entries(d.counties);
        if (d.quality === 'state-average') {
          expect(d.exchange, f).toBe('sbe');
          expect(entries.length, f).toBe(0);
          expect(d.header.status, f).not.toBe('enacted');
          expect(d.header.flags?.stateAverageAge21, f).toBeTruthy();
          if (yearDir === '2027') expect(sbe, f).toContain(d.state);
        } else {
          expect(d.exchange, f).toBe('ffe');
          expect(entries.length, f).toBeGreaterThan(0);
          expect(
            sbe.filter((s) => s !== 'OR'),
            f,
          ).not.toContain(d.state);
          let sum = 0;
          for (const [fips, c] of entries) {
            expect(fips, f).toMatch(/^\d{5}$/);
            expect(c.name.length, `${f} ${fips}`).toBeGreaterThan(0);
            expect(c.slcspAge21, `${f} ${fips}`).toBeGreaterThan(100);
            expect(c.slcspAge21, `${f} ${fips}`).toBeLessThan(2500);
            if (c.lowestBronzeAge21 !== undefined) {
              expect(c.lowestBronzeAge21, `${f} ${fips}`).toBeGreaterThan(50);
              expect(c.lowestBronzeAge21, `${f} ${fips}`).toBeLessThan(2500);
            }
            if (c.lowestGoldAge21 !== undefined) {
              expect(c.lowestGoldAge21, `${f} ${fips}`).toBeGreaterThan(100);
              expect(c.lowestGoldAge21, `${f} ${fips}`).toBeLessThan(3500);
            }
            sum += c.slcspAge21;
          }
          expect(d.stateAverageAge21, f).toBeCloseTo(sum / entries.length, 1);
          counties += entries.length;
        }
      }
      expect(counties).toBeGreaterThan(1500);
    });

    it('county FIPS prefixes belong to the state', () => {
      const prefix: Record<string, string> = { AK: '02', AL: '01', TX: '48', FL: '12', WY: '56', OH: '39' };
      for (const { d } of all) {
        const p = prefix[d.state];
        if (!p || d.quality !== 'county') continue;
        for (const fips of Object.keys(d.counties)) expect(fips.slice(0, 2), d.state).toBe(p);
      }
      const tx = all.find((x) => x.d.state === 'TX')!.d;
      expect(Object.keys(tx.counties).length).toBe(254);
      expect(tx.counties['48201']?.name).toBe('Harris');
    });
  });
});

// ---------------------------------------------------------------- inflation, LTC, mortality

describe('health/inflation.json', () => {
  const h = load<HealthInflationParams>('health', 'inflation.json');
  it('holds plausible growth rates', () => {
    checkHeader(h, 'health-inflation.v1');
    expect(h.defaultNominal).toBeGreaterThan(0.03);
    expect(h.defaultNominal).toBeLessThan(0.08);
    expect(h.excessOverCpi).toBeGreaterThan(0);
    expect(h.excessOverCpi).toBeLessThan(h.defaultNominal);
    expect(h.excessStdDev).toBeGreaterThan(0);
    expect(h.excessStdDev).toBeLessThan(0.1);
    const years = Object.keys(h.nheProjection).map(Number).sort((a, b) => a - b); // prettier-ignore
    expect(years.length).toBeGreaterThanOrEqual(8);
    for (let i = 1; i < years.length; i++) expect(years[i]).toBe(years[i - 1]! + 1);
    for (const g of Object.values(h.nheProjection)) {
      expect(g).toBeGreaterThan(0.02);
      expect(g).toBeLessThan(0.1);
    }
  });
});

describe('health/ltc', () => {
  const dir = join(root, 'health', 'ltc');
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  it.each(files)('%s', (f) => {
    const l = load<LtcParams>('health', 'ltc', f);
    checkHeader(l, 'ltc.v1');
    expect(`${l.year}.json`).toBe(f);
    const c = l.annualCost;
    expect(c.nursingHomePrivate).toBeGreaterThan(c.nursingHomeSemiPrivate);
    expect(c.nursingHomeSemiPrivate).toBeGreaterThan(c.assistedLiving);
    expect(c.assistedLiving).toBeGreaterThan(40_000);
    expect(c.homeCare).toBeGreaterThan(40_000);
    expect(c.nursingHomePrivate).toBeLessThan(250_000);
    for (const [st, x] of Object.entries(l.stateFactor)) {
      expect(STATES).toContain(st);
      expect(x).toBeGreaterThan(0.4);
      expect(x).toBeLessThan(2.5);
    }
    for (const s of [l.incidence.male, l.incidence.female]) {
      expect(s.probability).toBeGreaterThan(0.2);
      expect(s.probability).toBeLessThan(0.8);
      expect(s.avgYears).toBeGreaterThan(0.5);
      expect(s.avgYears).toBeLessThan(6);
    }
    expect(l.incidence.female.probability).toBeGreaterThan(l.incidence.male.probability);
    expect(l.typicalOnsetAge).toBeGreaterThanOrEqual(65);
    expect(l.typicalOnsetAge).toBeLessThanOrEqual(95);
  });
});

describe('mortality', () => {
  const dir = join(root, 'mortality');
  const files = readdirSync(dir).filter((f) => /^ssa-period-\d{4}\.json$/.test(f));
  it('has an SSA period table', () => {
    expect(files.length).toBeGreaterThan(0);
  });
  it.each(files)('%s', (f) => {
    const t = load<MortalityTable>('mortality', f);
    checkHeader(t, 'mortality.v1');
    expect(f).toBe(`ssa-period-${t.year}.json`);
    for (const q of [t.male, t.female]) {
      expect(q.length).toBe(120);
      for (const x of q) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(1);
      }
      // infant mortality, a childhood minimum, then rising through adult ages
      expect(q[0]!).toBeGreaterThan(q[10]!);
      for (let a = 31; a < 120; a++) expect(q[a]!).toBeGreaterThanOrEqual(q[a - 1]!);
      expect(q[119]!).toBeGreaterThan(0.8);
      expect(q[65]!).toBeGreaterThan(0.005);
      expect(q[65]!).toBeLessThan(0.03);
    }
    for (let a = 0; a < 120; a++) expect(t.male[a]!).toBeGreaterThanOrEqual(t.female[a]!);
    // implied period life expectancy at birth is in a sane range
    const e0 = (q: number[]) => {
      let alive = 1;
      let years = 0;
      for (const x of q) {
        years += alive * (1 - x / 2);
        alive *= 1 - x;
      }
      return years;
    };
    expect(e0(t.male)).toBeGreaterThan(72);
    expect(e0(t.male)).toBeLessThan(80);
    expect(e0(t.female)).toBeGreaterThan(78);
    expect(e0(t.female)).toBeLessThan(85);
  });
});
