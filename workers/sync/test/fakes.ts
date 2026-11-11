// In-memory stand-ins for the parts of D1 and R2 the Worker uses, plus JWT helpers.
// The D1 fake runs the real migration and the real SQL on Node's built-in SQLite, so queries are not mocked.
import { readFileSync } from 'node:fs';
import type { Deps, Env } from '../src/app';
import type { Jwk } from '../src/auth';

type SqlValue = string | number | null;

export function fakeD1(): D1Database {
  // getBuiltinModule: Vitest 2 cannot resolve a static `node:sqlite` import.
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8'));
  const statement = (sql: string, params: SqlValue[]) => ({
    bind: (...values: SqlValue[]) => statement(sql, values),
    first: async () => db.prepare(sql).get(...params) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...params) }),
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...params).changes) } }),
  });
  return { prepare: (sql: string) => statement(sql, []) } as unknown as D1Database;
}

export interface FakeR2 {
  bucket: R2Bucket;
  objects: Map<string, Uint8Array>;
  /** Set to make the next put() reject, simulating an R2 outage. */
  failNextPut: boolean;
}

export function fakeR2(): FakeR2 {
  const fake: FakeR2 = { objects: new Map(), failNextPut: false, bucket: undefined as unknown as R2Bucket };
  fake.bucket = {
    put: async (key: string, value: Uint8Array) => {
      if (fake.failNextPut) {
        fake.failNextPut = false;
        throw new Error('R2 unavailable');
      }
      fake.objects.set(key, value.slice());
    },
    get: async (key: string) => {
      const value = fake.objects.get(key);
      return value ? { arrayBuffer: async () => value.slice().buffer } : null;
    },
    delete: async (key: string) => {
      fake.objects.delete(key);
    },
  } as unknown as R2Bucket;
  return fake;
}

export const TEAM_DOMAIN = 'fisim-test.cloudflareaccess.com';
export const ACCESS_AUD = 'test-audience-tag';
export const APP_ORIGIN = 'https://app.example.test';

export function makeEnv(overrides: Partial<Env> = {}): { env: Env; r2: FakeR2 } {
  const r2 = fakeR2();
  const env: Env = {
    DB: fakeD1(),
    BLOBS: r2.bucket,
    ENVIRONMENT: 'production',
    TEAM_DOMAIN,
    ACCESS_AUD,
    ALLOWED_ORIGINS: `${APP_ORIGIN}, http://localhost:5173`,
    ...overrides,
  };
  return { env, r2 };
}

const base64Url = (data: Uint8Array | string) => Buffer.from(data).toString('base64url');

export interface Signer {
  jwk: Jwk;
  /** Signs a Cloudflare-Access-shaped JWT for `sub`; `claims` / `header` override the defaults. */
  token(sub: string, claims?: Record<string, unknown>, header?: Record<string, unknown>): Promise<string>;
}

export async function makeSigner(kid: string): Promise<Signer> {
  const algorithm = {
    name: 'RSASSA-PKCS1-v1_5',
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: 'SHA-256',
  };
  const pair = (await crypto.subtle.generateKey(algorithm, true, ['sign', 'verify'])) as CryptoKeyPair;
  const jwk = { ...((await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey), kid } as Jwk;
  return {
    jwk,
    async token(sub, claims = {}, header = {}) {
      const now = Math.floor(Date.now() / 1000);
      const head = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid, ...header }));
      const payload = base64Url(
        JSON.stringify({
          iss: `https://${TEAM_DOMAIN}`,
          aud: [ACCESS_AUD],
          sub,
          iat: now,
          nbf: now,
          exp: now + 300,
          ...claims,
        }),
      );
      const signature = await crypto.subtle.sign(
        'RSASSA-PKCS1-v1_5',
        pair.privateKey,
        Buffer.from(`${head}.${payload}`),
      );
      return `${head}.${payload}.${base64Url(new Uint8Array(signature))}`;
    },
  };
}

/** A JWKS fetcher serving the given signers, counting how often it is called. */
export function jwksDeps(...signers: Signer[]): Deps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    fetchJwks: async (url) => {
      calls.push(url);
      return signers.map((s) => s.jwk);
    },
  };
}
