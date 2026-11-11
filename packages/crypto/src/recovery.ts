// Recovery key text format: base32 (RFC 4648, no padding) of key (32 bytes) ‖ checksum (3 bytes),
// i.e. 56 characters shown as 14 groups of 4 separated by "-".
// checksum = first 3 bytes of SHA-256("fisim-recovery-key-v1" ‖ key); it only detects typos.
import { KEY_BYTES } from './aead';
import { concat, fromBase32, toBase32, utf8, type Bytes } from './encoding';
import { CryptoError } from './errors';

const CHECKSUM_BYTES = 3;
const CHECKSUM_DOMAIN = utf8('fisim-recovery-key-v1');
const ENCODED_LENGTH = ((KEY_BYTES + CHECKSUM_BYTES) * 8) / 5; // 56

async function checksum(key: Uint8Array): Promise<Uint8Array> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', concat(CHECKSUM_DOMAIN, key));
  return new Uint8Array(digest).subarray(0, CHECKSUM_BYTES);
}

export async function encodeRecoveryKey(key: Bytes): Promise<string> {
  if (key.length !== KEY_BYTES) throw new CryptoError('INVALID_INPUT', 'Recovery key must be 256 bits');
  const text = toBase32(concat(key, await checksum(key)));
  return text.match(/.{4}/g)!.join('-');
}

/** Accepts any case, spaces or dashes. Throws `INVALID_RECOVERY_KEY` on a bad character, length or checksum. */
export async function decodeRecoveryKey(text: string): Promise<Bytes> {
  const invalid = () => new CryptoError('INVALID_RECOVERY_KEY', 'Recovery key is mistyped or incomplete');
  if (typeof text !== 'string') throw invalid();
  const compact = text.replace(/[\s-]/g, '').toUpperCase();
  if (compact.length !== ENCODED_LENGTH) throw invalid();
  const decoded = fromBase32(compact);
  if (!decoded) throw invalid();
  const key = decoded.slice(0, KEY_BYTES);
  const expected = await checksum(key);
  if (!expected.every((byte, i) => decoded[KEY_BYTES + i] === byte)) throw invalid();
  return key;
}

/** For form validation in the UI: true if the text is a well-formed recovery key with a valid checksum. */
export async function isValidRecoveryKey(text: string): Promise<boolean> {
  try {
    (await decodeRecoveryKey(text)).fill(0);
    return true;
  } catch {
    return false;
  }
}
