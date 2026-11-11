# @fisim/crypto

End-to-end encryption helpers for EK-F.I.Sim (build plan §12.2). Runs in browsers and Node 22+ using
`globalThis.crypto.subtle`; the only dependency is `hash-wasm` (Argon2id). The sync server only ever sees
the outputs described here: ciphertext and wrapped keys.

## Primitives and parameters

| Purpose                   | Primitive                       | Parameters                                                    |
| ------------------------- | ------------------------------- | ------------------------------------------------------------- |
| Data encryption           | AES-256-GCM (Web Crypto)        | random 96-bit nonce per message, 128-bit tag                  |
| Passphrase KDF            | Argon2id (`hash-wasm`, WASM)    | m = 65,536 KiB (64 MiB), t = 3, p = 1, 32-byte output         |
| Passphrase KDF (fallback) | PBKDF2-HMAC-SHA256 (Web Crypto) | 600,000 iterations, 32-byte output                            |
| Salt                      | `crypto.getRandomValues`        | 16 bytes, fresh for every bundle / passphrase change / backup |
| DEK, recovery key         | `crypto.getRandomValues`        | 256 bits each                                                 |
| Recovery checksum         | SHA-256, truncated              | 3 bytes (typo detection only, not security)                   |

The passphrase is NFKC-normalised and UTF-8 encoded before key derivation.

**KDF selection.** New material uses Argon2id. PBKDF2 is used only when `WebAssembly` is undefined or
Argon2id fails to run (e.g. WASM blocked by CSP), or when the caller passes `{ forcePbkdf2: true }` (tests).
The KDF name and parameters are stored with the data, so either kind unlocks wherever it can run. Stored
parameters are untrusted input: anything below the minimums above, or absurdly above them
(Argon2id > 1 GiB / t > 16 / p > 8, PBKDF2 > 10,000,000), is rejected with `INVALID_FORMAT`. Data that needs
Argon2id on a device where WASM cannot run fails with `KDF_UNAVAILABLE` (it cannot be downgraded).

## Formats

`‖` is concatenation. "sealed" always means `nonce (12 bytes) ‖ AES-GCM ciphertext ‖ tag (16 bytes)`.

### Plan envelope (binary) - `encryptPlan` / `decryptPlan`

```
"FSP1" (4 bytes) ‖ format version 0x01 (1 byte) ‖ nonce (12) ‖ ciphertext ‖ tag (16)
key = DEK        AAD = UTF-8( planId ‖ U+0000 ‖ decimal version )
```

Overhead is 33 bytes. `planId` may not contain U+0000, so the AAD encoding is unambiguous. `version` is the
sync version the blob is stored as: when uploading with `If-Match: n`, encrypt with version `n + 1`.

### Key bundle (JSON) - `createKeyBundle`, `unlockWith*`, `changePassphrase`

```jsonc
{
  "v": 1,
  "kdf": {
    "name": "argon2id",
    "salt": "<base64 16 bytes>",
    "memoryKiB": 65536,
    "iterations": 3,
    "parallelism": 1,
  },
  // or  { "name": "pbkdf2-sha256", "salt": "<base64 16 bytes>", "iterations": 600000 }
  "wrappedByPassphrase": "<base64 sealed>", // key = KDF(passphrase), AAD = "fisim/v1/dek-wrap/passphrase", plaintext = DEK
  "wrappedByRecovery": "<base64 sealed>", // key = recovery key,    AAD = "fisim/v1/dek-wrap/recovery",   plaintext = DEK
  "keyCheck": "<base64 sealed>", // key = DEK,             AAD = "fisim/v1/dek-check",           plaintext = empty
}
```

- The two wrappings are independent; either secret alone recovers the DEK.
- `changePassphrase` verifies `keyCheck` (so a DEK from another bundle is refused with `KEY_MISMATCH`), then
  replaces only `kdf` and `wrappedByPassphrase`. Plans, `wrappedByRecovery` and the recovery key are untouched.
