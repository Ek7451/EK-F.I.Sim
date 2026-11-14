import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { publicRequest } from '../src/public-app';
import type { PublicEnv } from '../src/public-auth';

function setup() {
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
  const db = new DatabaseSync(':memory:');
  for (const name of ['0001_init', '0002_public_accounts', '0003_public_storage', '0004_simple_accounts'])
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
/**
 * What the browser sends: 32-byte keys derived from the password and the recovery code (base64), never the typed
 * secrets, and an opaque wrapped key bundle. The server must accept these shapes and nothing else.
 */
const key = (seed: string) => btoa(seed.padEnd(32, '.').slice(0, 32));
const password = key('password-one');
const recoveryAuth = key('recovery-one');
const bundle = (tag: string) => ({
  v: 2,
  wrappedByPassword: key(`wrap-${tag}`),
  wrappedByRecovery: key(`recovery-${tag}`),
  keyCheck: key(`check-${tag}`),
});
async function register(call: ReturnType<typeof setup>['call'], username: string) {
  const response = await call('/api/account/register', {
    username,
    password,
    recoveryAuth,
    bundle: bundle('first'),
  });
  expect(response.status, await response.clone().text()).toBe(200);
  const data = (await response.json()) as { user: { id: string } };
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
    // Registration stored the wrapped key; it can be read, but changes only through the account routes.
    expect(await (await call('/api/v1/keys', undefined, alice.headers)).json()).toEqual(bundle('first'));
    expect((await call('/api/v1/keys', { wrapped: 'key' }, headers, 'PUT')).status).toBe(405);
    expect(await (await call('/api/v1/keys', undefined, bob.headers)).json()).toEqual(bundle('first'));
    expect(
      (await call('/api/v1/plans/one', undefined, { ...alice.headers, 'If-Match': '1' }, 'DELETE')).status,
    ).toBe(200);
    expect((await call('/api/v1/plans/one', undefined, alice.headers)).status).toBe(410);
  });

  it('resets a password once with the recovery code, swaps the key and revokes sessions', async () => {
    const { call, db } = setup();
    const alice = await register(call, 'alice');
    const saved = db.prepare('SELECT code_hash FROM account_recovery').get();
    expect(saved?.code_hash).not.toBe(recoveryAuth);

    // Step 1: the code (its derived half) unlocks the wrapped key so the browser can re-wrap it.
    expect(
      (await call('/api/account/recover/begin', { username: 'alice', recoveryAuth: key('wrong') })).status,
    ).toBe(400);
    const begin = await call('/api/account/recover/begin', { username: 'alice', recoveryAuth });
    expect(begin.status, await begin.clone().text()).toBe(200);
    expect(await begin.json()).toEqual({ bundle: bundle('first'), version: 1 });

    const reset = {
      username: 'alice',
      recoveryAuth,
      password: key('password-two'),
      newRecoveryAuth: key('recovery-two'),
      bundle: bundle('second'),
      bundleVersion: 1,
    };
    // A stale key version changes nothing at all.
    expect((await call('/api/account/recover', { ...reset, bundleVersion: 2 })).status).toBe(400);
    expect((await call('/api/v1/plans', undefined, alice.headers)).status).toBe(200);

    const done = await call('/api/account/recover', reset);
    expect(done.status, await done.clone().text()).toBe(200);
    expect((await call('/api/account/recover', reset)).status).toBe(400); // the old code is spent
    expect((await call('/api/v1/plans', undefined, alice.headers)).status).toBe(401); // sessions revoked
    expect((await call('/api/auth/sign-in/username', { username: 'alice', password })).status).toBe(401);
    const signIn = await call('/api/auth/sign-in/username', { username: 'alice', password: reset.password });
    expect(signIn.status).toBe(200);
    const cookie = signIn.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');
    const headers = { Cookie: cookie, 'X-Longview-Account': alice.user.id };
    expect(await (await call('/api/v1/keys', undefined, headers)).json()).toEqual(bundle('second'));
    expect(
      (await call('/api/account/recover/begin', { username: 'alice', recoveryAuth: key('recovery-two') }))
        .status,
    ).toBe(200);
  });

  it('changes the password and the recovery code together with the key, or not at all', async () => {
    const { call } = setup();
    const alice = await register(call, 'alice');
    const change = { password, newPassword: key('password-two'), bundle: bundle('second'), bundleVersion: 1 };
    expect((await call('/api/account/change-password', change)).status).toBe(401);
    expect(
      (await call('/api/account/change-password', { ...change, password: key('wrong') }, alice.headers))
        .status,
    ).toBe(401);
    expect(
      (await call('/api/account/change-password', { ...change, bundleVersion: 7 }, alice.headers)).status,
    ).toBe(409);
    expect((await call('/api/auth/sign-in/username', { username: 'alice', password })).status).toBe(200);
    const changed = await call('/api/account/change-password', change, alice.headers);
    expect(changed.status, await changed.clone().text()).toBe(200);
    expect(await changed.json()).toEqual({ ok: true, version: 2 });
    expect((await call('/api/auth/sign-in/username', { username: 'alice', password })).status).toBe(401);
    expect(
      (await call('/api/auth/sign-in/username', { username: 'alice', password: change.newPassword })).status,
    ).toBe(200);

    const recovery = {
      password: change.newPassword,
      recoveryAuth: key('recovery-three'),
      bundle: bundle('third'),
      bundleVersion: 2,
    };
    const made = await call('/api/account/recovery', recovery, alice.headers);
    expect(made.status, await made.clone().text()).toBe(200);
    expect((await call('/api/account/recover/begin', { username: 'alice', recoveryAuth })).status).toBe(400);
    expect(
      (await call('/api/account/recover/begin', { username: 'alice', recoveryAuth: recovery.recoveryAuth }))
        .status,
    ).toBe(200);
  });

  it('accepts only derived keys, never a typed password or a malformed bundle', async () => {
    const { call } = setup();
    const typed = await call('/api/account/register', {
      username: 'carol',
      password: 'a typed password here',
      recoveryAuth,
      bundle: bundle('first'),
    });
    expect(typed.status).toBe(400);
    const badBundle = await call('/api/account/register', {
      username: 'carol',
      password,
      recoveryAuth,
      bundle: { v: 1, wrappedByPassword: 'x' },
    });
    expect(badBundle.status).toBe(400);
    expect((await call('/api/account/recovery-code', { password })).status).toBe(404);
    expect((await call('/api/auth/change-password', { currentPassword: password })).status).toBe(404);
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
