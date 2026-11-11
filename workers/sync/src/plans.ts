// Plan routes. D1 holds the metadata and is the single arbiter of versions; R2 holds the ciphertext.
// Every statement is scoped by user_id, and R2 keys are only ever built from / read through a user-scoped row.
import type { Env, Limits } from './app';
import { conflict, expectedVersion, HttpError, json, readBody } from './http';

interface PlanRow {
  version: number;
  updated_at: string;
  size: number;
  r2_key: string;
  deleted: number;
}

function getRow(env: Env, userId: string, planId: string): Promise<PlanRow | null> {
  return env.DB.prepare(
    'SELECT version, updated_at, size, r2_key, deleted FROM plans WHERE user_id = ? AND plan_id = ?',
  )
    .bind(userId, planId)
    .first<PlanRow>();
}

function conflictWith(row: PlanRow | null): HttpError {
  return conflict({
    version: row?.version ?? 0,
    updatedAt: row?.updated_at ?? null,
    deleted: row?.deleted === 1,
  });
}

export async function listPlans(env: Env, userId: string): Promise<Response> {
  const { results } = await env.DB.prepare(
    'SELECT plan_id, version, updated_at, size, deleted FROM plans WHERE user_id = ? ORDER BY plan_id',
  )
    .bind(userId)
    .all<PlanRow & { plan_id: string }>();
  return json(
    results.map((r) => ({
      id: r.plan_id,
      version: r.version,
      updatedAt: r.updated_at,
      size: r.size,
      deleted: r.deleted === 1,
    })),
  );
}

export async function getPlan(env: Env, userId: string, planId: string): Promise<Response> {
  const row = await getRow(env, userId, planId);
  if (!row) throw new HttpError(404, 'not_found', 'No such plan');
  if (row.deleted) throw new HttpError(410, 'deleted', 'Plan was deleted', { version: row.version });
  const object = await env.BLOBS.get(row.r2_key);
  // Only possible in the instant between a concurrent PUT's metadata and blob writes.
  if (!object) throw new HttpError(503, 'retry', 'Plan is being written; retry shortly');
  return new Response(await object.arrayBuffer(), {
    headers: {
      'Content-Type': 'application/octet-stream',
      ETag: `"${row.version}"`,
      'X-Plan-Version': String(row.version),
    },
  });
}

export async function putPlan(
  request: Request,
  env: Env,
  userId: string,
  planId: string,
  limits: Limits,
  now: number,
): Promise<Response> {
  const expected = expectedVersion(request);
  const body = await readBody(request, limits.maxPlanBytes);

  const row = await getRow(env, userId, planId);
  if ((row?.version ?? 0) !== expected) throw conflictWith(row);
  if (!row || row.deleted) {
    const live = await env.DB.prepare('SELECT COUNT(*) AS n FROM plans WHERE user_id = ? AND deleted = 0')
      .bind(userId)
      .first<{ n: number }>();
    if ((live?.n ?? 0) >= limits.maxPlans) {
      throw new HttpError(403, 'plan_limit', `At most ${limits.maxPlans} plans are allowed`);
    }
  }

  const version = expected + 1;
  const updatedAt = new Date(now).toISOString();
  const r2Key = `${userId}/${planId}/${version}`;

  // 1. Claim the new version atomically. The WHERE / ON CONFLICT clause makes a concurrent writer lose here,
  //    before anything is written to R2, so two writers can never both store an object for one version.
  const claim = row
    ? env.DB.prepare(
        `UPDATE plans SET version = ?, updated_at = ?, size = ?, r2_key = ?, deleted = 0
         WHERE user_id = ? AND plan_id = ? AND version = ?`,
      ).bind(version, updatedAt, body.byteLength, r2Key, userId, planId, expected)
    : env.DB.prepare(
        `INSERT INTO plans (user_id, plan_id, version, updated_at, size, r2_key, deleted)
         VALUES (?, ?, ?, ?, ?, ?, 0) ON CONFLICT (user_id, plan_id) DO NOTHING`,
      ).bind(userId, planId, version, updatedAt, body.byteLength, r2Key);
  if ((await claim.run()).meta.changes !== 1) throw conflictWith(await getRow(env, userId, planId));

  // 2. Store the ciphertext. If that fails, put the metadata back so the row never points at a missing blob.
  try {
    await env.BLOBS.put(r2Key, body);
  } catch {
    const undo = row
      ? env.DB.prepare(
          `UPDATE plans SET version = ?, updated_at = ?, size = ?, r2_key = ?, deleted = ?
           WHERE user_id = ? AND plan_id = ? AND version = ?`,
        ).bind(row.version, row.updated_at, row.size, row.r2_key, row.deleted, userId, planId, version)
      : env.DB.prepare('DELETE FROM plans WHERE user_id = ? AND plan_id = ? AND version = ?').bind(
          userId,
          planId,
          version,
        );
    await undo.run();
    throw new HttpError(503, 'storage_unavailable', 'Could not store the plan; retry');
  }

  // 3. The previous version's object is now unreferenced.
  if (row?.r2_key) await removeBlob(env, row.r2_key);
  return json({ id: planId, version, updatedAt, size: body.byteLength });
}

/** Best effort: the metadata change is already committed, so a failure here only leaves an orphaned object. */
async function removeBlob(env: Env, r2Key: string): Promise<void> {
  try {
    await env.BLOBS.delete(r2Key);
  } catch {
    console.error('sync-worker: could not delete unreferenced R2 object', r2Key);
  }
}

export async function deletePlan(
  request: Request,
  env: Env,
  userId: string,
  planId: string,
  now: number,
): Promise<Response> {
  const expected = expectedVersion(request);
  const row = await getRow(env, userId, planId);
  if (!row) throw new HttpError(404, 'not_found', 'No such plan');
  if (row.version !== expected) throw conflictWith(row);
  if (row.deleted)
    return json({ id: planId, version: row.version, updatedAt: row.updated_at, deleted: true });

  const version = expected + 1;
  const updatedAt = new Date(now).toISOString();
  const tombstone = await env.DB.prepare(
    `UPDATE plans SET version = ?, updated_at = ?, size = 0, r2_key = '', deleted = 1
     WHERE user_id = ? AND plan_id = ? AND version = ?`,
  )
    .bind(version, updatedAt, userId, planId, expected)
    .run();
  if (tombstone.meta.changes !== 1) throw conflictWith(await getRow(env, userId, planId));
  await removeBlob(env, row.r2_key);
  return json({ id: planId, version, updatedAt, deleted: true });
}
