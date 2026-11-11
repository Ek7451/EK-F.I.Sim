/** Node-only loader (tests, benchmarks, validation scripts). The browser uses ./bundle instead. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembleEngineData, type EngineData } from './engine-data';

export const DATA_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOMAINS = ['tax', 'limits', 'ss', 'health', 'mortality', 'market'];

export function readAllDatasets(root = DATA_ROOT): Record<string, unknown> {
  const files: Record<string, unknown> = {};
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.json'))
        files[relative(root, p).replace(/\\/g, '/')] = JSON.parse(readFileSync(p, 'utf8'));
    }
  };
  for (const d of DOMAINS) {
    try {
      walk(join(root, d));
    } catch {
      /* domain folder not present yet */
    }
  }
  return files;
}

let cached: EngineData | null = null;
export function loadEngineData(): EngineData {
  if (!cached) cached = assembleEngineData(readAllDatasets());
  return cached;
}
