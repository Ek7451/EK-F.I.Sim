// Typed client for the sync Worker (workers/sync). It moves opaque bytes only: encryption and decryption
// happen in @fisim/crypto before and after these calls, and no key material ever passes through here.
//
// Versions are optimistic-concurrency counters. Pass the version you last saw (0 = "does not exist yet");
// on success the server stores version + 1, so encrypt a plan with AAD version `expectedVersion + 1`.

export interface PlanMeta {
  id: string;
  version: number;
  updatedAt: string;
  size: number;
  deleted: boolean;
}

export interface Stored {
  version: number;
  updatedAt: string;
  size: number;
}

/** The server holds a different version than the one the caller expected; nothing was written. */
export interface Conflict {
  conflict: true;
  /** Current server version (0 if nothing is stored). */
  version: number;
  updatedAt: string | null;
  /** Plans only: the current server state is a tombstone. */
  deleted?: boolean;
}

export class SyncError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SyncError';
  }
}

export interface SyncClientOptions {
  /** e.g. "https://sync.example.com" (no trailing "/v1"). */
  baseUrl: string;
  /** Defaults to the global fetch. */
  fetch?: typeof fetch;
  /** Extra headers per request (e.g. a Cloudflare Access token outside the browser). */
  headers?: () => Record<string, string> | Promise<Record<string, string>>;
}

export interface SyncClient {
  listPlans(): Promise<PlanMeta[]>;
  /** Returns null if the plan does not exist or has been deleted. */
  getPlan(id: string): Promise<{ version: number; data: Uint8Array } | null>;
  putPlan(
    id: string,
    expectedVersion: number,
    data: Uint8Array,
  ): Promise<(Stored & { id: string }) | Conflict>;
  deletePlan(
    id: string,
    expectedVersion: number,
  ): Promise<{ id: string; version: number; updatedAt: string } | Conflict>;
  /** The wrapped key bundle (see @fisim/crypto KeyBundle), or null if this account has none yet. */
  getKeys(): Promise<{ version: number; bundle: unknown } | null>;
  putKeys(expectedVersion: number, bundle: unknown): Promise<Stored | Conflict>;
  getSettings(): Promise<{ version: number; data: Uint8Array } | null>;
  putSettings(expectedVersion: number, data: Uint8Array): Promise<Stored | Conflict>;
}

export function isConflict(result: object): result is Conflict {
  return (result as Partial<Conflict>).conflict === true;
}

export function createSyncClient(options: SyncClientOptions): SyncClient {
  const base = options.baseUrl.replace(/\/+$/, '');
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);

  async function request(
    method: string,
    path: string,
    init: { ifMatch?: number; body?: BodyInit; contentType?: string } = {},
  ) {
    const headers = new Headers(await options.headers?.());
    if (init.ifMatch !== undefined) headers.set('If-Match', String(init.ifMatch));
    if (init.contentType) headers.set('Content-Type', init.contentType);
    // credentials: the Cloudflare Access session cookie when the API is on another origin.
    return doFetch(`${base}/v1${path}`, {
      method,
      headers,
      body: init.body,
      credentials: 'include',
      cache: 'no-store',
    });
  }

  async function fail(response: Response): Promise<never> {
    const info = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new SyncError(
      response.status,
      info.error ?? 'http_error',
      info.message ?? `Sync request failed (${response.status})`,
    );
  }

  /** Parses a write response: the stored metadata, or a Conflict on 409. */
  async function written<T>(response: Response): Promise<T | Conflict> {
    if (response.status === 409) {
      const current = (await response.json()) as {
        version: number;
        updatedAt: string | null;
        deleted?: boolean;
      };
      return {
        conflict: true,
        version: current.version,
        updatedAt: current.updatedAt,
        deleted: current.deleted,
      };
    }
    if (!response.ok) return fail(response);
    return (await response.json()) as T;
  }

  /** Parses a read response: null when nothing is stored, otherwise the version (from the ETag) and bytes. */
  async function read(response: Response): Promise<{ version: number; data: Uint8Array } | null> {
    if (response.status === 404 || response.status === 410) return null;
    if (!response.ok) return fail(response);
    // Cloudflare may weaken ETags when compressing responses (W/"1"). The version is an application
    // counter, independent of the transfer encoding; prefer its explicit header and accept weak ETags.
    const raw =
      response.headers.get('X-Plan-Version') ??
      (response.headers.get('ETag') ?? '').replace(/^W\//, '').replace(/^"|"$/g, '');
    const version = /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isInteger(version) || version < 1)
      throw new SyncError(response.status, 'bad_response', 'Missing version');
    return { version, data: new Uint8Array(await response.arrayBuffer()) };
  }

  const planPath = (id: string) => `/plans/${encodeURIComponent(id)}`;
  const binary = (data: Uint8Array) => ({
    body: data as Uint8Array<ArrayBuffer>,
    contentType: 'application/octet-stream',
  });

  return {
    async listPlans() {
      const response = await request('GET', '/plans');
      if (!response.ok) return fail(response);
      return (await response.json()) as PlanMeta[];
    },
    async getPlan(id) {
      return read(await request('GET', planPath(id)));
    },
    async putPlan(id, expectedVersion, data) {
      return written(await request('PUT', planPath(id), { ifMatch: expectedVersion, ...binary(data) }));
    },
    async deletePlan(id, expectedVersion) {
      return written(await request('DELETE', planPath(id), { ifMatch: expectedVersion }));
    },
    async getKeys() {
      const stored = await read(await request('GET', '/keys'));
      return (
        stored && {
          version: stored.version,
          bundle: JSON.parse(new TextDecoder().decode(stored.data)) as unknown,
        }
      );
    },
    async putKeys(expectedVersion, bundle) {
      const body = JSON.stringify(bundle);
      return written(
        await request('PUT', '/keys', { ifMatch: expectedVersion, body, contentType: 'application/json' }),
      );
    },
    async getSettings() {
      return read(await request('GET', '/settings'));
    },
    async putSettings(expectedVersion, data) {
      return written(await request('PUT', '/settings', { ifMatch: expectedVersion, ...binary(data) }));
    },
  };
}
