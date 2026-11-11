/** The bundle of datasets the engine needs, and the pure assembler that builds it from loaded JSON files. */
import type {
  AcaAgeCurve,
  AcaCostSharingParams,
  AcaStateRules,
  ApplicablePctParams,
  DamodaranHistory,
  DataHeader,
  FederalTaxParams,
  FplParams,
  HealthInflationParams,
  LimitsParams,
  LtcParams,
  MarketHistory,
  MedicareParams,
  MortalityTable,
  ReturnAssumptions,
  RmdTables,
  SlcspStateFile,
  SocialSecurityParams,
  SocialSecuritySeries,
  StateTaxParams,
} from './types';

/** Bump when any dataset changes (plan 14.3): data-YYYY.N. */
export const DATA_RELEASE = 'data-2026.1';

export interface EngineData {
  /** Data release id, recorded in every result. */
  release: string;
  federal: Record<number, FederalTaxParams>;
  /** state code -> year -> params */
  states: Record<string, Record<number, StateTaxParams>>;
  limits: Record<number, LimitsParams>;
  socialSecurity: Record<number, SocialSecurityParams>;
  ssSeries: SocialSecuritySeries;
  rmd: RmdTables;
  medicare: Record<number, MedicareParams>;
  fpl: Record<number, FplParams>;
  applicablePct: Record<number, ApplicablePctParams>;
  ageCurve: AcaAgeCurve;
  acaStateRules: AcaStateRules;
  costSharing: Record<number, AcaCostSharingParams>;
  healthInflation: HealthInflationParams;
  ltc: LtcParams;
  mortality: MortalityTable;
  market: MarketHistory;
  damodaran?: DamodaranHistory;
  returnAssumptions: ReturnAssumptions;
  /** SLCSP benchmark files: plan year -> state code -> file. May be partial (states are lazy-loaded in the app). */
  slcsp: Record<number, Record<string, SlcspStateFile>>;
}

export interface DatasetInfo {
  path: string;
  header: DataHeader;
}

/**
 * Build EngineData from a map of dataset path (relative to packages/data, forward slashes) -> parsed JSON.
 * Throws if a required dataset is missing.
 */
export function assembleEngineData(files: Record<string, unknown>): EngineData {
  const d: EngineData = {
    release: DATA_RELEASE,
    federal: {},
    states: {},
    limits: {},
    socialSecurity: {},
    medicare: {},
    fpl: {},
    applicablePct: {},
    costSharing: {},
    slcsp: {},
  } as unknown as EngineData;
  let ltcYear = -1;
  let mortYear = -1;
  for (const raw in files) {
    const path = raw.replace(/\\/g, '/').replace(/^\.\//, '');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = files[raw] as any;
    let m: RegExpMatchArray | null;
    if ((m = path.match(/^tax\/us-federal\/(\d{4})\.json$/))) d.federal[+m[1]] = v;
    else if (path === 'tax/rmd/tables.json') d.rmd = v;
    else if ((m = path.match(/^tax\/us-([a-z]{2})\/(\d{4})\.json$/)))
      (d.states[m[1].toUpperCase()] ??= {})[+m[2]] = v;
    else if ((m = path.match(/^limits\/(\d{4})\.json$/))) d.limits[+m[1]] = v;
    else if (path === 'ss/series.json') d.ssSeries = v;
    else if ((m = path.match(/^ss\/(\d{4})\.json$/))) d.socialSecurity[+m[1]] = v;
    else if ((m = path.match(/^health\/medicare\/(\d{4})\.json$/))) d.medicare[+m[1]] = v;
    else if ((m = path.match(/^health\/fpl\/(\d{4})\.json$/))) d.fpl[+m[1]] = v;
    else if ((m = path.match(/^health\/aca\/applicable-pct\/(\d{4})\.json$/))) d.applicablePct[+m[1]] = v;
    else if (path === 'health/aca/age-curve.json') d.ageCurve = v;
    else if (path === 'health/aca/state-rules.json') d.acaStateRules = v;
    else if ((m = path.match(/^health\/aca\/cost-sharing\/(\d{4})\.json$/))) d.costSharing[+m[1]] = v;
    else if ((m = path.match(/^health\/aca\/slcsp\/(\d{4})\/([A-Z]{2})\.json$/)))
      (d.slcsp[+m[1]] ??= {})[m[2]] = v;
    else if (path === 'health/inflation.json') d.healthInflation = v;
    else if ((m = path.match(/^health\/ltc\/(\d{4})\.json$/))) {
      if (+m[1] > ltcYear) {
        ltcYear = +m[1];
        d.ltc = v;
      }
    } else if ((m = path.match(/^mortality\/ssa-period-(\d{4})\.json$/))) {
      if (+m[1] > mortYear) {
        mortYear = +m[1];
        d.mortality = v;
      }
    } else if (path === 'market/shiller-annual.json') d.market = v;
    else if (path === 'market/damodaran.json') d.damodaran = v;
    else if (path === 'market/assumptions.json') d.returnAssumptions = v;
  }
  const missing: string[] = [];
  const need = (ok: boolean, name: string): void => {
    if (!ok) missing.push(name);
  };
  need(Object.keys(d.federal).length > 0, 'tax/us-federal');
  need(Object.keys(d.limits).length > 0, 'limits');
  need(Object.keys(d.socialSecurity).length > 0, 'ss');
  need(!!d.ssSeries, 'ss/series.json');
  need(!!d.rmd, 'tax/rmd/tables.json');
  need(Object.keys(d.medicare).length > 0, 'health/medicare');
  need(Object.keys(d.fpl).length > 0, 'health/fpl');
  need(Object.keys(d.applicablePct).length > 0, 'health/aca/applicable-pct');
  need(!!d.ageCurve, 'health/aca/age-curve.json');
  need(!!d.acaStateRules, 'health/aca/state-rules.json');
  need(Object.keys(d.costSharing).length > 0, 'health/aca/cost-sharing');
  need(!!d.healthInflation, 'health/inflation.json');
  need(!!d.ltc, 'health/ltc');
  need(!!d.mortality, 'mortality');
  need(!!d.market, 'market/shiller-annual.json');
  need(!!d.returnAssumptions, 'market/assumptions.json');
  if (missing.length) throw new Error(`Missing datasets: ${missing.join(', ')}`);
  return d;
}

/** Every dataset header, for the "How this is calculated" panel and the data-versions screen. */
export function listDatasets(files: Record<string, unknown>): DatasetInfo[] {
  const out: DatasetInfo[] = [];
  for (const raw in files) {
    const v = files[raw] as { header?: DataHeader };
    if (v && v.header) out.push({ path: raw.replace(/\\/g, '/').replace(/^\.\//, ''), header: v.header });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
