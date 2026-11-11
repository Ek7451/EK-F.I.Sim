// Key bundle: the user's data key (DEK) wrapped by the passphrase and, independently, by the recovery key.
// The bundle is safe to store on the sync server; it reveals nothing without one of the two secrets.
import { importAesKey, KEY_BYTES, open, seal } from './aead';
import { fromBase64, randomBytes, toBase64, utf8, type Bytes } from './encoding';
import { CryptoError } from './errors';
import { deriveKey, deriveNewKey, parseKdfParams, type KdfOptions, type KdfParams } from './kdf';
import { decodeRecoveryKey, encodeRecoveryKey } from './recovery';

export interface KeyBundle {
  v: 1;
  /** How the passphrase is turned into the key that wraps the DEK. */
  kdf: KdfParams;
  /** base64(nonce ‖ AES-GCM(passphraseKey, DEK)) */
  wrappedByPassphrase: string;
  /** base64(nonce ‖ AES-GCM(recoveryKey, DEK)) */
  wrappedByRecovery: string;
  /** base64(nonce ‖ AES-GCM(DEK, empty)); lets changePassphrase confirm a DEK belongs to this bundle. */
  keyCheck: string;
}

// Distinct AAD per use, so one wrapped value can never be substituted for another.
const AAD_PASSPHRASE = utf8('fisim/v1/dek-wrap/passphrase');
const AAD_RECOVERY = utf8('fisim/v1/dek-wrap/recovery');
const AAD_KEY_CHECK = utf8('fisim/v1/dek-check');

function parseBundle(bundle: KeyBundle): KeyBundle {
  const b = bundle as Partial<KeyBundle> | null;
  if (typeof b !== 'object' || b === null)
    throw new CryptoError('INVALID_FORMAT', 'Key bundle is not an object');
  if (b.v !== 1) throw new CryptoError('UNSUPPORTED_VERSION', 'Unsupported key bundle version');
  for (const field of ['wrappedByPassphrase', 'wrappedByRecovery', 'keyCheck'] as const) {
    if (typeof b[field] !== 'string')
      throw new CryptoError('INVALID_FORMAT', `Key bundle is missing ${field}`);
  }
  return { ...(b as KeyBundle), kdf: parseKdfParams(b.kdf) };
}

async function unwrapDek(
  wrappingKey: CryptoKey,
  aad: Bytes,
  wrapped: string,
  failureCode: 'WRONG_PASSPHRASE' | 'WRONG_RECOVERY_KEY',
): Promise<CryptoKey> {
  const raw = await open(wrappingKey, aad, fromBase64(wrapped), failureCode);
  try {
    return await importAesKey(raw, true);
  } finally {
    raw.fill(0);
  }
}

/**
 * Creates a new DEK and its bundle. `recoveryKey` is returned exactly once: show it to the user and discard it.
 * The DEK is extractable only so that it can be re-wrapped on a passphrase change.
 */
export async function createKeyBundle(
  passphrase: string,
  opts: KdfOptions = {},
): Promise<{ bundle: KeyBundle; recoveryKey: string; dek: CryptoKey }> {
  const { kdf, key: passphraseKey } = await deriveNewKey(passphrase, opts);
  const rawDek = randomBytes(KEY_BYTES);
  const rawRecovery = randomBytes(KEY_BYTES);
  try {
    const dek = await importAesKey(rawDek, true);
    const recoveryWrappingKey = await importAesKey(rawRecovery, false);
    const bundle: KeyBundle = {
      v: 1,
      kdf,
      wrappedByPassphrase: toBase64(await seal(passphraseKey, AAD_PASSPHRASE, rawDek)),
      wrappedByRecovery: toBase64(await seal(recoveryWrappingKey, AAD_RECOVERY, rawDek)),
      keyCheck: toBase64(await seal(dek, AAD_KEY_CHECK, new Uint8Array(0))),
    };
    return { bundle, recoveryKey: await encodeRecoveryKey(rawRecovery), dek };
  } finally {
    rawDek.fill(0);
    rawRecovery.fill(0);
  }
}

export async function unlockWithPassphrase(bundle: KeyBundle, passphrase: string): Promise<CryptoKey> {
  const b = parseBundle(bundle);
  const passphraseKey = await deriveKey(passphrase, b.kdf);
  return unwrapDek(passphraseKey, AAD_PASSPHRASE, b.wrappedByPassphrase, 'WRONG_PASSPHRASE');
}

export async function unlockWithRecoveryKey(bundle: KeyBundle, recoveryKey: string): Promise<CryptoKey> {
  const b = parseBundle(bundle);
  const raw = await decodeRecoveryKey(recoveryKey);
  try {
    const wrappingKey = await importAesKey(raw, false);
    return await unwrapDek(wrappingKey, AAD_RECOVERY, b.wrappedByRecovery, 'WRONG_RECOVERY_KEY');
  } finally {
    raw.fill(0);
  }
}

/**
 * Re-wraps the same DEK under a new passphrase with a fresh salt. Plans, the recovery key and its wrapping
 * are untouched. Throws `KEY_MISMATCH` if `dek` is not the key this bundle protects.
 */
export async function changePassphrase(
  bundle: KeyBundle,
  dek: CryptoKey,
  newPassphrase: string,
  opts: KdfOptions = {},
): Promise<KeyBundle> {
  const b = parseBundle(bundle);
  await open(dek, AAD_KEY_CHECK, fromBase64(b.keyCheck), 'KEY_MISMATCH');
  const { kdf, key: passphraseKey } = await deriveNewKey(newPassphrase, opts);
  const rawDek = new Uint8Array(await globalThis.crypto.subtle.exportKey('raw', dek));
  try {
    return { ...b, kdf, wrappedByPassphrase: toBase64(await seal(passphraseKey, AAD_PASSPHRASE, rawDek)) };
  } finally {
    rawDek.fill(0);
  }
}

export async function resetPassphraseWithRecoveryKey(
  bundle: KeyBundle,
  recoveryKey: string,
  newPassphrase: string,
  opts: KdfOptions = {},
): Promise<{ bundle: KeyBundle; dek: CryptoKey }> {
  const dek = await unlockWithRecoveryKey(bundle, recoveryKey);
  return { bundle: await changePassphrase(bundle, dek, newPassphrase, opts), dek };
}
