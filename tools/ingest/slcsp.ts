/**
 * ACA benchmark (second-lowest-cost silver plan) premium ingest.
 *
 *   pnpm tsx tools/ingest/slcsp.ts <planYear> [--headers]
 *
 * Source: the CMS "QHP Landscape Individual Market Medical" file published on data.healthcare.gov
 * (https://data.healthcare.gov/datafile/py<year>/individual_market_medical.zip). It lists every individual
 * market medical QHP offered through HealthCare.gov by county, with the age-21 premium already rated for the
 * county's rating area, so no Rate PUF x Service Area PUF x rating-area join is needed.
 *
 * Output (one file per state): packages/data/health/aca/slcsp/<year>/<ST>.json  (SlcspStateFile)
 *   - HealthCare.gov states: `quality: "county"`, SLCSP / lowest bronze / lowest gold per county, age 21.
 *   - State-based-exchange states (not in the CMS file): `quality: "state-average"`, empty `counties`, and a
 *     statewide approximation from KFF's published average benchmark premium (age 40) converted to age 21.
 * Side output: tools/ingest/.cache/landscape-stats-<year>.json (median plan designs by metal tier, used to
 * build health/aca/cost-sharing/<year>.json).
 *
 * Only Node built-ins are used. The workbook's main sheet is ~360 MB of XML, far too large for an
 * in-memory spreadsheet parser (the `xlsx` package would need several GB of heap), so the zip container and
 * the sheet XML are stream-parsed here. Raw downloads are cached in tools/ingest/.cache/ (git-ignored).
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import * as zlib from 'node:zlib';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const CACHE = path.join(HERE, '.cache');
const OUT_ROOT = path.join(REPO, 'packages', 'data', 'health', 'aca', 'slcsp');

const sourceUrl = (year: number) =>
  `https://data.healthcare.gov/datafile/py${year}/individual_market_medical.zip`;

const STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA',
  'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR',
  'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
]; // prettier-ignore

/**
 * State-based-exchange fallback. KFF State Health Facts, "Marketplace Average Benchmark Premiums": average
 * second-lowest-cost silver premium for a 40-year-old, weighted by county plan selections (monthly $).
 * Retrieved 2026-11-10 (2027 column as corrected by KFF on 2026-11-06). Used only for states absent from the
 * CMS landscape file; cited as a benchmark, the app lets the user override it.
 */
const KFF_URL =
  'https://www.kff.org/affordable-care-act/state-indicator/marketplace-average-benchmark-premiums/';
const KFF_AGE40_BENCHMARK: Record<number, Record<string, number>> = {
  2026: {
    CA: 570, CO: 557, CT: 870, DC: 610, GA: 615, ID: 490, IL: 646, KY: 590, ME: 709, MD: 414, MA: 494, MN: 448,
    NV: 497, NJ: 545, NM: 623, NY: 817, PA: 572, RI: 506, VT: 1299, VA: 455, WA: 612,
  },
  2027: {
    CA: 633, CO: 615, CT: 1005, DC: 678, GA: 733, ID: 553, IL: 707, KY: 667, ME: 804, MD: 491, MA: 551, MN: 525,
    NV: 565, NJ: 665, NM: 725, NY: 1041, OR: 656, PA: 648, RI: 629, VT: 1313, VA: 549, WA: 768,
  },
}; // prettier-ignore

/**
 * Age-40 / age-21 premium ratio used to convert the KFF figure. 1.278 is the federal default curve; DC and MA
 * have their own curves (0.975/0.727 and 1.393/1.183, CMS "State Specific Age Curve Variations"); NY and VT
 * are community rated (same premium at every age).
 */
const AGE40_TO_21: Record<string, number> = { DC: 0.975 / 0.727, MA: 1.393 / 1.183, NY: 1, VT: 1 };
const FEDERAL_AGE40 = 1.278;

// ------------------------------------------------------------------ small helpers

const round2 = (x: number) => Math.round(x * 100) / 100;

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

async function sha256File(file: string): Promise<string> {
  const h = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) h.update(chunk as Buffer);
  return h.digest('hex');
}

