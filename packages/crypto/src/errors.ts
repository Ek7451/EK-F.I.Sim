export type CryptoErrorCode =
  | 'INVALID_INPUT' // caller passed something unusable (empty passphrase, bad planId, ...)
  | 'INVALID_FORMAT' // blob / bundle / file is malformed
  | 'UNSUPPORTED_VERSION' // well-formed but written by a newer format version
  | 'WRONG_PASSPHRASE' // passphrase did not unwrap (or the wrapped data was tampered with)
  | 'WRONG_RECOVERY_KEY' // well-formed recovery key that does not unwrap this bundle
  | 'INVALID_RECOVERY_KEY' // recovery key has a typo (bad character, length or checksum)
  | 'DECRYPT_FAILED' // AES-GCM authentication failed: tampered data, wrong key or wrong AAD
  | 'KEY_MISMATCH' // the supplied DEK does not belong to the supplied bundle
  | 'KDF_UNAVAILABLE'; // data needs Argon2id but WebAssembly cannot run here

export class CryptoError extends Error {
  readonly code: CryptoErrorCode;

  constructor(code: CryptoErrorCode, message: string) {
    super(message);
    this.name = 'CryptoError';
    this.code = code;
  }
}
