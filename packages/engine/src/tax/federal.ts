/**
 * Federal tax engine (TAX-01..04, 08, 11, 12). Pure function of a household's annual ledger.
 *
 * Indexing (TAX-13): `k` is the inflation factor from the parameter file's year to the tax year.
 * Thresholds the law indexes are multiplied by k; frozen thresholds (NIIT, Social Security taxation,
 * Additional Medicare, home-sale exclusion) are not. For an enacted data year k = 1.
 */
import type { Bracket, FederalTaxParams, FilingStatus, TableStatus } from '@fisim/data';

export interface FederalTaxInput {
  status: FilingStatus;
  /** Ages at year end of the filer(s). Length 1 or 2. */
  ages: number[];
  childrenUnder17: number;
  otherDependents: number;
  /** Gross wages per person (before 401(k) deferrals). */
  wages: [number, number];
  /** Wages subject to FICA per person (gross wages less section-125 items such as payroll HSA). */
  ficaWages: [number, number];
  /** Pre-tax retirement deferrals + payroll HSA + pre-tax premiums: excluded from income-tax wages. */
  pretaxFromWages: number;
  selfEmployment: [number, number];
  interest: number;
  /** Non-qualified ordinary dividends. */
  ordinaryDividends: number;
  qualifiedDividends: number;
  /** Net long-term gains realized this year (can be negative). */
  longTermGains: number;
  shortTermGains: number;
  /** Capital-loss carryforward coming into the year (positive number). */
  lossCarryforward: number;
  /** Taxable pensions and annuity income. */
  pensions: number;
  /**
   * Part of `pensions` and `iraDistributions` that is net investment income for NIIT: the taxable gain in
   * non-qualified annuity payments and in annuity / I-bond withdrawals. Already counted in income; NIIT only.
   */
  annuityGains?: number;
  /** Taxable distributions from pre-tax accounts (incl. RMDs). */
  iraDistributions: number;
  rothConversions: number;
  rentalNet: number;
  otherOrdinary: number;
  socialSecurity: number;
  taxExemptInterest: number;
  /** Above-the-line adjustments other than half of SE tax (deductible IRA, direct HSA contributions). */
  adjustments: number;
  itemized: { stateLocalTax: number; mortgageInterest: number; charity: number };
  /** Amounts subject to the 10% early-distribution, 20% HSA and 10% 529 additional taxes. */
  earlyWithdrawalPenaltyBase: number;
  hsaPenaltyBase: number;
  edu529PenaltyBase: number;
}

export interface FederalTaxResult {
  agi: number;
  /** AGI + untaxed Social Security + tax-exempt interest (ACA MAGI). */
  magiAca: number;
  /** AGI + tax-exempt interest (IRMAA MAGI). */
  magiIrmaa: number;
  taxableSocialSecurity: number;
  deduction: number;
  itemizing: boolean;
  seniorDeduction: number;
  qbiDeduction: number;
  taxableIncome: number;
  /** Taxable income taxed at ordinary rates. */
  ordinaryTaxable: number;
  /** Net capital gain + qualified dividends taxed at preferential rates. */
  preferentialIncome: number;
  ordinaryTax: number;
  capitalGainsTax: number;
  amt: number;
  niit: number;
  childTaxCredit: number;
  additionalChildTaxCredit: number;
  /** Income tax after credits (regular + AMT + NIIT - CTC - ACTC); can be negative (refundable). */
  incomeTax: number;
  ficaEmployee: number;
  selfEmploymentTax: number;
  additionalMedicareTax: number;
  penalties: number;
  /** Everything owed federally for the year. */
  total: number;
  /** Marginal ordinary bracket rate at the taxable-income level. */
  marginalRate: number;
  lossCarryforwardOut: number;
  /** Capital-loss deduction taken against ordinary income. */
  capitalLossDeduction: number;
}

export const tableStatus = (s: FilingStatus): TableStatus => (s === 'qss' ? 'mfj' : s);

