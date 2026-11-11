/**
 * Aswath Damodaran, "Historical Returns on Stocks, Bonds and Bills" (histretSP) -> annual S&P 500,
 * 3-month T-bill, 10-year T-bond and Baa corporate bond returns plus CPI inflation from 1928.
 * All series are calendar-year (end of December to end of December).
 *
 *   pnpm tsx tools/ingest/damodaran.ts [--refresh]
 *
 * Writes tools/ingest/.cache/damodaran.annual.json when run directly.
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

export const DAMODARAN_URLS = [
  'https://pages.stern.nyu.edu/~adamodar/pc/datasets/histretSP.xlsx',
  'https://pages.stern.nyu.edu/~adamodar/pc/datasets/histretSP.xls',
];

export interface DamodaranAnnual {
  raw: RawFile;
  years: number[];
  sp500: number[];
  tBill3m: number[];
  tBond10y: number[];
  baaCorporate: number[];
  inflation: number[];
}

export function buildDamodaranAnnual(raw: RawFile): DamodaranAnnual {
  const wb = XLSX.read(raw.bytes, { type: 'buffer' });
  const sheet = wb.Sheets['Returns by year'];
  if (!sheet) throw new Error(`histretSP: no "Returns by year" sheet (found ${wb.SheetNames.join(', ')})`);
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });
  const h = rows.findIndex((r) => r[0] === 'Year');
  if (h < 0) throw new Error('histretSP: header row not found');
  const header = rows[h]!.map((c) => (typeof c === 'string' ? c.trim() : c));
  // The first occurrence of each label is the nominal annual return block.
  const col = (label: string): number => {
    const i = header.indexOf(label);
    if (i < 0) throw new Error(`histretSP: column "${label}" not found`);
    return i;
  };
  const cols = {
    sp500: col('S&P 500 (includes dividends)'),
    tBill3m: col('3-month T.Bill'),
    tBond10y: col('US T. Bond (10-year)'),
    baaCorporate: col('Baa Corporate Bond'),
    inflation: col('Inflation Rate'),
  };
  const out: DamodaranAnnual = {
    raw,
    years: [],
    sp500: [],
    tBill3m: [],
    tBond10y: [],
    baaCorporate: [],
    inflation: [],
  };
  for (const r of rows.slice(h + 1)) {
    const y = r[0];
    if (typeof y !== 'number' || y < 1900 || y > 2200) break;
    out.years.push(y);
    for (const k of Object.keys(cols) as (keyof typeof cols)[]) {
      const v = r[cols[k]];
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`histretSP: ${k} missing for ${y}`);
      out[k].push(v);
    }
  }
  if (out.years[0] !== 1928)
    throw new Error(`histretSP: expected the table to start in 1928, got ${out.years[0]}`);
  for (let i = 1; i < out.years.length; i++) {
    if (out.years[i] !== out.years[i - 1]! + 1)
      throw new Error(`histretSP: years not contiguous at ${out.years[i]}`);
  }
  return out;
}

export async function loadDamodaran(refresh = wantRefresh()): Promise<DamodaranAnnual> {
  const raw = await fetchCached('histretSP.xlsx', DAMODARAN_URLS, { refresh, validate: assertWorkbook });
  return buildDamodaranAnnual(raw);
}

if (isMain(import.meta.url)) {
  const d = await loadDamodaran();
  const { raw, ...body } = d;
  writeJson(join(CACHE_DIR, 'damodaran.annual.json'), {
    source: raw.url,
    sha256: raw.sha256,
    retrieved: raw.retrieved,
    ...body,
  });
  const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
  console.log(`histretSP  ${raw.fromCache ? '(cached)' : '(downloaded)'}  ${raw.url}`);
  console.log(`  sha256 ${raw.sha256}  retrieved ${raw.retrieved}`);
  console.log(`  years ${d.years[0]}-${d.years[d.years.length - 1]} (${d.years.length})`);
  for (const k of ['sp500', 'tBill3m', 'tBond10y', 'baaCorporate', 'inflation'] as const) {
    console.log(
      `  ${k.padEnd(12)} mean ${pct(mean(d[k]))}  sd ${pct(stdDev(d[k]))}  geo ${pct(geoMean(d[k]))}`,
    );
  }
}