- The recovery key is a random AES-256 key used directly (no KDF needed for a uniformly random key).

### Recovery key (text)

```
base32 (RFC 4648 alphabet A-Z 2-7, no padding) of:  key (32 bytes) ‖ checksum (3 bytes)
checksum = SHA-256( "fisim-recovery-key-v1" ‖ key )[0..3]
```

56 characters, displayed as 14 groups of 4 joined by `-`. Input is case-insensitive and ignores spaces and
dashes. A bad character, length or checksum gives `INVALID_RECOVERY_KEY`; a well-formed key that does not
open the bundle gives `WRONG_RECOVERY_KEY`. It is returned once by `createKeyBundle` and never stored.

### Encrypted backup file (JSON, SYNC-03) - `exportEncrypted` / `importEncrypted`

```jsonc
{ "format": "fisim-backup", "v": 1, "kdf": {/* as above, own salt */}, "data": "<base64 sealed>" }
// key = KDF(passphrase) directly (no DEK), AAD = "fisim/v1/backup", plaintext = UTF-8 JSON of the data
```

Self-contained: needs only the passphrase, not the key bundle or the sync account.

### App lock (§12.1, optional) - `createAppLock`, `unlockAppLock`, `encryptLocal`, `decryptLocal`

```jsonc
{ "v": 1, "kdf": {/* as above */}, "check": "<base64 sealed>" } // AAD = "fisim/v1/app-lock-check", empty plaintext
```

```
record = "FSL1" ‖ 0x01 ‖ nonce (12) ‖ ciphertext ‖ tag (16)      key = KDF(passphrase)   AAD = UTF-8(context)
```

The lock key is derived once per unlock and is non-extractable. `context` names the record (for example
`plans/<id>`), so a ciphertext cannot be moved to another record.

## Errors

Every failure throws `CryptoError` with a `code`; decryption never returns unauthenticated data.

| Code                   | Meaning                                                                     |
| ---------------------- | --------------------------------------------------------------------------- |
| `WRONG_PASSPHRASE`     | Passphrase did not open the bundle / backup / app lock (or it was altered)  |
| `WRONG_RECOVERY_KEY`   | Well-formed recovery key for a different bundle                             |
| `INVALID_RECOVERY_KEY` | Recovery key mistyped (character, length or checksum)                       |
| `DECRYPT_FAILED`       | GCM authentication failed: tampering, wrong key, wrong `planId` / `version` |
| `KEY_MISMATCH`         | DEK passed to `changePassphrase` does not belong to the bundle              |
| `INVALID_FORMAT`       | Malformed blob, bundle, file or KDF parameters                              |
| `UNSUPPORTED_VERSION`  | Written by a newer format version                                           |
| `KDF_UNAVAILABLE`      | Data requires Argon2id but WASM cannot run here                             |
| `INVALID_INPUT`        | Bad argument (empty passphrase, invalid `planId` / `version`)               |

## Notes for the §12.3 review

- Key-wrapping keys (passphrase-derived, recovery, app lock) are imported non-extractable. The **DEK is
  extractable**, because `changePassphrase(bundle, dek, newPassphrase)` must re-wrap it without the old
  passphrase. Code running in the page (XSS) could therefore export it; the control for that is the CSP in §12.1.
- Raw key bytes are zeroed after use on a best-effort basis; JavaScript gives no guarantee.
- Random nonces under one DEK are safe up to about 2^32 encryptions (NIST SP 800-38D), far beyond this app's use.
- The server can withhold or replay an older (blob, version) pair it once stored; the AAD stops it from
  presenting a blob under a different plan id or version, and the client can refuse a version lower than it has seen.
- The app must pair `changePassphrase` with uploading the new bundle (`PUT /v1/keys`), or other devices keep
  the old passphrase.

## Tests

`pnpm vitest run --project crypto` (from the repo root).