/** Tax from a bracket table on `income`, with thresholds scaled by k. */
export function bracketTax(brackets: Bracket[], income: number, k: number): number {
  if (income <= 0) return 0;
  let tax = 0;
  let lower = 0;
  for (let i = 0; i < brackets.length; i++) {
    const b = brackets[i];
    const upper = b.upTo === null ? Infinity : b.upTo * k;
    if (income <= upper) return tax + (income - lower) * b.rate;
    tax += (upper - lower) * b.rate;
    lower = upper;
  }
  return tax;
}

export function marginalRate(brackets: Bracket[], income: number, k: number): number {
  for (let i = 0; i < brackets.length; i++) {
    const b = brackets[i];
    if (b.upTo === null || income < b.upTo * k) return b.rate;
  }
  return brackets[brackets.length - 1].rate;
}

/** Top of the bracket whose rate is `rateTarget` (scaled), or Infinity if it is the last bracket. */
export function bracketTop(brackets: Bracket[], rateTarget: number, k: number): number {
  let best = brackets[0];
  for (const b of brackets) if (b.rate <= rateTarget + 1e-9) best = b;
  return best.upTo === null ? Infinity : best.upTo * k;
}

/** Tax on preferential income stacked on top of ordinary taxable income. */
export function preferentialTax(
  brackets: Bracket[],
  ordinaryTaxable: number,
  pref: number,
  k: number,
): number {
  if (pref <= 0) return 0;
  let tax = 0;
  let lower = Math.max(0, ordinaryTaxable);
  const top = lower + pref;
  for (let i = 0; i < brackets.length; i++) {
    const b = brackets[i];
    const upper = b.upTo === null ? Infinity : b.upTo * k;
    if (upper <= lower) continue;
    const slice = Math.min(top, upper) - lower;
    if (slice > 0) {
      tax += slice * b.rate;
      lower += slice;
    }
    if (lower >= top) break;
  }
  return tax;
}

/** Taxable part of Social Security benefits (provisional-income method; thresholds are not indexed). */
export function taxableSocialSecurity(
  p: FederalTaxParams,
  status: FilingStatus,
  otherIncome: number,
  benefits: number,
  taxExempt: number,
): number {
  if (benefits <= 0) return 0;
  const s = tableStatus(status);
  const base = p.socialSecurityTaxation.base[s];
  const adj = p.socialSecurityTaxation.adjusted[s];
  const provisional = otherIncome + taxExempt + 0.5 * benefits;
  if (provisional <= base) return 0;
  const tier1 = Math.min(0.5 * (provisional - base), 0.5 * benefits);
  if (provisional <= adj) return tier1;
  const tier2 = 0.85 * (provisional - adj) + Math.min(tier1, 0.5 * (adj - base));
  return Math.min(tier2, 0.85 * benefits);
}

/** QBI thresholds are not in the dataset contract; 2026 values (Rev. Proc. 2025-32 / OBBBA phase-in ranges). */
/** OBBBA provisions effective 2026 that the dataset contract has no fields for (none are indexed). */
const OBBBA = {
  charityFloorPct: 0.005,
  nonItemizerCharity: 1000,
  itemizedLimitRate: 2 / 37,
  qbiMinimum: 400,
  qbiMinimumIncome: 1000,
};
const QBI = {
  rate: 0.2,
  threshold: { single: 201750, mfj: 403500 },
  phaseIn: { single: 75000, mfj: 150000 },
  baseYear: 2026,
};

