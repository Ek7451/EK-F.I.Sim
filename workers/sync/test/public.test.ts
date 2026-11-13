import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { publicRequest } from '../src/public-app';
import type { PublicEnv } from '../src/public-auth';

function setup() {
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
  const db = new DatabaseSync(':memory:');
  for (const name of ['0001_init', '0002_public_accounts', '0003_public_storage'])
    db.exec(readFileSync(new URL(`../migrations/${name}.sql`, import.meta.url), 'utf8'));
  type Value = string | number | null | Uint8Array;
  const statement = (sql: string, params: Value[] = []) => ({
    bind: (...values: Value[]) => statement(sql, values),
    first: async () => db.prepare(sql).get(...params) ?? null,
    all: async () => {
      const results = db.prepare(sql).all(...params);
      const meta = db.prepare('SELECT changes() AS changes, last_insert_rowid() AS last_row_id').get();
      return { results, meta, success: true };
    },
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...params).changes) }, success: true }),
  });
  const env: PublicEnv = {
    DB: {
      prepare: statement,
      batch: async (items: ReturnType<typeof statement>[]) => {
        db.exec('BEGIN');
        try {
          const results = [];
          for (const item of items) results.push(await item.run());
          db.exec('COMMIT');
          return results;
        } catch (e) {
          db.exec('ROLLBACK');
          throw e;
        }
      },
    } as unknown as D1Database,
    APP_ORIGIN: 'https://app.example.test',
    AUTH_SECRET: 'test-only-secret-with-at-least-thirty-two-characters',
  };
  const call = (
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
    method = body ? 'POST' : 'GET',
  ) =>
    publicRequest(
      new Request(`${env.APP_ORIGIN}${path}`, {
        method,
        headers: { Origin: env.APP_ORIGIN, 'Content-Type': 'application/json', ...headers },
        ...(body ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
      }),
      env,
    );
  return { call, db, env };
}
const password = 'long-test-password-unique';
async function register(call: ReturnType<typeof setup>['call'], username: string) {
  const response = await call('/api/account/register', { username, password });
  expect(response.status, await response.clone().text()).toBe(200);
  const data = (await response.json()) as { user: { id: string }; recoveryCode: string };
  const cookie = response.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  expect(cookie).toContain('longview.session_token');
  return { ...data, headers: { Cookie: cookie, 'X-Longview-Account': data.user.id } };
}

describe('public accounts and encrypted cloud storage', () => {
  it('isolates accounts, rejects anonymous/cross-origin access, and commits versioned bytes atomically', async () => {
    const { call } = setup();
    const alice = await register(call, 'alice');
    const bob = await register(call, 'bob');
    expect((await call('/api/v1/plans')).status).toBe(401);
    expect(
      (await call('/api/v1/plans', undefined, { ...alice.headers, Origin: 'https://evil.test' })).status,
    ).toBe(403);
    expect(
      (await call('/api/v1/plans', undefined, { ...bob.headers, 'X-Longview-Account': alice.user.id }))
        .status,
    ).toBe(409);
    const headers = { ...alice.headers, 'If-Match': '0' };
    expect((await call('/api/v1/plans/one', 'encrypted bytes', headers, 'PUT')).status).toBe(200);
    expect((await call('/api/v1/plans/one', 'overwrite', headers, 'PUT')).status).toBe(409);
    expect(await (await call('/api/v1/plans/one', undefined, alice.headers)).text()).toBe('encrypted bytes');
    expect((await call('/api/v1/plans/one', undefined, bob.headers)).status).toBe(404);
    expect(await (await call('/api/v1/plans', undefined, bob.headers)).json()).toEqual([]);
    expect((await call('/api/v1/keys', { wrapped: 'key' }, headers, 'PUT')).status).toBe(200);
    expect((await call('/api/v1/keys', undefined, bob.headers)).status).toBe(404);
    expect(
      (await call('/api/v1/plans/one', undefined, { ...alice.headers, 'If-Match': '1' }, 'DELETE')).status,
    ).toBe(200);
    expect((await call('/api/v1/plans/one', undefined, alice.headers)).status).toBe(410);
  });

  it('resets a password only once, rotates recovery codes, and revokes existing sessions', async () => {
    const { call, db } = setup();
    const alice = await register(call, 'alice');
    const saved = db.prepare('SELECT code_hash FROM account_recovery').get();
    expect(saved?.code_hash).not.toBe(alice.recoveryCode);
    const recovery = {
      username: 'alice',
      password: 'replacement-password-123',
      recoveryCode: alice.recoveryCode,
    };
    expect((await call('/api/account/recover', { ...recovery, recoveryCode: 'f'.repeat(64) })).status).toBe(
      400,
    );
    const result = await call('/api/account/recover', recovery);
    expect(result.status, await result.clone().text()).toBe(200);
    expect(((await result.json()) as { recoveryCode: string }).recoveryCode).not.toBe(alice.recoveryCode);
    expect((await call('/api/account/recover', recovery)).status).toBe(400);
    expect((await call('/api/v1/plans', undefined, alice.headers)).status).toBe(401);
    expect((await call('/api/auth/sign-in/username', { username: 'alice', password })).status).toBe(401);
    expect(
      (await call('/api/auth/sign-in/username', { username: 'alice', password: recovery.password })).status,
    ).toBe(200);
  });

  it('blocks bypass auth routes, rejects oversize storage, enforces quota and logout', async () => {
    const { call, db } = setup();
    expect((await call('/api/auth/sign-up/email', { name: 'oops', email: 'x@y.com', password })).status).toBe(
      404,
    );
    const alice = await register(call, 'alice');
    const headers = { ...alice.headers, 'If-Match': '0' };
    expect((await call('/api/v1/plans/large', 'a'.repeat(256 * 1024 + 1), headers, 'PUT')).status).toBe(413);
    for (let i = 0; i < 20; i++)
      db.prepare('INSERT INTO cloud_plans VALUES (?, ?, 1, ?, 1, ?, 0)').run(
        alice.user.id,
        `p${i}`,
        new Date().toISOString(),
        new Uint8Array([1]),
      );
    expect((await call('/api/v1/plans/another', 'cipher', headers, 'PUT')).status).toBe(403);
    expect((await call('/api/auth/sign-out', {}, alice.headers)).status).toBe(200);
    expect((await call('/api/v1/plans', undefined, alice.headers)).status).toBe(401);
  });

  it('rate limits repeated login attempts across requests', async () => {
    const { call } = setup();
    for (let i = 0; i < 10; i++)
      expect((await call('/api/auth/sign-in/username', { username: 'nobody', password })).status).toBe(401);
    expect((await call('/api/auth/sign-in/username', { username: 'nobody', password })).status).toBe(429);
  });
});
