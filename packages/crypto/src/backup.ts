// Standalone encrypted backup file (SYNC-03). Self-contained JSON, independent of the DEK and key bundle:
//   { "format": "fisim-backup", "v": 1, "kdf": { ... }, "data": base64(nonce ‖ ciphertext ‖ tag) }
// The key comes straight from the passphrase with the file's own salt; plaintext is UTF-8 JSON of the data.
import { open, seal } from './aead';
import { fromBase64, fromUtf8, toBase64, utf8 } from './encoding';
import { CryptoError } from './errors';
import { deriveKey, deriveNewKey, parseKdfParams, type KdfOptions, type KdfParams } from './kdf';

const FORMAT = 'fisim-backup';
const AAD = utf8('fisim/v1/backup');

interface BackupFile {
  format: typeof FORMAT;
  v: 1;
  kdf: KdfParams;
  data: string;
}

export async function exportEncrypted(
  passphrase: string,
  data: unknown,
  opts: KdfOptions = {},
): Promise<string> {
  const json = JSON.stringify(data);
  if (json === undefined) throw new CryptoError('INVALID_INPUT', 'Data is not JSON-serializable');
  const { kdf, key } = await deriveNewKey(passphrase, opts);
  const file: BackupFile = { format: FORMAT, v: 1, kdf, data: toBase64(await seal(key, AAD, utf8(json))) };
  return JSON.stringify(file);
}

export async function importEncrypted(passphrase: string, file: string): Promise<unknown> {
  let parsed: Partial<BackupFile> | null;
  try {
    parsed = JSON.parse(file) as Partial<BackupFile> | null;
  } catch {
    parsed = null;
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    parsed.format !== FORMAT ||
    typeof parsed.data !== 'string'
  ) {
    throw new CryptoError('INVALID_FORMAT', 'Not an encrypted backup file');
  }
  if (parsed.v !== 1) throw new CryptoError('UNSUPPORTED_VERSION', 'Backup was written by a newer version');
  const key = await deriveKey(passphrase, parseKdfParams(parsed.kdf));
  const plaintext = await open(key, AAD, fromBase64(parsed.data), 'WRONG_PASSPHRASE');
  return JSON.parse(fromUtf8(plaintext));
}
