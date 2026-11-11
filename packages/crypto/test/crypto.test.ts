import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  ARGON2ID,
  changePassphrase,
  createAppLock,
  createKeyBundle,
  CryptoError,
  decryptLocal,
  decryptPlan,
  encryptLocal,
  encryptPlan,
  exportEncrypted,
  importEncrypted,
  isValidRecoveryKey,
  PBKDF2_ITERATIONS,
  resetPassphraseWithRecoveryKey,
  unlockAppLock,
  unlockWithPassphrase,
  unlockWithRecoveryKey,
  type CryptoErrorCode,
  type KeyBundle,
} from '../src/index';

const text = (s: string) => new TextEncoder().encode(s);
const PLAN = text(JSON.stringify({ name: 'Base plan', balance: 123456.78 }));
const PBKDF2 = { forcePbkdf2: true };

async function expectCode(promise: Promise<unknown>, code: CryptoErrorCode): Promise<void> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(CryptoError);
  expect((err as CryptoError).code).toBe(code);
}

/** Replaces one character of a string with a different character from the same alphabet. */
function mutate(s: string, index: number, a = 'A', b = 'B'): string {
  return s.slice(0, index) + (s[index] === a ? b : a) + s.slice(index + 1);
}

// One bundle per KDF, shared by the read-only tests (key derivation is deliberately slow).
let argon: Awaited<ReturnType<typeof createKeyBundle>>;
let pbkdf2: Awaited<ReturnType<typeof createKeyBundle>>;
beforeAll(async () => {
  argon = await createKeyBundle('correct horse battery staple');
  pbkdf2 = await createKeyBundle('correct horse battery staple', PBKDF2);
});

