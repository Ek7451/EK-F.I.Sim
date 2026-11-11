/**
 * Emits schema/plan.v<N>.json (JSON Schema) from the Zod plan schema, and writes the v<N> plan fixtures.
 * The plan calls for Zod types generated from a hand-written JSON Schema; this project keeps Zod as the single
 * source and generates the JSON Schema instead, so the two can never drift.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { PlanZ, SAMPLE_PLANS, SCHEMA_VERSION } from '../src';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const schema = zodToJsonSchema(PlanZ, { name: `PlanV${SCHEMA_VERSION}`, $refStrategy: 'none' });
mkdirSync(join(root, 'schema'), { recursive: true });
writeFileSync(join(root, 'schema', `plan.v${SCHEMA_VERSION}.json`), JSON.stringify(schema, null, 1) + '\n');

const dir = join(root, 'test', 'fixtures', 'plans', `v${SCHEMA_VERSION}`);
mkdirSync(dir, { recursive: true });
for (const [id, mk] of Object.entries(SAMPLE_PLANS))
  writeFileSync(join(dir, `${id}.json`), JSON.stringify(mk(2026), null, 1) + '\n');
console.log(`wrote schema/plan.v${SCHEMA_VERSION}.json and ${Object.keys(SAMPLE_PLANS).length} fixtures`);
