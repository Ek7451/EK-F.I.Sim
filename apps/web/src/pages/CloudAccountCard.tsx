/**
 * Settings: the cloud account. Signed out, it explains cloud saving and opens the sign-in dialog. Signed in, it shows
 * that saving is on (it always is), when it last saved, and the account actions: change password, a new recovery
 * code, and sign out. Plans that changed on two devices are settled here too.
 */
import { Badge, Button, Card, Field, HelpTip, Notice } from '@fisim/ui';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import {
  ACCOUNT_PASSWORD_MIN,
  AccountError,
  changePassword,
  deleteCloudAccount,
  newRecoveryCode,
  openAccountDialog,
  passwordProblem,
  publicCloud,
  useCloudAccount,
} from '../lib/cloud-account';
import { useSync, type SyncConflict } from '../lib/sync-status';
import { useStore } from '../state/store';
import { RecoveryCode, SignOutDialog, cloudStatus } from './AccountDialog';
import './account.css';

const when = (iso: string | null): string => {
  if (!iso) return 'not yet';
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return new Date(iso).toLocaleString();
};

function Secret({
  label,
  value,
  onChange,
  autoComplete,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  hint?: string;
}): ReactNode {
  return (
    <Field label={label} hint={hint} help={null}>
      {(id, hintId) => (
        <input
          id={id}
          className="lv-input"
          type="password"
          value={value}
          autoComplete={autoComplete}
          aria-describedby={hintId}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Field>
  );
}

function ChangePassword({ onDone }: { onDone: () => void }): ReactNode {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const problem = !current
      ? 'Enter your current password.'
      : (passwordProblem(next) ?? (next !== again ? 'The two new passwords are different.' : null));
    if (problem) return setError(problem);
    setBusy(true);
    setError('');
    try {
      await changePassword(current, next);
      useStore.getState().notify('Password changed. Use it next time you sign in.', 'ok');
      onDone();
    } catch (err) {
      setError(err instanceof AccountError ? err.message : 'Could not change the password. Try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="acct-inline" onSubmit={(e) => void submit(e)} noValidate>
      <Secret
        label="Current password"
        value={current}
        onChange={setCurrent}
        autoComplete="current-password"
      />
      <Secret
        label="New password"
        value={next}
        onChange={setNext}
        autoComplete="new-password"
        hint={`At least ${ACCOUNT_PASSWORD_MIN} characters.`}
      />
      <Secret label="Confirm new password" value={again} onChange={setAgain} autoComplete="new-password" />
      {error ? <p className="field-error">{error}</p> : null}
      <div className="lv-row">
        <Button type="submit" variant="primary" size="sm" disabled={busy}>
          {busy ? 'Changing…' : 'Change password'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function NewCode({ username, onDone }: { username: string; onDone: () => void }): ReactNode {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [code, setCode] = useState<string | null>(null);
  const ack = useRef<(() => void) | null>(null);
  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!password) return setError('Enter your password.');
    setBusy(true);
    setError('');
    try {
      await newRecoveryCode(
        password,
        (value) =>
          new Promise((resolve) => {
            ack.current = resolve;
            setCode(value);
          }),
      );
      onDone();
    } catch (err) {
      setError(err instanceof AccountError ? err.message : 'Could not make a new code. Try again.');
    } finally {
      setBusy(false);
    }
  };
  if (code)
    return (
      <RecoveryCode
        code={code}
        username={username}
        onDone={() => {
          setCode(null);
          ack.current?.();
          ack.current = null;
        }}
      />
    );
  return (
    <form className="acct-inline" onSubmit={(e) => void submit(e)} noValidate>
      <p className="lv-small lv-muted">Lost your recovery code? Make a new one; the old one stops working.</p>
      <Secret label="Password" value={password} onChange={setPassword} autoComplete="current-password" />
      {error ? <p className="field-error">{error}</p> : null}
      <div className="lv-row">
        <Button type="submit" variant="primary" size="sm" disabled={busy}>
          {busy ? 'Making a code…' : 'Make a new code'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function Conflicts({ conflicts }: { conflicts: SyncConflict[] }): ReactNode {
  const plans = useStore((s) => s.plans);
  const [error, setError] = useState('');
  if (!conflicts.length) return null;
  const choose = async (c: SyncConflict, choice: 'mine' | 'theirs' | 'both'): Promise<void> => {
    setError('');
    try {
      const { resolveConflict } = await import('../lib/sync');
      await resolveConflict(c, choice);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="acct-conflicts">
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {conflicts.map((c) => (
        <Notice key={c.planId} tone="warn">
          <div className="lv-stack" style={{ gap: 8 }}>
            <span>
              <strong>{c.planName}</strong>{' '}
              {c.deletedLocally
                ? 'was deleted here but changed on another device.'
                : c.deletedOnServer
                  ? 'was deleted on another device.'
                  : 'was also changed on another device.'}{' '}
              A copy of this device's version is kept whichever you choose.
            </span>
            <span className="lv-row">
              <Button size="sm" onClick={() => void choose(c, 'mine')}>
                {c.deletedLocally ? 'Delete it everywhere' : "Keep this device's"}
              </Button>
              <Button size="sm" onClick={() => void choose(c, 'theirs')}>
                {c.deletedOnServer ? 'Delete it here too' : "Use the other device's"}
              </Button>
              {plans[c.planId] ? (
                <Button size="sm" onClick={() => void choose(c, 'both')}>
                  Keep both
                </Button>
              ) : null}
            </span>
          </div>
        </Notice>
      ))}
    </div>
  );
}

export function CloudAccountCard(): ReactNode {
  const account = useCloudAccount();
  const sync = useSync();
  const location = useLocation();
  const [panel, setPanel] = useState<'password' | 'code' | 'delete' | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [usage, setUsage] = useState<{ live: number; bytes: number; rows: number } | null>(null);
  useEffect(() => {
    let current = true;
    setUsage(null);
    if (account.user) {
      const id = account.user.id;
      void fetch('/api/v1/plans', { headers: { 'X-Longview-Account': id }, cache: 'no-store' })
        .then(async (response) => {
          if (!response.ok) return;
          const rows = (await response.json()) as { deleted: boolean; size: number }[];
          if (current && Array.isArray(rows))
            setUsage({
              live: rows.filter((r) => !r.deleted).length,
              bytes: rows.reduce((n, r) => n + r.size, 0),
              rows: rows.length,
            });
        })
        .catch(() => {});
    }
    return () => {
      current = false;
    };
  }, [account.user, sync.lastSyncAt]);
  useEffect(() => {
    if (location.hash !== '#cloud-account') return;
    document.getElementById('cloud-account')?.scrollIntoView({ block: 'start' });
  }, [location.key, location.hash]);
  if (!publicCloud) return null;

  if (!account.user)
    return (
      <Card id="cloud-account" title="Cloud saving" data-tour="cloud-account">
        <p className="lv-small">
          Sign in to open your plans on another device.{' '}
          <HelpTip label="About cloud saving">
            Plans stay in this browser until you sign in. Cloud plans are encrypted on your device before
            upload.
          </HelpTip>
        </p>
        {account.error || sync.message ? (
          <div style={{ marginTop: 8 }}>
            <Notice tone="warn">{account.error || sync.message}</Notice>
          </div>
        ) : null}
        <div className="lv-row" style={{ marginTop: 10 }}>
          <Button
            variant="primary"
            size="sm"
            disabled={account.loading}
            onClick={() => openAccountDialog('signin')}
          >
            Sign in
          </Button>
          <Button size="sm" disabled={account.loading} onClick={() => openAccountDialog('signup')}>
            Create an account
          </Button>
        </div>
      </Card>
    );

  const s = cloudStatus(sync.status);
  return (
    <Card
      id="cloud-account"
      title="Account"
      data-tour="cloud-account"
      actions={
        <Badge
          tone={s.tone === 'ok' ? 'ok' : s.tone === 'bad' ? 'danger' : s.tone === 'warn' ? 'warn' : undefined}
        >
          {s.text}
        </Badge>
      }
    >
      <dl className="lv-facts" data-tour="sync-status">
        <div>
          <dt>Signed in as</dt>
          <dd>{account.user.username}</dd>
        </div>
        <div>
          <dt>Cloud saving</dt>
          <dd>On, automatic</dd>
        </div>
        <div>
          <dt>Last saved</dt>
          <dd>{sync.status === 'syncing' ? 'Saving now…' : when(sync.lastSyncAt)}</dd>
        </div>
        <div>
          <dt>Plans in this account</dt>
          <dd>
            {usage
              ? `${usage.live} of 20 active · ${usage.bytes.toLocaleString()} of 2,097,152 bytes · ${usage.rows} of 200 lifetime plan IDs`
              : 'Usage unavailable'}
          </dd>
        </div>
      </dl>
      {sync.message ? (
        <div style={{ marginTop: 8 }}>
          <Notice tone={sync.status === 'error' ? 'danger' : 'warn'}>{sync.message}</Notice>
        </div>
      ) : null}
      <Conflicts conflicts={sync.conflicts} />
      {panel === 'delete' ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (deleting) return;
            setDeleting(true);
            setDeleteError('');
            try {
              await deleteCloudAccount(deletePassword, confirmName);
              setPanel(null);
            } catch (err) {
              setDeleteError(err instanceof Error ? err.message : 'Deletion could not be confirmed.');
            } finally {
              setDeleting(false);
              setDeletePassword('');
            }
          }}
        >
          <p>
            Deleting this account removes its cloud plans, recovery keys and sessions, and clears this
            device’s account workspace. Export a backup in Settings first if you want to keep the plans.
            Offline copies on other devices may still exist. Cloudflare can retain database recovery history
            for seven days on the current Free plan.
          </p>
          <label>
            Confirm username
            <input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} />
          </label>
          <Secret
            label="Current password"
            value={deletePassword}
            onChange={setDeletePassword}
            autoComplete="current-password"
          />
          {deleteError && <p role="alert">{deleteError}</p>}
          <Button
            disabled={deleting || !deletePassword || confirmName !== account.user.username}
            type="submit"
          >
            Permanently delete account
          </Button>
          <Button
            type="button"
            disabled={deleting}
            onClick={() => {
              setPanel(null);
              setDeletePassword('');
            }}
          >
            Cancel
          </Button>
        </form>
      ) : panel === 'password' ? (
        <ChangePassword onDone={() => setPanel(null)} />
      ) : panel === 'code' ? (
        <NewCode username={account.user.username} onDone={() => setPanel(null)} />
      ) : (
        <details className="hs-device-details">
          <summary>Manage account</summary>
          <div className="lv-row">
            <Button size="sm" onClick={() => setPanel('password')}>
              Change password
            </Button>
            <Button size="sm" onClick={() => setPanel('code')}>
              New recovery code
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPanel('delete')}>
              Delete account
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSigningOut(true)}>
              Sign out
            </Button>
          </div>
        </details>
      )}
      <SignOutDialog open={signingOut} onClose={() => setSigningOut(false)} />
    </Card>
  );
}
