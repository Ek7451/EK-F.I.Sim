/** Plain-language outcome of a projection: is spending covered every year, and what is left at the end. */
import type { ProjectionResult, YearRecord } from '@fisim/engine';

/** A year counts as short when spending could not be met by more than a dollar (rounding). */
export const isShort = (r: YearRecord): boolean => r.shortfall > 1;

export interface FundedSummary {
  /** Spending is met in every year of the plan. */
  covered: boolean;
  shortYears: number;
  totalYears: number;
  firstShort: YearRecord | null;
  last: YearRecord;
}

export function fundedSummary(result: ProjectionResult): FundedSummary {
  const recs = result.records;
  const short = recs.filter(isShort);
  return {
    covered: short.length === 0,
    shortYears: short.length,
    totalYears: recs.length,
    firstShort: short[0] ?? null,
    last: recs[recs.length - 1],
  };
}

/** "age 63" or "ages 63 and 61". */
export function agesText(r: YearRecord): string {
  return r.ages.length > 1 ? `ages ${r.ages.join(' and ')}` : `age ${r.ages[0]}`;
}

/** The headline and note for a "Spending covered" stat. */
export function fundedStat(result: ProjectionResult): { value: string; note: string } {
  const f = fundedSummary(result);
  if (f.covered) return { value: 'Every year', note: `Through ${f.last.year} (${agesText(f.last)})` };
  const first = f.firstShort!;
  return {
    value: `Short in ${f.shortYears} of ${f.totalYears} years`,
    note: `Money first runs short in ${first.year} (${agesText(first)})`,
  };
}
