import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const worker = resolve(root, 'workers/sync');
const result = spawnSync(
  process.execPath,
  [
    resolve(worker, 'node_modules/wrangler/bin/wrangler.js'),
    'deploy',
    '--dry-run',
    '--minify',
    '--outdir',
    '../../output/pages-worker',
    '-c',
    'wrangler.bundle.toml',
  ],
  { cwd: worker, stdio: 'inherit' },
);
if (result.status !== 0) process.exit(result.status ?? 1);
mkdirSync(resolve(root, 'apps/web/dist'), { recursive: true });
copyFileSync(resolve(root, 'output/pages-worker/pages.js'), resolve(root, 'apps/web/dist/_worker.js'));
