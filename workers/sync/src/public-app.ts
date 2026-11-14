import { createAccounts, type PublicEnv } from './public-auth';
import { HttpError, json, readBody } from './http';
import { publicPlans } from './public-plans';
import { isAPIError } from 'better-auth/api';

const encoder = new TextEncoder();
const hex = (bytes: ArrayBuffer | Uint8Array) =>
  Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
const digest = async (value: string) => hex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));

async function limit(env: PublicEnv, key: string, max: number, seconds: number): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const bucket = Math.floor(now / seconds);
  const storedKey = await digest(`${env.AUTH_SECRET}:${key}:${bucket}`);
  const result = await env.DB.prepare(
    'INSERT INTO request_limits (key, count, expires_at) VALUES (?, 1, ?) ON CONFLICT (key) DO UPDATE SET count = count + 1 RETURNING count',
  )
    .bind(storedKey, (bucket + 1) * seconds)
    .first<{ count: number }>();
  if (!result || result.count > max)
    throw new HttpError(429, 'rate_limit', 'Too many attempts. Please wait a few minutes and try again.');
  if (Math.random() < 0.02)
    await env.DB.prepare('DELETE FROM request_limits WHERE expires_at < ?').bind(now).run();
}

async function input(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('Content-Type')?.startsWith('application/json'))
    throw new HttpError(415, 'content_type', 'Use JSON');
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(await readBody(request, 8192)));
    if (typeof value === 'object' && value !== null && !Array.isArray(value))
      return value as Record<string, unknown>;
  } catch (e) {
    if (e instanceof HttpError) throw e;
  }
  throw new HttpError(400, 'invalid_body', 'Invalid request');
}

/**
 * The browser never sends the typed password. It sends a 32-byte key derived from it (base64), so the server
 * cannot read plans: the key that unwraps them is derived separately and never leaves the browser.
 */
const DERIVED = /^[A-Za-z0-9+/]{43}=$/;
function derived(value: unknown, field: string): string {
  if (typeof value !== 'string' || !DERIVED.test(value))
    throw new HttpError(400, field, 'This request was not made by the Longview app. Reload and try again.');
  return value;
}

function usernameOf(body: Record<string, unknown>): string {
  const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
  if (!/^[a-z0-9_]{3,30}$/.test(username))
    throw new HttpError(400, 'username', 'Use 3–30 letters, numbers or underscores for your username.');
  return username;
}

function credentials(body: Record<string, unknown>): { username: string; password: string } {
  return { username: usernameOf(body), password: derived(body.password, 'password') };
}

/** The wrapped data key (bundle v2). Opaque to the server apart from its shape and size. */
function bundleOf(value: unknown): string {
  const b = value as Record<string, unknown> | null;
  const field = (k: string) => typeof b?.[k] === 'string' && /^[A-Za-z0-9+/=]{16,512}$/.test(b[k] as string);
  if (
    typeof b !== 'object' ||
    b === null ||
    b.v !== 2 ||
    !field('wrappedByPassword') ||
    !field('wrappedByRecovery') ||
    !field('keyCheck')
  )
    throw new HttpError(
      400,
      'bundle',
      'This request was not made by the Longview app. Reload and try again.',
    );
  return JSON.stringify({
    v: 2,
    wrappedByPassword: b.wrappedByPassword,
    wrappedByRecovery: b.wrappedByRecovery,
    keyCheck: b.keyCheck,
  });
}

function versionOf(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1)
    throw new HttpError(400, 'version', 'Reload and try again.');
  return value as number;
}

// key_bundles keeps its body base64-encoded, like every per-user document (docs.ts).
const stored = (json: string) => btoa(json);

