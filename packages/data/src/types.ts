/**
 * Dataset contracts (plan §8.1). Every JSON file under packages/data/<domain>/... has a `header`
 * block and a body that matches one of the interfaces below. All money is in whole US dollars
 * (datasets are law/parameter tables, not plan files). Rates are decimals (0.22 = 22%).
 */

export type DataStatus = 'enacted' | 'projected';

export interface DataHeader {
  /** URL of the primary source document. */
  source: string;
  publisher: string;
  /** ISO date the raw input was retrieved. */
  retrieved: string;
  status: DataStatus;
  /** Statutes / Rev. Procs. / notices the numbers come from. */
  lawRefs: string[];
  /** sha256 of the raw input (or of the canonical body when hand-transcribed; say which in `notes`). */
  sha256: string;
  /** Schema id, e.g. "federal-tax.v1". */
  schema: string;
  notes?: string;
  /** Per-field flags, e.g. { "cash": "approximated before 1928" }. */
  flags?: Record<string, string>;
}

export type FilingStatus = 'single' | 'mfj' | 'mfs' | 'hoh' | 'qss';
/** qss uses the mfj tables; datasets only list these four. */
export type TableStatus = 'single' | 'mfj' | 'mfs' | 'hoh';
export type ByStatus<T> = Record<TableStatus, T>;

/** A marginal bracket: `rate` applies to income above the previous bracket's `upTo` and up to this `upTo`. The last bracket has upTo = null. */
export interface Bracket {
  upTo: number | null;
  rate: number;
}

// ---------------------------------------------------------------- federal tax

export interface FederalTaxParams {
  header: DataHeader;
  year: number;
  ordinaryBrackets: ByStatus<Bracket[]>;
  standardDeduction: ByStatus<number>;
  /** Additional standard deduction per qualifying condition (age 65+ or blind). */
  additionalStandardDeduction: { unmarried: number; married: number };
  /** OBBBA senior deduction (2025-2028). `perPerson` is 0 in years it does not apply. */
  seniorDeduction: {
    perPerson: number;
    phaseoutStart: { single: number; mfj: number };
    phaseoutRate: number;
  };
  /** SALT cap. Cap is reduced by `phaseDownRate` x (MAGI - phaseDownStart) but not below `floor`. MFS gets half. */
  salt: { cap: number; phaseDownStart: number; phaseDownRate: number; floor: number };
  /** Long-term gain / qualified dividend brackets: thresholds on TAXABLE income. */
  capitalGainsBrackets: ByStatus<Bracket[]>;
  /** NIIT (not indexed). */
  niit: { rate: number; threshold: ByStatus<number> };
  amt: {
    exemption: ByStatus<number>;
    phaseoutStart: ByStatus<number>;
    /** Exemption phase-out rate (0.25 historically, 0.50 from 2026 under OBBBA). */
    phaseoutRate: number;
    /** AMTI (after exemption) above which the 28% rate applies. MFS is half of this. */
    rate28Threshold: number;
    rates: [number, number];
  };
  childTaxCredit: {
    perChild: number;
    refundableMax: number;
    otherDependent: number;
    phaseoutStart: ByStatus<number>;
    /** $ of credit lost per $1,000 (or part) of MAGI above the threshold. */
    phaseoutPer1000: number;
    /** ACTC: 15% of earned income above this floor. */
    refundableEarnedIncomeFloor: number;
    refundableRate: number;
  };
  fica: {
    socialSecurityRate: number; // employee share, 0.062
    socialSecurityWageBase: number;
    medicareRate: number; // employee share, 0.0145
    additionalMedicareRate: number; // 0.009
    additionalMedicareThreshold: ByStatus<number>; // not indexed
    /** Net-earnings factor for SE tax (0.9235). */
    seNetEarningsFactor: number;
  };
  /** Provisional-income thresholds for taxing Social Security (not indexed). */
  socialSecurityTaxation: { base: ByStatus<number>; adjusted: ByStatus<number> };
  capitalLossLimit: { default: number; mfs: number };
  estate: { exemption: number; rate: number };
  /** Annual gift exclusion. */
  giftExclusion: number;
  /** §121 home-sale exclusion (not indexed). */
  homeSaleExclusion: { single: number; mfj: number };
  /** Early-withdrawal additional tax rates. */
  penalties: { earlyRetirement: number; hsaNonQualified: number; education529: number };
  /** Which fields are indexed for inflation when projecting future years. Anything not listed is frozen. */
  indexed: string[];
}

// ---------------------------------------------------------------- state tax

