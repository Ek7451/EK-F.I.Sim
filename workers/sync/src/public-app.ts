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
const newCode = () => hex(crypto.getRandomValues(new Uint8Array(32)));

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
    const value: unknown = JSON.parse(new TextDecoder().decode(await readBody(request, 4096)));
    if (typeof value === 'object' && value !== null && !Array.isArray(value))
      return value as Record<string, unknown>;
  } catch (e) {
    if (e instanceof HttpError) throw e;
  }
  throw new HttpError(400, 'invalid_body', 'Invalid request');
}

function credentials(body: Record<string, unknown>): { username: string; password: string } {
  const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!/^[a-z0-9_]{3,30}$/.test(username))
    throw new HttpError(400, 'username', 'Use 3–30 letters, numbers or underscores for your username.');
  if (password.length < 12 || password.length > 128)
    throw new HttpError(400, 'password', 'Use a password of 12–128 characters.');
  return { username, password };
}

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
    const code = newCode();
    await env.DB.prepare('INSERT INTO account_recovery (user_id, code_hash) VALUES (?, ?)')
      .bind(data.user.id, await digest(code))
      .run();
    const headers = new Headers(response.headers);
    return new Response(JSON.stringify({ user: { id: data.user.id, username }, recoveryCode: code }), {
      status: 200,
      headers,
    });
  }
  if (path === '/api/account/recover') {
    await limit(env, `recover:${ip}`, 10, 600);
    const { username, password } = credentials(body);
    const code =
      typeof body.recoveryCode === 'string' ? body.recoveryCode.trim().toLowerCase().replace(/-/g, '') : '';
    const codeHash = await digest(code);
    const row = await env.DB.prepare(
      'SELECT user.id FROM user JOIN account_recovery ON user.id = account_recovery.user_id WHERE user.username = ? AND account_recovery.code_hash = ?',
    )
      .bind(username, codeHash)
      .first<{ id: string }>();
    if (!row || !/^[a-f0-9]{64}$/.test(code))
      throw new HttpError(400, 'invalid_recovery', 'Username or recovery code is incorrect.');
    const nextCode = newCode();
    const hash = await (await auth.$context).password.hash(password);
    const guard = 'EXISTS (SELECT 1 FROM account_recovery WHERE user_id = ? AND code_hash = ?)';
    // Atomic D1 batch: only one use of this recovery code can reset the password and revoke sessions.
    const results = await env.DB.batch([
      env.DB.prepare(
        `UPDATE account SET password = ?, updatedAt = ? WHERE userId = ? AND providerId = 'credential' AND ${guard}`,
      ).bind(hash, new Date().toISOString(), row.id, row.id, codeHash),
      env.DB.prepare(`DELETE FROM session WHERE userId = ? AND ${guard}`).bind(row.id, row.id, codeHash),
      env.DB.prepare('UPDATE account_recovery SET code_hash = ? WHERE user_id = ? AND code_hash = ?').bind(
        await digest(nextCode),
        row.id,
        codeHash,
      ),
    ]);
    if (results[2]?.meta.changes !== 1)
      throw new HttpError(400, 'invalid_recovery', 'This recovery code has already been used.');
    return json({ recoveryCode: nextCode });
  }
  if (path === '/api/account/recovery-code') {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) throw new HttpError(401, 'sign_in', 'Sign in first.');
    await auth.api.verifyPassword({
      headers: request.headers,
      body: { password: String(body.password ?? '') },
    });
    const code = newCode();
    await env.DB.prepare(
      'INSERT INTO account_recovery (user_id, code_hash) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET code_hash = excluded.code_hash',
    )
      .bind(session.user.id, await digest(code))
      .run();
    return json({ recoveryCode: code });
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
  if (path === '/api/auth/sign-out' || path === '/api/auth/change-password') {
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
