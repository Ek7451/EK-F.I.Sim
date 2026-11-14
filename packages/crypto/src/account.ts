// One password, two unrelated keys (the public cloud account, bundle v2).
//
// The password is stretched once with Argon2id, salted by the username, then split with HKDF into
//   - the auth key: sent to the server as the account password (the server stores only a hash of it), and
//   - the wrap key: never leaves the browser; it wraps the random data key (DEK) that encrypts plans.
// A recovery code, shown once, is split the same way: its auth part lets the server allow a password reset,
// its wrap part (browser only) unwraps the DEK. So a reset keeps cloud plans readable, and the server can never
// read them: it sees neither the password nor the recovery code, only one-way derivatives of them.
import { argon2id } from 'hash-wasm';
import { importAesKey, KEY_BYTES, open, seal } from './aead';
import { fromBase64, randomBytes, toBase64, utf8, type Bytes } from './encoding';
import { CryptoError } from './errors';
import { ARGON2ID } from './kdf';
import { decodeRecoveryKey, encodeRecoveryKey } from './recovery';

export interface AccountBundle {
  v: 2;
  /** base64(nonce ‖ AES-GCM(wrapKey, DEK)) */
  wrappedByPassword: string;
  /** base64(nonce ‖ AES-GCM(recoveryWrap, DEK)) */
  wrappedByRecovery: string;
  /** base64(nonce ‖ AES-GCM(DEK, empty)); confirms a DEK belongs to this bundle before it is re-wrapped. */
  keyCheck: string;
}

export interface AccountKeys {
  /** What the server sees in place of the password (base64, 32 bytes). */
  authKey: string;
  /** Wraps the DEK. Non-extractable; stays in this browser. */
  wrapKey: CryptoKey;
}

export interface RecoveryKeys {
  /** What the server checks to allow a reset (base64, 32 bytes). */
  recoveryAuth: string;
  /** Unwraps the DEK. Non-extractable; stays in this browser. */
  recoveryWrap: CryptoKey;
}

export const ACCOUNT_PASSWORD_MIN = 10;
export const ACCOUNT_PASSWORD_MAX = 256;

const AAD_PASSWORD = utf8('longview/v2/dek-wrap/password');
const AAD_RECOVERY = utf8('longview/v2/dek-wrap/recovery');
const AAD_KEY_CHECK = utf8('longview/v2/dek-check');
const INFO_AUTH = utf8('longview/v2/account/auth');
const INFO_WRAP = utf8('longview/v2/account/wrap');
const INFO_RECOVERY_AUTH = utf8('longview/v2/recovery/auth');
const INFO_RECOVERY_WRAP = utf8('longview/v2/recovery/wrap');

/** Usernames are compared case-insensitively everywhere, so the salt is too. */
export const normaliseUsername = (username: string): string => username.trim().toLowerCase();

async function hkdfBits(ikm: Bytes, info: Bytes): Promise<Bytes> {
  const subtle = globalThis.crypto.subtle;
  const base = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(
    await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info }, base, 256),
  );
}

async function split(
  ikm: Bytes,
  authInfo: Bytes,
  wrapInfo: Bytes,
): Promise<{ auth: string; wrap: CryptoKey }> {
  const auth = await hkdfBits(ikm, authInfo);
  const wrapRaw = await hkdfBits(ikm, wrapInfo);
  try {
    return { auth: toBase64(auth), wrap: await importAesKey(wrapRaw, false) };
  } finally {
    auth.fill(0);
    wrapRaw.fill(0);
  }
}

/**
 * The account's two keys from its username and password. Deterministic: the same pair always gives the same keys,
 * so any browser can sign in. Argon2id only (no PBKDF2 fallback): an account made on one browser must open on all.
 */
export async function deriveAccountKeys(username: string, password: string): Promise<AccountKeys> {
  const name = normaliseUsername(username);
  if (!name) throw new CryptoError('INVALID_INPUT', 'Username is required');
  if (typeof password !== 'string' || password.length === 0)
    throw new CryptoError('INVALID_INPUT', 'Password is required');
  const salt = new Uint8Array(
    await globalThis.crypto.subtle.digest('SHA-256', utf8(`longview/v2/account-salt:${name}`)),
  ).subarray(0, 16);
  const pw = utf8(password.normalize('NFKC'));
  let stretched: Bytes;
  try {
    stretched = (await argon2id({
      password: pw,
      salt,
      memorySize: ARGON2ID.memoryKiB,
      iterations: ARGON2ID.iterations,
      parallelism: ARGON2ID.parallelism,
      hashLength: 32,
      outputType: 'binary',
    })) as Bytes;
  } catch {
    throw new CryptoError('KDF_UNAVAILABLE', 'This browser cannot run the encryption Longview needs');
  } finally {
    pw.fill(0);
  }
  try {
    const { auth, wrap } = await split(stretched, INFO_AUTH, INFO_WRAP);
    return { authKey: auth, wrapKey: wrap };
  } finally {
    stretched.fill(0);
  }
}