export interface StateTaxParams {
  header: DataHeader;
  year: number;
  /** Two-letter postal code. */
  state: string;
  name: string;
  kind: 'none' | 'flat' | 'graduated';
  /** For flat states a single bracket per status. Empty for `none`. */
  brackets: ByStatus<Bracket[]>;
  standardDeduction: ByStatus<number>;
  /** Per-person exemption (deduction form). */
  personalExemption: number;
  /** Per-person exemption taken as a credit against tax (e.g. CA). */
  personalExemptionCredit: number;
  /** Extra deduction per filer aged 65+. */
  seniorExtraDeduction: number;
  /** Starting point of the state base. */
  startingPoint: 'federalAGI' | 'federalTaxableIncome';
  /** Is federally-taxable Social Security taxed by the state? */
  taxesSocialSecurity: boolean;
  /** Retirement-income exclusion (pensions + traditional-account distributions), per person. */
  retirementIncomeExclusion: { amountPerPerson: number | 'all'; minAge: number };
  /** Fraction of long-term gains excluded from state income (0 for most states). */
  longTermGainExclusionPct: number;
  /** Are brackets/deductions inflation-indexed by statute? */
  indexed: boolean;
  /** Extra surtax brackets on taxable income (e.g. CA mental-health 1% over $1M, MA 4% over ~$1M). */
  surtax?: { threshold: number; rate: number }[];
}

// ---------------------------------------------------------------- contribution limits

export interface LimitsParams {
  header: DataHeader;
  year: number;
  /** 402(g) elective deferral limit for 401(k)/403(b)/457(b). */
  electiveDeferral: number;
  catchUp50: number;
  /** Ages 60-63 super catch-up (replaces catchUp50 for those ages). */
  catchUp60to63: number;
  /** Prior-year FICA wages above which catch-up contributions must be Roth. */
  rothCatchUpWageThreshold: number;
  /** 415(c) annual additions limit (employee + employer + after-tax). */
  annualAdditions: number;
  /** 401(a)(17) compensation cap. */
  compensationCap: number;
  ira: { limit: number; catchUp50: number };
  /** Roth IRA contribution phase-out ranges on MAGI. */
  rothIraPhaseout: { single: [number, number]; mfj: [number, number]; mfs: [number, number] };
  /** Traditional IRA deduction phase-out for active plan participants. */
  tradIraDeductionPhaseout: {
    single: [number, number];
    mfj: [number, number];
    /** Non-covered spouse of a covered participant. */
    mfjSpouseNotCovered: [number, number];
    mfs: [number, number];
  };
  simple: { limit: number; catchUp50: number; catchUp60to63: number };
  sep: { pctOfCompensation: number; limit: number };
  hsa: {
    self: number;
    family: number;
    catchUp55: number;
    hdhpMinDeductible: { self: number; family: number };
    hdhpMaxOop: { self: number; family: number };
  };
  /** 529-to-Roth rollover (SECURE 2.0). */
  rollover529ToRoth: { lifetimeCap: number; minAccountAgeYears: number };
  /** I-bond annual purchase cap per person. */
  iBondPurchaseCap: number;
}

// ---------------------------------------------------------------- social security

export interface SocialSecurityParams {
  header: DataHeader;
  year: number;
  /** COLA effective for benefits payable in January of `year` (decimal). */
  cola: number;
  wageBase: number;
  /** PIA bend points for workers first eligible (age 62) in `year`. */
  bendPoints: [number, number];
  piaFactors: [number, number, number]; // 0.90, 0.32, 0.15
  /** Annual earnings-test exempt amounts. */
  earningsTest: { underFra: number; yearOfFra: number };
  /** Earnings needed for one quarter of coverage. */
  quarterOfCoverage: number;
}

/** Long series shared across years (ss/series.json). */
export interface SocialSecuritySeries {
  header: DataHeader;
  /** National Average Wage Index by year. */
  awi: Record<string, number>;
  /** Contribution and benefit base (taxable maximum) by year. */
  wageBase: Record<string, number>;
  /** COLA by year it was effective (Dec of prior year), decimal. */
  cola: Record<string, number>;
  /** Bend points by year of first eligibility. */
  bendPoints: Record<string, [number, number]>;
  /** Full retirement age in months by birth year; last entry applies to all later years. */
  fraMonthsByBirthYear: Record<string, number>;
  /** Trust-fund depletion scenario default from the latest Trustees Report. */
  trusteesShortfall: { depletionYear: number; payablePct: number };
}

// ---------------------------------------------------------------- RMD tables

