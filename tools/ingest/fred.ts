/**
 * Cash series. FRED TB3MS (3-Month Treasury Bill Secondary Market Rate, discount basis, monthly,
 * from 1934; a public-domain Federal Reserve H.15 series) averaged per calendar year and converted
 * to an annual return; Damodaran's T-bill returns for 1928-1933; and a flagged proxy before 1928
 * (Shiller's long rate minus a fixed term spread).
 *
 *   pnpm tsx tools/ingest/fred.ts [--refresh]
 *
 * The keyless CSV endpoint is used. If it fails and FRED_API_KEY is set in the environment, the
 * official API is tried instead; the key is never written to disk or logged.
 *
 * Writes tools/ingest/.cache/cash.annual.json when run directly.
 */
import { join } from 'node:path';
import { loadDamodaran, type DamodaranAnnual } from './damodaran';
import {
  CACHE_DIR,
  fetchCached,
  isMain,
  mean,
  stdDev,
  wantRefresh,
  writeJson,
  type RawFile,
} from './market-common';
import { loadShiller, type ShillerAnnual } from './shiller';

export const TB3MS_CSV_URL = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=TB3MS';
export const TB3MS_SERIES_PAGE = 'https://fred.stlouisfed.org/series/TB3MS';

export interface Tb3msAnnual {
  raw: RawFile;
  /** Complete calendar years only (12 monthly observations). */
  years: number[];
  /** Calendar-year mean of the monthly discount rate, percent. */
  avgDiscountRatePct: number[];
  /** Annual return implied by rolling 91-day bills at that average discount rate. */
  annualReturn: number[];
  lastMonth: string;
}

/**
 * TB3MS is quoted on a bank-discount basis: a 91-day bill costs 1 - d * 91/360 per 1 of face.
 * Holding-period return for 91 days is 1/price - 1; rolling for a 365-day year compounds it
 * 365/91 times.
 */
export function discountRateToAnnualReturn(discountPct: number): number {
  const price = 1 - (discountPct / 100) * (91 / 360);
  return price ** (-365 / 91) - 1;
}

function parseObservations(bytes: Buffer): { date: string; value: number }[] {
  const text = bytes.toString('utf8').trim();
  if (text.startsWith('{')) {
    // FRED API JSON (only when the keyed fallback was used).
    const json = JSON.parse(text) as { observations: { date: string; value: string }[] };
    return json.observations
      .filter((o) => o.value !== '.')
      .map((o) => ({ date: o.date, value: Number(o.value) }));
  }
  const lines = text.split(/\r?\n/);
  if (!/^(observation_date|DATE),TB3MS$/i.test(lines[0]!.trim()))
    throw new Error(`TB3MS: unexpected CSV header "${lines[0]}"`);
  const out: { date: string; value: number }[] = [];
  for (const line of lines.slice(1)) {
    const [date, v] = line.trim().split(',');
    if (!date || v === undefined || v === '' || v === '.') continue;
    const value = Number(v);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(value))
      throw new Error(`TB3MS: bad row "${line}"`);
    out.push({ date, value });
  }
  return out;
}

export function buildTb3msAnnual(raw: RawFile): Tb3msAnnual {
  const obs = parseObservations(raw.bytes);
  const byYear = new Map<number, number[]>();
  for (const o of obs) {
    const y = Number(o.date.slice(0, 4));
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y)!.push(o.value);
  }
  const out: Tb3msAnnual = {
    raw,
    years: [],
    avgDiscountRatePct: [],
    annualReturn: [],
    lastMonth: obs[obs.length - 1]!.date.slice(0, 7),
  };
  for (const y of [...byYear.keys()].sort((a, b) => a - b)) {
    const v = byYear.get(y)!;
    if (v.length !== 12) continue; // partial (current) year
    const avg = mean(v);
    out.years.push(y);
    out.avgDiscountRatePct.push(avg);
    out.annualReturn.push(discountRateToAnnualReturn(avg));
  }
  return out;
}

export async function loadTb3ms(refresh = wantRefresh()): Promise<Tb3msAnnual> {
  const urls = [TB3MS_CSV_URL];
  const key = process.env.FRED_API_KEY;
  if (key)
    urls.push(
      `https://api.stlouisfed.org/fred/series/observations?series_id=TB3MS&file_type=json&api_key=${encodeURIComponent(key)}`,
    );
  const raw = await fetchCached('TB3MS.csv', urls, {
    refresh,
    displayUrl: (u) => u.replace(/api_key=[^&]+/, 'api_key=REDACTED'),
    validate: (b) => {
      if (parseObservations(b).length < 12) throw new Error('no TB3MS observations in response');
    },
  });
  return buildTb3msAnnual(raw);
}

