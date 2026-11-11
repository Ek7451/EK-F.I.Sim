import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleRequest, type Deps, type Env } from '../src/app';
import { clearJwksCache } from '../src/auth';
import {
  ACCESS_AUD,
  APP_ORIGIN,
  jwksDeps,
  makeEnv,
  makeSigner,
  TEAM_DOMAIN,
  type FakeR2,
  type Signer,
} from './fakes';

const BASE = 'https://sync.example.test';
const bytes = (s: string) => new TextEncoder().encode(s);

let signer: Signer;
let tokenA: string;
let tokenB: string;
let env: Env;
let r2: FakeR2;
let deps: Deps & { calls: string[] };

beforeAll(async () => {
  signer = await makeSigner('key-1');
  tokenA = await signer.token('user-a');
  tokenB = await signer.token('user-b');
});

beforeEach(() => {
  clearJwksCache();
  ({ env, r2 } = makeEnv());
  deps = jwksDeps(signer);
});

afterEach(() => {
  vi.restoreAllMocks();
});

interface CallOptions {
  token?: string | null;
  body?: Uint8Array | string | ReadableStream<Uint8Array>;
  ifMatch?: number | string;
  headers?: Record<string, string>;
  deps?: Deps;
  env?: Env;
}

function call(method: string, path: string, opts: CallOptions = {}): Promise<Response> {
  const headers = new Headers(opts.headers);
  const token = opts.token === undefined ? tokenA : opts.token;
  if (token !== null) headers.set('Cf-Access-Jwt-Assertion', token);
  if (opts.ifMatch !== undefined) headers.set('If-Match', String(opts.ifMatch));
  const init: RequestInit & { duplex?: 'half' } = {
    method,
    headers,
    body: opts.body as BodyInit | undefined,
  };
  if (opts.body instanceof ReadableStream) init.duplex = 'half';
  return handleRequest(new Request(BASE + path, init), opts.env ?? env, opts.deps ?? deps);
}