export interface RmdTables {
  header: DataHeader;
  /** Uniform Lifetime Table: age -> distribution period. */
  uniformLifetime: Record<string, number>;
  /** Single Life Expectancy Table (beneficiaries): age -> life expectancy. */
  singleLife: Record<string, number>;
  /** RMD starting age by birth year range (SECURE 2.0). */
  startAge: { bornThrough: number | null; age: number }[];
}

// ---------------------------------------------------------------- medicare

export interface IrmaaTier {
  /** MAGI above this (and up to the next tier's value) lands in this tier. Tier 0 starts at 0. */
  magiOver: number;
  /** Total Part B monthly premium for the tier (standard + surcharge). */
  partBMonthly: number;
  /** Part D monthly surcharge on top of the plan premium. */
  partDSurchargeMonthly: number;
}

export interface MedicareParams {
  header: DataHeader;
  year: number;
  partB: { standardMonthlyPremium: number; annualDeductible: number };
  /** Part A premium for people with <30 / 30-39 quarters, and the inpatient deductible. */
  partA: { premiumUnder30Quarters: number; premium30to39Quarters: number; inpatientDeductible: number };
  partD: { nationalBaseBeneficiaryPremium: number; outOfPocketCap: number; deductibleMax: number };
  /** IRMAA tiers keyed by filing status of the tax return from two years earlier. `mfj` also applies to qss; `single` to hoh. */
  irmaa: { single: IrmaaTier[]; mfj: IrmaaTier[]; mfs: IrmaaTier[] };
  /** Typical monthly premiums used as editable defaults (benchmarks only; flagged as estimates). */
  defaults: {
    medigapGMonthlyAt65: number;
    medigapNMonthlyAt65: number;
    /** Annual % by which Medigap premiums rise with attained age, on top of inflation. */
    medigapAgeRating: number;
    advantageMonthly: number;
    advantageTypicalOop: number;
    advantageMaxOop: number;
    partDPlanMonthly: number;
    dentalVisionHearingAnnual: number;
    /** Typical annual out-of-pocket (cost sharing) with Original Medicare + Medigap G / N. */
    medigapGTypicalOop: number;
    medigapNTypicalOop: number;
    /** Typical Part D drug cost sharing per year by utilization. */
    partDTypicalOop: { low: number; typical: number; high: number };
  };
}

// ---------------------------------------------------------------- ACA

export interface FplParams {
  header: DataHeader;
  /** Guideline year (published each January). PTC for coverage year Y uses guidelines of year Y-1. */
  year: number;
  contiguous: { base: number; perAdditional: number };
  alaska: { base: number; perAdditional: number };
  hawaii: { base: number; perAdditional: number };
}

export interface ApplicablePctParams {
  header: DataHeader;
  /** Coverage (plan) year. */
  year: number;
  /** Linear interpolation of the applicable percentage between `initial` and `final` within each FPL band. fplFrom/fplTo are multiples (1.33 = 133%). */
  bands: { fplFrom: number; fplTo: number | null; initial: number; final: number }[];
  /** If true, no credit at or above `cliffFpl` x FPL. */
  hasCliff: boolean;
  cliffFpl: number;
  /** Minimum FPL multiple for PTC eligibility (1.0; lawfully-present exceptions ignored). */
  minFpl: number;
  /** Repayment caps on excess APTC by FPL band; `null` cap = full repayment. */
  repaymentCaps: { fplTo: number | null; single: number | null; other: number | null }[];
}

export interface AcaAgeCurve {
  header: DataHeader;
  /** Federal default curve: age (0-64, "64" covers 64+) -> factor relative to age 21 = 1.0. */
  federal: Record<string, number>;
  /** State-specific curves, same shape. */
  states: Record<string, Record<string, number>>;
  /** States with community rating (no age factor). */
  communityRated: string[];
  /** Max tobacco surcharge ratio by state (1.5 federal default; 1.0 where banned). */
  tobaccoMaxRatio: { default: number; states: Record<string, number> };
}

/** One file per state per plan year: health/aca/slcsp/<year>/<ST>.json */
export interface SlcspStateFile {
  header: DataHeader;
  year: number;
  state: string;
  /** 'ffe' = HealthCare.gov (from CMS PUF), 'sbe' = state-based exchange. */
  exchange: 'ffe' | 'sbe';
  /** Benchmark quality: 'county' = computed per county from plan data; 'state-average' = one statewide approximation (flagged). */
  quality: 'county' | 'rating-area' | 'state-average';
  /** Monthly SLCSP premium for a 21-year-old non-tobacco user (age factor 1.0), by 5-digit county FIPS. */
  counties: Record<
    string,
    {
      name: string;
      ratingArea?: string;
      slcspAge21: number;
      lowestBronzeAge21?: number;
      lowestGoldAge21?: number;
    }
  >;
  /** Statewide fallback when the county is unknown. */
  stateAverageAge21: number;
}

