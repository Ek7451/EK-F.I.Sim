/**
 * One projection path (SIM-01), following the annual order of operations in build plan §6.2 and the
 * fixed-point cash-flow / tax solver in §6.3. Everything is nominal dollars; `cpi` in each record
 * converts to plan-start ("today's") dollars.
 */
import type { FederalTaxParams, FilingStatus, StateTaxParams } from '@fisim/data';
import { Kind, NC, staticYear, type CAccount, type Compiled } from './compile';
import { pickYear, projectFederal } from './data';
import {
  acaExpectedOop,
  ageRatingFactor,
  benchmarkAge21,
  fplAmount,
  premiumTaxCredit,
  seppAmortization,
  tobaccoRatio,
} from './healthcare';
import type { Coverage, YearRef } from './schema';
import { earningsTestWithholding, spousalFactor } from './social-security';
import {
  bracketTop,
  emptyFederalInput,
  estateTax,
  federalTax,
  tableStatus,
  type FederalTaxInput,
  type FederalTaxResult,
} from './tax/federal';
import { inheritedRmd, irmaaTier, ownerRmd } from './tax/rmd';
import { stateTax } from './tax/state';

export interface PathInputs {
  years: number;
  /** Nominal annual returns, [t * 5 + assetClass]. */
  returns: Float64Array;
  inflation: Float64Array;
  /** Healthcare inflation in excess of CPI per year. */
  healthExcess: Float64Array;
  /** Sampled death ages per person (stochastic longevity). */
  deathAge?: number[];
  /** Sampled long-term-care events per person (stochastic LTC). */
  ltc?: ({ onsetAge: number; years: number } | null)[];
}

export interface YearRecord {
  year: number;
  t: number;
  /** Cumulative CPI factor at the start of the year (1 in the first year). */
  cpi: number;
  ages: number[];
  alive: boolean[];
  filingStatus: FilingStatus;
  state: string;
  dataStatus: 'enacted' | 'projected';
  milestones: string[];
  coverage: string[];
  income: {
    wages: number;
    selfEmployment: number;
    pension: number;
    annuity: number;
    socialSecurity: number;
    rental: number;
    other: number;
    windfall: number;
    assetSales: number;
    total: number;
  };
  contributions: {
    pretax: number;
    roth: number;
    hsa: number;
    employer: number;
    afterTax: number;
    total: number;
  };
  withdrawals: {
    total: number;
    rmd: number;
    sepp: number;
    pretax: number;
    roth: number;
    taxable: number;
    cash: number;
    hsa: number;
    other: number;
    byAccount: Record<string, number>;
  };
  rothConversion: number;
  gainsHarvested: number;
  lossesHarvested: number;
  realizedGains: number;
  expenses: {
    living: number;
    byCategory: Record<string, number>;
    housing: number;
    debtService: number;
    debtInterest: number;
    purchases: number;
    healthcare: {
      premiums: number;
      outOfPocket: number;
      medicare: number;
      irmaa: number;
      ltc: number;
      total: number;
      hsaPaid: number;
    };
    total: number;
  };
  taxes: {
    federalIncome: number;
    state: number;
    fica: number;
    selfEmployment: number;
    niit: number;
    amt: number;
    penalties: number;
    ptc: number;
    total: number;
    agi: number;
    magi: number;
    taxableIncome: number;
    ordinaryTaxable: number;
    ordinaryTax: number;
    capitalGainsTax: number;
    deduction: number;
    taxableSocialSecurity: number;
    marginalRate: number;
    effectiveRate: number;
    irmaaTier: number;
    fplRatio: number;
  };
  balances: Record<string, number>;
  byKind: { taxable: number; cash: number; pretax: number; roth: number; hsa: number; other: number };
  investable: number;
  assets: number;
  debts: number;
  netWorth: number;
  returns: number;
  fees: number;
  saved: number;
  shortfall: number;
  spendingMultiplier: number;
  /** Conservation-of-money bookkeeping (§6.5). */
  check: {
    opening: number;
    deposits: number;
    withdrawals: number;
    closing: number;
    cashIn: number;
    cashOut: number;
  };
  warnings: string[];
}

export interface PathResult {
  startYear: number;
  /** Number of simulated years (until the last death). */
  n: number;
  investable: Float64Array;
  netWorth: Float64Array;
  spending: Float64Array;
  taxes: Float64Array;
  shortfall: Float64Array;
  cpi: Float64Array;
  success: boolean;
  failedYear: number | null;
  lifetimeTax: number;
  estate: {
    value: number;
    estateTax: number;
    heirPretaxDrag: number;
    stepUpGains: number;
    netToHeirs: number;
  };
  records?: YearRecord[];
  warnings: string[];
  milestoneYears: Record<string, number>;
  solver: { maxIterations: number; nonConverged: number };
}

interface DebtState {
  id: string;
  name: string;
  principal: number;
  rate: number;
  payment: number;
  kind: string;
  revolvingPayPct: number;
  linkedAssetId?: string;
  deductible: boolean;
  active: boolean;
  startYear: number;
  refi: { year: number; rate: number; termYears: number; costPct: number }[];
}
interface AssetState {
  id: string;
  name: string;
  kind: string;
  value: number;
  basis: number;
  owned: boolean;
  purchaseYear: number;
  saleYear: number;
}

const levelPayment = (p: number, annualRate: number, months: number): number => {
  if (months <= 0 || p <= 0) return 0;
  const i = annualRate / 12;
  return i === 0 ? p / months : (p * i) / (1 - Math.pow(1 + i, -months));
};

