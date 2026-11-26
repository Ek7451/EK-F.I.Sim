import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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

// Include the worker, static files and configuration in one reproducible content digest.
const dist = resolve(root, 'apps/web/dist');
const paths = [];
function walk(dir = '') {
  for (const entry of readdirSync(resolve(dist, dir), { withFileTypes: true })) {
    const path = dir ? dir + '/' + entry.name : entry.name;
    if (entry.isDirectory()) walk(path);
    else if (path !== 'release.json') paths.push(path);
  }
}
walk();
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const entries = paths.sort().map((path) => [path, sha256(readFileSync(resolve(dist, path)))]);
const source =
  process.env.GITHUB_SHA ??
  execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
writeFileSync(
  resolve(dist, 'release.json'),
  JSON.stringify(
    { source, artifactSha256: sha256(JSON.stringify(entries)), files: Object.fromEntries(entries) },
    null,
    2,
  ) + '\n',
);
