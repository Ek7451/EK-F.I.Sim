// Plan envelope: "FSP1" ‖ 0x01 ‖ nonce (12) ‖ AES-256-GCM ciphertext ‖ tag (16).
// AAD = UTF-8 of `${planId}\u0000${version}`, so a blob only decrypts as the plan and version it was written for.
import { fromEnvelope, open, seal, toEnvelope } from './aead';
import { utf8, type Bytes } from './encoding';
import { CryptoError } from './errors';

const PLAN_MAGIC = utf8('FSP1');

function planAad(planId: string, version: number): Bytes {
  if (typeof planId !== 'string' || planId.length === 0 || planId.includes('\u0000')) {
    throw new CryptoError('INVALID_INPUT', 'planId must be a non-empty string without NUL characters');
  }
  if (!Number.isSafeInteger(version) || version < 0) {
    throw new CryptoError('INVALID_INPUT', 'version must be a non-negative integer');
  }
  return utf8(`${planId}\u0000${version}`);
}

export async function encryptPlan(
  dek: CryptoKey,
  planId: string,
  version: number,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  return toEnvelope(PLAN_MAGIC, await seal(dek, planAad(planId, version), plaintext));
}

export async function decryptPlan(
  dek: CryptoKey,
  planId: string,
  version: number,
  blob: Uint8Array,
): Promise<Uint8Array> {
  const aad = planAad(planId, version);
  return open(dek, aad, fromEnvelope(PLAN_MAGIC, blob), 'DECRYPT_FAILED');
}
