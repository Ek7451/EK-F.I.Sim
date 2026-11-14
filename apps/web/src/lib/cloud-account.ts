/**
 * The cloud account (public site). One username and password: signing in is all it takes for plans to be saved to
 * the cloud, encrypted in this browser first. See packages/crypto/src/account.ts for how one password becomes a
 * login key for the server and, separately, the key that protects plans (which never leaves the browser).
 */
import type { AccountKeys } from '@fisim/crypto';
import type * as Comlink from 'comlink';
import { create } from 'zustand';
import type { AccountWorkerApi } from './account-worker';

// The header uses this module on every screen, so the encryption code (Argon2id, AES) loads only when someone
// actually signs in, creates an account or resets a password.
const crypto = (): Promise<typeof import('@fisim/crypto')> => import('@fisim/crypto');

export const publicCloud =
  import.meta.env.VITE_PUBLIC_CLOUD === 'true' ||
  (typeof window !== 'undefined' && window.location.hostname === 'longviewplanner.app');
export interface CloudUser {
  id: string;
  username: string;
}
export const useCloudAccount = create<{ user: CloudUser | null; loading: boolean; error: string }>(() => ({
  user: null,
  loading: publicCloud,
  error: '',
}));

/** Kept in step with ACCOUNT_PASSWORD_MIN / _MAX in packages/crypto/src/account.ts. */
export const ACCOUNT_PASSWORD_MIN = 10;
const ACCOUNT_PASSWORD_MAX = 256;
const normaliseUsername = (username: string): string => username.trim().toLowerCase();

/** Which account form is open, if any (one dialog, opened from the header or Settings). */
export const useAccountDialog = create<{ view: 'signin' | 'signup' | 'forgot' | null }>(() => ({
  view: null,
}));
export const openAccountDialog = (view: 'signin' | 'signup' | 'forgot' = 'signin'): void =>
  useAccountDialog.setState({ view });

/** A failed account action, phrased for the person in front of the screen. */
export class AccountError extends Error {}

export async function accountRequest<T>(
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new AccountError('You are offline, or the cloud cannot be reached. Try again in a moment.');
  }
  const data = (await response.json().catch(() => null)) as (T & { message?: string }) | null;
  if (!response.ok)
    throw new AccountError(data?.message ?? `The cloud did not accept that (${response.status}). Try again.`);
  return data as T;
}

// ------------------------------------------------------------------ password stretching, off the main thread

let worker: Comlink.Remote<AccountWorkerApi> | null = null;
async function derive(username: string, password: string): Promise<AccountKeys> {
  if (!worker) {
    const { wrap } = await import('comlink');
    worker = wrap<AccountWorkerApi>(
      new Worker(new URL('./account-worker.ts', import.meta.url), { type: 'module' }),
    );
  }
  return worker.deriveAccountKeys(username, password).catch((e: unknown) => {
    if (e instanceof Error && /KDF_UNAVAILABLE|cannot run/i.test(e.message))
      throw new AccountError(
        'This browser cannot run the encryption Longview uses. Try an up-to-date Chrome, Edge, Firefox or Safari.',
      );
    throw e;
  });
}

// ------------------------------------------------------------------ checks shared by the forms

export function usernameProblem(username: string): string | null {
  const u = normaliseUsername(username);
  if (!u) return 'Enter a username.';
  if (!/^[a-z0-9_]{3,30}$/.test(u)) return 'Use 3–30 letters, numbers or underscores.';
  return null;
}
export function passwordProblem(password: string): string | null {
  if (password.length < ACCOUNT_PASSWORD_MIN) return `Use at least ${ACCOUNT_PASSWORD_MIN} characters.`;
  if (password.length > ACCOUNT_PASSWORD_MAX) return `Use at most ${ACCOUNT_PASSWORD_MAX} characters.`;
  return null;
}

// ------------------------------------------------------------------ the wrapped key, read once signed in

interface Wrapped {
  bundle: unknown;
  version: number;
}
async function readWrappedKey(userId: string): Promise<Wrapped> {
  const response = await fetch('/api/v1/keys', {
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'X-Longview-Account': userId },
  });
  if (!response.ok) throw new AccountError('Your account could not be opened. Reload and try again.');
  return {
    bundle: await response.json(),
    version: Number(response.headers.get('X-Plan-Version') ?? 1),
  };
}

async function begin(user: CloudUser, dek: CryptoKey): Promise<void> {
  const { startCloudSync } = await import('./sync');
  await startCloudSync(user, dek);
  useCloudAccount.setState({ user, loading: false, error: '' });
}

// ------------------------------------------------------------------ the account actions

/** New user. Returns the recovery code, which is shown once. */
export async function signUp(username: string, password: string): Promise<{ recoveryCode: string }> {
  const name = normaliseUsername(username);
  const keys = await derive(name, password);
  const made = await (await crypto()).createAccountBundle(keys.wrapKey);
  const { user } = await accountRequest<{ user: CloudUser }>('account/register', {
    username: name,
    password: keys.authKey,
    recoveryAuth: made.recoveryAuth,
    bundle: made.bundle,
  });
  await begin(user, made.dek);
  return { recoveryCode: made.recoveryCode };
}

