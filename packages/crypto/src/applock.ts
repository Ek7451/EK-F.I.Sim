// Optional app lock (§12.1): encrypt IndexedDB records at rest with a passphrase-derived key.
// The key is derived once per unlock (the KDF is slow by design) and is never extractable.
// Record envelope: "FSL1" ‖ 0x01 ‖ nonce (12) ‖ AES-256-GCM ciphertext ‖ tag (16), AAD = UTF-8 of `context`.
import { fromEnvelope, open, seal, toEnvelope } from './aead';
import { fromBase64, toBase64, utf8 } from './encoding';
import { CryptoError } from './errors';
import { deriveKey, deriveNewKey, parseKdfParams, type KdfOptions, type KdfParams } from './kdf';

/** Stored unencrypted next to the locked data (JSON-serializable). */
export interface AppLock {
  v: 1;
  kdf: KdfParams;
  /** base64(nonce ‖ AES-GCM(lockKey, empty)); lets a wrong passphrase be rejected immediately. */
  check: string;
}

const LOCAL_MAGIC = utf8('FSL1');
const AAD_CHECK = utf8('fisim/v1/app-lock-check');

export async function createAppLock(
  passphrase: string,
  opts: KdfOptions = {},
): Promise<{ lock: AppLock; key: CryptoKey }> {
  const { kdf, key } = await deriveNewKey(passphrase, opts);
  return { lock: { v: 1, kdf, check: toBase64(await seal(key, AAD_CHECK, new Uint8Array(0))) }, key };
}

export async function unlockAppLock(lock: AppLock, passphrase: string): Promise<CryptoKey> {
  if (typeof lock !== 'object' || lock === null || typeof lock.check !== 'string') {
    throw new CryptoError('INVALID_FORMAT', 'Invalid app lock record');
  }
  if (lock.v !== 1) throw new CryptoError('UNSUPPORTED_VERSION', 'Unsupported app lock version');
  const key = await deriveKey(passphrase, parseKdfParams(lock.kdf));
  await open(key, AAD_CHECK, fromBase64(lock.check), 'WRONG_PASSPHRASE');
  return key;
}

/** `context` names the record (e.g. `plans/<id>`), so ciphertext cannot be moved between records. */
export async function encryptLocal(
  key: CryptoKey,
  context: string,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  return toEnvelope(LOCAL_MAGIC, await seal(key, utf8(context), plaintext));
}

export async function decryptLocal(key: CryptoKey, context: string, blob: Uint8Array): Promise<Uint8Array> {
  return open(key, utf8(context), fromEnvelope(LOCAL_MAGIC, blob), 'DECRYPT_FAILED');
}