async function body(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

async function blob(response: Response): Promise<Uint8Array> {
  return new Uint8Array(await response.arrayBuffer());
}

describe('plans: create / read / update / delete', () => {
  it('creates, lists, reads and updates a plan, keeping only the latest object in R2', async () => {
    expect(await body(await call('GET', '/v1/plans'))).toEqual([]);

    const created = await call('PUT', '/v1/plans/plan-1', { ifMatch: 0, body: bytes('ciphertext v1') });
    expect(created.status).toBe(200);
    const meta = await body(created);
    expect(meta).toMatchObject({ id: 'plan-1', version: 1, size: 13 });
    expect(typeof meta.updatedAt).toBe('string');
    expect([...r2.objects.keys()]).toEqual(['user-a/plan-1/1']);

    expect(await body(await call('GET', '/v1/plans'))).toEqual([
      { id: 'plan-1', version: 1, updatedAt: meta.updatedAt, size: 13, deleted: false },
    ]);

    const read = await call('GET', '/v1/plans/plan-1');
    expect(read.status).toBe(200);
    expect(read.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(read.headers.get('ETag')).toBe('"1"');
    expect(read.headers.get('X-Plan-Version')).toBe('1');
    expect(read.headers.get('Cache-Control')).toBe('no-store');
    expect(await blob(read)).toEqual(bytes('ciphertext v1'));

    // The ETag from a GET can be sent back verbatim as If-Match.
    const updated = await call('PUT', '/v1/plans/plan-1', { ifMatch: '"1"', body: bytes('ciphertext v2!') });
    expect(await body(updated)).toMatchObject({ id: 'plan-1', version: 2, size: 14 });
    expect([...r2.objects.keys()]).toEqual(['user-a/plan-1/2']);
    expect(await blob(await call('GET', '/v1/plans/plan-1'))).toEqual(bytes('ciphertext v2!'));
  });

  it('accepts If-None-Match: * to create, and only to create', async () => {
    const create = () => call('PUT', '/v1/plans/p', { headers: { 'If-None-Match': '*' }, body: bytes('x') });
    expect((await create()).status).toBe(200);
    const again = await create();
    expect(again.status).toBe(409);
    expect(await body(again)).toMatchObject({ error: 'version_conflict', version: 1 });
  });

  it('returns 409 with the current version on a stale If-Match and leaves the data untouched', async () => {
    await call('PUT', '/v1/plans/p', { ifMatch: 0, body: bytes('one') });
    const second = await body(await call('PUT', '/v1/plans/p', { ifMatch: 1, body: bytes('two') }));

    for (const stale of [0, 1, 3]) {
      const response = await call('PUT', '/v1/plans/p', { ifMatch: stale, body: bytes('stale write') });
      expect(response.status).toBe(409);
      expect(await body(response)).toEqual({
        error: 'version_conflict',
        message: expect.any(String),
        version: 2,
        updatedAt: second.updatedAt,
        deleted: false,
      });
    }
    expect(await blob(await call('GET', '/v1/plans/p'))).toEqual(bytes('two'));
    expect([...r2.objects.keys()]).toEqual(['user-a/p/2']);
  });

  it('lets exactly one of two concurrent writers win', async () => {
    await call('PUT', '/v1/plans/p', { ifMatch: 0, body: bytes('base') });
    const responses = await Promise.all([
      call('PUT', '/v1/plans/p', { ifMatch: 1, body: bytes('writer A') }),
      call('PUT', '/v1/plans/p', { ifMatch: 1, body: bytes('writer B') }),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    const winner = responses[0]!.status === 200 ? 'writer A' : 'writer B';
    expect(await blob(await call('GET', '/v1/plans/p'))).toEqual(bytes(winner));
    expect([...r2.objects.keys()]).toEqual(['user-a/p/2']);
  });

  it('requires a precondition and a valid one', async () => {
    expect((await call('PUT', '/v1/plans/p', { body: bytes('x') })).status).toBe(428);
    expect((await call('PUT', '/v1/plans/p', { ifMatch: 'abc', body: bytes('x') })).status).toBe(400);
    expect((await call('PUT', '/v1/plans/p', { ifMatch: -1, body: bytes('x') })).status).toBe(400);
    expect((await call('PUT', '/v1/plans/p', { ifMatch: 0 })).status).toBe(400); // empty body
    expect((await call('DELETE', '/v1/plans/p')).status).toBe(428);
    expect(r2.objects.size).toBe(0);
  });

  it('tombstones on DELETE: blob removed, row kept with deleted = true', async () => {
    await call('PUT', '/v1/plans/p', { ifMatch: 0, body: bytes('secret') });

    const stale = await call('DELETE', '/v1/plans/p', { ifMatch: 5 });
    expect(stale.status).toBe(409);
    expect(await body(stale)).toMatchObject({ version: 1, deleted: false });
    expect(r2.objects.size).toBe(1);

    const deleted = await call('DELETE', '/v1/plans/p', { ifMatch: 1 });
    expect(deleted.status).toBe(200);
    expect(await body(deleted)).toMatchObject({ id: 'p', version: 2, deleted: true });
    expect(r2.objects.size).toBe(0);

    expect(await body(await call('GET', '/v1/plans'))).toEqual([
      { id: 'p', version: 2, updatedAt: expect.any(String), size: 0, deleted: true },
    ]);
    expect((await call('GET', '/v1/plans/p')).status).toBe(410);

    // A device that has not seen the delete gets a conflict that says so, instead of resurrecting the plan.
    const lateWrite = await call('PUT', '/v1/plans/p', { ifMatch: 1, body: bytes('late') });
    expect(lateWrite.status).toBe(409);
    expect(await body(lateWrite)).toMatchObject({ version: 2, deleted: true });

    // Deliberately restoring it continues the version sequence.
    const restored = await call('PUT', '/v1/plans/p', { ifMatch: 2, body: bytes('restored') });
    expect(await body(restored)).toMatchObject({ version: 3 });
    expect([...r2.objects.keys()]).toEqual(['user-a/p/3']);
  });

  it('returns 404 for unknown plans and 400 for invalid plan ids', async () => {
    expect((await call('GET', '/v1/plans/nope')).status).toBe(404);
    expect((await call('DELETE', '/v1/plans/nope', { ifMatch: 1 })).status).toBe(404);
    for (const id of ['a.b', 'a%2Fb', 'x'.repeat(65), 'a%00b', 'a b']) {
      expect((await call('PUT', `/v1/plans/${id}`, { ifMatch: 0, body: bytes('x') })).status, id).toBe(400);
    }
    expect((await call('GET', '/v1/plans/a/b')).status).toBe(404);
    expect((await call('POST', '/v1/plans/p', { body: bytes('x') })).status).toBe(405);
    expect(r2.objects.size).toBe(0);
  });

  it('enforces the 5 MB body cap, whether or not Content-Length is honest', async () => {
    const max = 5 * 1024 * 1024;
    const ok = await call('PUT', '/v1/plans/big', { ifMatch: 0, body: new Uint8Array(max) });
    expect(ok.status).toBe(200);

    const tooBig = await call('PUT', '/v1/plans/big2', { ifMatch: 0, body: new Uint8Array(max + 1) });
    expect(tooBig.status).toBe(413);

    // Streamed body with no Content-Length: must be cut off while reading.
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 1024 * 1024;
        controller.enqueue(new Uint8Array(1024 * 1024));
        if (sent > 64 * 1024 * 1024) controller.close();
      },
    });
    const streamed = await call('PUT', '/v1/plans/big3', { ifMatch: 0, body: stream });
    expect(streamed.status).toBe(413);
    expect(sent).toBeLessThanOrEqual(8 * 1024 * 1024);

    expect([...r2.objects.keys()]).toEqual(['user-a/big/1']);
    expect(((await body(await call('GET', '/v1/plans'))) as unknown as unknown[]).length).toBe(1);
  });

  it('enforces the per-user plan-count cap on live plans only', async () => {
    const limited: Deps = { ...deps, limits: { maxPlans: 2 } };
    const put = (id: string, ifMatch = 0, token = tokenA) =>
      call('PUT', `/v1/plans/${id}`, { ifMatch, body: bytes('x'), deps: limited, token });
    expect((await put('one')).status).toBe(200);
    expect((await put('two')).status).toBe(200);
    const third = await put('three');
    expect(third.status).toBe(403);
    expect(await body(third)).toMatchObject({ error: 'plan_limit' });
    expect((await put('one', 1)).status).toBe(200); // updating an existing plan is still allowed
    expect((await put('one', 0, tokenB)).status).toBe(200); // the cap is per user

    await call('DELETE', '/v1/plans/two', { ifMatch: 1 });
    expect((await put('three')).status).toBe(200); // a tombstone frees a slot
    expect((await put('two', 2)).status).toBe(403); // ...and restoring it needs one
  });

  it('rolls the metadata back if the blob cannot be stored', async () => {
    r2.failNextPut = true;
    expect((await call('PUT', '/v1/plans/p', { ifMatch: 0, body: bytes('x') })).status).toBe(503);
    expect(await body(await call('GET', '/v1/plans'))).toEqual([]);

    await call('PUT', '/v1/plans/p', { ifMatch: 0, body: bytes('good') });
    r2.failNextPut = true;
    expect((await call('PUT', '/v1/plans/p', { ifMatch: 1, body: bytes('lost') })).status).toBe(503);
    const read = await call('GET', '/v1/plans/p');
    expect(read.headers.get('ETag')).toBe('"1"');
    expect(await blob(read)).toEqual(bytes('good'));
    expect((await call('PUT', '/v1/plans/p', { ifMatch: 1, body: bytes('retry') })).status).toBe(200);
  });
});

describe('keys and settings', () => {
  const bundle = JSON.stringify({
    v: 1,
    kdf: { name: 'argon2id' },
    wrappedByPassphrase: 'AAAA',
    wrappedByRecovery: 'BBBB',
  });

  it('stores and versions the wrapped key bundle', async () => {
    expect((await call('GET', '/v1/keys')).status).toBe(404);
    const created = await call('PUT', '/v1/keys', { ifMatch: 0, body: bundle });
    expect(await body(created)).toMatchObject({ version: 1, size: bundle.length });

    const read = await call('GET', '/v1/keys');
    expect(read.headers.get('Content-Type')).toBe('application/json');
    expect(read.headers.get('ETag')).toBe('"1"');
    expect(await read.text()).toBe(bundle);

    const stale = await call('PUT', '/v1/keys', { ifMatch: 0, body: '{"v":1,"other":true}' });
    expect(stale.status).toBe(409);
    expect(await body(stale)).toMatchObject({
      error: 'version_conflict',
      version: 1,
      updatedAt: expect.any(String),
    });
    expect(await (await call('GET', '/v1/keys')).text()).toBe(bundle);

    expect(
      await body(await call('PUT', '/v1/keys', { ifMatch: 1, body: '{"v":1,"rewrapped":true}' })),
    ).toMatchObject({ version: 2 });
    expect(await (await call('GET', '/v1/keys')).text()).toBe('{"v":1,"rewrapped":true}');
  });

  it('rejects key bundles that are not a JSON object, are too large, or lack a precondition', async () => {
    expect((await call('PUT', '/v1/keys', { ifMatch: 0, body: 'not json' })).status).toBe(400);
    expect((await call('PUT', '/v1/keys', { ifMatch: 0, body: '[1,2]' })).status).toBe(400);
    expect(
      (await call('PUT', '/v1/keys', { ifMatch: 0, body: `{"pad":"${'x'.repeat(17 * 1024)}"}` })).status,
    ).toBe(413);
    expect((await call('PUT', '/v1/keys', { body: bundle })).status).toBe(428);
    expect((await call('GET', '/v1/keys')).status).toBe(404);
  });

  it('stores and versions the opaque settings blob byte-for-byte', async () => {
    const binary = new Uint8Array(256).map((_, i) => i);
    expect((await call('GET', '/v1/settings')).status).toBe(404);
    expect(
      await body(await call('PUT', '/v1/settings', { headers: { 'If-None-Match': '*' }, body: binary })),
    ).toMatchObject({ version: 1, size: 256 });
    const read = await call('GET', '/v1/settings');
    expect(read.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(read.headers.get('ETag')).toBe('"1"');
    expect(await blob(read)).toEqual(binary);

    expect((await call('PUT', '/v1/settings', { ifMatch: 3, body: bytes('stale') })).status).toBe(409);
    expect((await call('PUT', '/v1/settings', { ifMatch: 1, body: bytes('next') })).status).toBe(200);
    expect(await blob(await call('GET', '/v1/settings'))).toEqual(bytes('next'));
    expect(
      (await call('PUT', '/v1/settings', { ifMatch: 2, body: new Uint8Array(64 * 1024 + 1) })).status,
    ).toBe(413);
  });
});

describe('authorization: users are isolated from each other', () => {
  beforeEach(async () => {
    await call('PUT', '/v1/plans/shared-id', { ifMatch: 0, body: bytes('A plan'), token: tokenA });
    await call('PUT', '/v1/plans/only-a', { ifMatch: 0, body: bytes('A only'), token: tokenA });
    await call('PUT', '/v1/keys', { ifMatch: 0, body: '{"owner":"a"}', token: tokenA });
    await call('PUT', '/v1/settings', { ifMatch: 0, body: bytes('A settings'), token: tokenA });
  });

  async function expectUserAUntouched(): Promise<void> {
    const list = (await body(await call('GET', '/v1/plans', { token: tokenA }))) as unknown as {
      id: string;
      version: number;
      deleted: boolean;
    }[];
    expect(list.map((p) => [p.id, p.version, p.deleted])).toEqual([
      ['only-a', 1, false],
      ['shared-id', 1, false],
    ]);
    expect(await blob(await call('GET', '/v1/plans/shared-id', { token: tokenA }))).toEqual(bytes('A plan'));
    expect(await blob(await call('GET', '/v1/plans/only-a', { token: tokenA }))).toEqual(bytes('A only'));
    expect(await (await call('GET', '/v1/keys', { token: tokenA })).text()).toBe('{"owner":"a"}');
    expect(await blob(await call('GET', '/v1/settings', { token: tokenA }))).toEqual(bytes('A settings'));
    expect(r2.objects.get('user-a/shared-id/1')).toEqual(bytes('A plan'));
    expect(r2.objects.get('user-a/only-a/1')).toEqual(bytes('A only'));
  }

  it("B cannot list A's plans", async () => {
    expect(await body(await call('GET', '/v1/plans', { token: tokenB }))).toEqual([]);
  });

  it("B cannot read A's plans, keys or settings", async () => {
    expect((await call('GET', '/v1/plans/shared-id', { token: tokenB })).status).toBe(404);
    expect((await call('GET', '/v1/plans/only-a', { token: tokenB })).status).toBe(404);
    expect((await call('GET', '/v1/keys', { token: tokenB })).status).toBe(404);
    expect((await call('GET', '/v1/settings', { token: tokenB })).status).toBe(404);
  });

  it("B cannot overwrite A's plan: a matching version number is checked against B's own (empty) row", async () => {
    const response = await call('PUT', '/v1/plans/shared-id', {
      ifMatch: 1,
      body: bytes('B attack'),
      token: tokenB,
    });
    expect(response.status).toBe(409);
    expect(await body(response)).toMatchObject({ version: 0, updatedAt: null }); // reveals nothing about A
    expect([...r2.objects.keys()].sort()).toEqual(['user-a/only-a/1', 'user-a/shared-id/1']);
    await expectUserAUntouched();
  });

  it("B creating the same plan id gets B's own row and object; A's are unaffected", async () => {
    const created = await call('PUT', '/v1/plans/shared-id', {
      ifMatch: 0,
      body: bytes('B plan'),
      token: tokenB,
    });
    expect(created.status).toBe(200);
    expect(r2.objects.get('user-b/shared-id/1')).toEqual(bytes('B plan'));
    expect(await blob(await call('GET', '/v1/plans/shared-id', { token: tokenB }))).toEqual(bytes('B plan'));
    const listB = (await body(await call('GET', '/v1/plans', { token: tokenB }))) as unknown as {
      id: string;
    }[];
    expect(listB.map((p) => p.id)).toEqual(['shared-id']);

    // B updating and deleting B's copy never touches A's copy.
    await call('PUT', '/v1/plans/shared-id', { ifMatch: 1, body: bytes('B plan 2'), token: tokenB });
    await call('DELETE', '/v1/plans/shared-id', { ifMatch: 2, token: tokenB });
    expect([...r2.objects.keys()].sort()).toEqual(['user-a/only-a/1', 'user-a/shared-id/1']);
    await expectUserAUntouched();
  });

  it("B cannot delete A's plans", async () => {
    for (const ifMatch of [0, 1, 2]) {
      expect((await call('DELETE', '/v1/plans/shared-id', { ifMatch, token: tokenB })).status).toBe(404);
      expect((await call('DELETE', '/v1/plans/only-a', { ifMatch, token: tokenB })).status).toBe(404);
    }
    await expectUserAUntouched();
  });

  it("B cannot overwrite A's keys or settings", async () => {
    for (const path of ['/v1/keys', '/v1/settings']) {
      const guess = await call('PUT', path, { ifMatch: 1, body: '{"owner":"b"}', token: tokenB });
      expect(guess.status).toBe(409);
      expect(await body(guess)).toMatchObject({ version: 0 });
      expect((await call('PUT', path, { ifMatch: 0, body: '{"owner":"b"}', token: tokenB })).status).toBe(
        200,
      );
      expect((await call('PUT', path, { ifMatch: 1, body: '{"owner":"b2"}', token: tokenB })).status).toBe(
        200,
      );
    }
    expect(await (await call('GET', '/v1/keys', { token: tokenB })).text()).toBe('{"owner":"b2"}');
    await expectUserAUntouched();
  });

  it('cannot escape the user prefix through the plan id', async () => {
    for (const id of ['..%2F..%2Fuser-a%2Fshared-id', 'user-a%2Fshared-id']) {
      expect((await call('GET', `/v1/plans/${id}`, { token: tokenB })).status).toBe(400);
      expect(
        (await call('PUT', `/v1/plans/${id}`, { ifMatch: 0, body: bytes('x'), token: tokenB })).status,
      ).toBe(400);
    }
    // Dot segments are normalised away by URL parsing before routing; the request still runs as B.
    expect((await call('GET', '/v1/plans/../plans/shared-id', { token: tokenB })).status).toBe(404);
    expect((await call('GET', '/v1/plans/%2E%2E', { token: tokenB })).status).toBe(404);
    await expectUserAUntouched();
  });

  it('rejects a subject that could not be a safe storage prefix', async () => {
    for (const sub of ['user-a/shared-id', '', '../user-a']) {
      const token = await signer.token(sub);
      expect((await call('GET', '/v1/plans', { token })).status, sub).toBe(401);
    }
  });
});

describe('authentication (Cloudflare Access JWT)', () => {
  const expect401 = async (token: string | null, opts: CallOptions = {}) => {
    const response = await call('GET', '/v1/plans', { ...opts, token });
    expect(response.status).toBe(401);
    expect(await body(response)).toMatchObject({ error: 'unauthorized' });
  };

  it('accepts a valid token and fetches the JWKS once from the team domain', async () => {
    expect((await call('GET', '/v1/plans')).status).toBe(200);
    expect((await call('GET', '/v1/plans', { token: tokenB })).status).toBe(200);
    expect(deps.calls).toEqual([`https://${TEAM_DOMAIN}/cdn-cgi/access/certs`]);
  });

  it('accepts a string aud claim and several audiences', async () => {
    expect(
      (await call('GET', '/v1/plans', { token: await signer.token('u', { aud: ACCESS_AUD }) })).status,
    ).toBe(200);
    expect(
      (await call('GET', '/v1/plans', { token: await signer.token('u', { aud: ['other', ACCESS_AUD] }) }))
        .status,
    ).toBe(200);
  });

  it('rejects a missing token on every protected route', async () => {
    const routes: [string, string][] = [
      ['GET', '/v1/plans'],
      ['GET', '/v1/plans/p'],
      ['PUT', '/v1/plans/p'],
      ['DELETE', '/v1/plans/p'],
      ['GET', '/v1/keys'],
      ['PUT', '/v1/keys'],
      ['GET', '/v1/settings'],
      ['PUT', '/v1/settings'],
      ['GET', '/v1/unknown'],
    ];
    for (const [method, path] of routes) {
      const response = await call(method, path, {
        token: null,
        ifMatch: 0,
        body: method === 'PUT' ? bytes('x') : undefined,
      });
      expect(response.status, `${method} ${path}`).toBe(401);
    }
    expect(r2.objects.size).toBe(0);
  });

  it('rejects malformed tokens', async () => {
    for (const token of ['garbage', 'a.b', 'a.b.c', '....', `${tokenA}.extra`]) await expect401(token);
  });

  it('rejects a token signed by a different key, even with the same kid', async () => {
    const attacker = await makeSigner('key-1');
    await expect401(await attacker.token('user-a'));
  });

  it('rejects a token whose payload was altered after signing', async () => {
    const [head, , signature] = tokenA.split('.');
    const now = Math.floor(Date.now() / 1000);
    const forged = Buffer.from(
      JSON.stringify({ iss: `https://${TEAM_DOMAIN}`, aud: [ACCESS_AUD], sub: 'user-b', exp: now + 300 }),
    ).toString('base64url');
    await expect401(`${head}.${forged}.${signature}`);
  });

  it('rejects alg "none" and HS256 (algorithm confusion)', async () => {
    const now = Math.floor(Date.now() / 1000);
    const payload = Buffer.from(
      JSON.stringify({ iss: `https://${TEAM_DOMAIN}`, aud: [ACCESS_AUD], sub: 'user-a', exp: now + 300 }),
    ).toString('base64url');
    const none = Buffer.from(JSON.stringify({ alg: 'none', kid: 'key-1' })).toString('base64url');
    await expect401(`${none}.${payload}.`);
    await expect401(await signer.token('user-a', {}, { alg: 'HS256' }));
  });

  it('rejects wrong audience, wrong issuer, expired, not-yet-valid and missing exp', async () => {
    const now = Math.floor(Date.now() / 1000);
    await expect401(await signer.token('user-a', { aud: ['another-app'] }));
    await expect401(await signer.token('user-a', { aud: undefined }));
    await expect401(await signer.token('user-a', { iss: 'https://evil.cloudflareaccess.com' }));
    await expect401(await signer.token('user-a', { exp: now - 1 }));
    await expect401(await signer.token('user-a', { nbf: now + 3600 }));
    await expect401(await signer.token('user-a', { exp: undefined }));
    await expect401(await signer.token('user-a', { sub: undefined }));
  });

  it('rejects an unknown kid without hammering the JWKS endpoint, and picks up rotated keys later', async () => {
    const rotated = await makeSigner('key-2');
    const token = await rotated.token('user-a');
    let now = Date.now();
    const signers = [signer];
    const calls: string[] = [];
    const rotating: Deps = {
      now: () => now,
      fetchJwks: async (url) => {
        calls.push(url);
        return signers.map((s) => s.jwk);
      },
    };
    await expect401(token, { deps: rotating });
    await expect401(token, { deps: rotating });
    expect(calls.length).toBe(1);

    signers.push(rotated); // Access publishes the new key
    now += 61_000;
    expect((await call('GET', '/v1/plans', { token, deps: rotating })).status).toBe(200);
    expect(calls.length).toBe(2);
  });

  it('fails closed when the JWKS cannot be fetched or Access is not configured', async () => {
    const failing: Deps = {
      fetchJwks: async () => {
        throw new Error('network');
      },
    };
    expect((await call('GET', '/v1/plans', { deps: failing })).status).toBe(503);
    const { env: unconfigured } = makeEnv({ ACCESS_AUD: undefined });
    expect((await call('GET', '/v1/plans', { env: unconfigured })).status).toBe(500);
    const { env: noDomain } = makeEnv({ TEAM_DOMAIN: '' });
    expect((await call('GET', '/v1/plans', { env: noDomain })).status).toBe(500);
  });

  it('honours DEV_USER only when ENVIRONMENT is exactly "local"', async () => {
    const { env: local } = makeEnv({
      ENVIRONMENT: 'local',
      DEV_USER: 'dev-user',
      TEAM_DOMAIN: undefined,
      ACCESS_AUD: undefined,
    });
    expect(
      (await call('PUT', '/v1/plans/p', { env: local, token: null, ifMatch: 0, body: bytes('x') })).status,
    ).toBe(200);

    for (const environment of ['production', 'preview', 'Local', '', undefined]) {
      const { env: deployed, r2: bucket } = makeEnv({ ENVIRONMENT: environment, DEV_USER: 'dev-user' });
      const response = await call('PUT', '/v1/plans/p', {
        env: deployed,
        token: null,
        ifMatch: 0,
        body: bytes('x'),
      });
      expect(response.status, String(environment)).toBe(401);
      expect(bucket.objects.size).toBe(0);
    }
    const { env: localNoUser } = makeEnv({ ENVIRONMENT: 'local' });
    expect((await call('GET', '/v1/plans', { env: localNoUser, token: null })).status).toBe(401);
  });

  it('serves /v1/health without authentication', async () => {
    const response = await call('GET', '/v1/health', { token: null });
    expect(response.status).toBe(200);
    expect(await body(response)).toEqual({ ok: true });
  });
});

describe('CORS', () => {
  it('answers preflight for an allowed origin', async () => {
    const response = await call('OPTIONS', '/v1/plans/p', {
      token: null,
      headers: {
        Origin: APP_ORIGIN,
        'Access-Control-Request-Method': 'PUT',
        'Access-Control-Request-Headers': 'if-match',
      },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(APP_ORIGIN);
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('PUT');
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('If-Match');
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    expect(response.headers.get('Vary')).toBe('Origin');
  });

  it('echoes only the calling allowed origin on real requests and exposes the version headers', async () => {
    await call('PUT', '/v1/plans/p', { ifMatch: 0, body: bytes('x'), headers: { Origin: APP_ORIGIN } });
    const response = await call('GET', '/v1/plans/p', { headers: { Origin: 'http://localhost:5173' } });
    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
    expect(response.headers.get('Access-Control-Expose-Headers')).toContain('ETag');
    // Errors carry CORS headers too, so the client can read a 409 body.
    const conflict = await call('PUT', '/v1/plans/p', {
      ifMatch: 7,
      body: bytes('x'),
      headers: { Origin: APP_ORIGIN },
    });
    expect(conflict.status).toBe(409);
    expect(conflict.headers.get('Access-Control-Allow-Origin')).toBe(APP_ORIGIN);
  });

  it('refuses other origins: no CORS headers, and the request is not executed', async () => {
    for (const origin of [
      'https://evil.example',
      `${APP_ORIGIN}.evil.example`,
      'null',
      'https://APP.example.test',
    ]) {
      const preflight = await call('OPTIONS', '/v1/plans/p', { token: null, headers: { Origin: origin } });
      expect(preflight.status).toBe(403);
      expect(preflight.headers.get('Access-Control-Allow-Origin')).toBeNull();

      const write = await call('PUT', '/v1/plans/p', {
        ifMatch: 0,
        body: bytes('x'),
        headers: { Origin: origin },
      });
      expect(write.status).toBe(403);
      expect(write.headers.get('Access-Control-Allow-Origin')).toBeNull();
    }
    expect(r2.objects.size).toBe(0);
  });

  it('allows no browser origin at all when ALLOWED_ORIGINS is unset, but still serves non-browser clients', async () => {
    const { env: closed } = makeEnv({ ALLOWED_ORIGINS: undefined });
    expect((await call('GET', '/v1/plans', { env: closed, headers: { Origin: APP_ORIGIN } })).status).toBe(
      403,
    );
    const direct = await call('GET', '/v1/plans', { env: closed });
    expect(direct.status).toBe(200);
    expect(direct.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});

describe('logging', () => {
  it('never logs request bodies, including on failures', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => undefined),
    );
    const secret = 'SECRET-BODY-MARKER';
    await call('PUT', '/v1/plans/p', { ifMatch: 0, body: bytes(secret) });
    await call('PUT', '/v1/plans/p', { ifMatch: 9, body: bytes(secret) });
    r2.failNextPut = true;
    await call('PUT', '/v1/plans/p', { ifMatch: 1, body: bytes(secret) });
    await call('PUT', '/v1/keys', { ifMatch: 0, body: secret });
    await call('PUT', '/v1/settings', { ifMatch: 0, body: bytes(secret) });
    const broken = {
      ...env,
      DB: {
        prepare: () => {
          throw new Error('D1 down');
        },
      } as unknown as D1Database,
    };
    expect((await call('PUT', '/v1/plans/q', { env: broken, ifMatch: 0, body: bytes(secret) })).status).toBe(
      500,
    );

    const logged = JSON.stringify(spies.flatMap((spy) => spy.mock.calls));
    expect(logged).toContain('D1 down'); // the failure itself is logged...
    expect(logged).not.toContain(secret); // ...the body never is
    expect(logged).not.toContain(Buffer.from(secret).toString('base64'));
  });
});
