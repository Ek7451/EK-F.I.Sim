// Routing, CORS and error handling. No framework; `handleRequest` is called by src/index.ts and by the tests.
import { authenticate, type JwksFetcher } from './auth';
import { getDoc, putDoc, type DocKind } from './docs';
import { HttpError, json } from './http';
import { deletePlan, getPlan, listPlans, putPlan } from './plans';

export interface Env {
  DB: D1Database;
  BLOBS: R2Bucket;
  /** "local" | "preview" | "production" */
  ENVIRONMENT?: string;
  /** Local development only; honoured only when ENVIRONMENT === "local". */
  DEV_USER?: string;
  /** e.g. "myteam.cloudflareaccess.com" */
  TEAM_DOMAIN?: string;
  /** The Access application's audience (AUD) tag. */
  ACCESS_AUD?: string;
  /** Comma-separated list of exact origins allowed to call the API from a browser. */
  ALLOWED_ORIGINS?: string;
}

export interface Limits {
  maxPlanBytes: number;
  maxPlans: number;
}

/** Injection points for tests. */
export interface Deps {
  fetchJwks?: JwksFetcher;
  /** Current time in milliseconds. */
  now?: () => number;
  limits?: Partial<Limits>;
}

export const DEFAULT_LIMITS: Limits = { maxPlanBytes: 5 * 1024 * 1024, maxPlans: 200 };

const KEYS: DocKind = {
  table: 'key_bundles',
  contentType: 'application/json',
  maxBytes: 16 * 1024,
  requireJsonObject: true,
};
const SETTINGS: DocKind = {
  table: 'settings',
  contentType: 'application/octet-stream',
  maxBytes: 64 * 1024,
  requireJsonObject: false,
};

const PLAN_PATH = /^\/v1\/plans\/([^/]+)$/;
const PLAN_ID = /^[A-Za-z0-9_-]{1,64}$/;

export async function handleRequest(request: Request, env: Env, deps: Deps = {}): Promise<Response> {
  const origin = request.headers.get('Origin');
  const originAllowed = origin !== null && allowedOrigins(env).includes(origin);

  let response: Response;
  if (origin !== null && !originAllowed) {
    // Browsers send Origin on every cross-origin request; refuse unknown sites before doing any work.
    response = errorResponse(new HttpError(403, 'origin_not_allowed', 'Origin is not allowed'));
  } else if (request.method === 'OPTIONS') {
    response = new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, If-Match, If-None-Match, Cf-Access-Jwt-Assertion',
        'Access-Control-Max-Age': '86400',
      },
    });
  } else {
    try {
      response = await route(request, env, deps);
    } catch (err) {
      if (err instanceof HttpError) {
        response = errorResponse(err);
      } else {
        // Log the failure, never the request: bodies and headers are not logged anywhere in this Worker.
        console.error('sync-worker: unhandled error:', err instanceof Error ? err.message : 'unknown');
        response = errorResponse(new HttpError(500, 'internal', 'Internal error'));
      }
    }
  }

  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  headers.set('Vary', 'Origin');
  if (originAllowed) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Credentials', 'true'); // the Access session cookie
    headers.set('Access-Control-Expose-Headers', 'ETag, X-Plan-Version');
  }
  return new Response(response.body, { status: response.status, headers });
}

async function route(request: Request, env: Env, deps: Deps): Promise<Response> {
  const { pathname } = new URL(request.url);
  const method = request.method;
  const now = deps.now?.() ?? Date.now();

  if (pathname === '/v1/health') {
    return method === 'GET' ? json({ ok: true }) : methodNotAllowed('GET');
  }

  // Everything below is per-user: authenticate first, then pass the user id to every query.
  const userId = await authenticate(request, env, deps);

  if (pathname === '/v1/plans') {
    return method === 'GET' ? listPlans(env, userId) : methodNotAllowed('GET');
  }
  const planMatch = PLAN_PATH.exec(pathname);
  if (planMatch) {
    const planId = planMatch[1]!;
    if (!PLAN_ID.test(planId))
      throw new HttpError(400, 'invalid_plan_id', 'Plan id must match [A-Za-z0-9_-]{1,64}');
    const limits = { ...DEFAULT_LIMITS, ...deps.limits };
    if (method === 'GET') return getPlan(env, userId, planId);
    if (method === 'PUT') return putPlan(request, env, userId, planId, limits, now);
    if (method === 'DELETE') return deletePlan(request, env, userId, planId, now);
    return methodNotAllowed('GET, PUT, DELETE');
  }
  if (pathname === '/v1/keys' || pathname === '/v1/settings') {
    const kind = pathname === '/v1/keys' ? KEYS : SETTINGS;
    if (method === 'GET') return getDoc(env, kind, userId);
    if (method === 'PUT') return putDoc(request, env, kind, userId, now);
    return methodNotAllowed('GET, PUT');
  }
  throw new HttpError(404, 'not_found', 'No such route');
}

function allowedOrigins(env: Env): string[] {
  return (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
}

function errorResponse(err: HttpError): Response {
  return json({ error: err.code, message: err.message, ...err.extra }, err.status);
}

function methodNotAllowed(allow: string): Response {
  return json({ error: 'method_not_allowed', message: `Allowed: ${allow}` }, 405, { Allow: allow });
}
