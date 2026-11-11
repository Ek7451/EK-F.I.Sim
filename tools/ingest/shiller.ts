/**
 * Robert Shiller's "Irrational Exuberance" workbook (ie_data.xls) -> calendar-year nominal annual
 * series from 1871: S&P Composite total return, a constant-maturity 10-year Treasury total return
 * built from the long rate (GS10), and CPI inflation. Everything is January-to-January.
 *
 *   pnpm tsx tools/ingest/shiller.ts [--refresh]
 *
 * Writes tools/ingest/.cache/shiller.annual.json when run directly.
 */
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import {
  CACHE_DIR,
  assertWorkbook,
  fetchCached,
  geoMean,
  isMain,
  mean,
  stdDev,
  wantRefresh,
  writeJson,
  type RawFile,
} from './market-common';

/**
 * The shillerdata.com link is the copy Shiller's site currently maintains (monthly updates); the
 * Yale copy stopped being updated in 2023, so it is only a fallback.
 */
export const SHILLER_URLS = [
  'https://img1.wsimg.com/blobby/go/e5e77e0b-59d1-44d9-ab25-4763ac982e53/downloads/1449043e-a1ed-4e2e-8e9c-7b9a2a064493/ie_data.xls',
  'http://www.econ.yale.edu/~shiller/data/ie_data.xls',
];
export const SHILLER_LANDING = 'https://shillerdata.com/';

export interface ShillerMonth {
  year: number;
  month: number;
  /** S&P Composite price, monthly average of daily closes. */
  price: number | null;
  /** Dividends per share, trailing 12 months (annual rate). */
  dividend: number | null;
  cpi: number | null;
  /** Long interest rate (GS10 from 1953; Homer/Sidney series before), percent. */
  longRate: number | null;
}

export interface ShillerAnnual {
  raw: RawFile;
  startYear: number;
  /** Last complete year: the return for year Y needs the January Y+1 row. */
  endYear: number;
  years: number[];
  usStocks: number[];
  usBonds: number[];
  inflation: number[];
  /** January long rate (decimal) at the start of each year, plus one trailing entry for endYear+1. */
  januaryLongRate: number[];
  /** Calendar-year mean of the monthly long rate (decimal). */
  avgLongRate: number[];
  /** Last month present in the workbook, e.g. "2026-10". */
  lastMonth: string;
  /** First year whose January long rate is an actual GS10 observation (earlier values are annual figures interpolated monthly by Shiller). */
  gs10From: number;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function parseShillerMonthly(bytes: Buffer): ShillerMonth[] {
  const wb = XLSX.read(bytes, { type: 'buffer' });
  const sheet = wb.Sheets['Data'];
  if (!sheet) throw new Error(`ie_data.xls: no "Data" sheet (found ${wb.SheetNames.join(', ')})`);
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });
  const h = rows.findIndex((r) => r[0] === 'Date');
  if (h < 0) throw new Error('ie_data.xls: header row not found');
  const header = rows[h]!.map((c) => (typeof c === 'string' ? c.trim() : c));
  const col = (label: string): number => {
    const i = header.indexOf(label);
    if (i < 0)
      throw new Error(
        `ie_data.xls: column "${label}" not found in header ${JSON.stringify(header.slice(0, 10))}`,
      );
    return i;
  };
  const cP = col('P');
  const cD = col('D');
  const cCpi = col('CPI');
  const cRate = col('Rate GS10');
  const out: ShillerMonth[] = [];
  for (const r of rows.slice(h + 1)) {
    const d = num(r[0]);
    if (d === null || d < 1800 || d > 2200) continue;
    // Dates are written as YYYY.MM, so October is 1871.1.
    const year = Math.floor(d + 1e-6);
    const month = Math.round((d - year) * 100);
    if (month < 1 || month > 12) throw new Error(`ie_data.xls: cannot parse date ${d}`);
    out.push({
      year,
      month,
      price: num(r[cP]),
      dividend: num(r[cD]),
      cpi: num(r[cCpi]),
      longRate: num(r[cRate]),
    });
  }
  for (let i = 1; i < out.length; i++) {
    const a = out[i - 1]!;
    const b = out[i]!;
    if (b.year * 12 + b.month !== a.year * 12 + a.month + 1)
      throw new Error(`ie_data.xls: months not contiguous at ${b.year}-${b.month}`);
  }
  return out;
}

