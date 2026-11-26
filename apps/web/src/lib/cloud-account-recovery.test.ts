import { afterEach, expect, it, vi } from 'vitest';
import { signUp, resetPassword } from './cloud-account';
import { startCloudSync } from './sync';

vi.mock('./sync', () => ({ startCloudSync: vi.fn() }));
vi.mock('comlink', () => ({
  wrap: () => ({ deriveAccountKeys: async () => ({ authKey: 'login', wrapKey: {} }) }),
}));
vi.mock('@fisim/crypto', () => ({
  CryptoError: class extends Error {},
  createAccountBundle: async () => ({ bundle: {}, recoveryAuth: 'next', recoveryCode: 'new-code', dek: {} }),
  deriveRecoveryKeys: async () => ({ recoveryAuth: 'previous', recoveryWrap: {} }),
  rewrapAccountBundle: async () => ({ bundle: {}, recoveryAuth: 'next', recoveryCode: 'new-code', dek: {} }),
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it.each(['register', 'reset'] as const)(
  'acknowledges the code and reconciles a lost %s response without a second write',
  async (action) => {
    vi.stubGlobal('Worker', class {});
    const events: string[] = [];
    const user = { id: 'test', username: 'user' };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body));
        if (path.endsWith('/begin')) {
          events.push('look up ' + body.recoveryAuth);
          return Response.json({
            bundle: {},
            version: body.recoveryAuth === 'previous' ? 1 : action === 'register' ? 1 : 2,
          });
        }
        if (path.endsWith('/username')) {
          events.push('sign in');
          return Response.json({ user });
        }
        events.push('write');
        throw new TypeError('Response lost after commit');
      }),
    );
    const acknowledge = async (code: string) => {
      expect(code).toBe('new-code');
      events.push('acknowledged');
    };
    const result =
      action === 'register'
        ? await signUp('user', 'passphrase', acknowledge, [])
        : await resetPassword('user', 'old-code', 'passphrase', acknowledge, []);
    expect(events).toEqual([
      ...(action === 'reset' ? ['look up previous'] : []),
      'acknowledged',
      'write',
      'look up next',
      'sign in',
    ]);
    expect(result.recoveryCode).toBe('new-code');
    expect(startCloudSync).toHaveBeenCalledOnce();
  },
);
it('aborts registration when the user dismisses the recovery code', async () => {
  vi.stubGlobal('Worker', class {});
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  await expect(
    signUp(
      'user',
      'passphrase',
      async () => {
        throw new Error('Canceled');
      },
      [],
    ),
  ).rejects.toThrow('Canceled');
  expect(fetcher).not.toHaveBeenCalled();
});