/** Existing user. */
export async function signIn(username: string, password: string): Promise<void> {
  const name = normaliseUsername(username);
  const keys = await derive(name, password);
  let user: CloudUser;
  try {
    ({ user } = await accountRequest<{ user: CloudUser }>('auth/sign-in/username', {
      username: name,
      password: keys.authKey,
    }));
  } catch (e) {
    if (e instanceof AccountError && /invalid|incorrect|not found/i.test(e.message))
      throw new AccountError('That username and password do not match an account.');
    throw e;
  }
  const { bundle } = await readWrappedKey(user.id);
  await begin(user, await (await crypto()).openAccountBundle(bundle, keys.wrapKey));
}

/** Forgot password: the recovery code sets a new password. Signs in, and returns the replacement code. */
export async function resetPassword(
  username: string,
  recoveryCode: string,
  newPassword: string,
): Promise<{ recoveryCode: string }> {
  const name = normaliseUsername(username);
  const { CryptoError, deriveRecoveryKeys, rewrapAccountBundle } = await crypto();
  let recovery: Awaited<ReturnType<typeof deriveRecoveryKeys>>;
  try {
    recovery = await deriveRecoveryKeys(recoveryCode);
  } catch (e) {
    if (e instanceof CryptoError)
      throw new AccountError('That recovery code has a typo. Check each group of four characters.');
    throw e;
  }
  const started = await accountRequest<Wrapped>('account/recover/begin', {
    username: name,
    recoveryAuth: recovery.recoveryAuth,
  });
  const keys = await derive(name, newPassword);
  const next = await rewrapAccountBundle(
    started.bundle,
    { recoveryWrap: recovery.recoveryWrap },
    { wrapKey: keys.wrapKey, newRecovery: true },
  );
  await accountRequest('account/recover', {
    username: name,
    recoveryAuth: recovery.recoveryAuth,
    password: keys.authKey,
    newRecoveryAuth: next.recoveryAuth,
    bundle: next.bundle,
    bundleVersion: started.version,
  });
  const { user } = await accountRequest<{ user: CloudUser }>('auth/sign-in/username', {
    username: name,
    password: keys.authKey,
  });
  await begin(user, next.dek);
  return { recoveryCode: next.recoveryCode! };
}

function signedIn(): CloudUser {
  const user = useCloudAccount.getState().user;
  if (!user) throw new AccountError('Sign in first.');
  return user;
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const user = signedIn();
  const current = await derive(user.username, currentPassword);
  const wrapped = await readWrappedKey(user.id);
  const next = await derive(user.username, newPassword);
  const { rewrapAccountBundle } = await crypto();
  let rewrapped: Awaited<ReturnType<typeof rewrapAccountBundle>>;
  try {
    rewrapped = await rewrapAccountBundle(
      wrapped.bundle,
      { wrapKey: current.wrapKey },
      { wrapKey: next.wrapKey },
    );
  } catch {
    throw new AccountError('That is not your current password.');
  }
  await accountRequest('account/change-password', {
    password: current.authKey,
    newPassword: next.authKey,
    bundle: rewrapped.bundle,
    bundleVersion: wrapped.version,
  });
}

/** A new recovery code; the old one stops working. Needs the password. */
export async function newRecoveryCode(password: string): Promise<{ recoveryCode: string }> {
  const user = signedIn();
  const keys = await derive(user.username, password);
  const wrapped = await readWrappedKey(user.id);
  const { rewrapAccountBundle } = await crypto();
  let rewrapped: Awaited<ReturnType<typeof rewrapAccountBundle>>;
  try {
    rewrapped = await rewrapAccountBundle(wrapped.bundle, { wrapKey: keys.wrapKey }, { newRecovery: true });
  } catch {
    throw new AccountError('That is not your current password.');
  }
  await accountRequest('account/recovery', {
    password: keys.authKey,
    recoveryAuth: rewrapped.recoveryAuth,
    bundle: rewrapped.bundle,
    bundleVersion: wrapped.version,
  });
  return { recoveryCode: rewrapped.recoveryCode! };
}

export async function refreshAccount(): Promise<CloudUser | null> {
  if (!publicCloud) return null;
  useCloudAccount.setState({ loading: true, error: '' });
  try {
    const data = await accountRequest<{ user: CloudUser } | null>('auth/get-session');
    const user = data?.user ?? null;
    useCloudAccount.setState({ user, loading: false });
    return user;
  } catch {
    useCloudAccount.setState({
      user: null,
      loading: false,
      error: 'Cloud saving is unavailable right now. Your plans are still saved on this device.',
    });
    return null;
  }
}

/** Changes made here that the cloud has not received yet. */
export class UnsentChanges extends AccountError {}

let signingOut: Promise<void> | null = null;
/**
 * Sign out: send anything unsent, then remove this account's plans from the browser (they stay in the cloud and come
 * back on the next sign-in). If something could not be sent, throws `UnsentChanges` unless `force` is set.
 */
export function signOutAccount(force = false): Promise<void> {
  if (signingOut) return signingOut;
  signingOut = (async () => {
    const sync = await import('./sync');
    if (!force && !(await sync.flushCloudSync()))
      throw new UnsentChanges(
        'Some changes have not reached the cloud yet (you may be offline). Signing out now would lose them.',
      );
    await sync.endCloudSession();
    await accountRequest('auth/sign-out', {}).catch(() => undefined);
    useCloudAccount.setState({ user: null, loading: false, error: '' });
  })().finally(() => {
    signingOut = null;
  });
  return signingOut;
}
