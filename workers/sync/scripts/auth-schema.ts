import { writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { getMigrations } from 'better-auth/db/migration';
import { accountOptions } from '../src/public-auth';

const options = accountOptions({
  DB: {} as D1Database,
  AUTH_SECRET: 'schema-generation-only-never-a-production-secret',
  APP_ORIGIN: 'http://localhost:8788',
});
const migrations = await getMigrations({ ...options, database: new DatabaseSync(':memory:') });
writeFileSync(
  new URL('../migrations/0002_public_accounts.sql', import.meta.url),
  `${await migrations.compileMigrations()}\n`,
);
