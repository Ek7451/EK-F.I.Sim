/**
 * Browser loader (Vite). Core datasets are bundled; the per-state SLCSP county tables are lazy-loaded
 * with content-hashed URLs (plan 8.1).
 */
import { assembleEngineData, listDatasets, type DatasetInfo, type EngineData } from './engine-data';
import type { SlcspStateFile } from './types';

const core = import.meta.glob(
  [
    '../tax/**/*.json',
    '../limits/*.json',
    '../ss/*.json',
    '../health/**/*.json',
    '!../health/aca/slcsp/**',
    '../mortality/*.json',
    '../market/*.json',
  ],
  {
    eager: true,
    import: 'default',
  },
) as Record<string, unknown>;

const slcspLoaders = import.meta.glob('../health/aca/slcsp/*/*.json', { import: 'default' }) as Record<
  string,
  () => Promise<unknown>
>;

const strip = (files: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const k in files) out[k.replace(/^\.\.\//, '')] = files[k];
  return out;
};

let cached: EngineData | null = null;
export function bundledEngineData(): EngineData {
  if (!cached) cached = assembleEngineData(strip(core));
  return cached;
}

export function bundledDatasets(): DatasetInfo[] {
  return listDatasets(strip(core));
}

export function slcspYears(): number[] {
  const ys = new Set<number>();
  for (const k in slcspLoaders) {
    const m = k.match(/slcsp\/(\d{4})\//);
    if (m) ys.add(+m[1]);
  }
  return [...ys].sort((a, b) => a - b);
}

/** Load one state's SLCSP table for a plan year (nearest available year at or before it). */
export async function loadSlcsp(
  state: string,
  year: number,
): Promise<{ year: number; file: SlcspStateFile } | null> {
  const ys = slcspYears();
  if (!ys.length) return null;
  let y = ys[0];
  for (const k of ys) if (k <= year) y = k;
  const loader = slcspLoaders[`../health/aca/slcsp/${y}/${state}.json`];
  if (!loader) return null;
  return { year: y, file: (await loader()) as SlcspStateFile };
}