export const CASH_DAMODARAN_FROM = 1928;
export const CASH_FRED_FROM = 1934;

export interface CashSeries {
  years: number[];
  cash: number[];
  /** Source used for each year. */
  source: ('proxy' | 'damodaran' | 'tb3ms')[];
  /** Fixed term spread (decimal) subtracted from Shiller's long rate before 1928. */
  proxySpread: number;
  /** Window over which the spread was calibrated. */
  proxySpreadWindow: [number, number];
}

/**
 * Cash for every year of the Shiller series:
 *  - 1934+     : TB3MS calendar-year average, converted with discountRateToAnnualReturn.
 *  - 1928-1933 : Damodaran's 3-month T-bill return for the year, as published.
 *  - before 1928: max(0, calendar-year mean of Shiller's long rate - spread), where spread is the
 *    mean of (long rate - cash) over 1928..endYear. An approximation; flagged via approximatedBefore.
 */
export function buildCashSeries(
  shiller: ShillerAnnual,
  tb3ms: Tb3msAnnual,
  damodaran: DamodaranAnnual,
): CashSeries {
  const fred = new Map(tb3ms.years.map((y, i) => [y, tb3ms.annualReturn[i]!]));
  const dam = new Map(damodaran.years.map((y, i) => [y, damodaran.tBill3m[i]!]));
  const cash: (number | null)[] = [];
  const source: CashSeries['source'] = [];
  for (const y of shiller.years) {
    if (y >= CASH_FRED_FROM) {
      const v = fred.get(y);
      if (v === undefined) throw new Error(`cash: TB3MS has no complete year ${y}`);
      cash.push(v);
      source.push('tb3ms');
    } else if (y >= CASH_DAMODARAN_FROM) {
      const v = dam.get(y);
      if (v === undefined) throw new Error(`cash: Damodaran has no T-bill return for ${y}`);
      cash.push(v);
      source.push('damodaran');
    } else {
      cash.push(null);
      source.push('proxy');
    }
  }
  const spreads: number[] = [];
  shiller.years.forEach((y, i) => {
    if (y >= CASH_DAMODARAN_FROM) spreads.push(shiller.avgLongRate[i]! - cash[i]!);
  });
  const proxySpread = mean(spreads);
  const filled = cash.map((c, i) => (c === null ? Math.max(0, shiller.avgLongRate[i]! - proxySpread) : c));
  return {
    years: shiller.years,
    cash: filled,
    source,
    proxySpread,
    proxySpreadWindow: [CASH_DAMODARAN_FROM, shiller.endYear],
  };
}

if (isMain(import.meta.url)) {
  const [shiller, tb3ms, damodaran] = [await loadShiller(), await loadTb3ms(), await loadDamodaran()];
  const c = buildCashSeries(shiller, tb3ms, damodaran);
  writeJson(join(CACHE_DIR, 'cash.annual.json'), {
    rawUrl: tb3ms.raw.url,
    sha256: tb3ms.raw.sha256,
    retrieved: tb3ms.raw.retrieved,
    ...c,
  });
  const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
  console.log(`TB3MS  ${tb3ms.raw.fromCache ? '(cached)' : '(downloaded)'}  ${tb3ms.raw.url}`);
  console.log(
    `  sha256 ${tb3ms.raw.sha256}  retrieved ${tb3ms.raw.retrieved}  last month ${tb3ms.lastMonth}`,
  );
  console.log(`  complete TB3MS years ${tb3ms.years[0]}-${tb3ms.years[tb3ms.years.length - 1]}`);
  console.log(`  pre-1928 proxy spread ${pct(c.proxySpread)} (calibrated ${c.proxySpreadWindow.join('-')})`);
  const post = c.cash.filter((_, i) => c.years[i]! >= CASH_DAMODARAN_FROM);
  console.log(
    `  cash ${c.years[0]}-${c.years[c.years.length - 1]}: mean ${pct(mean(c.cash))}  sd ${pct(stdDev(c.cash))};  1928+: mean ${pct(mean(post))}  sd ${pct(stdDev(post))}`,
  );
}