export function federalTax(
  p: FederalTaxParams,
  k: number,
  x: FederalTaxInput,
  out?: FederalTaxResult,
): FederalTaxResult {
  const s = tableStatus(x.status);
  const f = p.fica;
  const wageBase = f.socialSecurityWageBase * k;

  // ---- payroll taxes
  let fica = 0;
  let seTax = 0;
  let seTaxSSPart = 0;
  let medicareEarnings = 0;
  for (let i = 0; i < 2; i++) {
    const w = x.ficaWages[i];
    fica += Math.min(w, wageBase) * f.socialSecurityRate + w * f.medicareRate;
    const net = Math.max(0, x.selfEmployment[i]) * f.seNetEarningsFactor;
    if (net >= 400) {
      const ssPart = Math.min(net, Math.max(0, wageBase - w)) * f.socialSecurityRate * 2;
      seTaxSSPart += ssPart;
      seTax += ssPart + net * f.medicareRate * 2;
      medicareEarnings += net;
    }
    medicareEarnings += w;
  }
  const addlMedicare =
    Math.max(0, medicareEarnings - f.additionalMedicareThreshold[s]) * f.additionalMedicareRate;
  const halfSeTax = seTax / 2;

  // ---- capital gains netting and loss carryforward (TAX-08)
  const netGain = x.longTermGains + x.shortTermGains - x.lossCarryforward;
  const lossLimit = s === 'mfs' ? p.capitalLossLimit.mfs : p.capitalLossLimit.default;
  let capLossDeduction = 0;
  let carryOut = 0;
  let netLong = 0;
  let netShort = 0;
  if (netGain < 0) {
    capLossDeduction = Math.min(lossLimit, -netGain);
    carryOut = -netGain - capLossDeduction;
  } else {
    // Losses and carryforwards offset short-term first, then long-term.
    const shortAfter = x.shortTermGains - x.lossCarryforward;
    if (shortAfter >= 0) {
      netShort = shortAfter + Math.min(0, x.longTermGains);
      netLong = Math.max(0, x.longTermGains);
      if (netShort < 0) {
        netLong += netShort;
        netShort = 0;
      }
    } else {
      netLong = x.longTermGains + shortAfter;
    }
  }

  // ---- income
  const wagesTaxable = x.wages[0] + x.wages[1] - x.pretaxFromWages;
  const seIncome = x.selfEmployment[0] + x.selfEmployment[1];
  const otherIncome =
    wagesTaxable +
    seIncome +
    x.interest +
    x.ordinaryDividends +
    x.qualifiedDividends +
    netLong +
    netShort -
    capLossDeduction +
    x.pensions +
    x.iraDistributions +
    x.rothConversions +
    x.rentalNet +
    x.otherOrdinary -
    x.adjustments -
    halfSeTax;
  const taxableSS = taxableSocialSecurity(p, x.status, otherIncome, x.socialSecurity, x.taxExemptInterest);
  const agi = otherIncome + taxableSS;
  const magiAca = agi + (x.socialSecurity - taxableSS) + x.taxExemptInterest;
  const magiIrmaa = agi + x.taxExemptInterest;

  // ---- deductions (TAX-01)
  const married = s === 'mfj' || s === 'mfs';
  let n65 = 0;
  for (let i = 0; i < x.ages.length; i++) if (x.ages[i] >= 65) n65++;
  const addl =
    (married ? p.additionalStandardDeduction.married : p.additionalStandardDeduction.unmarried) * k;
  const standard = p.standardDeduction[s] * k + n65 * addl;
  const sd = p.salt;
  const half = s === 'mfs' ? 0.5 : 1;
  const saltCap = Math.max(
    sd.floor * half,
    sd.cap * half - Math.max(0, agi - sd.phaseDownStart * half) * sd.phaseDownRate,
  );
  const saltAllowed = Math.min(x.itemized.stateLocalTax, saltCap);
  // OBBBA (2026+): itemized charitable gifts count only above 0.5% of AGI; non-itemizers may deduct up to $1,000 ($2,000 joint).
  const charityItemized = Math.max(0, x.itemized.charity - OBBBA.charityFloorPct * Math.max(0, agi));
  let itemizedTotal = saltAllowed + x.itemized.mortgageInterest + charityItemized;
  // OBBBA (2026+): itemized deductions are trimmed by 2/37 of the lesser of the deductions or income above the 37% bracket.
  const top = p.ordinaryBrackets[s];
  const start37 = (top[top.length - 2].upTo ?? Infinity) * k;
  if (agi > start37) itemizedTotal -= OBBBA.itemizedLimitRate * Math.min(itemizedTotal, agi - start37);
  const standardPlus =
    standard +
    Math.min(x.itemized.charity, s === 'mfj' ? OBBBA.nonItemizerCharity * 2 : OBBBA.nonItemizerCharity);
  const itemizing = itemizedTotal > standardPlus;
  let deduction = itemizing ? itemizedTotal : standardPlus;
  let senior = 0;
  if (p.seniorDeduction.perPerson > 0 && n65 > 0 && s !== 'mfs') {
    const start = s === 'mfj' ? p.seniorDeduction.phaseoutStart.mfj : p.seniorDeduction.phaseoutStart.single;
    senior =
      Math.max(0, p.seniorDeduction.perPerson - Math.max(0, agi - start) * p.seniorDeduction.phaseoutRate) *
      n65;
  }
  deduction += senior;

  // ---- QBI deduction (simple form: no W-2 wages, so it phases out fully above the threshold)
  let qbi = 0;
  const pref0 = Math.max(0, netLong) + x.qualifiedDividends;
  if (seIncome > 0) {
    const qbiBase = Math.max(0, seIncome - halfSeTax);
    const tiBefore = Math.max(0, agi - deduction);
    const thr = (s === 'mfj' ? QBI.threshold.mfj : QBI.threshold.single) * k;
    const range = s === 'mfj' ? QBI.phaseIn.mfj : QBI.phaseIn.single;
    let allowed = QBI.rate * qbiBase;
    if (tiBefore > thr) allowed *= Math.max(0, 1 - (tiBefore - thr) / range);
    qbi = Math.max(0, Math.min(allowed, QBI.rate * Math.max(0, tiBefore - pref0)));
    if (qbiBase >= OBBBA.qbiMinimumIncome) qbi = Math.max(qbi, OBBBA.qbiMinimum);
  }

  const taxableIncome = Math.max(0, agi - deduction - qbi);
  const pref = Math.min(taxableIncome, pref0);
  const ordinaryTaxable = taxableIncome - pref;
  const ordinaryTax = bracketTax(p.ordinaryBrackets[s], ordinaryTaxable, k);
  const cgTax = preferentialTax(p.capitalGainsBrackets[s], ordinaryTaxable, pref, k);
  const regular = ordinaryTax + cgTax;

  // ---- AMT estimate (TAX-12): add back the standard deduction or SALT; preferential income keeps its rates.
  const a = p.amt;
  const amti = agi - qbi - (itemizing ? itemizedTotal - saltAllowed : 0);
  // The 0%/15%/20% breakpoints for gains under AMT are measured from regular ordinary taxable income (Form 6251, Part III).
  const exemption = Math.max(
    0,
    a.exemption[s] * k - Math.max(0, amti - a.phaseoutStart[s] * k) * a.phaseoutRate,
  );
  const amtBase = Math.max(0, amti - exemption);
  const amtOrdinary = Math.max(0, amtBase - pref);
  const thr28 = (s === 'mfs' ? a.rate28Threshold / 2 : a.rate28Threshold) * k;
  const tentative =
    Math.min(amtOrdinary, thr28) * a.rates[0] +
    Math.max(0, amtOrdinary - thr28) * a.rates[1] +
    preferentialTax(p.capitalGainsBrackets[s], ordinaryTaxable, Math.min(pref, amtBase), k);
  const amt = Math.max(0, tentative - regular);

  // ---- NIIT (TAX-02)
  const nii = Math.max(
    0,
    x.interest +
      x.ordinaryDividends +
      x.qualifiedDividends +
      netLong +
      netShort -
      capLossDeduction +
      x.rentalNet +
      (x.annuityGains ?? 0),
  );
  const niit = p.niit.rate * Math.max(0, Math.min(nii, agi - p.niit.threshold[s]));

  // ---- child tax credit (TAX-11)
  const c = p.childTaxCredit;
  let ctc = 0;
  let actc = 0;
  if (x.childrenUnder17 > 0 || x.otherDependents > 0) {
    // The per-child amount and the refundable cap are indexed (rounded down to $100); the $500 credit and the
    // phase-out thresholds are not.
    const perChild = k === 1 ? c.perChild : Math.floor((c.perChild * k) / 100) * 100;
    const refundableMax = k === 1 ? c.refundableMax : Math.floor((c.refundableMax * k) / 100) * 100;
    const gross = x.childrenUnder17 * perChild + x.otherDependents * c.otherDependent;
    const over = Math.max(0, agi - c.phaseoutStart[s]);
    const reduced = Math.max(0, gross - Math.ceil(over / 1000) * c.phaseoutPer1000);
    ctc = Math.min(reduced, regular + amt);
    const earned = wagesTaxable + x.pretaxFromWages + Math.max(0, seIncome - halfSeTax);
    actc = Math.max(
      0,
      Math.min(
        reduced - ctc,
        x.childrenUnder17 * refundableMax,
        Math.max(0, earned - c.refundableEarnedIncomeFloor) * c.refundableRate,
      ),
    );
  }

  const penalties =
    x.earlyWithdrawalPenaltyBase * p.penalties.earlyRetirement +
    x.hsaPenaltyBase * p.penalties.hsaNonQualified +
    x.edu529PenaltyBase * p.penalties.education529;
  const incomeTax = regular + amt + niit - ctc - actc;

  const r = out ?? ({} as FederalTaxResult);
  r.agi = agi;
  r.magiAca = magiAca;
  r.magiIrmaa = magiIrmaa;
  r.taxableSocialSecurity = taxableSS;
  r.deduction = deduction;
  r.itemizing = itemizing;
  r.seniorDeduction = senior;
  r.qbiDeduction = qbi;
  r.taxableIncome = taxableIncome;
  r.ordinaryTaxable = ordinaryTaxable;
  r.preferentialIncome = pref;
  r.ordinaryTax = ordinaryTax;
  r.capitalGainsTax = cgTax;
  r.amt = amt;
  r.niit = niit;
  r.childTaxCredit = ctc;
  r.additionalChildTaxCredit = actc;
  r.incomeTax = incomeTax;
  r.ficaEmployee = fica;
  r.selfEmploymentTax = seTax;
  r.additionalMedicareTax = addlMedicare;
  r.penalties = penalties;
  r.total = incomeTax + fica + seTax + addlMedicare + penalties;
  r.marginalRate = marginalRate(p.ordinaryBrackets[s], ordinaryTaxable, k);
  r.lossCarryforwardOut = carryOut;
  r.capitalLossDeduction = capLossDeduction;
  void seTaxSSPart;
  return r;
}

