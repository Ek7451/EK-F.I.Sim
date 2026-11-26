import type { Coverage } from './schema';
/** Healthcare helpers (§9): FPL, premium tax credit, age rating, cost sharing, Medicare. */
import type {
  AcaAgeCurve,
  AcaCostSharingParams,
  ApplicablePctParams,
  FplParams,
  SlcspStateFile,
} from '@fisim/data';

export function fplAmount(f: FplParams, state: string, householdSize: number): number {
  const t = state === 'AK' ? f.alaska : state === 'HI' ? f.hawaii : f.contiguous;
  return t.base + t.perAdditional * Math.max(0, householdSize - 1);
}

/** Applicable percentage (share of MAGI the household is expected to pay). null = not eligible for a credit. */
export function applicablePercentage(ap: ApplicablePctParams, fplRatio: number): number | null {
  if (fplRatio < ap.minFpl) return null;
  if (ap.hasCliff && fplRatio > ap.cliffFpl) return null;
  for (const b of ap.bands) {
    if (b.fplTo === null || fplRatio < b.fplTo) {
      if (b.fplTo === null) return b.final;
      const t = (fplRatio - b.fplFrom) / (b.fplTo - b.fplFrom);
      return b.initial + (b.final - b.initial) * Math.max(0, Math.min(1, t));
    }
  }
  return ap.bands[ap.bands.length - 1].final;
}

/** Premium tax credit (HC-04): benchmark premium minus the expected contribution, never more than the plan's premium. */
export function premiumTaxCredit(
  ap: ApplicablePctParams,
  slcspAnnual: number,
  planPremiumAnnual: number,
  magi: number,
  fpl: number,
  contributionFraction = 1,
): number {
  if (fpl <= 0 || slcspAnnual <= 0) return 0;
  const pct = applicablePercentage(ap, magi / fpl);
  if (pct === null) return 0;
  return Math.max(
    0,
    Math.min(planPremiumAnnual, slcspAnnual - pct * Math.max(0, magi) * contributionFraction),
  );
}

export function ageRatingFactor(curve: AcaAgeCurve, state: string, age: number): number {
  if (curve.communityRated.includes(state)) return 1;
  const table = curve.states[state] ?? curve.federal;
  const a = Math.max(0, Math.min(64, Math.floor(age)));
  return table[String(a)] ?? curve.federal[String(a)] ?? 1;
}

export function tobaccoRatio(curve: AcaAgeCurve, state: string): number {
  return curve.tobaccoMaxRatio.states[state] ?? curve.tobaccoMaxRatio.default;
}

/** Monthly age-21 benchmark for a county (falls back to the state average); `flagged` when not county-level. */
export function benchmarkAge21(
  file: SlcspStateFile | undefined,
  countyFips: string | undefined,
  overrideMonthly: number | undefined,
): { monthly: number; flagged: boolean; source: string } {
  if (overrideMonthly && overrideMonthly > 0)
    return { monthly: overrideMonthly, flagged: true, source: 'user-entered' };
  if (!file) return { monthly: 0, flagged: true, source: 'missing' };
  const c = countyFips ? file.counties[countyFips] : undefined;
  if (c)
    return { monthly: c.slcspAge21, flagged: file.quality !== 'county', source: `${file.state} ${c.name}` };
  return { monthly: file.stateAverageAge21, flagged: true, source: `${file.state} state average` };
}

/**
 * Expected out-of-pocket cost for one person on a marketplace plan, including CSR on silver at <= 250% FPL (HC-07).
 * CSRs need premium-credit eligibility, so none apply below `minFpl` (100% FPL: the coverage gap in states that did
 * not expand Medicaid).
 */
export function acaExpectedOop(
  cs: AcaCostSharingParams,
  metal: keyof AcaCostSharingParams['tiers'],
  utilization: 'low' | 'typical' | 'high',
  fplRatio: number,
  minFpl = 1,
): number {
  let oopMax = cs.tiers[metal].oopMax;
  let av = cs.tiers[metal].actuarialValue;
  const baseAv = av;
  if (metal === 'silver' && fplRatio >= minFpl) {
    for (const v of cs.csr) {
      if (fplRatio <= v.fplTo) {
        oopMax = v.oopMax;
        av = v.actuarialValue;
        break;
      }
    }
  }
  // Expected spend scales with the share of costs the plan does not cover.
  const share = baseAv < 1 ? (1 - av) / (1 - baseAv) : 1;
  return Math.min(oopMax, cs.utilization[utilization].pctOfOopMax * cs.tiers[metal].oopMax * share);
}

/** Fixed-amortization 72(t) payment: level annual amount over the life expectancy at the given rate. */
export function seppAmortization(balance: number, rate: number, lifeExpectancy: number): number {
  if (balance <= 0 || lifeExpectancy <= 0) return 0;
  if (rate === 0) return balance / lifeExpectancy;
  return (balance * rate) / (1 - Math.pow(1 + rate, -lifeExpectancy));
}

export interface CoveragePeriod {
  type: Coverage['type'];
  entry: Coverage | null;
  first: number;
  months: number;
}
/** Months are zero-based here. Timelines, COBRA expiration, wage coverage and enrollment are independent boundaries. */
export function coveragePeriods(
  timeline: { at: number; entry: Coverage }[],
  year: number,
  ownWageMonths: number,
  spouseWageMonths: number,
  medicareMonth: number,
  enabled: boolean,
): CoveragePeriod[] {
  const periods: CoveragePeriod[] = [];
  if (!enabled) return [{ first: 0, months: 12, type: 'none', entry: null }];
  const start = year * 12;
  const edges = new Set([0, 12]);
  const edge = (month: number) => {
    if (month > 0 && month < 12) edges.add(month);
  };
  edge(ownWageMonths);
  edge(spouseWageMonths);
  edge(medicareMonth - start);
  for (const row of timeline) {
    edge(row.at - start);
    if (row.entry.type === 'cobra') edge(row.at + row.entry.cobraMonths - start);
  }
  const boundaries = [...edges].sort((a, b) => a - b);
  for (let i = 0; i < boundaries.length - 1; i++) {
    const month = boundaries[i],
      months = boundaries[i + 1] - month;
    const now = year * 12 + month;
    let entry: Coverage | null = null;
    let latest = -Infinity;
    for (const row of timeline)
      if (row.at <= now && row.at >= latest) {
        entry = row.entry;
        latest = row.at;
      }
    if (
      (entry?.type === 'employer' && month >= ownWageMonths) ||
      (entry?.type === 'spouseEmployer' && month >= spouseWageMonths) ||
      (entry?.type === 'cobra' && now >= latest + entry.cobraMonths)
    )
      entry = null;
    let type: Coverage['type'] =
      entry?.type ??
      (month < ownWageMonths ? 'employer' : month < spouseWageMonths ? 'spouseEmployer' : 'aca');
    if (
      type !== 'employer' &&
      type !== 'spouseEmployer' &&
      (entry?.autoMedicare ?? (type !== 'none' && type !== 'cobra')) &&
      now >= medicareMonth
    )
      type = 'medicare';
    const last = periods.at(-1);
    if (last?.type === type && last.entry === entry) last.months += months;
    else periods.push({ type, entry, first: month, months });
  }
  return periods;
}
