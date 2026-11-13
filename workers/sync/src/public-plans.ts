import type { PublicEnv } from './public-auth';
import { getDoc, putDoc, type DocKind } from './docs';
import { conflict, expectedVersion, HttpError, json, readBody } from './http';

interface Row {
  plan_id: string;
  version: number;
  updated_at: string;
  size: number;
  deleted: number;
  body?: ArrayBuffer | number[];
}
export const CLOUD_LIMITS = { planBytes: 256 * 1024, accountBytes: 2 * 1024 * 1024, plans: 20 };
const kinds: Record<string, DocKind> = {
  '/v1/keys': {
    table: 'key_bundles',
    contentType: 'application/json',
    maxBytes: 16 * 1024,
    requireJsonObject: true,
  },
  '/v1/settings': {
    table: 'settings',
    contentType: 'application/octet-stream',
    maxBytes: 64 * 1024,
    requireJsonObject: false,
  },
};
const meta = (r: Row) => ({
  id: r.plan_id,
  version: r.version,
  updatedAt: r.updated_at,
  size: r.size,
  deleted: !!r.deleted,
});

export async function publicPlans(request: Request, env: PublicEnv, userId: string): Promise<Response> {
  const path = new URL(request.url).pathname.replace(/^\/api/, '');
  const kind = kinds[path];
  if (kind) {
    if (request.method === 'GET') return getDoc(env, kind, userId);
    if (request.method === 'PUT') return putDoc(request, env, kind, userId, Date.now());
    throw new HttpError(405, 'method_not_allowed', 'Use GET or PUT');
  }
  if (path === '/v1/plans' && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT plan_id, version, updated_at, size, deleted FROM cloud_plans WHERE user_id = ? ORDER BY plan_id',
    )
      .bind(userId)
      .all<Row>();
    return json(results.map(meta));
  }
  const id = /^\/v1\/plans\/([A-Za-z0-9_-]{1,64})$/.exec(path)?.[1];
  if (!id) throw new HttpError(404, 'not_found', 'No such route');
  const getRow = () =>
    env.DB.prepare(
      'SELECT plan_id, version, updated_at, size, deleted FROM cloud_plans WHERE user_id = ? AND plan_id = ?',
    )
      .bind(userId, id)
      .first<Row>();
  if (request.method === 'GET') {
    const row = await env.DB.prepare('SELECT * FROM cloud_plans WHERE user_id = ? AND plan_id = ?')
      .bind(userId, id)
      .first<Row>();
    if (!row) throw new HttpError(404, 'not_found', 'No such plan');
    if (row.deleted) throw new HttpError(410, 'deleted', 'Plan was deleted', { version: row.version });
    return new Response(Array.isArray(row.body) ? new Uint8Array(row.body) : row.body, {
      headers: {
        'Content-Type': 'application/octet-stream',
        ETag: `"${row.version}"`,
        'X-Plan-Version': String(row.version),
      },
    });
  }
  const expected = expectedVersion(request);
  const previous = await getRow();
  const failVersion = (row: Row | null) =>
    conflict({ version: row?.version ?? 0, updatedAt: row?.updated_at ?? null, deleted: !!row?.deleted });
  if ((previous?.version ?? 0) !== expected) throw failVersion(previous);
  const updatedAt = new Date().toISOString();
  if (request.method === 'DELETE') {
    if (!previous) throw new HttpError(404, 'not_found', 'No such plan');
    if (previous.deleted) return json(meta(previous));
    const result = await env.DB.prepare(
      'UPDATE cloud_plans SET version = version + 1, updated_at = ?, size = 0, body = NULL, deleted = 1 WHERE user_id = ? AND plan_id = ? AND version = ?',
    )
      .bind(updatedAt, userId, id, expected)
      .run();
    if (result.meta.changes !== 1) throw failVersion(await getRow());
    return json({ id, version: expected + 1, updatedAt, deleted: true });
  }
  if (request.method !== 'PUT') throw new HttpError(405, 'method_not_allowed', 'Use GET, PUT or DELETE');
  const body = await readBody(request, CLOUD_LIMITS.planBytes);
  // One SQL statement commits both ciphertext and version, with quotas enforced in the same statement.
  const quota = `(SELECT COUNT(*) FROM cloud_plans WHERE user_id = ? AND deleted = 0 AND plan_id != ?) < ?
    AND (SELECT COALESCE(SUM(size),0) FROM cloud_plans WHERE user_id = ? AND plan_id != ?) + ? <= ?`;
  const quotaArgs = [userId, id, CLOUD_LIMITS.plans, userId, id, body.byteLength, CLOUD_LIMITS.accountBytes];
  const write = previous
    ? env.DB.prepare(
        `UPDATE cloud_plans SET version = ?, updated_at = ?, size = ?, body = ?, deleted = 0 WHERE user_id = ? AND plan_id = ? AND version = ? AND ${quota}`,
      ).bind(expected + 1, updatedAt, body.byteLength, body, userId, id, expected, ...quotaArgs)
    : env.DB.prepare(
        `INSERT INTO cloud_plans (user_id, plan_id, version, updated_at, size, body, deleted) SELECT ?, ?, 1, ?, ?, ?, 0 WHERE ${quota} AND (SELECT COUNT(*) FROM cloud_plans WHERE user_id = ?) < 200 ON CONFLICT (user_id, plan_id) DO NOTHING`,
      ).bind(userId, id, updatedAt, body.byteLength, body, ...quotaArgs, userId);
  if ((await write.run()).meta.changes !== 1) {
    const row = await getRow();
    if ((row?.version ?? 0) !== expected) throw failVersion(row);
    throw new HttpError(
      403,
      'storage_limit',
      'Cloud storage is full (20 plans, 2 MiB total). Local saving still works. Export a backup or remove an unused cloud plan.',
    );
  }
  return json({ id, version: expected + 1, updatedAt, size: body.byteLength });
}