export interface AcaStateRules {
  header: DataHeader;
  /** States (incl. DC) that expanded Medicaid to 138% FPL. */
  medicaidExpansion: string[];
  /** State-based exchange states (not on HealthCare.gov). */
  stateBasedExchanges: string[];
  /** Medicaid adult eligibility as an FPL multiple in expansion states (1.38). */
  medicaidFplThreshold: number;
}

export interface AcaCostSharingParams {
  header: DataHeader;
  year: number;
  /** Federal out-of-pocket maximum (self-only / family). */
  oopMax: { self: number; family: number };
  /** Typical plan design by metal tier (editable defaults). */
  tiers: Record<
    'catastrophic' | 'bronze' | 'silver' | 'gold' | 'platinum',
    { actuarialValue: number; deductible: number; oopMax: number; premiumRatioToSilver: number }
  >;
  /** CSR silver variants by FPL band. */
  csr: { fplTo: number; actuarialValue: number; deductible: number; oopMax: number }[];
  /** Expected annual out-of-pocket spend as a fraction of the plan's OOP max, by utilization profile. */
  utilization: Record<'low' | 'typical' | 'high', { pctOfOopMax: number }>;
  /** Typical full employer-plan premium (KFF EHBS, single / family, annual) for COBRA defaults. */
  employerPremium: {
    single: number;
    family: number;
    employeeShareSingle: number;
    employeeShareFamily: number;
  };
}

export interface HealthInflationParams {
  header: DataHeader;
  /** Default long-run healthcare cost growth (nominal, decimal) from CMS NHE projections. */
  defaultNominal: number;
  /** Default excess over CPI. */
  excessOverCpi: number;
  /** Standard deviation of the excess used in stochastic mode. */
  excessStdDev: number;
  /** Year -> projected per-capita growth (NHE). */
  nheProjection: Record<string, number>;
}

export interface LtcParams {
  header: DataHeader;
  year: number;
  /** National median annual costs (CareScout/Genworth Cost of Care). */
  annualCost: {
    homeCare: number;
    assistedLiving: number;
    nursingHomeSemiPrivate: number;
    nursingHomePrivate: number;
  };
  /** State cost multiplier relative to national median (1.0 default). */
  stateFactor: Record<string, number>;
  /** Probability a 65-year-old ever needs paid LTC, and average duration in years, by sex. */
  incidence: {
    male: { probability: number; avgYears: number };
    female: { probability: number; avgYears: number };
  };
  /** Typical age at onset used for the deterministic scenario. */
  typicalOnsetAge: number;
}

// ---------------------------------------------------------------- mortality

export interface MortalityTable {
  header: DataHeader;
  /** Table year. */
  year: number;
  /** q(x): probability of dying within one year at exact age x, index = age 0..119. */
  male: number[];
  female: number[];
}

// ---------------------------------------------------------------- market history

export interface MarketHistory {
  header: DataHeader;
  /** First calendar year in the arrays. */
  startYear: number;
  /** Calendar years covered (length n). All returns are NOMINAL annual total returns as decimals (Jan-Jan or Dec-Dec; say which in header.notes). */
  years: number[];
  usStocks: number[];
  usBonds: number[];
  cash: number[];
  /** CPI-U inflation over the same year (decimal). */
  inflation: number[];
  /** Per-series coverage flags, e.g. cash approximated before 1928. */
  approximatedBefore: { usStocks?: number; usBonds?: number; cash?: number; inflation?: number };
}

/** Damodaran cross-check + Trinity-study bond series (market/damodaran.json). */
export interface DamodaranHistory {
  header: DataHeader;
  years: number[];
  sp500: number[];
  tBill3m: number[];
  tBond10y: number[];
  baaCorporate: number[];
  inflation: number[];
}

/** Default forward-looking assumptions for parametric mode (market/assumptions.json). */
export interface ReturnAssumptions {
  header: DataHeader;
  classes: ('usStocks' | 'usBonds' | 'cash' | 'intlStocks' | 'reits')[];
  /** Arithmetic mean nominal return and volatility per class. */
  mean: Record<string, number>;
  stdDev: Record<string, number>;
  /** Correlation matrix in `classes` order. */
  correlation: number[][];
  inflationMean: number;
  inflationStdDev: number;
}
