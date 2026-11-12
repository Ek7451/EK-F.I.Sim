/** Life-table helpers (SIM-08). Kept apart from the path generator so the app can show survival odds cheaply. */
import type { MortalityTable } from '@fisim/data';
import type { Rng } from './rng';

/** Death probability at `age`, optionally with annual mortality improvement after the table year (cohort adjustment). */
function qAt(
  table: MortalityTable,
  q: number[],
  age: number,
  improve?: { rate: number; birthYear: number },
): number {
  const base = q[age];
  if (!improve || improve.rate <= 0) return base;
  const yearsAhead = improve.birthYear + age - table.year;
  return yearsAhead > 0 ? base * Math.pow(1 - improve.rate, yearsAhead) : base;
}

/**
 * Sample an age at death from period q(x), conditional on being alive at `ageNow`. With `improve`, each q(x) is
 * reduced by `rate` a year for every calendar year after the table's year in which the person would reach age x
 * (a simple cohort mortality-improvement adjustment, as in the SSA Trustees' projections).
 */
export function sampleDeathAge(
  table: MortalityTable,
  sex: 'male' | 'female',
  ageNow: number,
  rng: Rng,
  improve?: { rate: number; birthYear: number },
): number {
  const q = sex === 'male' ? table.male : table.female;
  for (let age = Math.max(0, ageNow); age < q.length; age++)
    if (rng.next() < qAt(table, q, age, improve)) return age;
  return q.length - 1;
}

/** Probability of surviving from `fromAge` to `toAge` (with the same optional improvement adjustment). */
export function survivalProbability(
  table: MortalityTable,
  sex: 'male' | 'female',
  fromAge: number,
  toAge: number,
  improve?: { rate: number; birthYear: number },
): number {
  const q = sex === 'male' ? table.male : table.female;
  let s = 1;
  for (let a = fromAge; a < toAge && a < q.length; a++) s *= 1 - qAt(table, q, a, improve);
  return s;
}