function decodeXml(s: string): string {
  if (!s.includes('&')) return s;
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

async function download(url: string, dest: string): Promise<void> {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    console.log(`cache hit  ${path.relative(REPO, dest)}`);
    return;
  }
  console.log(`download   ${url}`);
  const res = await fetch(url, { headers: { 'User-Agent': 'fisim-ingest/0.1 (node)' }, redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  const tmp = `${dest}.part`;
  await pipeline(Readable.fromWeb(res.body as never), fs.createWriteStream(tmp));
  fs.renameSync(tmp, dest);
}

// ------------------------------------------------------------------ minimal zip reader (stored / deflate, zip64)

interface ZipEntry {
  name: string;
  method: number;
  compSize: number;
  size: number;
  localOffset: number;
}

function readAt(fd: number, pos: number, len: number): Buffer {
  const b = Buffer.alloc(len);
  let got = 0;
  while (got < len) {
    const n = fs.readSync(fd, b, got, len - got, pos + got);
    if (n <= 0) break;
    got += n;
  }
  return got === len ? b : b.subarray(0, got);
}

function readZipDirectory(file: string): ZipEntry[] {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const tailLen = Math.min(size, 65_536 + 22 + 20);
    const tail = readAt(fd, size - tailLen, tailLen);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error(`${file}: not a zip file (no end-of-central-directory record)`);
    let count = tail.readUInt16LE(eocd + 10);
    let cdSize = tail.readUInt32LE(eocd + 12);
    let cdOffset = tail.readUInt32LE(eocd + 16);
    if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      const loc = eocd - 20;
      if (loc < 0 || tail.readUInt32LE(loc) !== 0x07064b50) throw new Error(`${file}: zip64 locator missing`);
      const rec = readAt(fd, Number(tail.readBigUInt64LE(loc + 8)), 56);
      if (rec.readUInt32LE(0) !== 0x06064b50) throw new Error(`${file}: zip64 record missing`);
      count = Number(rec.readBigUInt64LE(32));
      cdSize = Number(rec.readBigUInt64LE(40));
      cdOffset = Number(rec.readBigUInt64LE(48));
    }
    const cd = readAt(fd, cdOffset, cdSize);
    const entries: ZipEntry[] = [];
    let p = 0;
    for (let i = 0; i < count; i++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error(`${file}: bad central directory entry`);
      const method = cd.readUInt16LE(p + 10);
      let compSize = cd.readUInt32LE(p + 20);
      let usize = cd.readUInt32LE(p + 24);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      let localOffset = cd.readUInt32LE(p + 42);
      const name = cd.toString('utf8', p + 46, p + 46 + nameLen);
      let x = p + 46 + nameLen;
      const xEnd = x + extraLen;
      while (x + 4 <= xEnd) {
        const id = cd.readUInt16LE(x);
        const len = cd.readUInt16LE(x + 2);
        if (id === 0x0001) {
          let q = x + 4;
          if (usize === 0xffffffff) {
            usize = Number(cd.readBigUInt64LE(q));
            q += 8;
          }
          if (compSize === 0xffffffff) {
            compSize = Number(cd.readBigUInt64LE(q));
            q += 8;
          }
          if (localOffset === 0xffffffff) localOffset = Number(cd.readBigUInt64LE(q));
        }
        x += 4 + len;
      }
      entries.push({ name, method, compSize, size: usize, localOffset });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  } finally {
    fs.closeSync(fd);
  }
}

function zipEntryStream(file: string, e: ZipEntry): Readable {
  if (e.method !== 0 && e.method !== 8) throw new Error(`${e.name}: unsupported zip method ${e.method}`);
  const fd = fs.openSync(file, 'r');
  let dataStart: number;
  try {
    const lh = readAt(fd, e.localOffset, 30);
    if (lh.readUInt32LE(0) !== 0x04034b50) throw new Error(`${e.name}: bad local header`);
    dataStart = e.localOffset + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
  } finally {
    fs.closeSync(fd);
  }
  if (e.compSize === 0) return Readable.from([]);
  const raw = fs.createReadStream(file, { start: dataStart, end: dataStart + e.compSize - 1 });
  if (e.method === 0) return raw;
  const inflate = zlib.createInflateRaw();
  raw.on('error', (err) => inflate.destroy(err));
  return raw.pipe(inflate);
}

async function zipEntryText(file: string, e: ZipEntry): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of zipEntryStream(file, e)) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

// ------------------------------------------------------------------ streaming worksheet reader

function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  const si = /<si>([\s\S]*?)<\/si>|<si\/>/g;
  const t = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
  let m: RegExpExecArray | null;
  while ((m = si.exec(xml))) {
    const body = (m[1] ?? '').replace(/<rPh[\s\S]*?<\/rPh>/g, '');
    let s = '';
    let tm: RegExpExecArray | null;
    t.lastIndex = 0;
    while ((tm = t.exec(body))) s += tm[1];
    out.push(decodeXml(s));
  }
  return out;
}

