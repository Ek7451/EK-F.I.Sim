import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  { test: { name: 'engine', root: 'packages/engine', include: ['test/**/*.test.ts'], testTimeout: 60000 } },
  { test: { name: 'data', root: 'packages/data', include: ['test/**/*.test.ts'] } },
  { test: { name: 'crypto', root: 'packages/crypto', include: ['test/**/*.test.ts'], testTimeout: 60000 } },
  { test: { name: 'sync', root: 'workers/sync', include: ['test/**/*.test.ts'] } },
  { test: { name: 'validation', root: 'tests/validation', include: ['**/*.test.ts'], testTimeout: 120000 } },
  { test: { name: 'web', root: 'apps/web', include: ['src/**/*.test.ts'], environment: 'node' } },
]);