async function route(request: Request, env: PublicEnv): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/api/v1/health' && request.method === 'GET') return json({ ok: true });
  // Previews do not share production account access. Never infer the trusted host from request headers.
  if (url.origin !== env.APP_ORIGIN)
    throw new HttpError(403, 'origin', 'Accounts are available on the main Longview Planner site.');
  const origin = request.headers.get('Origin');
  if ((origin && origin !== env.APP_ORIGIN) || (request.method !== 'GET' && origin !== env.APP_ORIGIN))
    throw new HttpError(403, 'origin', 'Request origin is not allowed.');
  if (!env.AUTH_SECRET || env.AUTH_SECRET.length < 32) throw new Error('Missing account configuration');
  const auth = createAccounts(env);
  const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
  if (url.pathname.startsWith('/api/v1/')) {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) throw new HttpError(401, 'sign_in', 'Sign in to your cloud account in Settings.');
    if (request.headers.get('X-Longview-Account') !== session.user.id)
      throw new HttpError(
        409,
        'account_changed',
        'The signed-in account changed. Reload and sign in to the account linked to this device.',
      );
    await limit(env, `sync:${session.user.id}`, 240, 60);
    // The wrapped key changes only with the password or the recovery code (below), so the two never drift apart.
    if (url.pathname === '/api/v1/keys' && request.method !== 'GET')
      throw new HttpError(405, 'method_not_allowed', 'The key changes only with your password.');
    return publicPlans(request, env, session.user.id);
  }
  const path = url.pathname;
  if (path === '/api/auth/get-session' && request.method === 'GET') return auth.handler(request);
  if (request.method !== 'POST') throw new HttpError(404, 'not_found', 'No such route');
  await limit(env, `account:${ip}`, 30, 60);
  const body = await input(request);
  if (path === '/api/account/register') {
    await limit(env, `register:${ip}`, 5, 3600);
    const { username, password } = credentials(body);
    const recoveryAuth = derived(body.recoveryAuth, 'recovery');
    const bundle = bundleOf(body.bundle);
    // Better Auth requires an email column; this reserved .invalid address is an internal identifier only.
    const response = await auth.handler(
      new Request(`${env.APP_ORIGIN}/api/auth/sign-up/email`, {
        method: 'POST',
        headers: request.headers,
        body: JSON.stringify({
          name: username,
          username,
          email: `${username}@accounts.longview.invalid`,
          password,
        }),
      }),
    );
    if (!response.ok) return response;
    const data = (await response.clone().json()) as { user: { id: string; username: string } };
    const now = new Date().toISOString();
    try {
      await env.DB.batch([
        env.DB.prepare('INSERT INTO account_recovery (user_id, code_hash) VALUES (?, ?)').bind(
          data.user.id,
          await digest(recoveryAuth),
        ),
        env.DB.prepare(
          'INSERT INTO key_bundles (user_id, version, updated_at, size, body) VALUES (?, 1, ?, ?, ?)',
        ).bind(data.user.id, now, bundle.length, stored(bundle)),
      ]);
    } catch (e) {
      // Without its key and recovery check the account is unusable: remove it so the name can be used again.
      await env.DB.prepare('DELETE FROM user WHERE id = ?').bind(data.user.id).run();
      throw e;
    }
    return new Response(JSON.stringify({ user: { id: data.user.id, username } }), {
      status: 200,
      headers: new Headers(response.headers),
    });
  }
  if (path === '/api/account/recover/begin') {
    await limit(env, `recover:${ip}`, 10, 600);
    const username = usernameOf(body);
    const codeHash = await digest(derived(body.recoveryAuth, 'recovery'));
    const row = await env.DB.prepare(
      'SELECT key_bundles.version, key_bundles.body FROM user JOIN account_recovery ON user.id = account_recovery.user_id JOIN key_bundles ON user.id = key_bundles.user_id WHERE user.username = ? AND account_recovery.code_hash = ?',
    )
      .bind(username, codeHash)
      .first<{ version: number; body: string }>();
    if (!row) throw new HttpError(400, 'invalid_recovery', 'Username or recovery code is incorrect.');
    return json({ bundle: JSON.parse(atob(row.body)) as unknown, version: row.version });
  }
  if (path === '/api/account/recover') {
    await limit(env, `recover:${ip}`, 10, 600);
    const { username, password } = credentials(body);
    const codeHash = await digest(derived(body.recoveryAuth, 'recovery'));
    const nextHash = await digest(derived(body.newRecoveryAuth, 'recovery'));
    const bundle = bundleOf(body.bundle);
    const version = versionOf(body.bundleVersion);
    const row = await env.DB.prepare(
      'SELECT user.id FROM user JOIN account_recovery ON user.id = account_recovery.user_id WHERE user.username = ? AND account_recovery.code_hash = ?',
    )
      .bind(username, codeHash)
      .first<{ id: string }>();
    if (!row || nextHash === codeHash)
      throw new HttpError(400, 'invalid_recovery', 'Username or recovery code is incorrect.');
    const hash = await (await auth.$context).password.hash(password);
    // One atomic batch: the old code is valid AND the key is the one the browser re-wrapped. Either everything
    // changes (password, sessions, recovery check, key) or nothing does, and the old code cannot be used twice.
    const guard =
      'EXISTS (SELECT 1 FROM account_recovery WHERE user_id = ? AND code_hash = ?) AND EXISTS (SELECT 1 FROM key_bundles WHERE user_id = ? AND version = ?)';
    const g = [row.id, codeHash, row.id, version];
    const now = new Date().toISOString();
    const results = await env.DB.batch([
      env.DB.prepare(
        `UPDATE account SET password = ?, updatedAt = ? WHERE userId = ? AND providerId = 'credential' AND ${guard}`,
      ).bind(hash, now, row.id, ...g),
      env.DB.prepare(`DELETE FROM session WHERE userId = ? AND ${guard}`).bind(row.id, ...g),
      env.DB.prepare(
        'UPDATE account_recovery SET code_hash = ? WHERE user_id = ? AND code_hash = ? AND EXISTS (SELECT 1 FROM key_bundles WHERE user_id = ? AND version = ?)',
      ).bind(nextHash, row.id, codeHash, row.id, version),
      env.DB.prepare(
        'UPDATE key_bundles SET version = version + 1, updated_at = ?, size = ?, body = ? WHERE user_id = ? AND version = ? AND EXISTS (SELECT 1 FROM account_recovery WHERE user_id = ? AND code_hash = ?)',
      ).bind(now, bundle.length, stored(bundle), row.id, version, row.id, nextHash),
    ]);
    if (results[2]?.meta.changes !== 1 || results[3]?.meta.changes !== 1)
      throw new HttpError(
        400,
        'invalid_recovery',
        'This recovery code has already been used, or the account changed. Start again.',
      );
    return json({ ok: true });
  }
  if (path === '/api/account/change-password' || path === '/api/account/recovery') {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) throw new HttpError(401, 'sign_in', 'Sign in first.');
    await limit(env, `change:${session.user.id}`, 10, 600);
    // The current password, as the browser derives it, proves this is the account holder.
    const current = derived(body.password, 'password');
    try {
      await auth.api.verifyPassword({ headers: request.headers, body: { password: current } });
    } catch (e) {
      if (isAPIError(e)) throw new HttpError(401, 'password', 'That is not your current password.');
      throw e;
    }
    const bundle = bundleOf(body.bundle);
    const version = versionOf(body.bundleVersion);
    const id = session.user.id;
    const now = new Date().toISOString();
    const sameKey = 'EXISTS (SELECT 1 FROM key_bundles WHERE user_id = ? AND version = ?)';
    const first =
      path === '/api/account/change-password'
        ? env.DB.prepare(
            `UPDATE account SET password = ?, updatedAt = ? WHERE userId = ? AND providerId = 'credential' AND ${sameKey}`,
          ).bind(
            await (await auth.$context).password.hash(derived(body.newPassword, 'password')),
            now,
            id,
            id,
            version,
          )
        : env.DB.prepare(`UPDATE account_recovery SET code_hash = ? WHERE user_id = ? AND ${sameKey}`).bind(
            await digest(derived(body.recoveryAuth, 'recovery')),
            id,
            id,
            version,
          );
    const results = await env.DB.batch([
      first,
      env.DB.prepare(
        'UPDATE key_bundles SET version = version + 1, updated_at = ?, size = ?, body = ? WHERE user_id = ? AND version = ?',
      ).bind(now, bundle.length, stored(bundle), id, version),
    ]);
    if (results[0]?.meta.changes !== 1 || results[1]?.meta.changes !== 1)
      throw new HttpError(409, 'conflict', 'Your account changed on another device. Reload and try again.');
    return json({ ok: true, version: version + 1 });
  }
  if (path === '/api/auth/sign-in/username') {
    const username = String(body.username ?? '')
      .trim()
      .toLowerCase();
    await limit(env, `login:${ip}`, 10, 300);
    await limit(env, `username:${username}`, 30, 300);
    return auth.handler(
      new Request(request.url, {
        method: 'POST',
        headers: request.headers,
        body: JSON.stringify({ ...body, username }),
      }),
    );
  }
  if (path === '/api/auth/sign-out') {
    return auth.handler(
      new Request(request.url, { method: 'POST', headers: request.headers, body: JSON.stringify(body) }),
    );
  }
  throw new HttpError(404, 'not_found', 'No such route');
}

export async function publicRequest(request: Request, env: PublicEnv): Promise<Response> {
  let response: Response;
  try {
    response = await route(request, env);
  } catch (e) {
    if (e instanceof HttpError) response = json({ error: e.code, message: e.message, ...e.extra }, e.status);
    else if (isAPIError(e))
      response = json(
        { error: 'account_request', message: e.body?.message ?? 'Account request failed.' },
        e.statusCode,
      );
    else {
      // Never log request bodies, passwords, recovery codes, cookies or plan contents.
      console.error('Longview account service request failed');
      response = json(
        {
          error: 'unavailable',
          message:
            'Cloud saving is temporarily unavailable. Your local plans are safe. Please try again later.',
        },
        503,
      );
    }
  }
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  if (response.status === 429) headers.set('Retry-After', '300');
  return new Response(response.body, { status: response.status, headers });
}
