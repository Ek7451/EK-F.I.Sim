/** Social Security (PLAN-06): AIME / PIA from an earnings record, claiming-age adjustments, spousal and survivor rules. */
import type { SocialSecuritySeries } from '@fisim/data';

export interface PiaInput {
  birthYear: number;
  /** Nominal covered earnings by calendar year (past record plus projected future earnings). */
  earnings: Record<number, number>;
  series: SocialSecuritySeries;
  /** Nominal AWI growth used past the end of the published series. */
  futureWageGrowth: number;
}

export interface PiaResult {
  /** Year of first eligibility (age 62). */
  eligibilityYear: number;
  aime: number;
  /** Monthly PIA in eligibility-year dollars, before COLAs. */
  pia: number;
  bendPoints: [number, number];
  indexedEarnings: { year: number; nominal: number; indexed: number }[];
}

const AWI_1977 = 9779.44;

function lastYear(rec: Record<string, number>): number {
  let m = -Infinity;
  for (const y in rec) m = Math.max(m, +y);
  return m;
}

/** AWI for a year, extended past the published series at `growth`. */
export function awiFor(series: SocialSecuritySeries, year: number, growth: number): number {
  const v = series.awi[String(year)];
  if (v !== undefined) return v;
  const last = lastYear(series.awi);
  if (year < 1951) return series.awi['1951'];
  return series.awi[String(last)] * Math.pow(1 + growth, year - last);
}

export function wageBaseFor(series: SocialSecuritySeries, year: number, growth: number): number {
  const v = series.wageBase[String(year)];
  if (v !== undefined) return v;
  const last = lastYear(series.wageBase);
  if (year < last) return series.wageBase[String(Math.min(...Object.keys(series.wageBase).map(Number)))];
  // Statutory formula: base grows with AWI (two-year lag), rounded to $300.
  const raw =
    series.wageBase[String(last)] * (awiFor(series, year - 2, growth) / awiFor(series, last - 2, growth));
  return Math.round(raw / 300) * 300;
}

export function bendPointsFor(
  series: SocialSecuritySeries,
  eligibilityYear: number,
  growth: number,
): [number, number] {
  const v = series.bendPoints[String(eligibilityYear)];
  if (v) return v;
  const ratio = awiFor(series, eligibilityYear - 2, growth) / AWI_1977;
  return [Math.round(180 * ratio), Math.round(1085 * ratio)];
}

/** SSA benefit formula: index earnings to the year the worker turns 60, take the top 35 years, apply bend points. */
export function computePia(x: PiaInput): PiaResult {
  const elig = x.birthYear + 62;
  const indexYear = x.birthYear + 60;
  const awiIndex = awiFor(x.series, indexYear, x.futureWageGrowth);
  const rows: { year: number; nominal: number; indexed: number }[] = [];
  for (const key in x.earnings) {
    const year = +key;
    const capped = Math.min(Math.max(0, x.earnings[year]), wageBaseFor(x.series, year, x.futureWageGrowth));
    const factor = year < indexYear ? awiIndex / awiFor(x.series, year, x.futureWageGrowth) : 1;
    rows.push({ year, nominal: capped, indexed: Math.round(capped * factor * 100) / 100 });
  }
  const top = rows
    .map((r) => r.indexed)
    .sort((a, b) => b - a)
    .slice(0, 35);
  const aime = Math.floor(top.reduce((a, b) => a + b, 0) / 420);
  const bp = bendPointsFor(x.series, elig, x.futureWageGrowth);
  const raw =
    0.9 * Math.min(aime, bp[0]) +
    0.32 * Math.max(0, Math.min(aime, bp[1]) - bp[0]) +
    0.15 * Math.max(0, aime - bp[1]);
  const pia = Math.floor(raw * 10 + 1e-9) / 10;
  rows.sort((a, b) => a.year - b.year);
  return { eligibilityYear: elig, aime, pia, bendPoints: bp, indexedEarnings: rows };
}

