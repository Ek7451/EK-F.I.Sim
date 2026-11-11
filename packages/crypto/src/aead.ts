// AES-256-GCM with a fresh random 96-bit nonce per message.
// "Sealed" layout: nonce (12 bytes) ‖ ciphertext ‖ GCM tag (16 bytes).
import { concat, randomBytes, type Bytes } from './encoding';
import { CryptoError, type CryptoErrorCode } from './errors';

export const KEY_BYTES = 32;
export const NONCE_BYTES = 12;
export const TAG_BYTES = 16;
const FORMAT_VERSION = 1;

export async function importAesKey(raw: Bytes, extractable: boolean): Promise<CryptoKey> {
  if (raw.length !== KEY_BYTES) throw new CryptoError('INVALID_FORMAT', 'Key must be 256 bits');
  return globalThis.crypto.subtle.importKey('raw', raw, 'AES-GCM', extractable, ['encrypt', 'decrypt']);
}

export async function seal(key: CryptoKey, aad: Bytes, plaintext: Uint8Array): Promise<Bytes> {
  const nonce = randomBytes(NONCE_BYTES);
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: aad, tagLength: TAG_BYTES * 8 },
    key,
    plaintext as Bytes,
  );
  return concat(nonce, new Uint8Array(ciphertext));
}

/** Throws `CryptoError(failureCode)` if authentication fails; never returns unauthenticated data. */
export async function open(
  key: CryptoKey,
  aad: Bytes,
  sealed: Uint8Array,
  failureCode: CryptoErrorCode,
): Promise<Bytes> {
  if (sealed.length < NONCE_BYTES + TAG_BYTES)
    throw new CryptoError('INVALID_FORMAT', 'Ciphertext too short');
  try {
    const plaintext = await globalThis.crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: sealed.subarray(0, NONCE_BYTES) as Bytes,
        additionalData: aad,
        tagLength: TAG_BYTES * 8,
      },
      key,
      sealed.subarray(NONCE_BYTES) as Bytes,
    );
    return new Uint8Array(plaintext);
  } catch {
    throw new CryptoError(failureCode, 'Decryption failed: wrong key or the data was modified');
  }
}

/** Binary envelope: magic (4 ASCII bytes) ‖ format version (1 byte) ‖ sealed. */
export function toEnvelope(magic: Bytes, sealed: Bytes): Bytes {
  return concat(magic, Uint8Array.of(FORMAT_VERSION), sealed);
}

export function fromEnvelope(magic: Bytes, blob: Uint8Array): Uint8Array {
  if (
    !(blob instanceof Uint8Array) ||
    blob.length < magic.length + 1 ||
    magic.some((b, i) => blob[i] !== b)
  ) {
    throw new CryptoError('INVALID_FORMAT', 'Not a recognised encrypted blob');
  }
  if (blob[magic.length] !== FORMAT_VERSION) {
    throw new CryptoError('UNSUPPORTED_VERSION', `Unsupported format version ${blob[magic.length]}`);
  }
  return blob.subarray(magic.length + 1);
}
