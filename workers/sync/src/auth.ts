// Authentication: Cloudflare Access. Identifies the caller; has nothing to do with encryption keys.
import type { Deps, Env } from './app';
import { HttpError } from './http';

export interface Jwk extends JsonWebKey {
  kid?: string;
}
export type JwksFetcher = (url: string) => Promise<Jwk[]>;

const JWKS_TTL_MS = 60 * 60 * 1000;
const JWKS_MIN_REFETCH_MS = 60 * 1000; // an unknown `kid` triggers at most one refetch per minute
const CLOCK_SKEW_S = 60;
// Access `sub` values are UUIDs. The user id becomes part of R2 object keys, so keep it free of "/".
const USER_ID = /^[A-Za-z0-9._@|:-]{1,128}$/;

const jwksCache = new Map<string, { fetchedAt: number; keys: Map<string, CryptoKey> }>();

export function clearJwksCache(): void {
  jwksCache.clear();
}

const defaultFetchJwks: JwksFetcher = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`JWKS fetch failed with ${response.status}`);
  return ((await response.json()) as { keys: Jwk[] }).keys;
};

const unauthorized = (message: string) => new HttpError(401, 'unauthorized', message);

/** Returns the authenticated user id, or throws a 401 `HttpError`. */
export async function authenticate(request: Request, env: Env, deps: Deps): Promise<string> {
  // Local development only: both conditions are required, and neither variable exists in deployed envs.
  if (env.ENVIRONMENT === 'local' && env.DEV_USER) return checkedUserId(env.DEV_USER);

  if (!env.TEAM_DOMAIN || !env.ACCESS_AUD) {
    throw new HttpError(500, 'misconfigured', 'Access is not configured'); // fail closed
  }
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) throw unauthorized('Missing Cf-Access-Jwt-Assertion');
  const parts = token.split('.');
  if (parts.length !== 3) throw unauthorized('Malformed token');
  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];

  let header: { alg?: unknown; kid?: unknown };
  let claims: Record<string, unknown>;
  let signature: Uint8Array<ArrayBuffer>;
  try {
    header = JSON.parse(new TextDecoder().decode(base64UrlDecode(headerPart)));
    claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadPart)));
    signature = base64UrlDecode(signaturePart);
  } catch {
    throw unauthorized('Malformed token');
  }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw unauthorized('Unsupported token');

  const now = deps.now?.() ?? Date.now();
  const key = await signingKey(env.TEAM_DOMAIN, header.kid, deps.fetchJwks ?? defaultFetchJwks, now);
  if (!key) throw unauthorized('Unknown signing key');
  const signed = new TextEncoder().encode(`${headerPart}.${payloadPart}`);
  if (!(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, signed))) {
    throw unauthorized('Bad signature');
  }

  // Only trust the claims after the signature has been verified.
  const nowSeconds = now / 1000;
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== `https://${env.TEAM_DOMAIN}`) throw unauthorized('Wrong issuer');
  if (!audiences.includes(env.ACCESS_AUD)) throw unauthorized('Wrong audience');
  if (typeof claims.exp !== 'number' || claims.exp <= nowSeconds) throw unauthorized('Token expired');
  if (typeof claims.nbf === 'number' && claims.nbf > nowSeconds + CLOCK_SKEW_S)
    throw unauthorized('Token not yet valid');
  return checkedUserId(claims.sub);
}

function checkedUserId(sub: unknown): string {
  if (typeof sub !== 'string' || !USER_ID.test(sub)) throw unauthorized('Token has no usable subject');
  return sub;
}

async function signingKey(
  teamDomain: string,
  kid: string,
  fetchJwks: JwksFetcher,
  now: number,
): Promise<CryptoKey | undefined> {
  let entry = jwksCache.get(teamDomain);
  const age = entry ? now - entry.fetchedAt : Infinity;
  if (!entry || age > JWKS_TTL_MS || (!entry.keys.has(kid) && age > JWKS_MIN_REFETCH_MS)) {
    let jwks: Jwk[];
    try {
      jwks = await fetchJwks(`https://${teamDomain}/cdn-cgi/access/certs`);
    } catch {
      throw new HttpError(503, 'auth_unavailable', 'Could not load Access signing keys');
    }
    entry = { fetchedAt: now, keys: new Map() };
    for (const jwk of jwks) {
      if (jwk.kty !== 'RSA' || typeof jwk.kid !== 'string') continue;
      const algorithm = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
      // Import only the public components, pinned to RS256, regardless of what the JWK claims about itself.
      const publicJwk = { kty: 'RSA', n: jwk.n, e: jwk.e };
      entry.keys.set(jwk.kid, await crypto.subtle.importKey('jwk', publicJwk, algorithm, false, ['verify']));
    }
    jwksCache.set(teamDomain, entry);
  }
  return entry.keys.get(kid);
}

function base64UrlDecode(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
