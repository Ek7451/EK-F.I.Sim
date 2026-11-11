/**
 * Compiles a validated Plan (cents, references by id) into the flat, dollar-denominated structure
 * the projection loop runs on. Nothing here depends on a particular return path.
 */
import type { Account, AccountType, Allocation, Coverage, Plan, YearRef } from './schema';
import { ASSET_CLASSES } from './schema';
import type { EngineData } from './data';
import { applyColas, claimFactor, computePia, fraMonths, awiFor } from './social-security';

export const NC = ASSET_CLASSES.length;
export const enum Kind {
  Taxable,
  Cash,
  Pretax,
  Roth,
  Hsa,
  Edu,
  Deferred,
}

const KIND_OF: Record<AccountType, Kind> = {
  taxable: Kind.Taxable,
  cash: Kind.Cash,
  tBill: Kind.Cash,
  trad401k: Kind.Pretax,
  trad403b: Kind.Pretax,
  gov457b: Kind.Pretax,
  tradIra: Kind.Pretax,
  sepIra: Kind.Pretax,
  simpleIra: Kind.Pretax,
  solo401k: Kind.Pretax,
  inheritedIra: Kind.Pretax,
  roth401k: Kind.Roth,
  rothIra: Kind.Roth,
  hsa: Kind.Hsa,
  plan529: Kind.Edu,
  iBond: Kind.Deferred,
  annuity: Kind.Deferred,
};

export interface CAccount {
  id: string;
  name: string;
  type: AccountType;
  kind: Kind;
  /** Owner person index (joint accounts use person 0 for age rules). */
  owner: number;
  joint: boolean;
  balance: number;
  basis: number;
  rothContrib: number;
  rothLots: { year: number; amount: number }[];
  rothFirstYear: number;
  weights: number[];
  glide: { age: number; w: number[] }[] | null;
  fee: number;
  fixedYield: { rate: number; real: boolean } | null;
  src: Account;
  /** Synthetic accounts are created by the compiler (sweep account, conversion target). */
  synthetic: boolean;
}

export interface CPerson {
  id: string;
  name: string;
  birthYear: number;
  birthMonth: number;
  sex: 'male' | 'female';
  deathAge: number;
  stochasticLongevity: boolean;
  /** Year the person reaches 59 1/2. */
  year59Half: number;
  /** Annual Social Security benefit at claim, in plan-start dollars (0 if none). */
  ssAnnualToday: number;
  /** PIA (annual, plan-start dollars) before the claiming adjustment. */
  ssPiaAnnualToday: number;
  ssClaimYear: number;
  /** Fraction of the claim year in which benefits are paid. */
  ssFirstYearFraction: number;
  ssClaimMonths: number;
  ssFraMonths: number;
  ssEstimated: boolean;
  rmdStartAge: number;
}

export interface Compiled {
  plan: Plan;
  data: EngineData;
  startYear: number;
  /** Longest possible horizon in years (to the latest fixed death age, or 110 when longevity is stochastic). */
  maxYears: number;
  people: CPerson[];
  accounts: CAccount[];
  accountIndex: Map<string, number>;
  incomeIndex: Map<string, number>;
  expenseIndex: Map<string, number>;
  milestoneIndex: Map<string, number>;
  /** Static firing year per milestone (NaN for condition milestones, resolved while running). */
  milestoneYear: number[];
  sweepAccount: number;
  conversionTarget: number[];
  /** Flow exponent for the timing convention: 1 = start, 0.5 = mid, 0 = end of year. */
  flowExponent: number;
  warnings: string[];
}

const dollars = (c: number | undefined): number => (c ?? 0) / 100;

export function weightsOf(a: Allocation): number[] {
  const w = ASSET_CLASSES.map((c) => a[c] ?? 0);
  const sum = w.reduce((x, y) => x + y, 0);
  if (sum <= 0) return [0, 0, 1, 0, 0];
  return w.map((x) => x / sum);
}

/** Resolve a YearRef to a calendar year using only static information; NaN if it depends on a condition milestone. */
export function staticYear(
  plan: Plan,
  ref: YearRef | undefined,
  fallback: number,
  milestoneYear?: number[],
  msIndex?: Map<string, number>,
): number {
  if (!ref) return fallback;
  if (ref.type === 'year') return ref.year;
  if (ref.type === 'age') {
    const p = plan.people.find((x) => x.id === ref.personId) ?? plan.people[0];
    return +p.birthDate.slice(0, 4) + ref.age;
  }
  if (milestoneYear && msIndex) {
    const i = msIndex.get(ref.milestoneId);
    if (i === undefined) return fallback;
    return milestoneYear[i] + ref.offset;
  }
  const m = plan.milestones.find((x) => x.id === ref.milestoneId);
  if (!m) return fallback;
  if (m.when.type === 'year') return m.when.year + ref.offset;
  if (m.when.type === 'age') {
    const w = m.when;
    const p = plan.people.find((x) => x.id === w.personId) ?? plan.people[0];
    return +p.birthDate.slice(0, 4) + w.age + ref.offset;
  }
  return NaN;
}

