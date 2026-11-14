/**
 * The cloud account in one dialog: Sign in (existing user), Create an account (new user) and Forgot password.
 * Once signed in, plans are saved to the cloud automatically, encrypted in this browser first; there is nothing to
 * turn on. A recovery code, shown once, is the only way to reset a forgotten password.
 */
import { Button, Dialog, Field, Icon, Menu, Notice } from '@fisim/ui';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ACCOUNT_PASSWORD_MIN,
  AccountError,
  UnsentChanges,
  openAccountDialog,
  passwordProblem,
  resetPassword,
  signIn,
  signOutAccount,
  signUp,
  useAccountDialog,
  useCloudAccount,
  usernameProblem,
} from '../lib/cloud-account';
import { saveTextFile, useSync } from '../lib/sync-status';
import { useStore } from '../state/store';
import './account.css';

const message = (e: unknown): string =>
  e instanceof AccountError ? e.message : 'Something went wrong. Check your connection and try again.';

/** A labelled input that password managers understand (autocomplete names the field's purpose). */
function Input({
  label,
  value,
  onChange,
  type = 'text',
  autoComplete,
  hint,
  invalid,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: 'text' | 'password';
  autoComplete: string;
  hint?: string;
  invalid?: boolean;
  autoFocus?: boolean;
}): ReactNode {
  return (
    <Field label={label} hint={hint} help={null}>
      {(id, hintId) => (
        <input
          id={id}
          className="lv-input"
          type={type}
          value={value}
          autoComplete={autoComplete}
          autoCapitalize="none"
          spellCheck={false}
          autoFocus={autoFocus}
          aria-describedby={hintId}
          aria-invalid={invalid || undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Field>
  );
}

/** Shown once after creating an account or resetting a password. */
function RecoveryCode({
  code,
  username,
  onDone,
}: {
  code: string;
  username: string;
  onDone: () => void;
}): ReactNode {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  return (
    <div className="acct-code">
      <p>
        If you ever forget your password, this code is the only way back into your account and your cloud
        plans. Keep it somewhere safe, such as a password manager. It is shown only now.
      </p>
      <code className="acct-code-value" data-testid="recovery-code">
        {code}
      </code>
      <div className="lv-row">
        <Button
          size="sm"
          icon="copy"
          onClick={() =>
            void navigator.clipboard?.writeText(code).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            })
          }
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button
          size="sm"
          icon="download"
          onClick={() =>
            saveTextFile(
              'longview-recovery-code.txt',
              `Longview Planner recovery code\nUsername: ${username}\nRecovery code: ${code}\n\nUse it with your username to set a new password if you forget yours. Keep it private.\n`,
            )
          }
        >
          Download
        </Button>
      </div>
      <label className="lv-switch acct-saved">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        <span>I have saved my recovery code</span>
      </label>
      <Button variant="primary" disabled={!saved} onClick={onDone}>
        Done
      </Button>
    </div>
  );
}

export function AccountDialog(): ReactNode {
  const view = useAccountDialog((s) => s.view);
  const close = (): void => useAccountDialog.setState({ view: null });
  const nav = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [tried, setTried] = useState(false);
  const [shown, setShown] = useState<{ code: string; username: string; title: string } | null>(null);
  const prev = useRef(view);
  useEffect(() => {
    // A fresh form each time the dialog opens or switches; the username carries over between forms.
    if (prev.current !== view) {
      setPassword('');
      setAgain('');
      setCode('');
      setError('');
      setTried(false);
    }
    prev.current = view;
  }, [view]);

  const open = view !== null || shown !== null;
  const switchTo = (v: 'signin' | 'signup' | 'forgot'): void => openAccountDialog(v);
  const uProblem = usernameProblem(username);
  const pProblem = view === 'signin' ? (password ? null : 'Enter your password.') : passwordProblem(password);
  const mismatch = view !== 'signin' && again !== password ? 'The two passwords are different.' : null;
  const cProblem = view === 'forgot' && !code.trim() ? 'Enter your recovery code.' : null;
  const problem = uProblem ?? pProblem ?? mismatch ?? cProblem;

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setTried(true);
    if (problem || busy) return;
    setBusy(true);
    setError('');
    // Signed in from the welcome screen with plans in the account: open them rather than the new-plan form.
    const toPlans = (): void => {
      if (location.pathname === '/start' && Object.keys(useStore.getState().plans).length) nav('/');
    };
    try {
      if (view === 'signup') {
        const r = await signUp(username, password);
        setShown({ code: r.recoveryCode, username, title: 'Save your recovery code' });
        close();
      } else if (view === 'forgot') {
        const r = await resetPassword(username, code, password);
        setShown({ code: r.recoveryCode, username, title: 'Password changed. Save your new recovery code' });
        close();
        toPlans();
      } else {
        await signIn(username, password);
        close();
        toPlans();
        useStore.getState().notify('Signed in. Your plans now save to the cloud automatically.', 'ok');
      }
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  if (shown)
    return (
      <Dialog open={open} title={shown.title} onClose={() => undefined}>
        <RecoveryCode
          code={shown.code}
          username={shown.username}
          onDone={() => {
            setShown(null);
            useStore
              .getState()
              .notify('You are signed in. Your plans now save to the cloud automatically.', 'ok');
          }}
        />
      </Dialog>
    );

  const title =
    view === 'signup' ? 'Create an account' : view === 'forgot' ? 'Reset your password' : 'Sign in';
  const action = view === 'signup' ? 'Create account' : view === 'forgot' ? 'Reset password' : 'Sign in';
  const working =
    view === 'signup' ? 'Creating your account…' : view === 'forgot' ? 'Resetting…' : 'Signing in…';
  return (
    <Dialog open={open} title={title} onClose={close}>
      <form className="acct-form" onSubmit={(e) => void submit(e)} noValidate data-tour="account-form">
        {view === 'signup' ? (
          <p className="acct-lead">
            Save your plans to the cloud and open them on any device. They are encrypted on this device before
            they leave it, so only you can read them.
          </p>
        ) : view === 'forgot' ? (
          <p className="acct-lead">
            Enter the recovery code you saved when you created your account, and choose a new password. Your
            cloud plans stay as they are.
          </p>
        ) : null}
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <Input
          label="Username"
          value={username}
          onChange={setUsername}
          autoComplete="username"
          autoFocus
          hint={view === 'signup' ? '3–30 letters, numbers or underscores. No email needed.' : undefined}
          invalid={tried && !!uProblem}
        />
        {view === 'forgot' ? (
          <Input
            label="Recovery code"
            value={code}
            onChange={setCode}
            autoComplete="off"
            hint="Fourteen groups of four characters. Dashes and spaces are optional."
            invalid={tried && !!cProblem}
          />
        ) : null}
        <Input
          label={view === 'forgot' ? 'New password' : 'Password'}
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete={view === 'signin' ? 'current-password' : 'new-password'}
          hint={view === 'signin' ? undefined : `At least ${ACCOUNT_PASSWORD_MIN} characters.`}
          invalid={tried && !!pProblem}
        />
        {view !== 'signin' ? (
          <Input
            label="Confirm password"
            type="password"
            value={again}
            onChange={setAgain}
            autoComplete="new-password"
            invalid={tried && !!mismatch}
          />
        ) : null}
        {tried && problem ? (
          <p className="field-error" role="alert">
            {problem}
          </p>
        ) : null}
        <Button type="submit" variant="primary" disabled={busy} className="lv-btn acct-submit">
          {busy ? working : action}
        </Button>
        {busy && view !== 'signin' ? (
          <p className="lv-small lv-muted acct-note" role="status">
            Securing your key on this device. This takes a moment.
          </p>
        ) : null}
        <div className="acct-links">
          {view === 'signin' ? (
            <>
              <button type="button" className="acct-link" onClick={() => switchTo('forgot')}>
                Forgot password?
              </button>
              <span>
                New here?{' '}
                <button type="button" className="acct-link" onClick={() => switchTo('signup')}>
                  Create an account
                </button>
              </span>
            </>
          ) : (
            <span>
              {view === 'signup' ? 'Already have an account?' : 'Remembered it?'}{' '}
              <button type="button" className="acct-link" onClick={() => switchTo('signin')}>
                Sign in
              </button>
            </span>
          )}
        </div>
        {view === 'forgot' ? (
          <p className="lv-small lv-muted acct-note">
            Without the recovery code a password cannot be reset, because nobody else can unlock your plans.
            Plans on this device are not affected.
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}

/** Sign out, asking first if some changes have not reached the cloud. */
export function SignOutDialog({ open, onClose }: { open: boolean; onClose: () => void }): ReactNode {
  const [busy, setBusy] = useState(false);
  const [unsent, setUnsent] = useState('');
  const go = async (force: boolean): Promise<void> => {
    setBusy(true);
    try {
      await signOutAccount(force);
      onClose();
      useStore.getState().notify('Signed out. Your plans are safe in the cloud.', 'ok');
    } catch (e) {
      if (e instanceof UnsentChanges) setUnsent(e.message);
      else useStore.getState().notify(message(e), 'danger');
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (open) {
      setUnsent('');
      void go(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return (
    <Dialog
      open={open && !!unsent}
      title="Sign out with unsent changes?"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Stay signed in</Button>
          <Button variant="danger" disabled={busy} onClick={() => void go(true)}>
            Sign out anyway
          </Button>
        </>
      }
    >
      <p>{unsent}</p>
      <p className="lv-small lv-muted" style={{ marginTop: 8 }}>
        Signing out removes your plans from this browser; the copies in the cloud stay. Stay signed in and
        reconnect to send the changes first.
      </p>
    </Dialog>
  );
}

const STATUS: Record<string, { text: string; tone: 'ok' | 'busy' | 'warn' | 'bad' }> = {
  idle: { text: 'Saved to the cloud', tone: 'ok' },
  syncing: { text: 'Saving to the cloud…', tone: 'busy' },
  offline: { text: 'Offline: changes wait here', tone: 'warn' },
  error: { text: 'Cloud saving needs attention', tone: 'bad' },
  off: { text: 'Not saving to the cloud', tone: 'warn' },
  locked: { text: 'Not saving to the cloud', tone: 'warn' },
};
export const cloudStatus = (status: string): (typeof STATUS)[string] => STATUS[status] ?? STATUS.off;

/** The header's account control: "Sign in" when signed out; the username, cloud status and a menu when signed in. */
export function AccountButton({ disabled }: { disabled?: boolean }): ReactNode {
  const account = useCloudAccount();
  const status = useSync((s) => s.status);
  const nav = useNavigate();
  const [signingOut, setSigningOut] = useState(false);
  if (!account.user)
    return (
      <Button
        className="lv-btn account-toggle"
        size="sm"
        disabled={disabled || account.loading}
        title="Sign in to save your plans to the cloud"
        onClick={() => openAccountDialog('signin')}
      >
        Sign in
      </Button>
    );
  const s = cloudStatus(status);
  return (
    <>
      <Menu
        label="Account"
        placement="bottom-end"
        items={[
          {
            id: 'settings',
            label: 'Account settings',
            icon: 'settings',
            onSelect: () => nav('/settings#cloud-account'),
          },
          {
            id: 'signout',
            label: 'Sign out',
            icon: 'close',
            divider: true,
            onSelect: () => setSigningOut(true),
          },
        ]}
        trigger={({ open: _open, ...props }) => (
          <button
            {...props}
            type="button"
            className="acct-chip"
            data-tone={s.tone}
            aria-label={`Account: ${account.user!.username}. ${s.text}`}
            title={s.text}
          >
            <span className="acct-dot" aria-hidden="true" />
            <span className="lv-ellipsis">{account.user!.username}</span>
            <Icon name="down" size={14} />
          </button>
        )}
      />
      <SignOutDialog open={signingOut} onClose={() => setSigningOut(false)} />
    </>
  );
}
