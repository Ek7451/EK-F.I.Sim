/** Data injected into the engine (the engine does no I/O, plan 6.1). */
import type { EngineData, FederalTaxParams } from '@fisim/data';

export type { EngineData };

/** Pick the parameter file for `year`: the exact year if present, otherwise the nearest earlier one (or the earliest). */
export function pickYear<T>(byYear: Record<number, T>, year: number): { value: T; dataYear: number } {
  let best = -Infinity;
  let min = Infinity;
  for (const k in byYear) {
    const y = +k;
    if (y <= year && y > best) best = y;
    if (y < min) min = y;
  }
  const dataYear = best === -Infinity ? min : best;
  return { value: byYear[dataYear], dataYear };
}

/**
 * Law-change hooks with effective dates (TAX-13) applied when projecting beyond the last enacted file.
 * Each returns a patched copy of the latest parameters for `year`.
 */
export function projectFederal(latest: FederalTaxParams, year: number): FederalTaxParams {
  if (year <= latest.year) return latest;
  const p: FederalTaxParams = { ...latest, year, header: { ...latest.header, status: 'projected' } };
  // OBBBA senior deduction applies to tax years 2025-2028 only.
  if (year > 2028) p.seniorDeduction = { ...latest.seniorDeduction, perPerson: 0 };
  // OBBBA SALT cap: grows 1% a year through 2029, then reverts to $10,000 in 2030.
  if (year >= 2030) p.salt = { cap: 10000, phaseDownStart: Infinity, phaseDownRate: 0, floor: 10000 };
  else {
    const g = Math.pow(1.01, year - latest.year);
    p.salt = {
      ...latest.salt,
      cap: Math.round(latest.salt.cap * g),
      phaseDownStart: Math.round(latest.salt.phaseDownStart * g),
    };
  }
  return p;
}
