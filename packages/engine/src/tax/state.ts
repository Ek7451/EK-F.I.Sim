/** Generic, data-driven state income tax (TAX-05). */
import type { FilingStatus, StateTaxParams } from '@fisim/data';
import { bracketTax, tableStatus } from './federal';

export interface StateTaxInput {
  status: FilingStatus;
  federalAgi: number;
  federalTaxableIncome: number;
  federalDeduction: number;
  /** Social Security included in federal AGI. */
  taxableSocialSecurity: number;
  /** Pension + pre-tax distributions (incl. conversions) per person, with ages, for retirement exclusions. */
  retirementIncome: [number, number];
  ages: number[];
  longTermGains: number;
  dependents: number;
}

/** State income tax for one year. `k` indexes brackets/deductions for projected years when the state indexes by statute. */
export function stateTax(p: StateTaxParams | undefined, k: number, x: StateTaxInput): number {
  if (!p || p.kind === 'none') return 0;
  const s = tableStatus(x.status);
  const kk = p.indexed ? k : 1;
  let base =
    p.startingPoint === 'federalTaxableIncome' ? x.federalTaxableIncome + x.federalDeduction : x.federalAgi;
  if (!p.taxesSocialSecurity) base -= x.taxableSocialSecurity;
  const ex = p.retirementIncomeExclusion;
  for (let i = 0; i < x.ages.length; i++) {
    if (x.ages[i] >= ex.minAge && x.retirementIncome[i] > 0) {
      base -=
        ex.amountPerPerson === 'all'
          ? x.retirementIncome[i]
          : Math.min(x.retirementIncome[i], ex.amountPerPerson * kk);
    }
  }
  if (p.longTermGainExclusionPct > 0) base -= Math.max(0, x.longTermGains) * p.longTermGainExclusionPct;
  const persons = x.ages.length + x.dependents;
  let n65 = 0;
  for (let i = 0; i < x.ages.length; i++) if (x.ages[i] >= 65) n65++;
  const taxable = Math.max(
    0,
    base -
      p.standardDeduction[s] * kk -
      p.personalExemption * kk * persons -
      p.seniorExtraDeduction * kk * n65,
  );
  let tax = bracketTax(p.brackets[s], taxable, kk);
  if (p.surtax) for (const st of p.surtax) tax += Math.max(0, taxable - st.threshold) * st.rate;
  tax -= p.personalExemptionCredit * kk * persons;
  return Math.max(0, tax);
}