export function runPath(c: Compiled, path: PathInputs, opts: { detail?: boolean } = {}): PathResult {
  const detail = !!opts.detail;
  const plan = c.plan;
  const data = c.data;
  const S = plan.strategies;
  const A = plan.assumptions;
  const startYear = c.startYear;
  const nP = c.people.length;
  const accts = c.accounts;
  const nA = accts.length;
  const warnings: string[] = [...c.warnings];

  const deathAge = c.people.map((p, i) =>
    p.stochasticLongevity && path.deathAge ? path.deathAge[i] : p.deathAge,
  );
  let n = 1;
  for (let i = 0; i < nP; i++) n = Math.max(n, c.people[i].birthYear + deathAge[i] - startYear + 1);
  n = Math.min(n, path.years, c.maxYears);

  // ------------------------------------------------------------ state
  const hold = new Float64Array(nA * NC);
  const open = new Float64Array(nA * NC);
  const target = new Float64Array(nA * NC);
  const basis = new Float64Array(nA);
  const rothContrib = new Float64Array(nA);
  const rothLots: { year: number; amount: number }[][] = [];
  const prevEnd = new Float64Array(nA);
  const owner = new Int32Array(nA);
  const contribStopped = new Uint8Array(nA);
  const seppAnnual = new Float64Array(nA);
  const seppEnd = new Int32Array(nA);
  const seppStart = new Int32Array(nA).fill(-1);
  for (let a = 0; a < nA; a++) {
    const ac = accts[a];
    for (let k = 0; k < NC; k++) hold[a * NC + k] = ac.balance * ac.weights[k];
    basis[a] = ac.basis;
    rothContrib[a] = ac.rothContrib;
    rothLots.push(ac.rothLots.map((l) => ({ ...l })));
    prevEnd[a] = ac.balance;
    owner[a] = ac.owner;
  }
  const bal = (a: number): number => {
    let s = 0;
    const o = a * NC;
    for (let k = 0; k < NC; k++) s += hold[o + k];
    return s;
  };
  const deposit = (a: number, amt: number): void => {
    if (amt <= 0) return;
    const o = a * NC;
    const b = bal(a);
    if (b > 0.005) for (let k = 0; k < NC; k++) hold[o + k] += (amt * hold[o + k]) / b;
    else for (let k = 0; k < NC; k++) hold[o + k] += amt * target[o + k];
    dep[a] += amt;
  };
  const withdraw = (a: number, amt: number): void => {
    if (amt <= 0) return;
    const o = a * NC;
    const b = bal(a);
    if (b <= 0) return;
    const f = Math.max(0, 1 - amt / b);
    for (let k = 0; k < NC; k++) hold[o + k] *= f;
    wd[a] += amt;
  };
  const dep = new Float64Array(nA);
  let extraDebtPaid = 0;
  const iraUsedBy = [0, 0];
  const rolled529 = new Map<number, number>();
  const wd = new Float64Array(nA);

  const milestoneYear = c.milestoneYear.slice();
  const resolve = (ref: YearRef | undefined, fallback: number): number => {
    const y = staticYear(plan, ref, fallback, milestoneYear, c.milestoneIndex);
    return Number.isNaN(y) ? Infinity : y;
  };

  const nI = plan.incomes.length;
  const incBase = new Float64Array(nI);
  const incIdx = new Float64Array(nI).fill(1);
  const incForce = new Int8Array(nI); // 1 = force on, -1 = force off
  const incAmt = new Float64Array(nI);
  for (let i = 0; i < nI; i++) incBase[i] = plan.incomes[i].amount / 100;
  const nE = plan.expenses.length;
  const expBase = new Float64Array(nE);
  const expForce = new Int8Array(nE);
  for (let i = 0; i < nE; i++) expBase[i] = plan.expenses[i].amount / 100;

  const debts: DebtState[] = plan.debts.map((d) => ({
    id: d.id,
    name: d.name,
    principal: d.principal / 100,
    rate: d.rate,
    kind: d.kind,
    revolvingPayPct: d.revolvingPayPct,
    linkedAssetId: d.linkedAssetId,
    payment: d.payment > 0 ? d.payment / 100 : levelPayment(d.principal / 100, d.rate, d.termMonths),
    deductible: d.interestDeductible || d.kind === 'mortgage',
    active: !d.start,
    startYear: d.start ? NaN : startYear,
    refi: [],
  }));
  const assets: AssetState[] = plan.assets.map((a) => ({
    id: a.id,
    name: a.name,
    kind: a.kind,
    value: a.value / 100,
    basis: (a.costBasis ?? a.value) / 100,
    owned: !a.purchase,
    purchaseYear: NaN,
    saleYear: NaN,
  }));

  let cpi = 1;
  let health = 1;
  let edu = 1;
  const cpiIdx = new Float64Array(n + 1);
  const healthIdx = new Float64Array(n + 1);
  const kFor = (dataYear: number, t: number, idx: Float64Array, baseRate: number): number => {
    const off = dataYear - startYear;
    if (off >= t) return 1;
    return off >= 0 ? idx[t] / idx[off] : idx[t] * Math.pow(1 + baseRate, -off);
  };

  let lossCarry = 0;
  const magiHist = new Float64Array(n);
  const statusHist: FilingStatus[] = [];
  let state = plan.people[0].residence.length ? plan.people[0].residence[0].state : 'TX';
  let county: string | undefined = plan.people[0].residence[0]?.countyFips;
  let statusOverride: FilingStatus | null = null;
  let firstDeathYear = Infinity;
  const alive = c.people.map(() => true);
  const ssClaimedToday = new Float64Array(nP); // annual benefit in today's dollars once in payment
  const ssSurvivorToday = new Float64Array(nP);
  let spendMult = 1;
  let gkInitialRate = NaN;
  let prevStateTax = 0;
  let prevWages = [0, 0];
  let lastLivingSpend = 0;
  const cobraStart: number[] = c.people.map(() => NaN);

  // ------------------------------------------------------------ outputs
  const out: PathResult = {
    startYear,
    n,
    investable: new Float64Array(n),
    netWorth: new Float64Array(n),
    spending: new Float64Array(n),
    taxes: new Float64Array(n),
    shortfall: new Float64Array(n),
    cpi: new Float64Array(n),
    success: true,
    failedYear: null,
    lifetimeTax: 0,
    estate: { value: 0, estateTax: 0, heirPretaxDrag: 0, stepUpGains: 0, netToHeirs: 0 },
    records: detail ? [] : undefined,
    warnings,
    milestoneYears: {},
    solver: { maxIterations: 0, nonConverged: 0 },
  };

  // scratch
  const ti: FederalTaxInput = emptyFederalInput();
  const fed = {} as FederalTaxResult;
  const fedTmp = {} as FederalTaxResult;
  const freeAvail = new Float64Array(nA);
  const totAvail = new Float64Array(nA);
  const wAmt = new Float64Array(nA);
  const order: number[] = [];
  const hc = plan.healthcare;
  const slcspByState = Object.keys(data.slcsp).length ? pickYear(data.slcsp, startYear).value : {};
  const hcByPerson = c.people.map((p) => hc.people.find((h) => h.personId === p.id));

  const investableTotal = (): number => {
    let s = 0;
    for (let i = 0; i < nA * NC; i++) s += hold[i];
    return s;
  };
  const assetTotal = (): number => assets.reduce((s, a) => s + (a.owned ? a.value : 0), 0);
  const debtTotal = (): number => debts.reduce((s, d) => s + (d.active ? d.principal : 0), 0);

  const setTargets = (y: number): void => {
    for (let a = 0; a < nA; a++) {
      const ac = accts[a];
      let w = ac.weights;
      if (ac.glide) {
        const age = y - c.people[owner[a]].birthYear;
        const g = ac.glide;
        if (age <= g[0].age) w = g[0].w;
        else if (age >= g[g.length - 1].age) w = g[g.length - 1].w;
        else {
          for (let i = 0; i < g.length - 1; i++) {
            if (age >= g[i].age && age <= g[i + 1].age) {
              const f = (age - g[i].age) / (g[i + 1].age - g[i].age || 1);
              w = g[i].w.map((x, k) => x + (g[i + 1].w[k] - x) * f);
              break;
            }
          }
        }
      }
      for (let k = 0; k < NC; k++) target[a * NC + k] = w[k];
    }
  };

  // ============================================================== year loop
  for (let t = 0; t < n; t++) {
    const y = startYear + t;
    cpiIdx[t] = cpi;
    healthIdx[t] = health;
    const infl = path.inflation[t];
    const yearWarnings: string[] = [];
    const fired: string[] = [];
    dep.fill(0);
    wd.fill(0);

    // ---------------------------------------------------------- 1. clock, deaths, milestones
    const ages: number[] = [];
    let nAlive = 0;
    for (let i = 0; i < nP; i++) {
      const age = y - c.people[i].birthYear;
      ages.push(age);
      if (alive[i] && age > deathAge[i]) {
        alive[i] = false;
        firstDeathYear = Math.min(firstDeathYear, y - 1);
        // Survivor inherits accounts and the larger Social Security benefit.
        const sIdx = i === 0 ? 1 : 0;
        if (nP === 2 && alive[sIdx]) {
          for (let a = 0; a < nA; a++) if (owner[a] === i) owner[a] = sIdx;
          const deceased =
            ssClaimedToday[i] > 0
              ? ssClaimedToday[i]
              : c.people[i].ssPiaAnnualToday *
                Math.max(1, c.people[i].ssAnnualToday / Math.max(1, c.people[i].ssPiaAnnualToday));
          ssSurvivorToday[sIdx] = deceased;
        }
      }
      if (alive[i]) nAlive++;
    }
    if (nAlive === 0) {
      out.n = t;
      break;
    }
    const primary = alive[0] ? 0 : 1;
    const openInvestable = investableTotal();
    const openAssets = assetTotal();
    const openDebts = debtTotal();

    for (let m = 0; m < plan.milestones.length; m++) {
      const ms = plan.milestones[m];
      if (Number.isNaN(milestoneYear[m]) && ms.when.type === 'condition') {
        const w = ms.when;
        const nw = openInvestable + openAssets - openDebts;
        const hit =
          w.metric === 'netWorth'
            ? nw >= (w.value / 100) * cpi
            : w.metric === 'investable'
              ? openInvestable >= (w.value / 100) * cpi
              : lastLivingSpend > 0 && openInvestable >= w.fiMultiple * lastLivingSpend * (1 + infl);
        if (hit) milestoneYear[m] = y;
      }
      if (milestoneYear[m] === y) {
        fired.push(ms.name);
        for (const e of ms.effects) {
          if (e.type === 'start' || e.type === 'stop') {
            const v = e.type === 'start' ? 1 : -1;
            if (e.target === 'income') {
              const i = c.incomeIndex.get(e.targetId);
              if (i !== undefined) incForce[i] = v;
            } else if (e.target === 'expense') {
              const i = c.expenseIndex.get(e.targetId);
              if (i !== undefined) expForce[i] = v;
            } else {
              const a = c.accountIndex.get(e.targetId);
              if (a !== undefined) contribStopped[a] = 1;
            }
          } else if (e.type === 'setAmount' || e.type === 'scaleAmount') {
            if (e.target === 'income') {
              const i = c.incomeIndex.get(e.targetId);
              if (i !== undefined) {
                if (e.type === 'setAmount') {
                  incBase[i] = e.amount / 100;
                  incIdx[i] = cpi;
                } else incBase[i] *= e.factor;
              }
            } else {
              const i = c.expenseIndex.get(e.targetId);
              if (i !== undefined)
                expBase[i] = e.type === 'setAmount' ? e.amount / 100 : expBase[i] * e.factor;
            }
          } else if (e.type === 'relocate') {
            state = e.state;
            county = e.countyFips;
          } else if (e.type === 'filingStatus') statusOverride = e.status;
        }
      }
    }
    // residence timeline
    for (const r of plan.people[primary].residence)
      if (r.fromYear === y && t > 0) {
        state = r.state;
        county = r.countyFips;
      }
    if (t === 0)
      for (const r of plan.people[primary].residence)
        if (r.fromYear <= y) {
          state = r.state;
          county = r.countyFips;
        }

    // ---------------------------------------------------------- 2. parameters
    let status: FilingStatus = nP === 2 ? 'mfj' : 'single';
    for (const f of plan.household.filingStatus) if (f.fromYear <= y) status = f.status;
    if (statusOverride) status = statusOverride;
    let kidsUnder17 = 0;
    let otherDeps = 0;
    for (const d of plan.household.dependents) {
      const a = y - d.birthYear;
      if (a >= 0 && a < 17) kidsUnder17++;
      else if (a >= 17 && a < 24) otherDeps++;
    }
    if (nP === 2 && nAlive === 1) {
      if (y === firstDeathYear) status = 'mfj';
      else if (y <= firstDeathYear + 2 && kidsUnder17 + otherDeps > 0) status = 'qss';
      else status = 'single';
    }
    const fedPick = pickYear(data.federal, y);
    const fp: FederalTaxParams = fedPick.dataYear === y ? fedPick.value : projectFederal(fedPick.value, y);
    const k = kFor(fedPick.dataYear, t, cpiIdx, A.inflation.rate);
    const dataStatus: 'enacted' | 'projected' =
      fedPick.dataYear === y ? fedPick.value.header.status : 'projected';
    const stYears = data.states[state];
    let sp: StateTaxParams | undefined;
    let kState = 1;
    if (stYears) {
      const pk = pickYear(stYears, y);
      sp = pk.value;
      kState = kFor(pk.dataYear, t, cpiIdx, A.inflation.rate);
    } else if (t === 0)
      yearWarnings.push(`No state tax data for ${state}; state income tax is treated as zero.`);
    const limPick = pickYear(data.limits, y);
    const lim = limPick.value;
    const kLim = kFor(limPick.dataYear, t, cpiIdx, A.inflation.rate);
    const medPick = pickYear(data.medicare, y);
    const med = medPick.value;
    const kMed = kFor(medPick.dataYear, t, healthIdx, A.inflation.rate + A.healthcareInflation.excessOverCpi);
    const kMedCpi = kFor(medPick.dataYear, t, cpiIdx, A.inflation.rate);
    const csPick = pickYear(data.costSharing, y);
    const cs = csPick.value;
    const kCs = kFor(csPick.dataYear, t, healthIdx, A.inflation.rate + A.healthcareInflation.excessOverCpi);
    const fplPick = pickYear(data.fpl, y - 1);
    const kFpl = kFor(fplPick.dataYear + 1, t, cpiIdx, A.inflation.rate);
    const apPick = pickYear(data.applicablePct, y).value;
    const ssPick = pickYear(data.socialSecurity, y);
    const kSs = kFor(ssPick.dataYear, t, cpiIdx, A.inflation.rate);
    const filerAges: number[] = [];
    for (let i = 0; i < nP; i++) if (alive[i] || y === firstDeathYear) filerAges.push(ages[i]);
    const personOfFiler = (fi: number): number => (nAlive === nP || y === firstDeathYear ? fi : primary);

    setTargets(y);

    // ---- rebalance on last year's drift (taxable gains land in this year's tax solve)
    let realizedGains = 0;
    let lossesHarvested = 0;
    for (let a = 0; a < nA; a++) {
      const o = a * NC;
      const b = bal(a);
      if (b <= 0) continue;
      let drift = 0;
      let sold = 0;
      for (let kk = 0; kk < NC; kk++) {
        const d = hold[o + kk] - b * target[o + kk];
        if (d > 0) sold += d;
        drift = Math.max(drift, Math.abs(d) / b);
      }
      const doIt = accts[a].glide
        ? true
        : S.rebalance.mode === 'annual'
          ? drift > 1e-9
          : S.rebalance.mode === 'threshold'
            ? drift > S.rebalance.band
            : false;
      if (!doIt) continue;
      if (accts[a].kind === Kind.Taxable && sold > 0) {
        const g = sold * (1 - basis[a] / b);
        realizedGains += g;
        basis[a] += g;
      }
      for (let kk = 0; kk < NC; kk++) hold[o + kk] = b * target[o + kk];
    }
    // ---- tax-loss harvesting (TAX-08)
    if (S.lossHarvest.enabled) {
      for (let a = 0; a < nA; a++) {
        if (accts[a].kind !== Kind.Taxable) continue;
        const b = bal(a);
        if (basis[a] > b + 1) {
          lossesHarvested += basis[a] - b;
          basis[a] = b;
        }
      }
    }
    open.set(hold);
    let openTotal = 0;
    for (let i = 0; i < nA * NC; i++) openTotal += hold[i];

    // ---------------------------------------------------------- asset purchases / sales / debts starting
    let assetSales = 0;
    let purchases = 0;
    let saleGain = 0;
    let loanProceeds = 0;
    for (let i = 0; i < assets.length; i++) {
      const as = assets[i];
      const src = plan.assets[i];
      if (
        !as.owned &&
        src.purchase &&
        Number.isNaN(as.purchaseYear) &&
        resolve(src.purchase.when, Infinity) === y
      ) {
        as.owned = true;
        as.purchaseYear = y;
        as.value = (src.value / 100) * cpi;
        as.basis = as.value;
        const down = as.value * src.purchase.downPaymentPct;
        purchases += down + as.value * src.purchase.closingCostPct;
        const loan = as.value - down;
        if (loan > 0) {
          debts.push({
            id: `__mortgage_${as.id}`,
            name: `${as.name} mortgage`,
            principal: loan,
            rate: src.purchase.mortgageRate,
            kind: 'mortgage',
            revolvingPayPct: 0,
            payment: levelPayment(loan, src.purchase.mortgageRate, src.purchase.mortgageTermYears * 12),
            linkedAssetId: as.id,
            deductible: true,
            active: true,
            startYear: y,
            refi: [],
          });
        }
      }
      if (as.owned && src.sale && Number.isNaN(as.saleYear) && resolve(src.sale.when, Infinity) === y) {
        as.saleYear = y;
        as.owned = false;
        const net = as.value * (1 - src.sale.sellingCostPct);
        let payoff = 0;
        for (const d of debts)
          if (d.active && d.linkedAssetId === as.id) {
            payoff += d.principal;
            d.principal = 0;
            d.active = false;
          }
        let gain = net - as.basis;
        if (as.kind === 'primaryHome')
          gain -=
            status === 'mfj' || status === 'qss' ? fp.homeSaleExclusion.mfj : fp.homeSaleExclusion.single;
        if (gain > 0 || as.kind === 'rental')
          saleGain += Math.max(as.kind === 'rental' ? -Infinity : 0, gain);
        assetSales += net - payoff;
        as.value = 0;
      }
    }
    let refiCosts = 0;
    for (let i = 0; i < debts.length; i++) {
      const d = debts[i];
      const src = plan.debts[i];
      if (!src) continue;
      if (!d.active && Number.isNaN(d.startYear) && resolve(src.start, Infinity) === y) {
        d.active = true;
        d.startYear = y;
        loanProceeds += d.principal;
      }
      if (d.active)
        for (const r of src.refinance) {
          if (resolve(r.when, Infinity) === y) {
            refiCosts += d.principal * r.costPct;
            d.rate = r.rate;
            d.payment = levelPayment(d.principal, r.rate, r.termYears * 12);
          }
        }
    }

    // ---------------------------------------------------------- 3. gross income
    const wages = [0, 0];
    const seInc = [0, 0];
    const earned = [0, 0];
    const retirementInc = [0, 0];
    let pension = 0;
    let annuityTaxable = 0;
    let annuityCash = 0;
    let rental = 0;
    let rentalCash = 0;
    let otherOrd = 0;
    let otherCash = 0;
    let otherQd = 0;
    let otherLtcg = 0;
    let windfall = 0;
    let windfallTaxable = 0;
    for (let i = 0; i < nI; i++) {
      const inc = plan.incomes[i];
      const o = c.people.findIndex((p) => p.id === inc.ownerId);
      const oi = o < 0 ? primary : o;
      let active = y >= resolve(inc.start, startYear) && y < resolve(inc.end, Infinity);
      if (incForce[i] === 1 && y < resolve(inc.end, Infinity)) active = true;
      if (incForce[i] === -1) active = false;
      let amt = active ? incBase[i] * incIdx[i] : 0;
      if (active && !alive[oi]) {
        // Pensions pay the survivor percentage; everything else stops with its owner.
        amt = inc.kind === 'pension' && inc.pension && nAlive > 0 ? amt * inc.pension.survivorPct : 0;
      }
      incAmt[i] = amt;
      if (amt === 0) continue;
      const who = alive[oi] ? oi : primary;
      switch (inc.taxCharacter) {
        case 'earned':
          wages[who] += amt;
          earned[who] += amt;
          break;
        case 'selfEmployment':
          seInc[who] += amt;
          earned[who] += amt;
          break;
        case 'qualifiedDividend':
          otherQd += amt;
          otherCash += amt;
          break;
        case 'capitalGain':
          otherLtcg += amt;
          otherCash += amt;
          break;
        case 'taxFree':
          otherCash += amt;
          break;
        default:
          if (inc.kind === 'pension') {
            pension += amt;
            retirementInc[who] += amt;
          } else if (inc.kind === 'annuity') {
            annuityCash += amt;
            annuityTaxable += amt * (1 - inc.annuityExclusionRatio);
            retirementInc[who] += amt * (1 - inc.annuityExclusionRatio);
          } else if (inc.kind === 'rental') {
            rental += amt;
            rentalCash += amt;
          } else {
            otherOrd += amt;
            otherCash += amt;
          }
      }
    }
    // milestone windfalls
    for (let m = 0; m < plan.milestones.length; m++) {
      if (milestoneYear[m] !== y) continue;
      for (const e of plan.milestones[m].effects) {
        if (e.type !== 'windfall') continue;
        const a = c.accountIndex.get(e.accountId) ?? c.sweepAccount;
        const amt = (e.amount / 100) * cpi;
        deposit(a, amt);
        if (accts[a].kind === Kind.Taxable || accts[a].kind === Kind.Deferred) basis[a] += amt;
        if (accts[a].kind === Kind.Roth) rothContrib[a] += amt;
        windfall += amt;
        if (e.taxable) windfallTaxable += amt;
      }
    }

    // ---- Social Security
    const ssByPerson = [0, 0];
    let ssTotal = 0;
    const cut =
      A.socialSecurityCut.enabled && y >= A.socialSecurityCut.fromYear ? A.socialSecurityCut.payablePct : 1;
    for (let i = 0; i < nP; i++) {
      if (!alive[i]) continue;
      const p = c.people[i];
      let b = 0;
      if (y >= p.ssClaimYear && p.ssAnnualToday >= 0) {
        let own = p.ssAnnualToday;
        // Spousal top-up once both have claimed.
        if (nP === 2) {
          const sI = i === 0 ? 1 : 0;
          const sp2 = c.people[sI];
          if (alive[sI] && y >= sp2.ssClaimYear) {
            const excess = 0.5 * sp2.ssPiaAnnualToday - p.ssPiaAnnualToday;
            if (excess > 0) own += excess * spousalFactor(p.ssClaimMonths, p.ssFraMonths);
          }
        }
        ssClaimedToday[i] = own;
        b = own * (y === p.ssClaimYear ? p.ssFirstYearFraction : 1);
      }
      if (ssSurvivorToday[i] > 0 && ages[i] >= 60) b = Math.max(b, ssSurvivorToday[i]);
      b *= cpi * cut;
      if (b > 0 && earned[i] > 0) {
        const ageMonthsStart = (y - p.birthYear) * 12 - (p.birthMonth - 1);
        b -= earningsTestWithholding(
          b,
          earned[i],
          ageMonthsStart,
          p.ssFraMonths,
          ssPick.value.earningsTest.underFra * kSs,
          ssPick.value.earningsTest.yearOfFra * kSs,
        );
      }
      ssByPerson[i] = b;
      ssTotal += b;
    }

    // ---- taxable-account investment income (reinvested: raises basis)
    let interest = 0;
    let qDiv = otherQd;
    let oDiv = 0;
    for (let a = 0; a < nA; a++) {
      const kd = accts[a].kind;
      if (kd !== Kind.Taxable && kd !== Kind.Cash) continue;
      const o = a * NC;
      const fy = accts[a].fixedYield;
      let int: number;
      let div = 0;
      if (fy) int = bal(a) * Math.max(0, fy.real ? fy.rate + infl : fy.rate);
      else {
        int = hold[o + 1] * A.bondYield + hold[o + 2] * Math.max(0, path.returns[t * NC + 2]);
        div = (hold[o] + hold[o + 3]) * A.dividendYield + hold[o + 4] * A.dividendYield * 2;
      }
      interest += int;
      qDiv += div * A.qualifiedDividendPct;
      oDiv += div * (1 - A.qualifiedDividendPct);
      if (kd === Kind.Taxable) basis[a] += int + div;
    }

    // ---- required distributions (RMDs, inherited IRAs, 72(t))
    let rmdTotal = 0;
    let seppTotal = 0;
    let reqOrdinary = 0;
    for (const sc of S.sepp) {
      const a = c.accountIndex.get(sc.accountId);
      if (a === undefined) continue;
      const sy = resolve(sc.start, Infinity);
      if (sy === y && seppStart[a] < 0) {
        const p = c.people[owner[a]];
        const le = data.rmd.singleLife[String(y - p.birthYear)] ?? 30;
        seppAnnual[a] = seppAmortization(bal(a), sc.interestRate, le);
        seppStart[a] = y;
        seppEnd[a] = Math.max(y + 5, p.year59Half);
      }
    }
    for (let a = 0; a < nA; a++) {
      const ac = accts[a];
      if (ac.kind !== Kind.Pretax) continue;
      const p = c.people[owner[a]];
      const b = bal(a);
      let req = 0;
      if (seppStart[a] >= 0 && y < seppEnd[a]) {
        const s = Math.min(b, seppAnnual[a]);
        seppTotal += s;
        req = s;
      }
      if (ac.type === 'inheritedIra' && ac.src.inherited) {
        const since = y - ac.src.inherited.yearOfDeath;
        const r = inheritedRmd(
          data.rmd,
          ac.src.inherited.yearOfDeath + 1 - p.birthYear,
          since,
          ac.src.inherited.decedentHadStartedRmds,
          prevEnd[a],
        );
        req = Math.max(req, Math.min(b, r));
        rmdTotal += Math.min(b, r);
      } else if (alive[owner[a]]) {
        const r = Math.min(b, ownerRmd(data.rmd, p.birthYear, ages[owner[a]], prevEnd[a]));
        if (r > req) {
          rmdTotal += r - req;
          req = r;
        }
      }
      if (req > 0) {
        withdraw(a, req);
        reqOrdinary += req;
        retirementInc[alive[owner[a]] ? owner[a] : primary] += req;
      }
    }

    // ---------------------------------------------------------- healthcare coverage this year (needed for HSA + premiums)
    const covType: Coverage['type'][] = [];
    const covFrac: number[] = []; // fraction of the year on the primary coverage (COBRA run-out), remainder on ACA
    const covEntry: (Coverage | null)[] = [];
    const anyEarned = earned[0] + earned[1] > 0;
    for (let i = 0; i < nP; i++) {
      let type: Coverage['type'] = 'none';
      let entry: Coverage | null = null;
      let frac = 1;
      if (alive[i] && hc.enabled) {
        const hp = hcByPerson[i];
        let bestYear = -Infinity;
        if (hp)
          for (const cv of hp.coverage) {
            const fy = resolve(cv.from, startYear);
            if (fy <= y && fy >= bestYear) {
              bestYear = fy;
              entry = cv;
            }
          }
        // Employer coverage only lasts while the job does.
        if (
          entry &&
          ((entry.type === 'employer' && earned[i] <= 0) ||
            (entry.type === 'spouseEmployer' && earned[i === 0 ? 1 : 0] <= 0))
        )
          entry = null;
        if (entry) type = entry.type;
        else
          type =
            earned[i] > 0 || (anyEarned && nP === 2)
              ? earned[i] > 0
                ? 'employer'
                : 'spouseEmployer'
              : 'aca';
        if (type === 'cobra' && entry) {
          if (Number.isNaN(cobraStart[i])) cobraStart[i] = Math.max(bestYear, startYear);
          const used = 12 * (y - cobraStart[i]);
          const left = entry.cobraMonths - used;
          if (left <= 0) {
            type = 'aca';
            entry = null;
          } else frac = Math.min(12, left) / 12;
        }
        const medicareYear = c.people[i].birthYear + 65 + (c.people[i].birthMonth > 6 ? 1 : 0);
        if (y >= medicareYear && type !== 'employer' && type !== 'spouseEmployer') {
          type = 'medicare';
          frac = 1;
        }
      }
      covType.push(type);
      covFrac.push(frac);
      covEntry.push(entry);
    }

    // ---------------------------------------------------------- 4. payroll-level contributions
    let cPretax = 0;
    let cRoth = 0;
    let cHsa = 0;
    let cEmployer = 0;
    let cAfterTaxPayroll = 0;
    let adjustments = 0; // above-the-line (SEP / solo employer / direct HSA)
    const pretaxFromWagesBy = [0, 0];
    const hsaPayrollBy = [0, 0];
    const deferralUsed = [0, 0];
    const deferral457Used = [0, 0];
    const hsaContributed = [0, 0];
    const coveredByPlan = [false, false];
    const elective = lim.electiveDeferral * kLim;
    const catchUpFor = (age: number, simple: boolean): number => {
      if (age >= 60 && age <= 63) return (simple ? lim.simple.catchUp60to63 : lim.catchUp60to63) * kLim;
      if (age >= 50) return (simple ? lim.simple.catchUp50 : lim.catchUp50) * kLim;
      return 0;
    };
    const hsaLimitFor = (i: number): number => {
      const tp = covType[i];
      const en = covEntry[i];
      const eligible =
        tp === 'employer' || tp === 'spouseEmployer' || tp === 'cobra'
          ? !!en?.hdhp
          : tp === 'aca'
            ? en
              ? en.hdhp || en.metal === 'bronze' || en.metal === 'catastrophic'
              : false
            : false;
      if (!eligible) return 0;
      const sI = i === 0 ? 1 : 0;
      const family =
        (nP === 2 && alive[sI] && covType[sI] !== 'medicare' && covType[sI] !== 'none') ||
        kidsUnder17 + otherDeps > 0;
      // The family limit is shared; give it to the first eligible spouse and the catch-up to each.
      const baseLim = family ? (i === primary || hsaLimitShared === 0 ? lim.hsa.family : 0) : lim.hsa.self;
      return baseLim * kLim + (ages[i] >= 55 ? lim.hsa.catchUp55 : 0);
    };
    let hsaLimitShared = 0;
    for (let a = 0; a < nA; a++) {
      const ac = accts[a];
      const cfg = ac.src.contribution;
      if (!cfg || contribStopped[a] || ac.synthetic) continue;
      const oi = owner[a];
      if (!alive[oi]) continue;
      let salary = 0;
      if (cfg.incomeId) {
        const ii = c.incomeIndex.get(cfg.incomeId);
        salary = ii !== undefined ? incAmt[ii] : 0;
      } else
        salary =
          ac.type === 'sepIra' || ac.type === 'solo401k'
            ? seInc[oi]
            : wages[oi] + (ac.type === 'simpleIra' ? seInc[oi] : 0);
      if (salary <= 0) continue;
      const age = ages[oi];
      const wantBase = cfg.employeePct * salary + (cfg.employeeAmount / 100) * cpi;
      const comp = Math.min(salary, lim.compensationCap * kLim);
      if (ac.kind === Kind.Hsa) {
        const limit = Math.max(0, hsaLimitFor(oi) - hsaContributed[oi]);
        if (limit > 0 && lim.hsa.family > 0) hsaLimitShared = 1;
        const employer = Math.min(limit, cfg.employerFixedPct * comp);
        const emp = Math.min(limit - employer, cfg.maxOut ? limit : wantBase, salary);
        if (emp + employer <= 0) continue;
        deposit(a, emp + employer);
        hsaContributed[oi] += emp + employer;
        cHsa += emp;
        cEmployer += employer;
        if (wages[oi] > 0) {
          hsaPayrollBy[oi] += emp;
          pretaxFromWagesBy[oi] += emp;
        } else adjustments += emp;
        continue;
      }
      const isSimple = ac.type === 'simpleIra';
      const is457 = ac.type === 'gov457b';
      const isEmployerPlan =
        ac.type === 'trad401k' ||
        ac.type === 'trad403b' ||
        ac.type === 'roth401k' ||
        ac.type === 'solo401k' ||
        is457 ||
        isSimple;
      if (ac.type === 'sepIra') {
        const base = Math.max(0, seInc[oi] * 0.9235 * (1 - 0.0765)); // net SE earnings after the deductible half of SE tax (approx.)
        const amt = Math.min(
          lim.sep.limit * kLim,
          lim.sep.pctOfCompensation * base * 0.8,
          cfg.maxOut ? Infinity : wantBase || Infinity,
        );
        if (amt > 0) {
          deposit(a, amt);
          cPretax += amt;
          adjustments += amt;
          coveredByPlan[oi] = true;
        }
        continue;
      }
      if (!isEmployerPlan) continue;
      coveredByPlan[oi] = true;
      const used = is457 ? deferral457Used : deferralUsed;
      const baseLimit = isSimple ? lim.simple.limit * kLim : elective;
      const cu = catchUpFor(age, isSimple);
      const room = Math.max(0, baseLimit + cu - used[oi]);
      let emp = Math.min(room, cfg.maxOut ? room : wantBase, salary);
      // SECURE 2.0: catch-up dollars must be Roth for high earners; without a Roth plan account they are not allowed.
      const rothOnlyCatchUp =
        cu > 0 && prevWages[oi] > lim.rothCatchUpWageThreshold * kLim && ac.kind === Kind.Pretax && !isSimple;
      let catchUpToRoth = 0;
      if (rothOnlyCatchUp && used[oi] + emp > baseLimit) {
        const cuPart = used[oi] + emp - Math.max(baseLimit, used[oi]);
        const rothAcct = accts.findIndex((x, xi) => x.type === 'roth401k' && owner[xi] === oi);
        emp -= cuPart;
        if (rothAcct >= 0) {
          catchUpToRoth = cuPart;
          deposit(rothAcct, cuPart);
          rothContrib[rothAcct] += cuPart;
          cRoth += cuPart;
          used[oi] += cuPart;
        } else if (t === 0)
          yearWarnings.push(
            `Catch-up contributions for ${c.people[oi].name} must be Roth (prior-year wages above the threshold) and no Roth 401(k) exists, so they are skipped.`,
          );
      }
      if (emp > 0) {
        deposit(a, emp);
        used[oi] += emp;
        if (ac.kind === Kind.Roth) {
          cRoth += emp;
          rothContrib[a] += emp;
        } else if (ac.type === 'solo401k' && wages[oi] <= 0) {
          cPretax += emp;
          adjustments += emp;
        } else {
          cPretax += emp;
          pretaxFromWagesBy[oi] += emp;
        }
      }
      // employer match + non-elective
      let match = 0;
      let prevTier = 0;
      const deferred = emp + catchUpToRoth;
      for (const tier of cfg.employerMatch) {
        const tierCap = Math.max(0, tier.upToPctOfSalary - prevTier) * comp;
        const inTier = Math.max(0, Math.min(deferred - prevTier * comp, tierCap));
        match += inTier * tier.matchPct;
        prevTier = tier.upToPctOfSalary;
      }
      match += cfg.employerFixedPct * comp;
      if (ac.type === 'solo401k') match = Math.min(match, 0.2 * seInc[oi] * 0.9235);
      const additionsRoom = Math.max(0, lim.annualAdditions * kLim - Math.min(emp, baseLimit));
      match = Math.min(match, additionsRoom);
      if (match > 0) {
        let dest = a;
        if (ac.kind === Kind.Roth) {
          const pre = accts.findIndex(
            (x, xi) => (x.type === 'trad401k' || x.type === 'trad403b') && owner[xi] === oi,
          );
          if (pre >= 0) dest = pre;
        }
        deposit(dest, match);
        if (accts[dest].kind === Kind.Roth) rothContrib[dest] += 0; // employer money in a Roth account is treated as earnings
        cEmployer += match;
        if (ac.type === 'solo401k') adjustments += match;
      }
      // mega-backdoor Roth: after-tax contributions up to the 415(c) limit, converted in-plan
      if (cfg.megaBackdoor) {
        const mb = Math.max(0, Math.min(additionsRoom - match, salary - emp));
        const dest = cfg.megaBackdoorRothAccountId
          ? c.accountIndex.get(cfg.megaBackdoorRothAccountId)
          : accts.findIndex((x, xi) => x.kind === Kind.Roth && owner[xi] === oi);
        if (mb > 0 && dest !== undefined && dest >= 0) {
          deposit(dest, mb);
          rothContrib[dest] += mb;
          cAfterTaxPayroll += mb;
        }
      }
    }
    const payrollDeferrals = cPretax + cRoth + cHsa + cAfterTaxPayroll - adjustments; // cash leaving take-home via payroll
    const directContribCash = adjustments; // SEP / solo / direct HSA paid from household cash

    // ---------------------------------------------------------- 5. spending need
    const byCategory: Record<string, number> = {};
    let living = 0;
    let eduExpense = 0;
    const phaseAge = ages[primary];
    let phaseMult = 1;
    for (const ph of S.spendingPhases) if (phaseAge >= ph.fromAge) phaseMult = ph.multiplier;
    const survivorMult = nP === 2 && nAlive === 1 ? S.survivorSpendingPct : 1;
    const baseExpense = (i: number): number => {
      const e = plan.expenses[i];
      const sy = resolve(e.start, startYear);
      let active: boolean;
      if (e.recurrence.type === 'once') active = y === sy;
      else {
        active = y >= sy && y < resolve(e.end, Infinity);
        if (active && e.recurrence.type === 'interval') active = (y - sy) % e.recurrence.everyYears === 0;
      }
      if (expForce[i] === 1 && e.recurrence.type !== 'once') active = y < resolve(e.end, Infinity);
      if (expForce[i] === -1) active = false;
      if (!active) return 0;
      const idx =
        e.inflationIndex === 'cpi'
          ? cpi
          : e.inflationIndex === 'healthcare'
            ? health
            : e.inflationIndex === 'education'
              ? edu
              : e.inflationIndex === 'custom'
                ? Math.pow(1 + e.customRate, t)
                : 1;
      return (
        expBase[i] *
        idx *
        (e.followsPhases ? phaseMult : 1) *
        (e.recurrence.type === 'once' ? 1 : survivorMult)
      );
    };
    let plannedLiving = 0;
    const expAmt = new Float64Array(nE);
    for (let i = 0; i < nE; i++) {
      expAmt[i] = baseExpense(i);
      plannedLiving += expAmt[i];
    }

    // ---- flexible spending rules (STRAT-01)
    const rule = S.spendingRule;
    const nonPortfolioIncome =
      wages[0] + wages[1] + seInc[0] + seInc[1] + pension + annuityCash + ssTotal + rentalCash + otherCash;
    const ruleStart = rule.start
      ? resolve(rule.start, Infinity)
      : (() => {
          let ry = Infinity;
          plan.milestones.forEach((m, mi) => {
            if (m.kind === 'retirement' && !Number.isNaN(milestoneYear[mi]))
              ry = Math.min(ry, milestoneYear[mi]);
          });
          return ry === Infinity ? (anyEarned ? Infinity : startYear) : ry;
        })();
    if (rule.type !== 'fixed' && y >= ruleStart && plannedLiving > 0 && openInvestable > 0) {
      if (rule.type === 'percentOfPortfolio')
        spendMult = Math.max(0, rule.pct * openInvestable + nonPortfolioIncome * 0) / plannedLiving;
      else if (rule.type === 'floorCeiling')
        spendMult = Math.min(rule.ceiling, Math.max(rule.floor, (rule.pct * openInvestable) / plannedLiving));
      else {
        const need = Math.max(0, plannedLiving * spendMult - nonPortfolioIncome);
        const r = need / openInvestable;
        if (Number.isNaN(gkInitialRate)) gkInitialRate = r > 0 ? r : NaN;
        else if (r > gkInitialRate * (1 + rule.guardrailBand)) spendMult *= 1 - rule.guardrailAdjust;
        else if (r < gkInitialRate * (1 - rule.guardrailBand)) spendMult *= 1 + rule.guardrailAdjust;
        spendMult = Math.min(rule.ceiling, Math.max(rule.floor, spendMult));
      }
    } else if (rule.type !== 'fixed' && y >= ruleStart && openInvestable <= 0)
      spendMult = rule.type === 'percentOfPortfolio' ? 0 : rule.floor;
    for (let i = 0; i < nE; i++) {
      if (expAmt[i] === 0) continue;
      const e = plan.expenses[i];
      const v = expAmt[i] * (e.recurrence.type === 'once' ? 1 : spendMult);
      living += v;
      byCategory[e.category] = (byCategory[e.category] ?? 0) + v;
      if (e.category === 'education') eduExpense += v;
    }
    lastLivingSpend = living;

    // ---- debts and property costs
    let debtService = 0;
    let debtInterest = 0;
    let mortgageInterest = 0;
    let rentalCosts = 0;
    for (const d of debts) {
      if (!d.active || d.principal <= 0) continue;
      let intY = 0;
      let paid = 0;
      if (d.kind === 'revolving') {
        intY = d.principal * d.rate;
        const pr = d.principal * d.revolvingPayPct;
        paid = intY + pr;
        d.principal -= pr;
      } else {
        const mr = d.rate / 12;
        for (let m = 0; m < 12 && d.principal > 0.005; m++) {
          const im = d.principal * mr;
          const pay = d.payment > 0 ? Math.min(d.payment, d.principal + im) : im;
          intY += im;
          paid += pay;
          d.principal -= pay - im;
        }
      }
      if (d.principal <= 0.005) {
        d.principal = 0;
        d.active = false;
      }
      debtService += paid;
      debtInterest += intY;
      const linked = d.linkedAssetId ? assets.find((x) => x.id === d.linkedAssetId) : undefined;
      if (linked?.kind === 'rental') rentalCosts += intY;
      else if (d.deductible) mortgageInterest += intY;
    }
    let housing = 0;
    let propertyTax = 0;
    for (let i = 0; i < assets.length; i++) {
      const as = assets[i];
      const pr = plan.assets[i].property;
      if (!as.owned || !pr) continue;
      const ptax = as.value * pr.propertyTaxRate;
      const other = (pr.insuranceAnnual / 100 + pr.hoaAnnual / 100) * cpi + as.value * pr.maintenanceRate;
      housing += ptax + other;
      if (as.kind === 'rental') rentalCosts += ptax + other;
      else propertyTax += ptax;
    }
    const rentalNet = rental - rentalCosts;

    // ---- healthcare: premiums that do not depend on MAGI, Medicare, LTC
    let hPremiums = 0;
    let hOop = 0;
    let hMedicare = 0;
    let hIrmaa = 0;
    let hLtc = 0;
    let acaSlcsp = 0;
    let acaPremium = 0;
    let acaMembers = 0;
    let irmaaTierIdx = 0;
    const acaOopInputs: { metal: Coverage['metal']; util: 'low' | 'typical' | 'high'; frac: number }[] = [];
    if (hc.enabled) {
      const bench = benchmarkAge21(
        slcspByState[state],
        county,
        hc.slcspOverrideAge21Monthly ? hc.slcspOverrideAge21Monthly / 100 : undefined,
      );
      const slcspFile = slcspByState[state];
      const kSlcsp = slcspFile
        ? kFor(slcspFile.year, t, healthIdx, A.inflation.rate + A.healthcareInflation.excessOverCpi)
        : health;
      const benchMonthly = bench.monthly * (hc.slcspOverrideAge21Monthly ? health : kSlcsp);
      let anyAca = false;
      for (let i = 0; i < nP; i++) {
        if (!alive[i]) continue;
        const hp = hcByPerson[i];
        const util = hp?.utilization ?? 'typical';
        const tp = covType[i];
        const en = covEntry[i];
        const frac = covFrac[i];
        const addAca = (fr: number, metal: Coverage['metal']): void => {
          if (fr <= 0) return;
          anyAca = true;
          const f = ageRatingFactor(data.ageCurve, state, ages[i]);
          const b = benchMonthly * 12 * f * fr;
          acaSlcsp += b;
          acaPremium +=
            b * cs.tiers[metal].premiumRatioToSilver * (hp?.tobacco ? tobaccoRatio(data.ageCurve, state) : 1);
          acaMembers++;
          acaOopInputs.push({ metal, util, frac: fr });
        };
        if (tp === 'employer' || tp === 'spouseEmployer') {
          const prem =
            en?.premiumAnnual !== undefined
              ? (en.premiumAnnual / 100) * health
              : tp === 'spouseEmployer'
                ? (cs.employerPremium.employeeShareFamily - cs.employerPremium.employeeShareSingle) * kCs
                : cs.employerPremium.employeeShareSingle * kCs;
          hPremiums += prem;
          const payer = tp === 'employer' ? i : i === 0 ? 1 : 0;
          if (wages[payer] > 0) pretaxFromWagesBy[payer] += Math.min(prem, wages[payer]);
          hOop += cs.utilization[util].pctOfOopMax * cs.tiers.gold.oopMax * kCs;
        } else if (tp === 'cobra') {
          const full =
            en?.premiumAnnual !== undefined
              ? (en.premiumAnnual / 100) * health
              : cs.employerPremium.single * kCs;
          hPremiums += full * 1.02 * frac;
          hOop += cs.utilization[util].pctOfOopMax * cs.tiers.gold.oopMax * kCs * frac;
          addAca(1 - frac, 'silver');
        } else if (tp === 'aca') addAca(1, en?.metal ?? 'silver');
        else if (tp === 'medicare') {
          const m = hp?.medicare;
          const lookback = t >= 2 ? magiHist[t - 2] : t === 1 ? magiHist[0] : NaN;
          const ir = irmaaTier(
            med,
            kMedCpi,
            t >= 2 ? statusHist[t - 2] : status,
            Number.isNaN(lookback) ? 0 : lookback,
          );
          irmaaTierIdx = Math.max(irmaaTierIdx, ir.tier);
          const std = med.partB.standardMonthlyPremium * 12 * kMed;
          const partB = ir.row.partBMonthly * 12 * kMed;
          const dSur = ir.row.partDSurchargeMonthly * 12 * kMed;
          hMedicare += std;
          hIrmaa += partB - std + dSur;
          hPremiums += std + (partB - std) + dSur;
          if (m && !m.partAPremiumFree) hPremiums += med.partA.premiumUnder30Quarters * 12 * kMed;
          const df = med.defaults;
          const yearsOver65 = Math.max(0, ages[i] - 65);
          const sup = m?.supplement ?? 'medigapG';
          if (sup === 'advantage') {
            hPremiums += df.advantageMonthly * 12 * kMed;
            hOop +=
              Math.min(
                df.advantageMaxOop,
                df.advantageTypicalOop * (util === 'low' ? 0.5 : util === 'high' ? 2.5 : 1),
              ) * kMed;
          } else {
            hPremiums += df.partDPlanMonthly * 12 * kMed;
            hOop += Math.min(med.partD.outOfPocketCap, df.partDTypicalOop[util]) * kMed;
            if (sup === 'medigapG' || sup === 'medigapN') {
              hPremiums +=
                (sup === 'medigapG' ? df.medigapGMonthlyAt65 : df.medigapNMonthlyAt65) *
                12 *
                Math.pow(1 + df.medigapAgeRating, yearsOver65) *
                kMed;
              hOop += (sup === 'medigapG' ? df.medigapGTypicalOop : df.medigapNTypicalOop) * kMed;
            } else hOop += cs.utilization[util].pctOfOopMax * cs.tiers.silver.oopMax * kCs;
          }
          if (!m || m.dentalVisionHearing) hOop += df.dentalVisionHearingAnnual * kMed;
        }
        // long-term care (HC-10)
        const ltc = hp?.ltc;
        if (ltc && ltc.mode !== 'none') {
          const ev =
            ltc.mode === 'stochastic' && path.ltc
              ? path.ltc[i]
              : ltc.mode === 'expected' || !path.ltc
                ? { onsetAge: ltc.onsetAge, years: ltc.years }
                : null;
          const yearsIn = ev ? ages[i] - ev.onsetAge : -1;
          if (ev && yearsIn >= 0 && yearsIn < ev.years) {
            const fr = Math.min(1, ev.years - yearsIn);
            let cost = data.ltc.annualCost[ltc.careType] * (data.ltc.stateFactor[state] ?? 1) * health * fr;
            if (ltc.insurance && yearsIn < ltc.insurance.benefitYears)
              cost = Math.max(0, cost - (ltc.insurance.annualBenefit / 100) * fr);
            hLtc += cost;
          } else if (ltc.insurance && (!ev || yearsIn < 0))
            hPremiums += (ltc.insurance.premiumAnnual / 100) * cpi;
        }
      }
      if (anyAca && bench.flagged && t === 0)
        yearWarnings.push(
          `ACA benchmark premium uses ${bench.source}; enter your own SLCSP for a precise subsidy.`,
        );
    }
    const householdSize = nAlive + kidsUnder17 + otherDeps;
    const fplBase = fplAmount(fplPick.value, state, householdSize) * kFpl;
    const medicaidExpansion = data.acaStateRules.medicaidExpansion.includes(state);

    // ---------------------------------------------------------- 6. cash-flow and tax fixed point
    for (let i = 0; i < 2; i++) pretaxFromWagesBy[i] = Math.min(pretaxFromWagesBy[i], wages[i]);
    ti.status = status;
    ti.ages = filerAges;
    ti.childrenUnder17 = kidsUnder17;
    ti.otherDependents = otherDeps;
    ti.wages[0] = wages[0];
    ti.wages[1] = wages[1];
    ti.ficaWages[0] = wages[0] - hsaPayrollBy[0];
    ti.ficaWages[1] = wages[1] - hsaPayrollBy[1];
    ti.pretaxFromWages = pretaxFromWagesBy[0] + pretaxFromWagesBy[1];
    ti.selfEmployment[0] = seInc[0];
    ti.selfEmployment[1] = seInc[1];
    ti.interest = interest;
    ti.ordinaryDividends = oDiv;
    ti.qualifiedDividends = qDiv;
    ti.shortTermGains = 0;
    ti.lossCarryforward = lossCarry;
    ti.pensions = pension + annuityTaxable;
    ti.rentalNet = rentalNet;
    ti.socialSecurity = ssTotal;
    ti.taxExemptInterest = 0;
    ti.itemized.mortgageInterest = mortgageInterest;
    ti.itemized.charity = byCategory['giving'] ?? 0;
    const baseLtcg = realizedGains + otherLtcg + saleGain - lossesHarvested;
    const baseOrdinary = otherOrd + windfallTaxable;
    const baseIra = reqOrdinary;

    // penalty-free and total availability per account
    const earnedHousehold = earned[0] + earned[1];
    const penaltyFree = (a: number): boolean => {
      const ac = accts[a];
      const p = c.people[owner[a]];
      if (y >= p.year59Half) return true;
      if (ac.type === 'gov457b' || ac.type === 'inheritedIra') return true;
      if (ac.src.ruleOf55 && ages[owner[a]] >= 55 && earned[owner[a]] <= 0) return true;
      return false;
    };
    const rothSeasoned = (a: number): number => {
      const p = c.people[owner[a]];
      let s = rothContrib[a];
      const over = y >= p.year59Half;
      for (const l of rothLots[a]) if (over || l.year + 5 <= y) s += l.amount;
      return s;
    };
    let hsaQualified = 0;
    for (let a = 0; a < nA; a++) {
      const ac = accts[a];
      const b = bal(a);
      wAmt[a] = 0;
      totAvail[a] = b;
      let free = b;
      if (ac.kind === Kind.Pretax) {
        if (seppStart[a] >= 0 && y < seppEnd[a]) {
          free = 0;
          totAvail[a] = 0;
        } else free = penaltyFree(a) ? b : 0;
      } else if (ac.kind === Kind.Roth) {
        const p = c.people[owner[a]];
        const qualified = y >= p.year59Half && ac.rothFirstYear + 5 <= y;
        free = qualified ? b : Math.min(b, rothSeasoned(a));
      } else if (ac.kind === Kind.Hsa) free = 0;
      else if (ac.kind === Kind.Edu) free = 0;
      else if (ac.kind === Kind.Deferred)
        free = ac.type === 'annuity' && y < c.people[owner[a]].year59Half ? 0 : b;
      freeAvail[a] = free;
    }
    // Qualified HSA and 529 spending comes straight from those accounts.
    let hsaPaid = 0;
    let eduPaid = 0;
    const medicalOopKnown = hOop + hLtc;
    if (S.hsaUse === 'spend') {
      for (let a = 0; a < nA && hsaPaid < medicalOopKnown; a++) {
        if (accts[a].kind !== Kind.Hsa) continue;
        const take = Math.min(totAvail[a], medicalOopKnown - hsaPaid);
        if (take > 0) {
          withdraw(a, take);
          totAvail[a] -= take;
          hsaPaid += take;
        }
      }
    }
    hsaQualified = hsaPaid;
    for (let a = 0; a < nA && eduPaid < eduExpense; a++) {
      if (accts[a].kind !== Kind.Edu) continue;
      const b = bal(a);
      const take = Math.min(b, eduExpense - eduPaid);
      if (take > 0) {
        basis[a] -= take * (basis[a] / b);
        withdraw(a, take);
        totAvail[a] -= take;
        eduPaid += take;
      }
    }
    // 529-to-Roth rollover (PLAN-14)
    for (let a = 0; a < nA; a++) {
      const ac = accts[a];
      const cfg = ac.src.plan529;
      if (ac.kind !== Kind.Edu || !cfg?.rollToRoth) continue;
      const dest = cfg.rothRolloverAccountId
        ? c.accountIndex.get(cfg.rothRolloverAccountId)
        : c.conversionTarget[owner[a]];
      if (dest === undefined || dest < 0 || y - cfg.openedYear < lim.rollover529ToRoth.minAccountAgeYears)
        continue;
      const done = rolled529.get(a) ?? 0;
      const amt = Math.min(
        bal(a),
        lim.ira.limit * kLim,
        lim.rollover529ToRoth.lifetimeCap - done,
        earned[owner[dest]] > 0 ? earned[owner[dest]] : 0,
      );
      if (amt > 0) {
        const b = bal(a);
        basis[a] -= amt * (basis[a] / b);
        withdraw(a, amt);
        totAvail[a] -= amt;
        deposit(dest, amt);
        rothContrib[dest] += amt;
        rolled529.set(a, done + amt);
        iraUsedBy[owner[dest]] += amt;
      }
    }

    const cashInFixed =
      wages[0] +
      wages[1] +
      seInc[0] +
      seInc[1] +
      pension +
      annuityCash +
      ssTotal +
      rentalCash +
      otherCash +
      assetSales +
      loanProceeds +
      reqOrdinary;
    const spendingFixed =
      living - eduPaid + debtService + housing + purchases + refiCosts + hPremiums + hOop + hLtc - hsaPaid;
    const cashOutFixed = spendingFixed + payrollDeferrals + directContribCash;

    // withdrawal order for this year
    order.length = 0;
    const strat = S.withdrawalOrder.strategy;
    const rank = (a: number): number => {
      switch (accts[a].kind) {
        case Kind.Cash:
          return 0;
        case Kind.Taxable:
          return 1;
        case Kind.Deferred:
          return 2;
        case Kind.Pretax:
          return strat === 'bracketTargeted' ? -1 : 3;
        case Kind.Roth:
          return 4;
        case Kind.Hsa:
          return 5;
        default:
          return 6;
      }
    };
    if (strat === 'custom') {
      for (const id of S.withdrawalOrder.customOrder) {
        const a = c.accountIndex.get(id);
        if (a !== undefined) order.push(a);
      }
      const rest: number[] = [];
      for (let a = 0; a < nA; a++) if (!order.includes(a)) rest.push(a);
      rest.sort((x, z) => rank(x) - rank(z));
      order.push(...rest);
    } else {
      for (let a = 0; a < nA; a++) order.push(a);
      order.sort((x, z) => rank(x) - rank(z) || x - z);
    }
    let totalAvailAll = 0;
    for (let a = 0; a < nA; a++) totalAvailAll += totAvail[a];

    // conversion window + MAGI management
    const conv = S.rothConversion;
    const convActive =
      conv.mode !== 'none' && y >= resolve(conv.start, startYear) && y < resolve(conv.end, Infinity);
    const onAca = acaMembers > 0;
    const magiCap = S.magiTarget.enabled && onAca ? S.magiTarget.maxFplPct * fplBase : Infinity;
    const magiFloor =
      S.magiTarget.enabled && onAca && S.magiTarget.minFplPct > 0 ? S.magiTarget.minFplPct * fplBase : 0;
    const ts = tableStatus(status);

    // results of the last evaluation
    let eConv = 0;
    let eHarvest = 0;
    let eUnmet = 0;
    let eState = 0;
    let ePtc = 0;
    let eHealthAdj = 0;
    let eFplRatio = 0;
    let ePenBase = 0;
    let eDeduct = 0;
    let eBackdoorOrd = 0;
    let eMedicaid = false;
    let eAcaOop = 0;
    let pretaxCap = Infinity;
    let magiRoom = Infinity;
    let wOrd = 0;
    let wLtcg = 0;
    let wPen = 0;
    let wHsaPen = 0;
    let wEduPen = 0;

    const characterize = (): void => {
      wOrd = 0;
      wLtcg = 0;
      wPen = 0;
      wHsaPen = 0;
      wEduPen = 0;
      for (let a = 0; a < nA; a++) {
        const amt = wAmt[a];
        if (amt <= 0) continue;
        const ac = accts[a];
        const b = totAvail[a];
        switch (ac.kind) {
          case Kind.Taxable:
            wLtcg += amt * (1 - basis[a] / Math.max(b, 1e-9));
            break;
          case Kind.Pretax:
            wOrd += amt;
            if (!penaltyFree(a)) wPen += amt;
            break;
          case Kind.Roth: {
            const p = c.people[owner[a]];
            const qualified = y >= p.year59Half && ac.rothFirstYear + 5 <= y;
            if (qualified) break;
            let rem = amt - rothContrib[a];
            if (rem <= 0) break;
            const over = y >= p.year59Half;
            for (const l of rothLots[a]) {
              if (rem <= 0) break;
              const use = Math.min(rem, l.amount);
              if (!over && l.year + 5 > y) wPen += use;
              rem -= use;
            }
            if (rem > 0) {
              wOrd += rem;
              if (!over) wPen += rem;
            }
            break;
          }
          case Kind.Hsa:
            wOrd += amt;
            if (ages[owner[a]] < 65) wHsaPen += amt;
            break;
          case Kind.Edu: {
            const e = amt * (1 - basis[a] / Math.max(b, 1e-9));
            wOrd += e;
            wEduPen += e;
            break;
          }
          case Kind.Deferred: {
            const gain = Math.max(0, b - basis[a]);
            const g = Math.min(amt, gain);
            wOrd += g;
            if (ac.type === 'annuity' && y < c.people[owner[a]].year59Half) wPen += g;
            break;
          }
          default:
            break;
        }
      }
    };

    const planWithdrawals = (G: number): number => {
      wAmt.fill(0);
      let rem = G;
      if (rem <= 0) return 0;
      if (strat === 'proportional') {
        let pool = 0;
        for (let a = 0; a < nA; a++)
          if (accts[a].kind !== Kind.Hsa && accts[a].kind !== Kind.Edu) pool += freeAvail[a];
        if (pool > 0) {
          const f = Math.min(1, rem / pool);
          for (let a = 0; a < nA; a++)
            if (accts[a].kind !== Kind.Hsa && accts[a].kind !== Kind.Edu) {
              wAmt[a] = freeAvail[a] * f;
            }
          rem -= pool * f;
        }
      } else {
        // pass A: with bracket / MAGI caps
        let pRoom = strat === 'bracketTargeted' ? pretaxCap : Infinity;
        let mRoom = magiRoom;
        if (pRoom !== Infinity || mRoom !== Infinity) {
          for (let oi = 0; oi < order.length && rem > 0; oi++) {
            const a = order[oi];
            const kd = accts[a].kind;
            let cap = freeAvail[a];
            if (kd === Kind.Pretax) cap = Math.min(cap, pRoom, mRoom);
            else if (kd === Kind.Taxable && mRoom !== Infinity) {
              const gf = Math.max(0, 1 - basis[a] / Math.max(totAvail[a], 1e-9));
              if (gf > 1e-6) cap = Math.min(cap, mRoom / gf);
            } else if (kd === Kind.Hsa || kd === Kind.Edu) cap = 0;
            const take = Math.min(cap, rem);
            if (take <= 0) continue;
            wAmt[a] += take;
            rem -= take;
            if (kd === Kind.Pretax) {
              pRoom -= take;
              mRoom -= take;
            } else if (kd === Kind.Taxable && mRoom !== Infinity)
              mRoom -= take * Math.max(0, 1 - basis[a] / Math.max(totAvail[a], 1e-9));
          }
        }
        // pass B: penalty-free amounts, no caps (pre-tax goes after Roth when a cap was active, to protect the cap)
        for (let pass = 0; pass < 2 && rem > 0; pass++) {
          for (let oi = 0; oi < order.length && rem > 0; oi++) {
            const a = order[oi];
            const isPre = accts[a].kind === Kind.Pretax;
            const capped = (pretaxCap !== Infinity && strat === 'bracketTargeted') || magiRoom !== Infinity;
            if (capped ? (pass === 0) === isPre : pass === 1) continue;
            const take = Math.min(freeAvail[a] - wAmt[a], rem);
            if (take <= 0) continue;
            wAmt[a] += take;
            rem -= take;
          }
        }
      }
      // pass C: penalized sources, least costly first (unseasoned Roth conversions, pre-tax, Roth earnings, HSA, 529)
      if (rem > 0) {
        for (let pass = 0; pass < 4 && rem > 0; pass++) {
          for (let a = 0; a < nA && rem > 0; a++) {
            const kd = accts[a].kind;
            const want =
              pass === 0
                ? kd === Kind.Roth
                : pass === 1
                  ? kd === Kind.Pretax || kd === Kind.Deferred
                  : pass === 2
                    ? kd === Kind.Hsa
                    : true;
            if (!want) continue;
            const take = Math.min(totAvail[a] - wAmt[a], rem);
            if (take <= 0) continue;
            wAmt[a] += take;
            rem -= take;
          }
        }
      }
      return rem;
    };

    let convCapacity = 0;
    const setLedger = (extraOrd: number, convAmt: number, harvest: number, deductible: number): void => {
      ti.longTermGains = baseLtcg + wLtcg + harvest;
      ti.iraDistributions = baseIra + wOrd;
      ti.rothConversions = convAmt;
      ti.otherOrdinary = baseOrdinary + extraOrd;
      ti.adjustments = adjustments + deductible;
      ti.itemized.stateLocalTax = prevStateTax + propertyTax;
      ti.earlyWithdrawalPenaltyBase = wPen;
      ti.hsaPenaltyBase = wHsaPen;
      ti.edu529PenaltyBase = wEduPen;
    };

    let harvestable = 0;
    if (S.gainHarvest.enabled)
      for (let a = 0; a < nA; a++)
        if (accts[a].kind === Kind.Taxable) harvestable += Math.max(0, bal(a) - basis[a]);

    /** Net household cash for a gross discretionary withdrawal G (positive = surplus). */
    const evaluate = (G: number, withWaterfall: boolean): number => {
      eUnmet = planWithdrawals(G);
      characterize();
      convCapacity = 0;
      if (convActive || magiFloor > 0) {
        for (let a = 0; a < nA; a++) {
          const ac = accts[a];
          if (
            ac.kind === Kind.Pretax &&
            ac.type !== 'inheritedIra' &&
            !(seppStart[a] >= 0 && y < seppEnd[a]) &&
            alive[owner[a]]
          )
            convCapacity += totAvail[a] - wAmt[a];
        }
      }
      let cv = 0;
      let hv = 0;
      let deduct = withWaterfall ? eDeduct : 0;
      let bdOrd = withWaterfall ? eBackdoorOrd : 0;
      // --- conversions (TAX-07) solved inside the loop
      if (convCapacity > 0 && (convActive || magiFloor > 0)) {
        setLedger(bdOrd, 0, 0, deduct);
        federalTax(fp, k, ti, fedTmp);
        let want = 0;
        if (convActive) {
          if (conv.mode === 'fixed' || conv.mode === 'ladder') want = (conv.amount / 100) * cpi;
          else if (conv.mode === 'magiTarget')
            want = Math.max(
              0,
              Math.min(magiCap === Infinity ? S.magiTarget.maxFplPct * fplBase : magiCap, Infinity) -
                fedTmp.magiAca,
            );
          else {
            const top = bracketTop(fp.ordinaryBrackets[ts], conv.bracketRate, k);
            const room = top === Infinity ? convCapacity : top - fedTmp.ordinaryTaxable;
            want = Math.max(0, room);
            if (want > 0 && top !== Infinity) {
              // A conversion can raise ordinary income by more than its own size (more Social Security becomes taxable,
              // deductions phase out), so close in on the bracket top with regula falsi.
              const base0 = fedTmp.ordinaryTaxable;
              const magi0 = fedTmp.magiAca;
              let cLo = 0;
              let gLo = base0 - top;
              let cTry = Math.min(want, convCapacity);
              for (let it = 0; it < 6 && cTry > 0; it++) {
                setLedger(bdOrd, cTry, 0, deduct);
                federalTax(fp, k, ti, fedTmp);
                const g = fedTmp.ordinaryTaxable - top;
                if (g <= 0.5) {
                  if (g > -1 || cTry >= convCapacity) break;
                  cLo = cTry;
                  gLo = g;
                  cTry = Math.min(convCapacity, cTry - g);
                } else cTry = cLo + ((cTry - cLo) * -gLo) / (g - gLo);
              }
              want = Math.max(0, cTry);
              fedTmp.magiAca = magi0;
            }
          }
        }
        if (magiFloor > 0) want = Math.max(want, magiFloor - fedTmp.magiAca);
        if (magiCap !== Infinity) want = Math.min(want, Math.max(0, magiCap - fedTmp.magiAca));
        cv = Math.max(0, Math.min(want, convCapacity));
      }
      // --- 0% bracket gain harvesting (TAX-08)
      if (harvestable > 0) {
        setLedger(bdOrd, cv, 0, deduct);
        federalTax(fp, k, ti, fedTmp);
        const top0 = bracketTop(fp.capitalGainsBrackets[ts], 0, k);
        let room = top0 - fedTmp.taxableIncome;
        if (magiCap !== Infinity) room = Math.min(room, magiCap - fedTmp.magiAca);
        hv = Math.max(0, Math.min(harvestable - Math.max(0, wLtcg), room));
        if (hv > 0 && ssTotal > 0) {
          setLedger(bdOrd, cv, hv, deduct);
          federalTax(fp, k, ti, fedTmp);
          const over = fedTmp.taxableIncome - top0;
          if (over > 1) hv = Math.max(0, hv - over);
        }
      }
      let net = 0;
      for (let pass = 0; pass < 4; pass++) {
        setLedger(bdOrd, cv, hv, deduct);
        federalTax(fp, k, ti, fed);
        // state
        eState = stateTax(sp, kState, {
          status,
          federalAgi: fed.agi,
          federalTaxableIncome: fed.taxableIncome,
          federalDeduction: fed.deduction,
          taxableSocialSecurity: fed.taxableSocialSecurity,
          retirementIncome: [
            retirementInc[personOfFiler(0)] + (wOrd + cv) * (filerAges.length === 1 ? 1 : 0.5),
            filerAges.length > 1 ? retirementInc[1] + (wOrd + cv) * 0.5 : 0,
          ],
          ages: filerAges,
          longTermGains: Math.max(0, ti.longTermGains),
          dependents: kidsUnder17 + otherDeps,
        });
        // healthcare that depends on MAGI: Medicaid, PTC, cost-sharing reductions
        ePtc = 0;
        eHealthAdj = 0;
        eMedicaid = false;
        eAcaOop = 0;
        eFplRatio = fplBase > 0 ? fed.magiAca / fplBase : 0;
        if (acaMembers > 0) {
          if (medicaidExpansion && eFplRatio < data.acaStateRules.medicaidFplThreshold) eMedicaid = true;
          else {
            ePtc = premiumTaxCredit(apPick, acaSlcsp, acaPremium, fed.magiAca, fplBase);
            for (const o of acaOopInputs)
              eAcaOop += acaExpectedOop(cs, o.metal, o.util, eFplRatio) * kCs * o.frac;
            eHealthAdj = acaPremium + eAcaOop;
          }
        }
        net = cashInFixed + (G - eUnmet) - cashOutFixed - eHealthAdj + ePtc - fed.total - eState;
        if (!withWaterfall || net <= 1) break;
        // deductible contributions in the waterfall feed back into tax
        const dry = waterfall(net, false, fed.magiAca);
        if (Math.abs(dry.deductible - deduct) < 1 && Math.abs(dry.backdoorOrdinary - bdOrd) < 1) break;
        deduct = dry.deductible;
        bdOrd = dry.backdoorOrdinary;
      }
      eConv = cv;
      eHarvest = hv;
      eDeduct = deduct;
      eBackdoorOrd = bdOrd;
      ePenBase = wPen;
      return net;
    };

    // ---- surplus waterfall (step 7); `commit` = false is a dry run that reports the tax-relevant parts
    const iraUsed = iraUsedBy;
    const waterfall = (
      surplus: number,
      commit: boolean,
      magi: number,
    ): { deductible: number; backdoorOrdinary: number; saved: number } => {
      let rem = surplus;
      let deductible = 0;
      let backdoorOrd = 0;
      let saved = 0;
      const iraUse = [iraUsed[0], iraUsed[1]];
      const hsaUse = [hsaContributed[0], hsaContributed[1]];
      const put = (a: number, amt: number): void => {
        if (amt <= 0) return;
        rem -= amt;
        saved += amt;
        if (!commit) return;
        deposit(a, amt);
        const kd = accts[a].kind;
        if (kd === Kind.Taxable || kd === Kind.Deferred || kd === Kind.Edu) basis[a] += amt;
        else if (kd === Kind.Roth) rothContrib[a] += amt;
      };
      for (const step of S.surplusWaterfall) {
        if (rem <= 0.5) break;
        if (step.type === 'emergencyFund') {
          const a = c.accountIndex.get(step.accountId);
          if (a === undefined) continue;
          const tgt = (step.months / 12) * (living + housing + debtService + hPremiums);
          put(a, Math.min(rem, Math.max(0, tgt - bal(a))));
        } else if (step.type === 'debt') {
          const d = debts.find((x) => x.id === step.debtId);
          if (!d || !d.active) continue;
          const amt = Math.min(
            rem,
            d.principal,
            step.maxAnnual !== undefined ? (step.maxAnnual / 100) * cpi : Infinity,
          );
          if (amt > 0) {
            rem -= amt;
            if (commit) {
              d.principal -= amt;
              extraDebtPaid += amt;
              if (d.principal <= 0.005) {
                d.principal = 0;
                d.active = false;
              }
            }
          }
        } else {
          const a = c.accountIndex.get(step.accountId);
          if (a === undefined) continue;
          const ac = accts[a];
          const oi = owner[a];
          if (!alive[oi]) continue;
          const cap = step.maxAnnual !== undefined ? (step.maxAnnual / 100) * cpi : Infinity;
          let amt = 0;
          if (ac.type === 'rothIra' || ac.type === 'tradIra') {
            const limit = Math.max(
              0,
              Math.min(lim.ira.limit * kLim + (ages[oi] >= 50 ? lim.ira.catchUp50 : 0), earnedHousehold) -
                iraUse[oi],
            );
            amt = Math.min(rem, cap, limit);
            if (amt <= 0) continue;
            if (ac.type === 'rothIra') {
              const range =
                status === 'mfj' || status === 'qss'
                  ? lim.rothIraPhaseout.mfj
                  : status === 'mfs'
                    ? lim.rothIraPhaseout.mfs
                    : lim.rothIraPhaseout.single;
              const lo = range[0] * kLim;
              const hi = range[1] * kLim;
              const allowed = magi <= lo ? amt : magi >= hi ? 0 : amt * (1 - (magi - lo) / (hi - lo));
              if (allowed < amt) {
                if (S.backdoorRoth) {
                  // Backdoor: non-deductible traditional contribution converted at once; pro-rata rule on existing pre-tax IRA money.
                  let pre = 0;
                  for (let x = 0; x < nA; x++)
                    if (
                      owner[x] === oi &&
                      (accts[x].type === 'tradIra' ||
                        accts[x].type === 'sepIra' ||
                        accts[x].type === 'simpleIra')
                    )
                      pre += bal(x);
                  const viaBackdoor = amt - allowed;
                  backdoorOrd += viaBackdoor * (pre / (pre + viaBackdoor));
                } else amt = allowed;
              }
              iraUse[oi] += amt;
              put(a, amt);
            } else {
              const range =
                status === 'mfj' || status === 'qss'
                  ? coveredByPlan[oi]
                    ? lim.tradIraDeductionPhaseout.mfj
                    : lim.tradIraDeductionPhaseout.mfjSpouseNotCovered
                  : status === 'mfs'
                    ? lim.tradIraDeductionPhaseout.mfs
                    : lim.tradIraDeductionPhaseout.single;
              const anyCovered = coveredByPlan[oi] || (nP === 2 && coveredByPlan[oi === 0 ? 1 : 0]);
              const lo = range[0] * kLim;
              const hi = range[1] * kLim;
              const dedShare = !anyCovered
                ? 1
                : magi <= lo
                  ? 1
                  : magi >= hi
                    ? 0
                    : 1 - (magi - lo) / (hi - lo);
              deductible += amt * dedShare;
              iraUse[oi] += amt;
              put(a, amt);
            }
          } else if (ac.kind === Kind.Hsa) {
            amt = Math.min(rem, cap, Math.max(0, hsaLimitFor(oi) - hsaUse[oi]));
            if (amt > 0) {
              deductible += amt;
              hsaUse[oi] += amt;
              put(a, amt);
            }
          } else if (ac.kind === Kind.Edu) {
            amt = Math.min(rem, cap === Infinity ? fp.giftExclusion * k * nAlive : cap);
            put(a, amt);
          } else if (ac.type === 'iBond') put(a, Math.min(rem, cap, lim.iBondPurchaseCap * nAlive));
          else if (ac.kind === Kind.Taxable || ac.kind === Kind.Cash || ac.kind === Kind.Deferred)
            put(a, Math.min(rem, cap));
        }
      }
      if (rem > 0.005) put(c.sweepAccount, rem);
      if (commit) {
        iraUsed[0] = iraUse[0];
        iraUsed[1] = iraUse[1];
      }
      return { deductible, backdoorOrdinary: backdoorOrd, saved };
    };

    // baseline (no discretionary withdrawals) to size the bracket / MAGI caps
    wAmt.fill(0);
    wOrd = 0;
    wLtcg = 0;
    wPen = 0;
    wHsaPen = 0;
    wEduPen = 0;
    eDeduct = 0;
    eBackdoorOrd = 0;
    setLedger(0, 0, 0, 0);
    federalTax(fp, k, ti, fedTmp);
    if (strat === 'bracketTargeted') {
      const top = bracketTop(fp.ordinaryBrackets[ts], S.withdrawalOrder.bracketRate, k);
      pretaxCap = Math.max(0, top - fedTmp.ordinaryTaxable);
    }
    magiRoom = magiCap === Infinity ? Infinity : Math.max(0, magiCap - fedTmp.magiAca);
    if (t === 0 || (t === 1 && Number.isNaN(magiHist[0]))) magiHist[t] = fedTmp.magiIrmaa;

    // ---- solve
    let G = 0;
    let f = evaluate(0, true);
    let iterations = 1;
    let shortfall = 0;
    if (f < -0.5) {
      // Fixed-point iteration (G <- G - f) with a secant step once two points exist; bisection if it oscillates.
      let lo = 0;
      let hi = Infinity;
      let gPrev = 0;
      let fPrev = f;
      let converged = false;
      for (let it = 0; it < 25; it++) {
        let next = G - f;
        if (it > 0 && Math.abs(f - fPrev) > 1e-9) {
          const sec = G - (f * (G - gPrev)) / (f - fPrev);
          if (Number.isFinite(sec)) next = sec;
        }
        if (next <= lo || next >= hi || (it >= 12 && hi !== Infinity))
          next = hi !== Infinity ? (lo + hi) / 2 : Math.max(G - f, lo + 1);
        next = Math.max(0, Math.min(next, totalAvailAll));
        gPrev = G;
        fPrev = f;
        G = next;
        f = evaluate(G, false);
        iterations++;
        if (eUnmet > 0.5 || (G >= totalAvailAll - 0.5 && f < 0)) {
          converged = true;
          break;
        }
        if (Math.abs(f) < 0.5) {
          converged = true;
          break;
        }
        if (f >= 0) hi = Math.min(hi, G);
        else lo = Math.max(lo, G);
        if (hi - lo < 0.5) {
          converged = true;
          break;
        }
      }
      // At a discontinuity (e.g. the subsidy cliff) settle on the funded side.
      if (f < -0.5 && hi !== Infinity && eUnmet <= 0.5) {
        G = hi;
        f = evaluate(G, false);
        iterations++;
      }
      if (!converged) {
        out.solver.nonConverged++;
        yearWarnings.push(
          'Tax solver did not fully converge this year; the result is within the last bracket tested.',
        );
      }
      if (f < -0.5) shortfall = -f;
    }
    out.solver.maxIterations = Math.max(out.solver.maxIterations, iterations);

    // ---- commit withdrawals
    let wPretax = 0;
    let wRoth = 0;
    let wTaxable = 0;
    let wCash = 0;
    let wHsa = 0;
    let wOther = 0;
    const byAccount: Record<string, number> = {};
    for (let a = 0; a < nA; a++) {
      const amt = wAmt[a];
      if (wd[a] + amt > 0 && detail) byAccount[accts[a].id] = wd[a] + amt;
      if (amt <= 0) continue;
      const ac = accts[a];
      const b = totAvail[a];
      switch (ac.kind) {
        case Kind.Taxable:
          basis[a] -= amt * (basis[a] / Math.max(b, 1e-9));
          wTaxable += amt;
          break;
        case Kind.Cash:
          wCash += amt;
          break;
        case Kind.Pretax:
          wPretax += amt;
          retirementInc[alive[owner[a]] ? owner[a] : primary] += amt;
          break;
        case Kind.Roth: {
          let rem = amt;
          const u = Math.min(rem, rothContrib[a]);
          rothContrib[a] -= u;
          rem -= u;
          for (const l of rothLots[a]) {
            if (rem <= 0) break;
            const x = Math.min(rem, l.amount);
            l.amount -= x;
            rem -= x;
          }
          wRoth += amt;
          break;
        }
        case Kind.Hsa:
          wHsa += amt;
          break;
        case Kind.Edu:
          basis[a] -= amt * (basis[a] / Math.max(b, 1e-9));
          wOther += amt;
          break;
        case Kind.Deferred: {
          const gain = Math.max(0, b - basis[a]);
          basis[a] -= Math.max(0, amt - gain);
          wOther += amt;
          break;
        }
        default:
          break;
      }
      withdraw(a, amt);
    }
    // ---- commit conversion
    if (eConv > 0) {
      let rem = eConv;
      for (let a = 0; a < nA && rem > 0.005; a++) {
        const ac = accts[a];
        if (
          ac.kind !== Kind.Pretax ||
          ac.type === 'inheritedIra' ||
          (seppStart[a] >= 0 && y < seppEnd[a]) ||
          !alive[owner[a]]
        )
          continue;
        const dest = c.conversionTarget[owner[a]];
        if (dest < 0) continue;
        const b = bal(a);
        const x = Math.min(rem, b);
        if (x <= 0) continue;
        // move in kind (no market exposure change beyond the target account's mix)
        const o = a * NC;
        const fct = 1 - x / b;
        for (let kk = 0; kk < NC; kk++) hold[o + kk] *= fct;
        wd[a] += x;
        deposit(dest, x);
        rothLots[dest].push({ year: y, amount: x });
        rem -= x;
      }
      eConv -= rem;
    }
    // ---- commit harvest
    if (eHarvest > 0 && harvestable > 0) {
      for (let a = 0; a < nA; a++)
        if (accts[a].kind === Kind.Taxable)
          basis[a] += (Math.max(0, bal(a) - basis[a]) / harvestable) * eHarvest;
    }
    // ---- 7. surplus
    let saved = 0;
    extraDebtPaid = 0;
    if (f > 0.005) saved = waterfall(f, true, fed.magiAca).saved;
    iraUsedBy[0] = 0;
    iraUsedBy[1] = 0;

    const fedIncomeTax = fed.incomeTax;
    const taxTotal = fed.total + eState - ePtc;
    lossCarry = fed.lossCarryforwardOut;
    magiHist[t] = fed.magiIrmaa;
    statusHist[t] = status;
    prevStateTax = eState;
    prevWages = [wages[0], wages[1]];

    // ---------------------------------------------------------- 8. returns, 9. fees
    let retDollars = 0;
    let feeDollars = 0;
    const fx = c.flowExponent;
    for (let a = 0; a < nA; a++) {
      const o = a * NC;
      const fy = accts[a].fixedYield;
      let before = 0;
      let after = 0;
      for (let kk = 0; kk < NC; kk++) {
        const r = fy ? (fy.real ? fy.rate + infl : fy.rate) : path.returns[t * NC + kk];
        const op = open[o + kk];
        const cur = hold[o + kk];
        const flow = cur - op;
        const g = 1 + r;
        let end = op * g + flow * (fx === 1 ? g : fx === 0 ? 1 : Math.sqrt(Math.max(0, g)));
        if (end < 0) end = 0;
        before += cur;
        after += end;
        hold[o + kk] = end;
      }
      retDollars += after - before;
      if (accts[a].fee > 0 && after > 0) {
        const fee = after * accts[a].fee;
        for (let kk = 0; kk < NC; kk++) hold[o + kk] *= 1 - accts[a].fee;
        feeDollars += fee;
      }
      prevEnd[a] = bal(a);
    }
    // real assets appreciate
    for (let i = 0; i < assets.length; i++) {
      const as = assets[i];
      if (!as.owned) continue;
      const g = plan.assets[i].appreciation;
      as.value *= g.basis === 'real' ? (1 + infl) * (1 + g.rate) : 1 + g.rate;
    }

    // ---------------------------------------------------------- 10. record
    const investable = investableTotal();
    const assetVal = assetTotal();
    const debtVal = debtTotal();
    const healthTotal = hPremiums + hOop + hLtc + eHealthAdj;
    const spendingTotal = spendingFixed + hsaPaid + eduPaid + eHealthAdj - shortfall;
    out.investable[t] = investable;
    out.netWorth[t] = investable + assetVal - debtVal;
    out.spending[t] = spendingTotal;
    out.taxes[t] = taxTotal;
    out.shortfall[t] = shortfall;
    out.cpi[t] = cpi;
    out.lifetimeTax += taxTotal / cpi;
    if (shortfall > 1 && out.success) {
      out.success = false;
      out.failedYear = y;
    }

    if (detail) {
      let depSum = 0;
      let wdSum = 0;
      for (let a = 0; a < nA; a++) {
        depSum += dep[a];
        wdSum += wd[a];
      }
      const balances: Record<string, number> = {};
      const byKind = { taxable: 0, cash: 0, pretax: 0, roth: 0, hsa: 0, other: 0 };
      for (let a = 0; a < nA; a++) {
        const b = bal(a);
        if (accts[a].synthetic && b === 0) continue;
        balances[accts[a].id] = b;
        const kd = accts[a].kind;
        if (kd === Kind.Taxable) byKind.taxable += b;
        else if (kd === Kind.Cash) byKind.cash += b;
        else if (kd === Kind.Pretax) byKind.pretax += b;
        else if (kd === Kind.Roth) byKind.roth += b;
        else if (kd === Kind.Hsa) byKind.hsa += b;
        else byKind.other += b;
      }
      const incomeTotal =
        wages[0] + wages[1] + seInc[0] + seInc[1] + pension + annuityCash + ssTotal + rentalCash + otherCash;
      const gross = incomeTotal + wOrd + eConv + Math.max(0, ti.longTermGains);
      out.records!.push({
        year: y,
        t,
        cpi,
        ages,
        alive: alive.slice(),
        filingStatus: status,
        state,
        dataStatus,
        milestones: fired,
        coverage: covType.slice(),
        income: {
          wages: wages[0] + wages[1],
          selfEmployment: seInc[0] + seInc[1],
          pension,
          annuity: annuityCash,
          socialSecurity: ssTotal,
          rental: rentalCash,
          other: otherCash,
          windfall,
          assetSales,
          total: incomeTotal,
        },
        contributions: {
          pretax: cPretax,
          roth: cRoth + cAfterTaxPayroll,
          hsa: cHsa,
          employer: cEmployer,
          afterTax: saved,
          total: cPretax + cRoth + cAfterTaxPayroll + cHsa + cEmployer + saved,
        },
        withdrawals: {
          total: G - eUnmet + reqOrdinary + hsaQualified + eduPaid,
          rmd: rmdTotal,
          sepp: seppTotal,
          pretax: wPretax + reqOrdinary,
          roth: wRoth,
          taxable: wTaxable,
          cash: wCash,
          hsa: wHsa + hsaQualified,
          other: wOther + eduPaid,
          byAccount,
        },
        rothConversion: eConv,
        gainsHarvested: eHarvest,
        lossesHarvested,
        realizedGains: ti.longTermGains,
        expenses: {
          living,
          byCategory,
          housing,
          debtService,
          debtInterest,
          purchases: purchases + refiCosts,
          healthcare: {
            premiums: hPremiums + (eMedicaid ? 0 : acaMembers > 0 ? acaPremium : 0),
            outOfPocket: hOop + eAcaOop,
            medicare: hMedicare,
            irmaa: hIrmaa,
            ltc: hLtc,
            total: healthTotal,
            hsaPaid,
          },
          total: spendingTotal,
        },
        taxes: {
          federalIncome: fedIncomeTax,
          state: eState,
          fica: fed.ficaEmployee + fed.additionalMedicareTax,
          selfEmployment: fed.selfEmploymentTax,
          niit: fed.niit,
          amt: fed.amt,
          penalties: fed.penalties,
          ptc: ePtc,
          total: taxTotal,
          agi: fed.agi,
          magi: fed.magiAca,
          taxableIncome: fed.taxableIncome,
          ordinaryTaxable: fed.ordinaryTaxable,
          ordinaryTax: fed.ordinaryTax,
          capitalGainsTax: fed.capitalGainsTax,
          deduction: fed.deduction,
          taxableSocialSecurity: fed.taxableSocialSecurity,
          marginalRate: fed.marginalRate,
          effectiveRate: gross > 0 ? taxTotal / gross : 0,
          irmaaTier: irmaaTierIdx,
          fplRatio: eFplRatio,
        },
        balances,
        byKind,
        investable,
        assets: assetVal,
        debts: debtVal,
        netWorth: investable + assetVal - debtVal,
        returns: retDollars,
        fees: feeDollars,
        saved,
        shortfall,
        spendingMultiplier: spendMult,
        check: {
          opening: openTotal,
          deposits: depSum,
          withdrawals: wdSum,
          closing: investable,
          cashIn: cashInFixed - reqOrdinary + (wdSum - eConv) + ePtc,
          cashOut:
            spendingFixed +
            hsaPaid +
            eduPaid +
            eHealthAdj -
            shortfall +
            payrollDeferrals +
            directContribCash +
            fed.total +
            eState +
            saved +
            extraDebtPaid,
        },
        warnings: yearWarnings,
      });
      void ePenBase;
    }
    for (const w of yearWarnings) if (!warnings.includes(w)) warnings.push(w);

    // ---------------------------------------------------------- 11. inflate
    cpi *= 1 + infl;
    health *= 1 + infl + path.healthExcess[t];
    edu *= 1 + infl + A.inflation.educationExcess;
    for (let i = 0; i < nI; i++) {
      const g = plan.incomes[i].growth;
      const inc = plan.incomes[i];
      const gr = inc.kind === 'pension' && inc.pension ? inc.pension.cola : g;
      incIdx[i] *= gr.basis === 'real' ? (1 + infl) * (1 + gr.rate) : 1 + gr.rate;
    }
    cpiIdx[t + 1] = cpi;
    healthIdx[t + 1] = health;
  }

  // ------------------------------------------------------------ estate (STRAT-03, TAX-14)
  const last = Math.max(0, out.n - 1);
  const estateValue = out.netWorth[last];
  let pretaxLeft = 0;
  let stepUp = 0;
  for (let a = 0; a < nA; a++) {
    const b = bal(a);
    if (accts[a].kind === Kind.Pretax || accts[a].kind === Kind.Deferred)
      pretaxLeft += accts[a].kind === Kind.Pretax ? b : Math.max(0, b - basis[a]);
    if (accts[a].kind === Kind.Taxable) stepUp += Math.max(0, b - basis[a]);
  }
  for (const as of assets) if (as.owned) stepUp += Math.max(0, as.value - as.basis);
  const fedLast = pickYear(data.federal, startYear + last);
  const kLast = cpi / (cpiIdx[Math.max(0, Math.min(out.n, fedLast.dataYear - startYear))] || 1);
  const eTax = estateTax(fedLast.value, kLast, Math.max(0, estateValue), false);
  const drag = pretaxLeft * S.estate.heirMarginalRate;
  out.estate = {
    value: estateValue,
    estateTax: eTax,
    heirPretaxDrag: drag,
    stepUpGains: stepUp,
    netToHeirs: estateValue - eTax - drag,
  };
  plan.milestones.forEach((m, i) => {
    if (!Number.isNaN(milestoneYear[i])) out.milestoneYears[m.id] = milestoneYear[i];
  });
  return out;
}

/** Build a constant-return path for the deterministic projection. */
export function fixedPath(c: Compiled, years?: number): PathInputs {
  const n = years ?? c.maxYears;
  const A = c.plan.assumptions;
  const r = A.returns.fixed;
  let per = [r.usStocks, r.usBonds, r.cash, r.intlStocks, r.reits];
  let infl = A.inflation.rate;
  if (A.returns.mode === 'historicalAverage') {
    const m = c.data.market;
    const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
    // geometric means so the deterministic path compounds like history did
    const geo = (xs: number[]): number => Math.exp(mean(xs.map((x) => Math.log(1 + x)))) - 1;
    per = [geo(m.usStocks), geo(m.usBonds), geo(m.cash), r.intlStocks, r.reits];
    infl = geo(m.inflation);
  }
  const returns = new Float64Array(n * NC);
  const inflation = new Float64Array(n).fill(infl);
  const healthExcess = new Float64Array(n).fill(A.healthcareInflation.excessOverCpi);
  for (let t = 0; t < n; t++) for (let k = 0; k < NC; k++) returns[t * NC + k] = per[k];
  return { years: n, returns, inflation, healthExcess };
}

export type { CAccount };