const CELL = /<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;

function parseRow(rowXml: string, shared: string[]): Map<string, string> {
  const cells = new Map<string, string>();
  CELL.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CELL.exec(rowXml))) {
    const inner = m[3];
    if (!inner) continue;
    const attrs = m[2] ?? '';
    let value: string;
    if (attrs.includes('t="inlineStr"')) {
      const t = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/.exec(inner);
      value = decodeXml(t?.[1] ?? '');
    } else {
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner);
      if (!v) continue;
      value = attrs.includes('t="s"') ? (shared[Number(v[1])] ?? '') : decodeXml(v[1]!);
    }
    cells.set(m[1]!, value);
  }
  return cells;
}

/** Calls `onRow` for every worksheet row, in order, without holding the sheet in memory. */
async function streamRows(xlsx: string, onRow: (cells: Map<string, string>) => void): Promise<void> {
  const entries = readZipDirectory(xlsx);
  const sst = entries.find((e) => e.name === 'xl/sharedStrings.xml');
  const sheets = entries
    .filter((e) => /^xl\/worksheets\/[^/]+\.xml$/.test(e.name))
    .sort((a, b) => b.size - a.size);
  const sheet = sheets[0];
  if (!sheet) throw new Error(`${xlsx}: no worksheet found`);
  const shared = sst ? parseSharedStrings(await zipEntryText(xlsx, sst)) : [];
  console.log(
    `parse      ${sheet.name} (${(sheet.size / 1e6).toFixed(0)} MB XML, ${shared.length} shared strings)`,
  );
  const stream = zipEntryStream(xlsx, sheet);
  stream.setEncoding('utf8');
  let buf = '';
  for await (const chunk of stream) {
    buf += chunk as string;
    let from = 0;
    for (;;) {
      const end = buf.indexOf('</row>', from);
      if (end < 0) break;
      const start = buf.indexOf('<row', from);
      if (start >= 0 && start < end) onRow(parseRow(buf.slice(start, end), shared));
      from = end + 6;
    }
    buf = buf.slice(from);
  }
}

// ------------------------------------------------------------------ landscape -> benchmarks

interface PlanRow {
  planId: string;
  metal: string;
  /** Full age-21 premium as listed. */
  premium21: number;
  /** Portion of the premium allocable to essential health benefits (what the PTC benchmark is measured on). */
  ehb21: number;
}
interface AreaAgg {
  ratingArea: string;
  plans: Map<string, PlanRow>;
}
interface CountyAgg {
  state: string;
  fips: string;
  name: string;
  areas: Map<string, AreaAgg>;
}
interface PlanDesign {
  metal: string;
  deductible: number | null;
  oop: number | null;
  csr: Record<'73' | '87' | '94', { deductible: number | null; oop: number | null }>;
}

