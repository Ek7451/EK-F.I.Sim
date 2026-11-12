/**
 * Emits schema/plan.v<N>.json (JSON Schema) from the Zod plan schema, and writes the v<N> plan fixtures.
 * The plan calls for Zod types generated from a hand-written JSON Schema; this project keeps Zod as the single
 * source and generates the JSON Schema instead, so the two can never drift.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { PlanZ, SAMPLE_PLANS, SCHEMA_VERSION } from '../src';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// The schema describes the file as written (io: input), so fields with defaults are optional. The layout matches
// the earlier zod-to-json-schema output: a $ref to a named definition.
const { $schema, ...body } = z.toJSONSchema(PlanZ, { io: 'input', target: 'draft-7' });
const name = `PlanV${SCHEMA_VERSION}`;
const schema = { $ref: `#/definitions/${name}`, definitions: { [name]: body }, $schema };
mkdirSync(join(root, 'schema'), { recursive: true });
writeFileSync(join(root, 'schema', `plan.v${SCHEMA_VERSION}.json`), JSON.stringify(schema, null, 1) + '\n');

const dir = join(root, 'test', 'fixtures', 'plans', `v${SCHEMA_VERSION}`);
mkdirSync(dir, { recursive: true });
for (const [id, mk] of Object.entries(SAMPLE_PLANS))
  writeFileSync(join(dir, `${id}.json`), JSON.stringify(mk(2026), null, 1) + '\n');
console.log(`wrote schema/plan.v${SCHEMA_VERSION}.json and ${Object.keys(SAMPLE_PLANS).length} fixtures`);