/** Price per 1 of face of an annual-coupon bond with `n` years left, coupon rate `c`, yield `y`. */
export function bondPrice(n: number, c: number, y: number): number {
  if (Math.abs(y) < 1e-12) return 1 + c * n;
  const v = (1 + y) ** -n;
  return (c * (1 - v)) / y + v;
}

/** One-year total return of a 10-year par bond bought at yield y0 and sold a year later as a 9-year bond at yield y1. */
export function tenYearBondReturn(y0: number, y1: number): number {
  return y0 + bondPrice(9, y0, y1) - 1;
}

export function buildShillerAnnual(raw: RawFile): ShillerAnnual {
  const months = parseShillerMonthly(raw.bytes);
  const at = new Map<number, ShillerMonth>();
  for (const m of months) at.set(m.year * 12 + (m.month - 1), m);
  const jan = (y: number) => at.get(y * 12);
  const startYear = months[0]!.year;
  if (months[0]!.month !== 1) throw new Error('ie_data.xls: series does not start in January');

  const years: number[] = [];
  const usStocks: number[] = [];
  const usBonds: number[] = [];
  const inflation: number[] = [];
  const januaryLongRate: number[] = [];
  const avgLongRate: number[] = [];

  for (let y = startYear; ; y++) {
    const j0 = jan(y);
    const j1 = jan(y + 1);
    if (!j0 || !j1 || j1.price === null || j1.cpi === null || j1.longRate === null) break;
    if (j0.price === null || j0.cpi === null || j0.longRate === null)
      throw new Error(`ie_data.xls: January ${y} incomplete`);

    // Stocks: compound the twelve monthly total returns Feb(y) .. Jan(y+1). Each month's total
    // return is (P_m + D_m / 12) / P_{m-1}: Shiller's D is a trailing-twelve-month figure, so one
    // twelfth of it is that month's dividend, reinvested at the month's average price.
    let growth = 1;
    let complete = true;
    for (let k = 1; k <= 12; k++) {
      const prev = at.get(y * 12 + k - 1);
      const cur = at.get(y * 12 + k);
      if (!prev || !cur || prev.price === null || cur.price === null || cur.dividend === null) {
        complete = false;
        break;
      }
      growth *= (cur.price + cur.dividend / 12) / prev.price;
    }
    if (!complete) break;

    const y0 = j0.longRate / 100;
    const y1 = j1.longRate / 100;
    const rates: number[] = [];
    for (let k = 0; k < 12; k++) {
      const r = at.get(y * 12 + k)?.longRate;
      if (r !== null && r !== undefined) rates.push(r / 100);
    }

    years.push(y);
    usStocks.push(growth - 1);
    usBonds.push(tenYearBondReturn(y0, y1));
    inflation.push(j1.cpi / j0.cpi - 1);
    januaryLongRate.push(y0);
    avgLongRate.push(mean(rates));
  }
  const endYear = years[years.length - 1]!;
  januaryLongRate.push(jan(endYear + 1)!.longRate! / 100);
  const last = months[months.length - 1]!;
  return {
    raw,
    startYear,
    endYear,
    years,
    usStocks,
    usBonds,
    inflation,
    januaryLongRate,
    avgLongRate,
    lastMonth: `${last.year}-${String(last.month).padStart(2, '0')}`,
    gs10From: 1953,
  };
}

export async function loadShiller(refresh = wantRefresh()): Promise<ShillerAnnual> {
  const raw = await fetchCached('ie_data.xls', SHILLER_URLS, { refresh, validate: assertWorkbook });
  return buildShillerAnnual(raw);
}

if (isMain(import.meta.url)) {
  const s = await loadShiller();
  const { raw, ...body } = s;
  writeJson(join(CACHE_DIR, 'shiller.annual.json'), {
    source: raw.url,
    sha256: raw.sha256,
    retrieved: raw.retrieved,
    ...body,
  });
  const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
  console.log(`ie_data.xls  ${raw.fromCache ? '(cached)' : '(downloaded)'}  ${raw.url}`);
  console.log(`  sha256 ${raw.sha256}  retrieved ${raw.retrieved}  last month in file ${s.lastMonth}`);
  console.log(`  years ${s.startYear}-${s.endYear} (${s.years.length})`);
  for (const k of ['usStocks', 'usBonds', 'inflation'] as const) {
    console.log(
      `  ${k.padEnd(9)} mean ${pct(mean(s[k]))}  sd ${pct(stdDev(s[k]))}  geo ${pct(geoMean(s[k]))}`,
    );
  }
}
