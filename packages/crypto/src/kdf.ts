// Passphrase → 256-bit AES key. Argon2id (hash-wasm, WASM) preferred; PBKDF2-SHA256 (Web Crypto) fallback.
// The parameters travel with the data, so whichever KDF created it can unlock it.
import { argon2id } from 'hash-wasm';
import { importAesKey } from './aead';
import { fromBase64, randomBytes, toBase64, utf8, type Bytes } from './encoding';
import { CryptoError } from './errors';

export type KdfParams =
  | { name: 'argon2id'; salt: string; memoryKiB: number; iterations: number; parallelism: number }
  | { name: 'pbkdf2-sha256'; salt: string; iterations: number };

export interface KdfOptions {
  /** Skip Argon2id and use PBKDF2 (what happens automatically when WASM is unavailable). For tests. */
  forcePbkdf2?: boolean;
}

export const SALT_BYTES = 16;
export const ARGON2ID = { memoryKiB: 64 * 1024, iterations: 3, parallelism: 1 } as const;
export const PBKDF2_ITERATIONS = 600_000;

// Upper bounds: stored parameters may come from an untrusted server or file; refuse absurd work factors.
const ARGON2ID_MAX = { memoryKiB: 1024 * 1024, iterations: 16, parallelism: 8 } as const;
const PBKDF2_MAX_ITERATIONS = 10_000_000;

function passphraseBytes(passphrase: string): Bytes {
  if (typeof passphrase !== 'string' || passphrase.length === 0) {
    throw new CryptoError('INVALID_INPUT', 'Passphrase must be a non-empty string');
  }
  return utf8(passphrase.normalize('NFKC')); // same bytes regardless of keyboard / OS composition
}

function intInRange(value: unknown, min: number, max: number): value is number {
  return Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
}

/** Validates untrusted KDF parameters; rejects anything weaker than the spec minimums. */
export function parseKdfParams(value: unknown): KdfParams {
  const bad = () => new CryptoError('INVALID_FORMAT', 'Invalid or unsupported KDF parameters');
  if (typeof value !== 'object' || value === null) throw bad();
  const kdf = value as Record<string, unknown>;
  const { salt, memoryKiB, iterations, parallelism } = kdf;
  if (typeof salt !== 'string' || fromBase64(salt).length < SALT_BYTES) throw bad();
  if (kdf.name === 'argon2id') {
    if (
      !intInRange(memoryKiB, ARGON2ID.memoryKiB, ARGON2ID_MAX.memoryKiB) ||
      !intInRange(iterations, ARGON2ID.iterations, ARGON2ID_MAX.iterations) ||
      !intInRange(parallelism, ARGON2ID.parallelism, ARGON2ID_MAX.parallelism)
    ) {
      throw bad();
    }
    return { name: 'argon2id', salt, memoryKiB, iterations, parallelism };
  }
  if (kdf.name === 'pbkdf2-sha256') {
    if (!intInRange(iterations, PBKDF2_ITERATIONS, PBKDF2_MAX_ITERATIONS)) throw bad();
    return { name: 'pbkdf2-sha256', salt, iterations };
  }
  throw bad();
}

/** Derives a non-extractable AES-256-GCM key from the passphrase using the given parameters. */
export async function deriveKey(passphrase: string, params: KdfParams): Promise<CryptoKey> {
  const kdf = parseKdfParams(params);
  const password = passphraseBytes(passphrase);
  const salt = fromBase64(kdf.salt);
  let raw: Bytes;
  if (kdf.name === 'argon2id') {
    try {
      raw = (await argon2id({
        password,
        salt,
        memorySize: kdf.memoryKiB,
        iterations: kdf.iterations,
        parallelism: kdf.parallelism,
        hashLength: 32,
        outputType: 'binary',
      })) as Bytes;
    } catch {
      throw new CryptoError('KDF_UNAVAILABLE', 'Argon2id (WebAssembly) is not available in this environment');
    }
  } else {
    const subtle = globalThis.crypto.subtle;
    const base = await subtle.importKey('raw', password, 'PBKDF2', false, ['deriveBits']);
    raw = new Uint8Array(
      await subtle.deriveBits(
        { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: kdf.iterations },
        base,
        256,
      ),
    );
  }
  try {
    return await importAesKey(raw, false);
  } finally {
    raw.fill(0);
    password.fill(0);
  }
}

/** Picks a KDF (Argon2id unless forced or WASM fails), generates a fresh salt and derives the key. */
export async function deriveNewKey(
  passphrase: string,
  opts: KdfOptions = {},
): Promise<{ kdf: KdfParams; key: CryptoKey }> {
  const salt = toBase64(randomBytes(SALT_BYTES));
  if (!opts.forcePbkdf2 && typeof WebAssembly === 'object') {
    const kdf: KdfParams = { name: 'argon2id', salt, ...ARGON2ID };
    try {
      return { kdf, key: await deriveKey(passphrase, kdf) };
    } catch (err) {
      // Only a WASM failure (e.g. blocked by CSP) triggers the fallback; other errors are real.
      if (!(err instanceof CryptoError) || err.code !== 'KDF_UNAVAILABLE') throw err;
    }
  }
  const kdf: KdfParams = { name: 'pbkdf2-sha256', salt, iterations: PBKDF2_ITERATIONS };
  return { kdf, key: await deriveKey(passphrase, kdf) };
}
