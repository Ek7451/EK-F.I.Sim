import { Button, Card, Dialog, Notice, SelectField, TextField } from '@fisim/ui';
import { useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import {
  accountRequest,
  publicCloud,
  refreshAccount,
  signOutAccount,
  useCloudAccount,
  type CloudUser,
} from '../lib/cloud-account';
import { bindCloudAccount } from '../lib/sync';
import { download } from '../lib/files';

export function CloudAccountCard(): ReactNode {
  const account = useCloudAccount();
  const location = useLocation();
  const [mode, setMode] = useState<'signin' | 'register' | 'recover'>('signin');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [recovery, setRecovery] = useState('');
  const [shown, setShown] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (location.hash !== '#cloud-account' || account.loading || account.user) return;
    setMode('signin');
    const card = document.getElementById('cloud-account');
    card?.scrollIntoView({ block: 'start' });
    card?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
  }, [location.key, location.hash, account.loading, account.user]);
  if (!publicCloud) return null;
  async function run(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      setPassword('');
      setAgain('');
      setRecovery('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not complete that request.');
    } finally {
      setBusy(false);
    }
  }
  async function accept(user: CloudUser): Promise<void> {
    try {
      await bindCloudAccount(user);
    } catch (e) {
      await accountRequest('auth/sign-out', {});
      await refreshAccount();
      throw e;
    }
    await refreshAccount();
  }
  async function submit(): Promise<void> {
    if (mode === 'register') {
      const result = await accountRequest<{ user: CloudUser; recoveryCode: string }>('account/register', {
        username,
        password,
      });
      setShown(result.recoveryCode);
      await accept(result.user);
    } else if (mode === 'recover') {
      const result = await accountRequest<{ recoveryCode: string }>('account/recover', {
        username,
        password,
        recoveryCode: recovery,
      });
      setShown(result.recoveryCode);
      setMode('signin');
      setNotice(
        'Password reset. Save your replacement account recovery code, then sign in. Your vault passphrase has not changed.',
      );
    } else {
      const result = await accountRequest<{ user: CloudUser }>('auth/sign-in/username', {
        username,
        password,
      });
      await accept(result.user);
    }
  }
  return (
    <Card id="cloud-account" title="Local or cloud saving" data-tour="cloud-account">
      <p className="lv-muted lv-small">
        Your plans save in this browser without an account. Create a free account to save encrypted copies in
        the cloud and open them on other devices. Cloud storage includes 20 plans, up to 2 MiB total (256 KiB
        per plan).
      </p>
      {error || account.error ? <Notice tone="danger">{error || account.error}</Notice> : null}
      {notice ? <Notice>{notice}</Notice> : null}
      {account.loading ? (
        <p role="status">Checking cloud sign-in…</p>
      ) : account.user ? (
        <div className="lv-stack" style={{ marginTop: 16 }}>
          <p>
            Signed in as <strong>{account.user.username}</strong>. Unlock your encrypted vault below to sync.
          </p>
          <p className="lv-muted lv-small">
            Signing out stops cloud saving. Plans already on this device remain here. On a shared computer,
            use a private browser window and close it when finished.
          </p>
          <div>
            <Button disabled={busy} onClick={() => void run(signOutAccount)}>
              Sign out
            </Button>
          </div>
          <details>
            <summary>Replace a lost account recovery code</summary>
            <div className="lv-stack" style={{ marginTop: 12, maxWidth: 480 }}>
              <TextField label="Account password" type="password" value={password} onChange={setPassword} />
              <div>
                <Button
                  disabled={busy || !password}
                  onClick={() =>
                    void run(async () => {
                      const result = await accountRequest<{ recoveryCode: string }>('account/recovery-code', {
                        password,
                      });
                      setShown(result.recoveryCode);
                    })
                  }
                >
                  Generate replacement code
                </Button>
              </div>
            </div>
          </details>
        </div>
      ) : (
        <form
          className="lv-stack"
          style={{ marginTop: 16, maxWidth: 600 }}
          onSubmit={(e) => {
            e.preventDefault();
            void run(submit);
          }}
        >
          <SelectField
            label="Cloud account"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'signin', label: 'Sign in' },
              { value: 'register', label: 'Create a free account' },
              { value: 'recover', label: 'Recover my account' },
            ]}
          />
          <TextField
            label="Username"
            hint="3–30 letters, numbers or underscores. No email address needed."
            value={username}
            onChange={setUsername}
          />
          {mode === 'recover' ? (
            <TextField
              label="Account recovery code"
              hint="This resets your account password. Your separate vault recovery key unlocks your encrypted plans."
              value={recovery}
              onChange={setRecovery}
            />
          ) : null}
          <TextField
            label={mode === 'recover' ? 'New account password' : 'Account password'}
            hint="At least 12 characters. Use a different passphrase for your encrypted vault."
            type="password"
            value={password}
            onChange={setPassword}
          />
          {mode !== 'signin' ? (
            <TextField label="Account password again" type="password" value={again} onChange={setAgain} />
          ) : null}
          <div className="lv-row">
            <Button
              type="submit"
              variant="primary"
              disabled={
                busy ||
                !username ||
                password.length < 12 ||
                (mode !== 'signin' && password !== again) ||
                (mode === 'recover' && !recovery)
              }
            >
              {busy
                ? 'Working…'
                : mode === 'register'
                  ? 'Create account'
                  : mode === 'recover'
                    ? 'Reset account password'
                    : 'Sign in'}
            </Button>
            <span className="lv-small lv-muted">Local saving is always available.</span>
          </div>
        </form>
      )}
      <Dialog
        open={!!shown}
        title="Save your account recovery code"
        onClose={() => setShown(null)}
        footer={
          <Button variant="primary" onClick={() => setShown(null)}>
            I have saved this code
          </Button>
        }
      >
        <div className="lv-stack">
          <p>
            This code resets your account password if you forget it. It is shown once and replaces any
            previous account recovery code. It does not unlock your encrypted vault.
          </p>
          <code style={{ overflowWrap: 'anywhere', userSelect: 'all' }}>{shown}</code>
          <Button
            onClick={() =>
              download(
                'longview-account-recovery.txt',
                `Longview Planner account recovery\nUsername: ${account.user?.username ?? username}\nRecovery code: ${shown}\nKeep this private. Your vault recovery key is separate.\n`,
                'text/plain',
              )
            }
          >
            Download recovery code
          </Button>
        </div>
      </Dialog>
    </Card>
  );
}