export function emptyFederalInput(): FederalTaxInput {
  return {
    status: 'single',
    ages: [40],
    childrenUnder17: 0,
    otherDependents: 0,
    wages: [0, 0],
    ficaWages: [0, 0],
    pretaxFromWages: 0,
    selfEmployment: [0, 0],
    interest: 0,
    ordinaryDividends: 0,
    qualifiedDividends: 0,
    longTermGains: 0,
    shortTermGains: 0,
    lossCarryforward: 0,
    pensions: 0,
    iraDistributions: 0,
    rothConversions: 0,
    rentalNet: 0,
    annuityGains: 0,
    otherOrdinary: 0,
    socialSecurity: 0,
    taxExemptInterest: 0,
    adjustments: 0,
    itemized: { stateLocalTax: 0, mortgageInterest: 0, charity: 0 },
    earlyWithdrawalPenaltyBase: 0,
    hsaPenaltyBase: 0,
    edu529PenaltyBase: 0,
  };
}

/**
 * Federal estate tax against the exemption (TAX-14). `dsue` is a deceased spouse's unused exclusion carried over
 * by portability (nominal dollars).
 */
export function estateTax(
  p: FederalTaxParams,
  k: number,
  estate: number,
  married: boolean,
  dsue = 0,
): number {
  const exemption = p.estate.exemption * k * (married ? 2 : 1) + dsue;
  return Math.max(0, estate - exemption) * p.estate.rate;
}