/** The two halves of a recovery code. Throws `INVALID_RECOVERY_KEY` if the code is mistyped. */
export async function deriveRecoveryKeys(code: string): Promise<RecoveryKeys> {
  const raw = await decodeRecoveryKey(code);
  try {
    const { auth, wrap } = await split(raw, INFO_RECOVERY_AUTH, INFO_RECOVERY_WRAP);
    return { recoveryAuth: auth, recoveryWrap: wrap };
  } finally {
    raw.fill(0);
  }
}

function parseBundle(bundle: unknown): AccountBundle {
  const b = bundle as Partial<AccountBundle> | null;
  if (typeof b !== 'object' || b === null)
    throw new CryptoError('INVALID_FORMAT', 'Key bundle is not an object');
  if (b.v !== 2) throw new CryptoError('UNSUPPORTED_VERSION', 'Unsupported key bundle version');
  for (const field of ['wrappedByPassword', 'wrappedByRecovery', 'keyCheck'] as const)
    if (typeof b[field] !== 'string')
      throw new CryptoError('INVALID_FORMAT', `Key bundle is missing ${field}`);
  return b as AccountBundle;
}

async function newRecovery(): Promise<{ code: string; keys: RecoveryKeys }> {
  const raw = randomBytes(KEY_BYTES);
  try {
    const code = await encodeRecoveryKey(raw);
    return { code, keys: await deriveRecoveryKeys(code) };
  } finally {
    raw.fill(0);
  }
}

/**
 * A brand-new account: a fresh DEK wrapped by the password's wrap key and by a fresh recovery code.
 * `recoveryCode` is returned once: show it, then forget it. The returned DEK is non-extractable.
 */
export async function createAccountBundle(wrapKey: CryptoKey): Promise<{
  bundle: AccountBundle;
  dek: CryptoKey;
  recoveryCode: string;
  recoveryAuth: string;
}> {
  const rawDek = randomBytes(KEY_BYTES);
  try {
    const recovery = await newRecovery();
    const dek = await importAesKey(rawDek, false);
    const bundle: AccountBundle = {
      v: 2,
      wrappedByPassword: toBase64(await seal(wrapKey, AAD_PASSWORD, rawDek)),
      wrappedByRecovery: toBase64(await seal(recovery.keys.recoveryWrap, AAD_RECOVERY, rawDek)),
      keyCheck: toBase64(await seal(dek, AAD_KEY_CHECK, new Uint8Array(0))),
    };
    return { bundle, dek, recoveryCode: recovery.code, recoveryAuth: recovery.keys.recoveryAuth };
  } finally {
    rawDek.fill(0);
  }
}

async function unwrap(
  key: CryptoKey,
  aad: Bytes,
  wrapped: string,
  failure: 'WRONG_PASSPHRASE' | 'WRONG_RECOVERY_KEY',
): Promise<Bytes> {
  return open(key, aad, fromBase64(wrapped), failure);
}

/** The DEK, for encrypting plans on this device. Non-extractable. Throws `WRONG_PASSPHRASE`. */
export async function openAccountBundle(bundle: unknown, wrapKey: CryptoKey): Promise<CryptoKey> {
  const raw = await unwrap(wrapKey, AAD_PASSWORD, parseBundle(bundle).wrappedByPassword, 'WRONG_PASSPHRASE');
  try {
    return await importAesKey(raw, false);
  } finally {
    raw.fill(0);
  }
}

/**
 * Re-wrap the bundle: under a new password's wrap key, and/or under a brand-new recovery code. The DEK is opened
 * with whichever secret the caller holds (the current wrap key, or the recovery code's wrap half), so plans are
 * never re-encrypted. Returns the new bundle and, when a new code was made, the code and its auth half.
 */
export async function rewrapAccountBundle(
  bundle: unknown,
  opener: { wrapKey: CryptoKey } | { recoveryWrap: CryptoKey },
  change: { wrapKey?: CryptoKey; newRecovery?: boolean },
): Promise<{ bundle: AccountBundle; dek: CryptoKey; recoveryCode?: string; recoveryAuth?: string }> {
  const b = parseBundle(bundle);
  const rawDek =
    'wrapKey' in opener
      ? await unwrap(opener.wrapKey, AAD_PASSWORD, b.wrappedByPassword, 'WRONG_PASSPHRASE')
      : await unwrap(opener.recoveryWrap, AAD_RECOVERY, b.wrappedByRecovery, 'WRONG_RECOVERY_KEY');
  try {
    const dek = await importAesKey(rawDek, false);
    await open(dek, AAD_KEY_CHECK, fromBase64(b.keyCheck), 'KEY_MISMATCH');
    const next: AccountBundle = { ...b };
    if (change.wrapKey) next.wrappedByPassword = toBase64(await seal(change.wrapKey, AAD_PASSWORD, rawDek));
    let recovery: { code: string; keys: RecoveryKeys } | undefined;
    if (change.newRecovery) {
      recovery = await newRecovery();
      next.wrappedByRecovery = toBase64(await seal(recovery.keys.recoveryWrap, AAD_RECOVERY, rawDek));
    }
    return {
      bundle: next,
      dek,
      ...(recovery ? { recoveryCode: recovery.code, recoveryAuth: recovery.keys.recoveryAuth } : {}),
    };
  } finally {
    rawDek.fill(0);
  }
}
