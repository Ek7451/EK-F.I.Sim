/** Required minimum distributions (TAX-06) and IRMAA tiers (TAX-10). */
import type { IrmaaTier, MedicareParams, RmdTables, FilingStatus } from '@fisim/data';

export function rmdStartAge(t: RmdTables, birthYear: number): number {
  for (const row of t.startAge) if (row.bornThrough === null || birthYear <= row.bornThrough) return row.age;
  return t.startAge[t.startAge.length - 1].age;
}

function lookup(table: Record<string, number>, age: number): number {
  const v = table[String(age)];
  if (v !== undefined) return v;
  const keys = Object.keys(table).map(Number);
  const max = Math.max(...keys);
  const min = Math.min(...keys);
  return age > max ? table[String(max)] : table[String(min)];
}

/** RMD for an owner's own pre-tax account: prior year-end balance / Uniform Lifetime divisor. */
export function ownerRmd(t: RmdTables, birthYear: number, age: number, priorYearEndBalance: number): number {
  if (age < rmdStartAge(t, birthYear) || priorYearEndBalance <= 0) return 0;
  return priorYearEndBalance / lookup(t.uniformLifetime, age);
}

/**
 * Inherited IRA under the 10-year rule: the account must be empty by the end of the 10th year after death.
 * If the decedent had started RMDs, annual distributions are required in years 1-9 (single-life factor,
 * reduced by one each year); otherwise only the year-10 clean-out is required.
 */
export function inheritedRmd(
  t: RmdTables,
  beneficiaryAgeYearAfterDeath: number,
  yearsSinceDeath: number,
  hadStartedRmds: boolean,
  balance: number,
): number {
  if (balance <= 0 || yearsSinceDeath < 1) return 0;
  if (yearsSinceDeath >= 10) return balance;
  if (!hadStartedRmds) return 0;
  const factor = lookup(t.singleLife, beneficiaryAgeYearAfterDeath) - (yearsSinceDeath - 1);
  return factor <= 1 ? balance : balance / factor;
}

/** IRMAA tier index and premiums for MAGI from two years earlier. Thresholds scale by k for projected years. */
export function irmaaTier(
  m: MedicareParams,
  k: number,
  status: FilingStatus,
  magiTwoYearsAgo: number,
): { tier: number; row: IrmaaTier } {
  const table =
    status === 'mfj' || status === 'qss' ? m.irmaa.mfj : status === 'mfs' ? m.irmaa.mfs : m.irmaa.single;
  let tier = 0;
  // Each tier starts above its threshold, except the top one, which the law starts at "greater than or equal to".
  for (let i = 0; i < table.length; i++) {
    const over = table[i].magiOver * k;
    if (i > 0 && i === table.length - 1 ? magiTwoYearsAgo >= over : magiTwoYearsAgo > over) tier = i;
  }
  return { tier, row: table[tier] };
}