export function compilePlan(
  plan: Plan,
  data: EngineData,
  opts: { stochasticLongevity?: boolean } = {},
): Compiled {
  const warnings: string[] = [];
  const startYear = plan.settings.startYear;
  const infl = plan.assumptions.inflation.rate;
  const wageGrowth = infl + plan.assumptions.realWageGrowth;

  const msIndex = new Map<string, number>();
  plan.milestones.forEach((m, i) => msIndex.set(m.id, i));
  const milestoneYear = plan.milestones.map((m) => {
    if (m.when.type === 'year') return m.when.year;
    if (m.when.type === 'age') {
      const w = m.when;
      const p = plan.people.find((x) => x.id === w.personId) ?? plan.people[0];
      return +p.birthDate.slice(0, 4) + w.age;
    }
    return NaN;
  });

  const personIdx = (id: string): number => {
    const i = plan.people.findIndex((p) => p.id === id);
    return i < 0 ? 0 : i;
  };

  // ------------------------------------------------------------ people + Social Security
  const people: CPerson[] = plan.people.map((p, pi) => {
    const birthYear = +p.birthDate.slice(0, 4);
    const birthMonth = +p.birthDate.slice(5, 7);
    const fra = fraMonths(data.ssSeries, birthYear);
    const claimMonths = p.socialSecurity.claimAge.years * 12 + p.socialSecurity.claimAge.months;
    let piaAnnualToday = 0;
    let estimated = false;
    if (p.socialSecurity.mode === 'pia') {
      piaAnnualToday = dollars(p.socialSecurity.piaMonthly) * 12;
    } else if (p.socialSecurity.mode === 'earnings') {
      const earnings: Record<number, number> = {};
      for (const e of p.socialSecurity.earnings) earnings[e.year] = dollars(e.amount);
      // Project future covered earnings from this person's earned-income streams.
      let currentEarned = 0;
      for (const inc of plan.incomes) {
        if (personIdx(inc.ownerId) !== pi) continue;
        if (inc.taxCharacter !== 'earned' && inc.taxCharacter !== 'selfEmployment') continue;
        const s = staticYear(plan, inc.start, startYear);
        const e = staticYear(plan, inc.end, birthYear + 67);
        const from = Math.max(startYear, Number.isNaN(s) ? startYear : s);
        const to = Number.isNaN(e) ? birthYear + 67 : e;
        const g = inc.growth.basis === 'real' ? (1 + infl) * (1 + inc.growth.rate) - 1 : inc.growth.rate;
        for (let y = from; y < to && y < birthYear + 70; y++) {
          earnings[y] = (earnings[y] ?? 0) + dollars(inc.amount) * Math.pow(1 + g, y - startYear);
        }
        if (from === startYear) currentEarned += dollars(inc.amount);
      }
      if (p.socialSecurity.earnings.length === 0 && currentEarned > 0) {
        // No statement entered: back-cast the current wage with the wage index from age 22 (flagged as an estimate).
        estimated = true;
        const awiNow = awiFor(data.ssSeries, startYear, wageGrowth);
        for (let y = Math.max(birthYear + 22, 1951); y < startYear; y++) {
          earnings[y] = currentEarned * (awiFor(data.ssSeries, y, wageGrowth) / awiNow);
        }
        warnings.push(
          `Social Security for ${p.name} is estimated from current wages; enter the earnings record for a better figure.`,
        );
      }
      const r = computePia({ birthYear, earnings, series: data.ssSeries, futureWageGrowth: wageGrowth });
      const elig = r.eligibilityYear;
      // Express the PIA in plan-start dollars.
      const monthly =
        elig <= startYear
          ? applyColas(r.pia, data.ssSeries, elig, startYear - 1)
          : r.pia / Math.pow(1 + infl, elig - startYear);
      piaAnnualToday = monthly * 12;
    }
    const factor = claimFactor(claimMonths, fra);
    const claimAbsMonth = birthYear * 12 + (birthMonth - 1) + claimMonths;
    // Benefits are paid the month after entitlement.
    const firstPaidMonth = claimAbsMonth + 1;
    const ssClaimYear = Math.floor(firstPaidMonth / 12);
    const ssFirstYearFraction = (12 - (firstPaidMonth % 12)) / 12;
    const half = birthMonth <= 6 ? birthYear + 59 : birthYear + 60;
    let rmdAge = 75;
    for (const row of data.rmd.startAge) {
      if (row.bornThrough === null || birthYear <= row.bornThrough) {
        rmdAge = row.age;
        break;
      }
    }
    return {
      id: p.id,
      name: p.name,
      birthYear,
      birthMonth,
      sex: p.sex ?? (pi === 0 ? 'female' : 'male'),
      deathAge: p.longevity.age,
      stochasticLongevity: p.longevity.mode === 'stochastic' || !!opts.stochasticLongevity,
      year59Half: half,
      ssAnnualToday: piaAnnualToday * factor,
      ssPiaAnnualToday: piaAnnualToday,
      ssClaimYear,
      ssFirstYearFraction,
      ssClaimMonths: claimMonths,
      ssFraMonths: fra,
      ssEstimated: estimated,
      rmdStartAge: rmdAge,
    };
  });

  // ------------------------------------------------------------ accounts
  const glideById = new Map(
    plan.glidePaths.map((g) => [
      g.id,
      g.points.map((pt) => ({ age: pt.age, w: weightsOf(pt.allocation) })).sort((a, b) => a.age - b.age),
    ]),
  );
  const mk = (a: Account, synthetic = false): CAccount => {
    const kind = KIND_OF[a.type];
    const cashLike = kind === Kind.Cash || a.type === 'iBond';
    const bal = dollars(a.balance);
    return {
      id: a.id,
      name: a.name,
      type: a.type,
      kind,
      owner: personIdx(a.ownerId),
      joint: a.ownerId === 'joint',
      balance: bal,
      basis:
        kind === Kind.Taxable || kind === Kind.Deferred || kind === Kind.Edu
          ? Math.min(bal, dollars(a.costBasis ?? a.balance))
          : 0,
      rothContrib: kind === Kind.Roth ? Math.min(bal, dollars(a.rothBasis?.contributions ?? a.balance)) : 0,
      rothLots:
        kind === Kind.Roth
          ? (a.rothBasis?.conversions ?? []).map((l) => ({ year: l.year, amount: dollars(l.amount) }))
          : [],
      rothFirstYear: a.rothBasis?.firstContributionYear ?? startYear - 5,
      weights: cashLike ? [0, 0, 1, 0, 0] : weightsOf(a.allocation),
      glide: !cashLike && a.glidePathId ? (glideById.get(a.glidePathId) ?? null) : null,
      fee: (a.fees?.expenseRatio ?? 0) + (a.fees?.advisory ?? 0),
      fixedYield: a.fixedYield ? { rate: a.fixedYield.rate, real: a.fixedYield.basis === 'real' } : null,
      src: a,
      synthetic,
    };
  };
  const accounts = plan.accounts.map((a) => mk(a));
  const synth = (id: string, name: string, type: AccountType, ownerId: string): number => {
    accounts.push(
      mk(
        {
          id,
          ownerId,
          name,
          type,
          balance: 0,
          allocation: { usStocks: 0.6, usBonds: 0.4, cash: 0, intlStocks: 0, reits: 0 },
          fees: { expenseRatio: 0, advisory: 0 },
          ruleOf55: false,
        } as Account,
        true,
      ),
    );
    return accounts.length - 1;
  };

  // Sweep account for leftover surplus.
  let sweep = plan.strategies.surplusDefaultAccountId
    ? accounts.findIndex((a) => a.id === plan.strategies.surplusDefaultAccountId)
    : -1;
  if (sweep < 0) sweep = accounts.findIndex((a) => a.kind === Kind.Taxable);
  if (sweep < 0) sweep = accounts.findIndex((a) => a.kind === Kind.Cash);
  if (sweep < 0) sweep = synth('__sweep', 'Savings (auto)', 'cash', plan.people[0].id);

  // Roth conversion / mega-backdoor target per person.
  const conversionTarget = plan.people.map((p, pi) => {
    const want = plan.strategies.rothConversion.targetAccountId;
    let t = want ? accounts.findIndex((a) => a.id === want && a.owner === pi) : -1;
    if (t < 0) t = accounts.findIndex((a) => a.type === 'rothIra' && a.owner === pi);
    if (t < 0 && (plan.strategies.rothConversion.mode !== 'none' || plan.strategies.backdoorRoth))
      t = synth(`__roth_${p.id}`, `Roth IRA (${p.name})`, 'rothIra', p.id);
    return t;
  });

  const accountIndex = new Map<string, number>();
  accounts.forEach((a, i) => accountIndex.set(a.id, i));
  const incomeIndex = new Map<string, number>();
  plan.incomes.forEach((x, i) => incomeIndex.set(x.id, i));
  const expenseIndex = new Map<string, number>();
  plan.expenses.forEach((x, i) => expenseIndex.set(x.id, i));

  const anyStochastic = people.some((p) => p.stochasticLongevity);
  const maxYears = Math.max(
    1,
    ...people.map((p) => p.birthYear + (anyStochastic ? 110 : p.deathAge) - startYear + 1),
  );
  const flowExponent = plan.settings.timing === 'start' ? 1 : plan.settings.timing === 'mid' ? 0.5 : 0;

  return {
    plan,
    data,
    startYear,
    maxYears,
    people,
    accounts,
    accountIndex,
    incomeIndex,
    expenseIndex,
    milestoneIndex: msIndex,
    milestoneYear,
    sweepAccount: sweep,
    conversionTarget,
    flowExponent,
    warnings,
  };
}

/** Default coverage when the user has not entered a timeline: employer while working, marketplace after, Medicare at 65. */
export function defaultCoverage(hasEarnedIncome: boolean): Coverage['type'] {
  return hasEarnedIncome ? 'employer' : 'aca';
}
