/**
 * `pnpm validate:data` (plan 8.2): every dataset must carry a complete provenance header and pass structural
 * checks before it can ship. Run in CI on every pull request and by the annual data update runbook.
 */
import { z } from 'zod';
import { assembleEngineData } from '../src/engine-data';
import { readAllDatasets } from '../src/node';

const Header = z
  .object({
    source: z.string().url(),
    publisher: z.string().min(2),
    retrieved: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'retrieved must be an ISO date'),
    status: z.enum(['enacted', 'projected']),
    lawRefs: z.array(z.string()),
    sha256: z.string().regex(/^[0-9a-f]{64}$/, 'sha256 must be 64 hex characters'),
    schema: z.string().regex(/^[a-z0-9-]+\.v\d+$/, 'schema must look like "name.v1"'),
    notes: z.string().optional(),
    fieldFlags: z.record(z.string()).optional(),
  })
  .passthrough();

const errors: string[] = [];
const fail = (path: string, msg: string): void => {
  errors.push(`${path}: ${msg}`);
};

const files = readAllDatasets();
const paths = Object.keys(files).sort();
const bySchema: Record<string, number> = {};
let projected = 0;

type Bracket = { upTo?: number | null; over?: number; from?: number; rate: number };
const ascending = (path: string, name: string, xs: number[]): void => {
  for (let i = 1; i < xs.length; i++)
    if (!(xs[i] > xs[i - 1])) {
      fail(path, `${name} is not strictly ascending at index ${i} (${xs[i - 1]} then ${xs[i]})`);
      return;
    }
};
/** Walk the whole document: no NaN/Infinity, and any array that looks like tax brackets has sane rates. */
function walk(path: string, node: unknown, trail: string): void {
  if (typeof node === 'number') {
    if (!Number.isFinite(node)) fail(path, `${trail} is not a finite number`);
    return;
  }
  if (Array.isArray(node)) {
    if (
      node.length &&
      node.every((b) => b && typeof b === 'object' && typeof (b as Bracket).rate === 'number')
    ) {
      for (const b of node as Bracket[])
        if (b.rate < 0 || b.rate > 1) fail(path, `${trail} has a rate outside 0..1 (${b.rate})`);
      for (const key of ['over', 'from'] as const) {
        const starts = (node as Bracket[])
          .map((b) => b[key])
          .filter((v): v is number => typeof v === 'number');
        if (starts.length === node.length) ascending(path, `${trail}.${key}`, starts);
      }
    }
    node.forEach((v, i) => walk(path, v, `${trail}[${i}]`));
    return;
  }
  if (node && typeof node === 'object')
    for (const [k, v] of Object.entries(node)) walk(path, v, trail ? `${trail}.${k}` : k);
}

for (const path of paths) {
  const doc = files[path] as { header?: unknown };
  const parsed = Header.safeParse(doc.header);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) fail(path, `header.${issue.path.join('.')}: ${issue.message}`);
    continue;
  }
  const h = parsed.data;
  bySchema[h.schema] = (bySchema[h.schema] ?? 0) + 1;
  if (h.status === 'projected') projected++;
  if (h.retrieved > new Date().toISOString().slice(0, 10))
    fail(path, `retrieved date ${h.retrieved} is in the future`);
  if (
    h.status === 'enacted' &&
    h.lawRefs.length === 0 &&
    /^(tax|limits|ss|health\/(medicare|fpl|aca\/applicable-pct))/.test(path)
  )
    fail(path, 'an enacted legal dataset must cite at least one law reference');
  // The year in the file name must match the year inside the file when it states one.
  const m = path.match(/\/(\d{4})\.json$/);
  const year =
    (doc as { year?: number; taxYear?: number; planYear?: number }).year ??
    (doc as { taxYear?: number }).taxYear ??
    (doc as { planYear?: number }).planYear;
  if (m && typeof year === 'number' && year !== +m[1])
    fail(path, `file is named ${m[1]} but says year ${year}`);
  walk(path, doc, '');
}

// The engine must be able to assemble everything, and the coverage the app relies on must be present.
try {
  const data = assembleEngineData(files);
  const states = Object.keys(data.states);
  if (states.length !== 51) fail('tax/us-*', `expected 50 states and DC, found ${states.length}`);
  for (const [name, rec] of Object.entries({
    federal: data.federal,
    limits: data.limits,
    socialSecurity: data.socialSecurity,
    medicare: data.medicare,
    fpl: data.fpl,
    applicablePct: data.applicablePct,
    costSharing: data.costSharing,
  })) {
    if (Object.keys(rec).length === 0) fail(name, 'no years present');
  }
  for (const y of Object.keys(data.slcsp)) {
    const n = Object.keys(data.slcsp[+y]).length;
    if (n !== 51) fail(`health/aca/slcsp/${y}`, `expected 51 state files, found ${n}`);
  }
  const market = data.market as unknown as { years?: number[]; rows?: unknown[] };
  const span = market.years?.length ?? market.rows?.length ?? 0;
  if (span && span < 100) fail('market/shiller-annual.json', `only ${span} years of history`);
} catch (e) {
  fail('assemble', e instanceof Error ? e.message : String(e));
}

console.log(`Checked ${paths.length} datasets (${projected} projected).`);
for (const [schema, n] of Object.entries(bySchema).sort()) console.log(`  ${schema.padEnd(28)} ${n}`);
if (errors.length) {
  console.error(`\n${errors.length} problem${errors.length === 1 ? '' : 's'}:`);
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}
console.log('All datasets are valid.');