/** PIA after applying the COLAs from the eligibility year through `throughYear` (SSA truncates to the dime each step). */
export function applyColas(
  pia: number,
  series: SocialSecuritySeries,
  eligibilityYear: number,
  throughYear: number,
): number {
  let v = pia;
  for (let y = eligibilityYear; y <= throughYear; y++) {
    // The series is keyed by the January a COLA was first payable, so December-of-year-y's COLA is under y + 1.
    const c = series.cola[String(y + 1)];
    if (c === undefined) break;
    v = Math.floor(v * (1 + c) * 10 + 1e-9) / 10;
  }
  return v;
}

export function fraMonths(series: SocialSecuritySeries, birthYear: number): number {
  const keys = Object.keys(series.fraMonthsByBirthYear)
    .map(Number)
    .sort((a, b) => a - b);
  let v = series.fraMonthsByBirthYear[String(keys[0])];
  for (const k of keys) if (birthYear >= k) v = series.fraMonthsByBirthYear[String(k)];
  return v;
}

/** Retirement-benefit factor for claiming at `claimMonths` of age given the FRA (early reduction / delayed credits). */
export function claimFactor(claimMonths: number, fra: number): number {
  const m = Math.min(claimMonths, 70 * 12);
  if (m >= fra) return 1 + ((m - fra) * 2) / 300; // 2/3 of 1% per month
  const early = fra - m;
  return 1 - (Math.min(early, 36) * 5) / 900 - (Math.max(0, early - 36) * 5) / 1200;
}

/** Spousal-benefit factor (no delayed credits; 25/36 of 1% for 36 months, then 5/12). */
export function spousalFactor(claimMonths: number, fra: number): number {
  if (claimMonths >= fra) return 1;
  const early = fra - claimMonths;
  return 1 - (Math.min(early, 36) * 25) / 3600 - (Math.max(0, early - 36) * 5) / 1200;
}

/**
 * Survivor-benefit factor (widow(er)'s reduction): 100% at the survivor FRA, falling linearly to 71.5% at age 60
 * (SSA POMS RS 00615.301). `survivorFra` is the FRA for survivors, which runs two birth years behind the retirement FRA.
 */
export function survivorFactor(ageMonths: number, survivorFra: number): number {
  if (ageMonths >= survivorFra) return 1;
  const m = Math.max(720, ageMonths);
  return 1 - (0.285 * (survivorFra - m)) / Math.max(1, survivorFra - 720);
}

/**
 * Survivor benefit (annual) from the deceased's PIA and record, before the survivor's own age reduction is applied:
 * - claimed with delayed credits, or died past FRA without claiming: the PIA plus credits earned up to the claim or
 *   the death (never past 70);
 * - otherwise the full PIA, and if the deceased took a reduced benefit the result is capped at the widow(er)'s limit,
 *   the larger of what they received and 82.5% of the PIA (POMS RS 00615.320).
 */
export function survivorBase(
  piaAnnual: number,
  fra: number,
  claimed: boolean,
  claimMonths: number,
  deathAgeMonths: number,
): { base: number; limit: number } {
  if (piaAnnual <= 0) return { base: 0, limit: 0 };
  const f = claimed
    ? claimFactor(claimMonths, fra)
    : deathAgeMonths > fra
      ? claimFactor(deathAgeMonths, fra)
      : 1;
  if (f < 1) return { base: piaAnnual, limit: Math.max(piaAnnual * f, 0.825 * piaAnnual) };
  return { base: piaAnnual * f, limit: Infinity };
}

/**
 * Annual benefit withheld by the retirement earnings test. In the year FRA is reached only the months before FRA
 * count: earnings are prorated to those months and only those months' benefits can be withheld.
 */
export function earningsTestWithholding(
  annualBenefit: number,
  earnings: number,
  ageMonthsAtYearStart: number,
  fra: number,
  exemptUnderFra: number,
  exemptYearOfFra: number,
): number {
  if (ageMonthsAtYearStart >= fra) return 0;
  if (ageMonthsAtYearStart + 12 > fra) {
    const share = (fra - ageMonthsAtYearStart) / 12;
    return Math.min(annualBenefit * share, Math.max(0, earnings * share - exemptYearOfFra) / 3);
  }
  return Math.min(annualBenefit, Math.max(0, earnings - exemptUnderFra) / 2);
}