const money = (s: string | undefined): number | null => {
  if (s === undefined) return null;
  const t = s.replace(/[$,\s]/g, '');
  if (t === '' || !/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
};

/** Header names vary in spacing / hyphenation between columns and years; compare letters and digits only. */
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Bronze and "Expanded Bronze" are both the bronze tier for consumer purposes. */
const tierOf = (metal: string): string => (/bronze/i.test(metal) ? 'bronze' : metal.trim().toLowerCase());

function nthLowest(
  plans: PlanRow[],
  n: number,
  key: 'premium21' | 'ehb21' = 'premium21',
): number | undefined {
  const s = plans.map((p) => p[key]).sort((a, b) => a - b);
  return s.length === 0 ? undefined : s[Math.min(n, s.length - 1)];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const year = Number(args.find((a) => /^\d{4}$/.test(a)));
  const headersOnly = args.includes('--headers');
  if (!year) {
    console.error('usage: pnpm tsx tools/ingest/slcsp.ts <planYear> [--headers]');
    process.exit(2);
  }
  fs.mkdirSync(CACHE, { recursive: true });
  const url = sourceUrl(year);
  const zipPath = path.join(CACHE, `py${year}-individual_market_medical.zip`);
  await download(url, zipPath);
  const sha = await sha256File(zipPath);

  // The download is a zip that contains one .xlsx (itself a zip); unpack the workbook once into the cache.
  const xlsxPath = path.join(CACHE, `py${year}-individual_market_medical.xlsx`);
  const inner = readZipDirectory(zipPath).find((e) => e.name.toLowerCase().endsWith('.xlsx'));
  if (!inner) throw new Error(`${zipPath}: no .xlsx inside (CMS changed the file format?)`);
  if (!fs.existsSync(xlsxPath) || fs.statSync(xlsxPath).size !== inner.size) {
    console.log(`unpack     ${inner.name}`);
    await pipeline(zipEntryStream(zipPath, inner), fs.createWriteStream(`${xlsxPath}.part`));
    fs.renameSync(`${xlsxPath}.part`, xlsxPath);
  }

  const WANT = {
    state: 'state code',
    fips: 'fips county code',
    county: 'county name',
    metal: 'metal level',
    planId: 'plan id (standard component)',
    ratingArea: 'rating area',
    childOnly: 'child only offering',
    premium21: 'premium adult individual age 21',
    ehbPct: 'ehb percent of total premium',
    ded: 'medical deductible - individual - standard',
    oop: 'medical maximum out of pocket - individual - standard',
    ded73: 'medical deductible - individual - 73 percent',
    oop73: 'medical maximum out of pocket - individual - 73 percent',
    ded87: 'medical deductible - individual - 87 percent',
    oop87: 'medical maximum out of pocket - individual - 87 percent',
    ded94: 'medical deductible - individual - 94 percent',
    oop94: 'medical maximum out of pocket - individual - 94 percent',
  } as const;
  type Key = keyof typeof WANT;
  const REQUIRED: Key[] = ['state', 'fips', 'county', 'metal', 'planId', 'premium21'];

  let col: Partial<Record<Key, string>> | null = null;
  const counties = new Map<string, CountyAgg>();
  const designs = new Map<string, PlanDesign>();
  let dataRows = 0;
  let skippedChildOnly = 0;

  await streamRows(xlsxPath, (cells) => {
    if (!col) {
      const names = new Map<string, string>();
      for (const [c, v] of cells) if (!names.has(norm(v))) names.set(norm(v), c);
      if (!names.has(norm(WANT.state))) return; // title rows above the header
      col = {};
      for (const k of Object.keys(WANT) as Key[]) col[k] = names.get(norm(WANT[k]));
      const missing = REQUIRED.filter((k) => !col![k]);
      if (headersOnly || missing.length) {
        console.log([...cells].map(([c, v]) => `${c}: ${v.trim()}`).join('\n'));
      }
      if (missing.length) throw new Error(`landscape header is missing columns: ${missing.join(', ')}`);
      return;
    }
    if (headersOnly) {
      if (dataRows++ === 0) console.log('first data row:', Object.fromEntries([...cells].slice(0, 30)));
      return;
    }
    const get = (k: Key) => (col![k] ? cells.get(col![k]!) : undefined);
    const state = (get('state') ?? '').trim();
    const premium21 = money(get('premium21'));
    const planId = (get('planId') ?? '').trim();
    if (!/^[A-Z]{2}$/.test(state) || !planId || premium21 === null || premium21 <= 0) return;
    dataRows++;
    if (/^allows child-only$/i.test((get('childOnly') ?? '').trim())) {
      skippedChildOnly++;
      return;
    }
    const fips = (get('fips') ?? '').trim().padStart(5, '0');
    const metal = (get('metal') ?? '').trim();
    const ratingArea = (get('ratingArea') ?? '').trim();

    let c = counties.get(fips);
    if (!c) counties.set(fips, (c = { state, fips, name: (get('county') ?? '').trim(), areas: new Map() }));
    let a = c.areas.get(ratingArea);
    if (!a) c.areas.set(ratingArea, (a = { ratingArea, plans: new Map() }));
    const prev = a.plans.get(planId);
    const pct = money((get('ehbPct') ?? '').replace('%', ''));
    const ehbShare = pct !== null && pct > 0 && pct <= 100 ? pct / 100 : 1;
    if (!prev || premium21 < prev.premium21)
      a.plans.set(planId, { planId, metal, premium21, ehb21: premium21 * ehbShare });

    if (!designs.has(planId)) {
      designs.set(planId, {
        metal,
        deductible: money(get('ded')),
        oop: money(get('oop')),
        csr: {
          '73': { deductible: money(get('ded73')), oop: money(get('oop73')) },
          '87': { deductible: money(get('ded87')), oop: money(get('oop87')) },
          '94': { deductible: money(get('ded94')), oop: money(get('oop94')) },
        },
      });
    }
  });
  if (headersOnly) return;
  if (!col || counties.size === 0) throw new Error('no plan rows parsed from the landscape file');
  console.log(`rows       ${dataRows} plan-county rows, ${counties.size} counties, ${designs.size} plans`);

  // ---- per-county benchmarks
  interface CountyOut {
    name: string;
    ratingArea?: string;
    slcspAge21: number;
    lowestBronzeAge21?: number;
    lowestGoldAge21?: number;
  }
  const byState = new Map<
    string,
    { counties: Record<string, CountyOut>; multiArea: string[]; noSilver: string[] }
  >();
  const ratios: Record<string, number[]> = { catastrophic: [], bronze: [], gold: [], platinum: [] };

  for (const c of [...counties.values()].sort((x, y) => x.fips.localeCompare(y.fips))) {
    let st = byState.get(c.state);
    if (!st) byState.set(c.state, (st = { counties: {}, multiArea: [], noSilver: [] }));
    // A county split across rating areas appears once per area; use the area with the most plans.
    const areas = [...c.areas.values()].sort(
      (x, y) => y.plans.size - x.plans.size || x.ratingArea.localeCompare(y.ratingArea),
    );
    if (areas.length > 1) st.multiArea.push(c.fips);
    const area = areas[0]!;
    const plans = [...area.plans.values()];
    const tier = (t: string) => plans.filter((p) => tierOf(p.metal) === t);
    const slcsp = nthLowest(tier('silver'), 1, 'ehb21');
    if (slcsp === undefined) {
      st.noSilver.push(c.fips);
      continue;
    }
    const out: CountyOut = { name: c.name, slcspAge21: round2(slcsp) };
    if (area.ratingArea) out.ratingArea = area.ratingArea;
    const bronze = nthLowest(tier('bronze'), 0);
    const gold = nthLowest(tier('gold'), 0);
    if (bronze !== undefined) out.lowestBronzeAge21 = round2(bronze);
    if (gold !== undefined) out.lowestGoldAge21 = round2(gold);
    st.counties[c.fips] = out;
    for (const t of Object.keys(ratios)) {
      const low = nthLowest(tier(t), 0);
      if (low !== undefined) ratios[t]!.push(low / slcsp);
    }
  }

  const now = new Date(); // local calendar date
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const outDir = path.join(OUT_ROOT, String(year));
  fs.mkdirSync(outDir, { recursive: true });
  const written: string[] = [];

  for (const [state, st] of [...byState].sort(([a], [b]) => a.localeCompare(b))) {
    const vals = Object.values(st.counties).map((c) => c.slcspAge21);
    if (vals.length === 0) continue;
    const flags: Record<string, string> = {
      stateAverageAge21: 'unweighted mean of the county benchmarks (not enrollment- or population-weighted)',
    };
    if (st.multiArea.length)
      flags.multiRatingAreaCounties = `county spans several rating areas; the area with the most plans is used: ${st.multiArea.join(', ')}`;
    if (st.noSilver.length) flags.countiesWithoutSilverPlans = st.noSilver.join(', ');
    const file = {
      header: {
        source: url,
        publisher: 'CMS / HealthCare.gov (data.healthcare.gov)',
        retrieved: today,
        status: 'enacted',
        lawRefs: ['26 U.S.C. 36B(b)(3)(B)', '26 CFR 1.36B-3(f)', '45 CFR 147.102', '45 CFR 156.80'],
        sha256: sha,
        schema: 'slcsp-state.v1',
        notes:
          `Computed by tools/ingest/slcsp.ts from the CMS QHP Landscape Individual Market Medical file for plan year ${year}. ` +
          'sha256 is of the raw downloaded zip. slcspAge21 = second-lowest age-21 silver premium in the county (the only silver ' +
          'plan where a county has one), ranked and reported on the essential-health-benefit portion of the premium ' +
          '(premium x "EHB Percent of Total Premium", 26 CFR 1.36B-3(j)). lowestBronzeAge21 (incl. expanded bronze) and ' +
          'lowestGoldAge21 are full listed premiums. Child-only plans excluded; non-tobacco rates. Multiply by the ' +
          'age-curve factor for other ages.',
        flags,
      },
      year,
      state,
      exchange: 'ffe',
      quality: 'county',
      counties: st.counties,
      stateAverageAge21: round2(vals.reduce((a, b) => a + b, 0) / vals.length),
    };
    fs.writeFileSync(path.join(outDir, `${state}.json`), JSON.stringify(file, null, 1) + '\n');
    written.push(state);
  }

  // ---- state-based exchanges: statewide approximation
  const sbe: string[] = [];
  const missing: string[] = [];
  const kff = KFF_AGE40_BENCHMARK[year] ?? {};
  for (const state of STATES) {
    if (byState.has(state)) continue;
    const age40 = kff[state];
    if (age40 === undefined) {
      missing.push(state);
      continue;
    }
    const factor = AGE40_TO_21[state] ?? FEDERAL_AGE40;
    const body = {
      year,
      state,
      exchange: 'sbe',
      quality: 'state-average',
      counties: {},
      stateAverageAge21: round2(age40 / factor),
    };
    const file = {
      header: {
        source: KFF_URL,
        publisher: 'KFF State Health Facts (analysis of state exchange data)',
        retrieved: today,
        status: 'projected',
        lawRefs: ['26 U.S.C. 36B(b)(3)(B)', '26 CFR 1.36B-3(f)', '45 CFR 147.102'],
        sha256: createHash('sha256').update(JSON.stringify(body)).digest('hex'),
        schema: 'slcsp-state.v1',
        notes:
          `APPROXIMATION. ${state} runs a state-based exchange for plan year ${year} and is not in the CMS HealthCare.gov ` +
          `landscape file; no county-level machine-readable benchmark data was ingested. stateAverageAge21 = KFF average ` +
          `benchmark premium for a 40-year-old ($${age40}/month, weighted by county plan selections) / ${round2(factor)} ` +
          `(${factor === 1 ? 'community-rated state: same premium at every age' : 'age-40 factor of the applicable age curve'}). ` +
          'The real benchmark varies by rating area; the app lets the user enter their own SLCSP. ' +
          'sha256 is of the canonical JSON body (file without header).',
        flags: {
          stateAverageAge21: `approximated from KFF statewide average (age 40: $${age40})`,
          counties: 'not available for state-based exchanges',
        },
      },
      ...body,
    };
    fs.writeFileSync(path.join(outDir, `${state}.json`), JSON.stringify(file, null, 1) + '\n');
    sbe.push(state);
  }

  // ---- plan-design statistics for the cost-sharing dataset
  const tiers: Record<
    string,
    { plans: number; medianDeductible: number | null; medianOopMax: number | null }
  > = {};
  const byTier = new Map<string, PlanDesign[]>();
  for (const d of designs.values()) {
    const t = tierOf(d.metal);
    if (!byTier.has(t)) byTier.set(t, []);
    byTier.get(t)!.push(d);
  }
  const nums = (xs: (number | null)[]) => xs.filter((x): x is number => x !== null);
  for (const [t, ds] of byTier) {
    tiers[t] = {
      plans: ds.length,
      medianDeductible: median(nums(ds.map((d) => d.deductible))),
      medianOopMax: median(nums(ds.map((d) => d.oop))),
    };
  }
  const silver = byTier.get('silver') ?? [];
  const csr = Object.fromEntries(
    (['94', '87', '73'] as const).map((v) => [
      v,
      {
        medianDeductible: median(nums(silver.map((d) => d.csr[v].deductible))),
        medianOopMax: median(nums(silver.map((d) => d.csr[v].oop))),
      },
    ]),
  );
  const stats = {
    year,
    source: url,
    sha256: sha,
    generated: today,
    note: 'Medians over distinct plans (standard component IDs) in the HealthCare.gov landscape; premium ratios are the median across counties of (lowest-cost plan in the tier / second-lowest-cost silver).',
    planCountyRows: dataRows,
    childOnlyRowsSkipped: skippedChildOnly,
    counties: counties.size,
    tiers,
    csr,
    premiumRatioToSlcsp: Object.fromEntries(
      Object.entries(ratios).map(([t, xs]) => [t, { counties: xs.length, median: median(xs) }]),
    ),
  };
  fs.writeFileSync(path.join(CACHE, `landscape-stats-${year}.json`), JSON.stringify(stats, null, 2) + '\n');

  console.log(`county     ${written.length} states: ${written.join(' ')}`);
  console.log(`state-avg  ${sbe.length} states: ${sbe.join(' ')}`);
  if (missing.length) console.log(`MISSING    no data for: ${missing.join(' ')}`);
  console.log(`wrote      ${path.relative(REPO, outDir)} and .cache/landscape-stats-${year}.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
