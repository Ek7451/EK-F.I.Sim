/**
 * Shared helpers for the market-history ingest scripts (shiller.ts, fred.ts, damodaran.ts,
 * build-market.ts). Node built-ins only.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const INGEST_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(INGEST_DIR, '..', '..');
export const CACHE_DIR = join(INGEST_DIR, '.cache');
export const MARKET_DIR = join(REPO_ROOT, 'packages', 'data', 'market');

/** A generic client name; no contact details are sent to the data hosts. */
const USER_AGENT = 'Mozilla/5.0 (compatible; market-data-ingest/1.0)';

export interface RawFile {
  /** URL the bytes were actually fetched from (first one that worked). */
  url: string;
  /** Absolute path of the cached copy. */
  path: string;
  sha256: string;
  bytes: Buffer;
  /** ISO date the cached copy was downloaded. */
  retrieved: string;
  fromCache: boolean;
}

export function sha256(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex');
}

export function today(): string {
  // Local calendar date (not UTC), so an evening run is not stamped with tomorrow's date.
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** True when the process was started with --refresh (ignore cached raw files). */
export function wantRefresh(): boolean {
  return process.argv.includes('--refresh');
}

/**
 * Download `urls` in order until one succeeds and cache the bytes as tools/ingest/.cache/<name>.
 * A sidecar <name>.meta.json records the URL, retrieval date and sha256. The cached copy is reused
 * unless `refresh` is set. `validate` may throw to reject a response (e.g. an HTML error page).
 * `displayUrl` replaces a URL in the sidecar/log (used so an API key never lands on disk).
 */
export async function fetchCached(
  name: string,
  urls: string[],
  opts: { refresh?: boolean; validate?: (bytes: Buffer) => void; displayUrl?: (url: string) => string } = {},
): Promise<RawFile> {
  mkdirSync(CACHE_DIR, { recursive: true });
  const path = join(CACHE_DIR, name);
  const metaPath = `${path}.meta.json`;
  const show = opts.displayUrl ?? ((u: string) => u);
  if (!opts.refresh && existsSync(path) && existsSync(metaPath)) {
    const bytes = readFileSync(path);
    const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as {
      url: string;
      retrieved: string;
      sha256: string;
    };
    const digest = sha256(bytes);
    if (digest !== meta.sha256)
      throw new Error(`${name}: cached file does not match its recorded sha256; rerun with --refresh`);
    return { url: meta.url, path, sha256: digest, bytes, retrieved: meta.retrieved, fromCache: true };
  }
  const failures: string[] = [];
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: '*/*' },
        redirect: 'follow',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length === 0) throw new Error('empty body');
      opts.validate?.(bytes);
      const digest = sha256(bytes);
      const retrieved = today();
      writeFileSync(path, bytes);
      writeFileSync(
        metaPath,
        JSON.stringify({ url: show(url), retrieved, sha256: digest, bytes: bytes.length }, null, 2) + '\n',
      );
      return { url: show(url), path, sha256: digest, bytes, retrieved, fromCache: false };
    } catch (err) {
      failures.push(`${show(url)} -> ${(err as Error).message}`);
    }
  }
  throw new Error(`${name}: every download attempt failed:\n  ${failures.join('\n  ')}`);
}

/** Reject responses that are not a real Excel workbook (OLE2 .xls or zip .xlsx). */
export function assertWorkbook(bytes: Buffer): void {
  const ole = bytes.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]));
  const zip = bytes.subarray(0, 2).toString('latin1') === 'PK';
  if (!ole && !zip) throw new Error('response is not an Excel workbook');
}

export function isMain(metaUrl: string): boolean {
  const entry = process.argv[1];
  return !!entry && pathToFileURL(resolve(entry)).href === metaUrl;
}

export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

export const round = (x: number, dp = 6): number => {
  const f = 10 ** dp;
  const r = Math.round(x * f) / f;
  return r === 0 ? 0 : r;
};

// ------------------------------------------------------------------ statistics

export const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Sample standard deviation (n - 1). */
export function stdDev(xs: number[]): number {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

export function correlation(xs: number[], ys: number[]): number {
  if (xs.length !== ys.length) throw new Error('correlation: length mismatch');
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) ** 2;
    syy += (ys[i]! - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy);
}

/** Geometric (compound) mean of a return series. */
export function geoMean(xs: number[]): number {
  return Math.exp(xs.reduce((a, x) => a + Math.log1p(x), 0) / xs.length) - 1;
}

/** True when the symmetric matrix has a Cholesky factorisation with every pivot > eps. */
export function isPositiveDefinite(m: number[][], eps = 1e-9): boolean {
  const n = m.length;
  const l: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = m[i]![j]!;
      for (let k = 0; k < j; k++) s -= l[i]![k]! * l[j]![k]!;
      if (i === j) {
        if (s <= eps) return false;
        l[i]![j] = Math.sqrt(s);
      } else {
        l[i]![j] = s / l[j]![j]!;
      }
    }
  }
  return true;
}
