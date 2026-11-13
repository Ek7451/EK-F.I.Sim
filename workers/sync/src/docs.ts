// Per-user single documents: the wrapped key bundle (/v1/keys) and the encrypted settings blob (/v1/settings).
// Both are opaque to the server, small, and stored base64-encoded in D1 with the same If-Match versioning as plans.
import type { Env } from './app';
import { conflict, expectedVersion, HttpError, json, readBody } from './http';

export interface DocKind {
  /** Fixed table name (never derived from request input). */
  table: 'key_bundles' | 'settings';
  contentType: string;
  maxBytes: number;
  /** Key bundles must at least be a JSON object, so a broken client cannot store garbage over them. */
  requireJsonObject: boolean;
}

interface DocRow {
  version: number;
  updated_at: string;
  body: string;
}

function getRow(env: Pick<Env, 'DB'>, kind: DocKind, userId: string): Promise<DocRow | null> {
  return env.DB.prepare(`SELECT version, updated_at, body FROM ${kind.table} WHERE user_id = ?`)
    .bind(userId)
    .first<DocRow>();
}

export async function getDoc(env: Pick<Env, 'DB'>, kind: DocKind, userId: string): Promise<Response> {
  const row = await getRow(env, kind, userId);
  if (!row) throw new HttpError(404, 'not_found', 'Nothing stored yet');
  return new Response(fromBase64(row.body), {
    headers: {
      'Content-Type': kind.contentType,
      ETag: `"${row.version}"`,
      'X-Plan-Version': String(row.version),
    },
  });
}

export async function putDoc(
  request: Request,
  env: Pick<Env, 'DB'>,
  kind: DocKind,
  userId: string,
  now: number,
): Promise<Response> {
  const expected = expectedVersion(request);
  const body = await readBody(request, kind.maxBytes);
  if (kind.requireJsonObject && !isJsonObject(body)) {
    throw new HttpError(400, 'invalid_body', 'Body must be a JSON object');
  }

  const version = expected + 1;
  const updatedAt = new Date(now).toISOString();
  const encoded = toBase64(body);
  const write =
    expected === 0
      ? env.DB.prepare(
          `INSERT INTO ${kind.table} (user_id, version, updated_at, size, body) VALUES (?, 1, ?, ?, ?)
           ON CONFLICT (user_id) DO NOTHING`,
        ).bind(userId, updatedAt, body.byteLength, encoded)
      : env.DB.prepare(
          `UPDATE ${kind.table} SET version = ?, updated_at = ?, size = ?, body = ?
           WHERE user_id = ? AND version = ?`,
        ).bind(version, updatedAt, body.byteLength, encoded, userId, expected);
  if ((await write.run()).meta.changes !== 1) {
    const row = await getRow(env, kind, userId);
    throw conflict({ version: row?.version ?? 0, updatedAt: row?.updated_at ?? null });
  }
  return json({ version, updatedAt, size: body.byteLength });
}

function isJsonObject(body: Uint8Array): boolean {
  try {
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  } catch {
    return false;
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