describe('key bundle', () => {
  it('uses Argon2id with the §12.2 parameters by default', () => {
    expect(argon.bundle.v).toBe(1);
    expect(argon.bundle.kdf).toMatchObject({
      name: 'argon2id',
      memoryKiB: 65536,
      iterations: 3,
      parallelism: 1,
    });
    expect(ARGON2ID).toEqual({ memoryKiB: 64 * 1024, iterations: 3, parallelism: 1 });
    expect(atob(argon.bundle.kdf.salt)).toHaveLength(16);
  });

  it('uses PBKDF2-SHA256 with >= 600,000 iterations when forced', () => {
    expect(pbkdf2.bundle.kdf).toMatchObject({ name: 'pbkdf2-sha256', iterations: 600_000 });
    expect(PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(600_000);
    expect(atob(pbkdf2.bundle.kdf.salt)).toHaveLength(16);
  });

  it('falls back to PBKDF2 automatically when WebAssembly is unavailable', async () => {
    vi.stubGlobal('WebAssembly', undefined);
    try {
      const { bundle } = await createKeyBundle('pw');
      expect(bundle.kdf.name).toBe('pbkdf2-sha256');
      // ...and a bundle that needs Argon2id reports it clearly instead of failing obscurely.
      await expectCode(unlockWithPassphrase(argon.bundle, 'correct horse battery staple'), 'KDF_UNAVAILABLE');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([
    ['Argon2id', () => argon],
    ['PBKDF2', () => pbkdf2],
  ])('round-trips a plan through a JSON-serialized bundle (%s)', async (_name, get) => {
    const { bundle, dek } = get();
    const blob = await encryptPlan(dek, 'plan-1', 1, PLAN);
    const stored = JSON.parse(JSON.stringify(bundle)) as KeyBundle;
    const unlocked = await unlockWithPassphrase(stored, 'correct horse battery staple');
    expect(await decryptPlan(unlocked, 'plan-1', 1, blob)).toEqual(PLAN);
  });

  it.each([
    ['Argon2id', () => argon],
    ['PBKDF2', () => pbkdf2],
  ])('rejects a wrong passphrase (%s)', async (_name, get) => {
    await expectCode(unlockWithPassphrase(get().bundle, 'correct horse battery stapl'), 'WRONG_PASSPHRASE');
  });

  it('rejects an empty passphrase', async () => {
    await expectCode(createKeyBundle(''), 'INVALID_INPUT');
  });

  it('treats Unicode-equivalent passphrases as equal (NFKC)', async () => {
    const { bundle } = await createKeyBundle('café', PBKDF2);
    await expect(unlockWithPassphrase(bundle, 'café')).resolves.toBeDefined();
  });

  it('generates independent keys and salts for each bundle', async () => {
    const other = await createKeyBundle('correct horse battery staple', PBKDF2);
    expect(other.bundle.kdf.salt).not.toBe(pbkdf2.bundle.kdf.salt);
    expect(other.recoveryKey).not.toBe(pbkdf2.recoveryKey);
    const blob = await encryptPlan(pbkdf2.dek, 'p', 1, PLAN);
    await expectCode(decryptPlan(other.dek, 'p', 1, blob), 'DECRYPT_FAILED');
  });

  it('rejects a tampered wrapped key', async () => {
    const bundle = { ...pbkdf2.bundle, wrappedByPassphrase: mutate(pbkdf2.bundle.wrappedByPassphrase, 30) };
    await expectCode(unlockWithPassphrase(bundle, 'correct horse battery staple'), 'WRONG_PASSPHRASE');
  });

  it('does not accept the recovery-wrapped key in the passphrase slot (domain separation)', async () => {
    const bundle = { ...pbkdf2.bundle, wrappedByRecovery: pbkdf2.bundle.wrappedByPassphrase };
    await expectCode(unlockWithRecoveryKey(bundle, pbkdf2.recoveryKey), 'WRONG_RECOVERY_KEY');
  });

  it('rejects malformed bundles and weakened KDF parameters', async () => {
    const pw = 'correct horse battery staple';
    await expectCode(
      unlockWithPassphrase({ ...pbkdf2.bundle, v: 2 } as unknown as KeyBundle, pw),
      'UNSUPPORTED_VERSION',
    );
    await expectCode(unlockWithPassphrase({} as KeyBundle, pw), 'UNSUPPORTED_VERSION');
    await expectCode(unlockWithPassphrase(null as unknown as KeyBundle, pw), 'INVALID_FORMAT');
    const weakPbkdf2 = { ...pbkdf2.bundle, kdf: { ...pbkdf2.bundle.kdf, iterations: 1000 } };
    await expectCode(unlockWithPassphrase(weakPbkdf2, pw), 'INVALID_FORMAT');
    const weakArgon = { ...argon.bundle, kdf: { ...argon.bundle.kdf, memoryKiB: 1024 } } as KeyBundle;
    await expectCode(unlockWithPassphrase(weakArgon, pw), 'INVALID_FORMAT');
    const hugeArgon = { ...argon.bundle, kdf: { ...argon.bundle.kdf, memoryKiB: 2 ** 30 } } as KeyBundle;
    await expectCode(unlockWithPassphrase(hugeArgon, pw), 'INVALID_FORMAT');
    const unknownKdf = {
      ...pbkdf2.bundle,
      kdf: { name: 'md5', salt: pbkdf2.bundle.kdf.salt },
    } as unknown as KeyBundle;
    await expectCode(unlockWithPassphrase(unknownKdf, pw), 'INVALID_FORMAT');
  });
});

describe('recovery key', () => {
  it('is 14 dash-separated groups of 4 base32 characters', () => {
    expect(argon.recoveryKey).toMatch(/^([A-Z2-7]{4}-){13}[A-Z2-7]{4}$/);
  });

  it('unlocks the same DEK as the passphrase', async () => {
    const blob = await encryptPlan(argon.dek, 'plan-1', 4, PLAN);
    const dek = await unlockWithRecoveryKey(argon.bundle, argon.recoveryKey);
    expect(await decryptPlan(dek, 'plan-1', 4, blob)).toEqual(PLAN);
  });

  it('accepts lower case, spaces and missing dashes', async () => {
    const sloppy = `  ${pbkdf2.recoveryKey.toLowerCase().replace(/-/g, ' ')} `;
    await expect(unlockWithRecoveryKey(pbkdf2.bundle, sloppy)).resolves.toBeDefined();
    await expect(
      unlockWithRecoveryKey(pbkdf2.bundle, pbkdf2.recoveryKey.replace(/-/g, '')),
    ).resolves.toBeDefined();
  });

  it('detects a single-character typo in every position via the checksum', async () => {
    const key = pbkdf2.recoveryKey;
    expect(await isValidRecoveryKey(key)).toBe(true);
    for (let i = 0; i < key.length; i++) {
      if (key[i] === '-') continue;
      const typo = mutate(key, i);
      expect(await isValidRecoveryKey(typo), `typo at ${i}`).toBe(false);
    }
    await expectCode(unlockWithRecoveryKey(pbkdf2.bundle, mutate(key, 7)), 'INVALID_RECOVERY_KEY');
  });

  it('detects transposed, truncated and non-alphabet input', async () => {
    const key = pbkdf2.recoveryKey;
    const i = [...key].findIndex(
      (c, n) => c !== '-' && key[n + 1] !== '-' && n + 1 < key.length && c !== key[n + 1],
    );
    const swapped = key.slice(0, i) + key[i + 1] + key[i] + key.slice(i + 2);
    await expectCode(unlockWithRecoveryKey(pbkdf2.bundle, swapped), 'INVALID_RECOVERY_KEY');
    await expectCode(unlockWithRecoveryKey(pbkdf2.bundle, key.slice(0, -5)), 'INVALID_RECOVERY_KEY');
    await expectCode(unlockWithRecoveryKey(pbkdf2.bundle, '1' + key.slice(1)), 'INVALID_RECOVERY_KEY');
    await expectCode(unlockWithRecoveryKey(pbkdf2.bundle, ''), 'INVALID_RECOVERY_KEY');
  });

  it("rejects another user's (well-formed) recovery key", async () => {
    await expectCode(unlockWithRecoveryKey(pbkdf2.bundle, argon.recoveryKey), 'WRONG_RECOVERY_KEY');
  });

  it('resets the passphrase and keeps existing ciphertext readable', async () => {
    const created = await createKeyBundle('forgotten', PBKDF2);
    const blob = await encryptPlan(created.dek, 'plan-1', 2, PLAN);
    const reset = await resetPassphraseWithRecoveryKey(
      created.bundle,
      created.recoveryKey,
      'new passphrase',
      PBKDF2,
    );
    expect(await decryptPlan(reset.dek, 'plan-1', 2, blob)).toEqual(PLAN);
    const dek = await unlockWithPassphrase(reset.bundle, 'new passphrase');
    expect(await decryptPlan(dek, 'plan-1', 2, blob)).toEqual(PLAN);
    await expectCode(unlockWithPassphrase(reset.bundle, 'forgotten'), 'WRONG_PASSPHRASE');
    // The recovery key itself is unchanged and still works.
    await expect(unlockWithRecoveryKey(reset.bundle, created.recoveryKey)).resolves.toBeDefined();
  });
});

describe('changePassphrase', () => {
  it('only re-wraps the DEK: old ciphertext stays decryptable, old passphrase stops working', async () => {
    const created = await createKeyBundle('old passphrase', PBKDF2);
    const blob = await encryptPlan(created.dek, 'plan-1', 7, PLAN);
    const changed = await changePassphrase(created.bundle, created.dek, 'new passphrase');

    expect(changed.kdf.name).toBe('argon2id'); // upgraded: Argon2id is available here
    expect(changed.kdf.salt).not.toBe(created.bundle.kdf.salt);
    expect(changed.wrappedByPassphrase).not.toBe(created.bundle.wrappedByPassphrase);
    expect(changed.wrappedByRecovery).toBe(created.bundle.wrappedByRecovery);
    expect(changed.keyCheck).toBe(created.bundle.keyCheck);

    const dek = await unlockWithPassphrase(changed, 'new passphrase');
    expect(await decryptPlan(dek, 'plan-1', 7, blob)).toEqual(PLAN);
    await expectCode(unlockWithPassphrase(changed, 'old passphrase'), 'WRONG_PASSPHRASE');
    const viaRecovery = await unlockWithRecoveryKey(changed, created.recoveryKey);
    expect(await decryptPlan(viaRecovery, 'plan-1', 7, blob)).toEqual(PLAN);
  });

  it('refuses a DEK that does not belong to the bundle', async () => {
    await expectCode(changePassphrase(pbkdf2.bundle, argon.dek, 'new', PBKDF2), 'KEY_MISMATCH');
  });
});

describe('plan encryption', () => {
  it('writes the versioned envelope: magic, format version, nonce, ciphertext + tag', async () => {
    const blob = await encryptPlan(pbkdf2.dek, 'plan-1', 1, PLAN);
    expect(new TextDecoder().decode(blob.subarray(0, 4))).toBe('FSP1');
    expect(blob[4]).toBe(1);
    expect(blob.length).toBe(4 + 1 + 12 + PLAN.length + 16);
    expect(Buffer.from(blob).includes(Buffer.from('Base plan'))).toBe(false);
  });

  it('round-trips empty and large plaintexts', async () => {
    const empty = await encryptPlan(pbkdf2.dek, 'p', 0, new Uint8Array(0));
    expect(await decryptPlan(pbkdf2.dek, 'p', 0, empty)).toEqual(new Uint8Array(0));
    const large = new Uint8Array(1024 * 1024).map((_, i) => i % 251);
    const blob = await encryptPlan(pbkdf2.dek, 'p', 1, large);
    expect(await decryptPlan(pbkdf2.dek, 'p', 1, blob)).toEqual(large);
  });

  it('binds the ciphertext to planId and version (AAD)', async () => {
    const blob = await encryptPlan(pbkdf2.dek, 'plan-1', 3, PLAN);
    await expectCode(decryptPlan(pbkdf2.dek, 'plan-2', 3, blob), 'DECRYPT_FAILED');
    await expectCode(decryptPlan(pbkdf2.dek, 'plan-1', 4, blob), 'DECRYPT_FAILED');
    await expectCode(decryptPlan(pbkdf2.dek, 'plan-1', 2, blob), 'DECRYPT_FAILED');
    expect(await decryptPlan(pbkdf2.dek, 'plan-1', 3, blob)).toEqual(PLAN);
  });

  it('encodes the AAD unambiguously', async () => {
    // With naive concatenation ("plan-1" + "23" === "plan-12" + "3") these would collide.
    const blob = await encryptPlan(pbkdf2.dek, 'plan-1', 23, PLAN);
    await expectCode(decryptPlan(pbkdf2.dek, 'plan-12', 3, blob), 'DECRYPT_FAILED');
    await expectCode(encryptPlan(pbkdf2.dek, 'plan\u00001', 1, PLAN), 'INVALID_INPUT');
    await expectCode(encryptPlan(pbkdf2.dek, '', 1, PLAN), 'INVALID_INPUT');
    await expectCode(encryptPlan(pbkdf2.dek, 'p', 1.5, PLAN), 'INVALID_INPUT');
    await expectCode(encryptPlan(pbkdf2.dek, 'p', -1, PLAN), 'INVALID_INPUT');
  });

  it('detects a flipped bit anywhere in the blob', async () => {
    const blob = await encryptPlan(pbkdf2.dek, 'plan-1', 1, text('short'));
    for (let i = 0; i < blob.length; i++) {
      const tampered = blob.slice();
      tampered[i] ^= 0x01;
      const err = await decryptPlan(pbkdf2.dek, 'plan-1', 1, tampered).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err, `byte ${i}`).toBeInstanceOf(CryptoError);
    }
  });

  it('detects truncation and garbage, with typed errors', async () => {
    const blob = await encryptPlan(pbkdf2.dek, 'plan-1', 1, PLAN);
    await expectCode(
      decryptPlan(pbkdf2.dek, 'plan-1', 1, blob.subarray(0, blob.length - 1)),
      'DECRYPT_FAILED',
    );
    await expectCode(decryptPlan(pbkdf2.dek, 'plan-1', 1, blob.subarray(0, 10)), 'INVALID_FORMAT');
    await expectCode(decryptPlan(pbkdf2.dek, 'plan-1', 1, new Uint8Array(0)), 'INVALID_FORMAT');
    await expectCode(
      decryptPlan(pbkdf2.dek, 'plan-1', 1, text('not an envelope at all, really')),
      'INVALID_FORMAT',
    );
    const future = blob.slice();
    future[4] = 2;
    await expectCode(decryptPlan(pbkdf2.dek, 'plan-1', 1, future), 'UNSUPPORTED_VERSION');
  });

  it('uses a fresh nonce for every encryption', async () => {
    const nonces = new Set<string>();
    const blobs = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const blob = await encryptPlan(pbkdf2.dek, 'plan-1', 1, PLAN);
      nonces.add(Buffer.from(blob.subarray(5, 17)).toString('hex'));
      blobs.add(Buffer.from(blob).toString('hex'));
    }
    expect(nonces.size).toBe(500);
    expect(blobs.size).toBe(500);
  });
});

describe('encrypted backup file', () => {
  const data = { schema: 1, plans: [{ id: 'a', name: 'Plan ☃', values: [1, 2.5, null] }] };

  it.each([
    ['Argon2id', {}, 'argon2id'],
    ['PBKDF2', PBKDF2, 'pbkdf2-sha256'],
  ])('round-trips (%s) and is self-contained JSON', async (_name, opts, kdfName) => {
    const file = await exportEncrypted('backup pass', data, opts);
    const envelope = JSON.parse(file) as { format: string; v: number; kdf: { name: string }; data: string };
    expect(envelope).toMatchObject({ format: 'fisim-backup', v: 1, kdf: { name: kdfName } });
    expect(file).not.toContain('Plan');
    expect(await importEncrypted('backup pass', file)).toEqual(data);
  });

  it('uses a fresh salt and nonce per export', async () => {
    const a = JSON.parse(await exportEncrypted('pw', data, PBKDF2)) as {
      kdf: { salt: string };
      data: string;
    };
    const b = JSON.parse(await exportEncrypted('pw', data, PBKDF2)) as {
      kdf: { salt: string };
      data: string;
    };
    expect(a.kdf.salt).not.toBe(b.kdf.salt);
    expect(a.data).not.toBe(b.data);
  });

  it('rejects a wrong passphrase, tampering and non-backup input', async () => {
    const file = await exportEncrypted('backup pass', data, PBKDF2);
    await expectCode(importEncrypted('wrong', file), 'WRONG_PASSPHRASE');
    const envelope = JSON.parse(file) as { data: string; v: number };
    const tampered = JSON.stringify({ ...envelope, data: mutate(envelope.data, 40) });
    await expectCode(importEncrypted('backup pass', tampered), 'WRONG_PASSPHRASE');
    await expectCode(
      importEncrypted('backup pass', JSON.stringify({ ...envelope, v: 2 })),
      'UNSUPPORTED_VERSION',
    );
    await expectCode(importEncrypted('backup pass', 'not json'), 'INVALID_FORMAT');
    await expectCode(importEncrypted('backup pass', '{"plans":[]}'), 'INVALID_FORMAT');
    await expectCode(importEncrypted('backup pass', 'null'), 'INVALID_FORMAT');
  });
});

describe('app lock', () => {
  it('encrypts records at rest and rejects a wrong passphrase, wrong context and tampering', async () => {
    const { lock, key } = await createAppLock('device pin', PBKDF2);
    expect(key.extractable).toBe(false);
    const record = await encryptLocal(key, 'plans/plan-1', PLAN);
    expect(new TextDecoder().decode(record.subarray(0, 4))).toBe('FSL1');

    const reopened = await unlockAppLock(JSON.parse(JSON.stringify(lock)), 'device pin');
    expect(await decryptLocal(reopened, 'plans/plan-1', record)).toEqual(PLAN);
    await expectCode(unlockAppLock(lock, 'wrong pin'), 'WRONG_PASSPHRASE');
    await expectCode(decryptLocal(reopened, 'plans/plan-2', record), 'DECRYPT_FAILED');
    const tampered = record.slice();
    tampered[tampered.length - 1] ^= 1;
    await expectCode(decryptLocal(reopened, 'plans/plan-1', tampered), 'DECRYPT_FAILED');
    // A sync-format blob is not accepted as a local record, and vice versa.
    await expectCode(decryptPlan(pbkdf2.dek, 'plans/plan-1', 1, record), 'INVALID_FORMAT');
  });
});
