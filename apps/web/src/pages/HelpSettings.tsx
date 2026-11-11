import { DATA_RELEASE, type DatasetInfo } from '@fisim/data';
import { methodology, type MethodEntry } from '@fisim/engine';
import { Badge, Button, Card, Dialog, Notice, SelectField, TextField } from '@fisim/ui';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { exportBackup, download, readBackup } from '../lib/files';
import {
  changeSyncPassphrase,
  lockSync,
  recoverSync,
  resolveConflict,
  setUpSync,
  syncNow,
  turnOffSync,
  unlockSync,
  useSync,
} from '../lib/sync';
import { PageHead } from '../shell/Shell';
import { errorLog } from '../state/db';
import { useStore, type Theme } from '../state/store';
import { TOURS, tourById } from '../tours/catalog';
import { useTour } from '../tours/TourEngine';
import type { TourDef } from '../tours/types';

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const when = (iso: string | null): string => (iso ? new Date(iso).toLocaleString() : 'never');

// ------------------------------------------------------------------ guided tours (UX-10 to UX-12)

export function ToursPage(): ReactNode {
  const tour = useTour();
  const progress = useStore((s) => s.settings.tours);
  const hasPlan = useStore((s) => !!s.settings.activePlanId);
  const done = (t: TourDef): boolean => !!progress[t.id]?.completed;
  const basic = TOURS.filter((t) => t.level === 'basic');
  const advanced = TOURS.filter((t) => t.level === 'advanced');
  const count = TOURS.filter(done).length;
  const tile = (t: TourDef): ReactNode => {
    const p = progress[t.id];
    const started = !!p && !p.completed && p.step > 0;
    const missing = t.prerequisites
      .filter((id) => !progress[id]?.completed)
      .map((id) => tourById(id)?.title ?? id);
    return (
      <article key={t.id} className="tour-tile" data-tour="tour-tile" data-tour-id={t.id}>
        <div className="lv-spread">
          <span className="lv-muted lv-small">
            {t.id} · about {t.minutes} min · {t.steps.length} steps
          </span>
          {p?.completed ? (
            <Badge tone="ok">Completed</Badge>
          ) : started ? (
            <Badge tone="warn">
              Step {p.step + 1} of {t.steps.length}
            </Badge>
          ) : (
            <Badge>Not started</Badge>
          )}
        </div>
        <h3>{t.title}</h3>
        <p className="lv-small lv-muted" style={{ flex: 1 }}>
          {t.summary}
        </p>
        {missing.length ? <p className="lv-small lv-muted">Easier after: {missing.join(', ')}.</p> : null}
        <div className="lv-row">
          <Button
            size="sm"
            variant="primary"
            onClick={() => tour.start(t.id, { restart: !started })}
            aria-label={`${p?.completed ? 'Replay' : started ? 'Resume' : 'Start'} the tour: ${t.title}`}
          >
            {p?.completed ? 'Replay' : started ? 'Resume' : 'Start'}
          </Button>
          {hasPlan ? (
            <Button
              size="sm"
              onClick={() => tour.start(t.id, { ownPlan: true, restart: true })}
              aria-label={`On my plan: run the tour ${t.title} with changes switched off`}
            >
              On my plan
            </Button>
          ) : null}
        </div>
      </article>
    );
  };
  return (
    <>
      <PageHead
        title="Guided tours"
        intro="Short walkthroughs that explain each part of the app. A tour runs on a sample plan in a sandbox, so nothing you do in it changes your own plans. Choose On my plan to see your own numbers with changes switched off."
      />
      <Card data-tour="tours-progress">
        <div className="lv-spread">
          <strong>
            {count} of {TOURS.length} tours completed
          </strong>
          <span className="lv-row">
            {basic.every(done) ? <Badge tone="ok">Basics complete</Badge> : null}
            {advanced.every(done) ? <Badge tone="ok">Advanced complete</Badge> : null}
          </span>
        </div>
        <div
          className="lv-progress"
          role="progressbar"
          aria-label="Tours completed"
          aria-valuemin={0}
          aria-valuemax={TOURS.length}
          aria-valuenow={count}
          style={{ marginTop: 12 }}
        >
          <div style={{ width: `${(count / TOURS.length) * 100}%` }} />
        </div>
        <p className="lv-small lv-muted" style={{ marginTop: 12 }}>
          During a tour: Next and Back move between steps, the right and left arrow keys do the same, and Esc
          leaves. Your place is saved.
        </p>
      </Card>
      <Card title="Basic series" data-tour="tours-catalog">
        <div className="tour-grid">{basic.map(tile)}</div>
      </Card>
      <Card title="Advanced series">
        <div className="tour-grid">{advanced.map(tile)}</div>
      </Card>
    </>
  );
}

// ------------------------------------------------------------------ how this is calculated (RPT-06)

export function MethodsPage(): ReactNode {
  const [entries, setEntries] = useState<MethodEntry[] | null>(null);
  const [datasets, setDatasets] = useState<DatasetInfo[]>([]);
  const loc = useLocation();
  useEffect(() => {
    let live = true;
    void import('@fisim/data/src/bundle').then((b) => {
      if (!live) return;
      setEntries(methodology(b.bundledEngineData(), new Date().getFullYear()));
      setDatasets(b.bundledDatasets());
    });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (!entries || !loc.hash) return;
    const el = document.getElementById(loc.hash.slice(1));
    el?.scrollIntoView({ block: 'start' });
    el?.focus({ preventScroll: true });
  }, [entries, loc.hash]);
  const projected = datasets.filter((d) => d.header.status !== 'enacted').length;
  return (
    <>
      <PageHead
        title="How this is calculated"
        intro="Each method the app uses, in plain words, with its formula and the published source of its figures. Every result is an estimate built from these methods and your inputs."
      />
      <Card title="Enacted and projected figures" data-tour="data-status">
        <p>
          <Badge tone="ok">Enacted</Badge> figures come from published law and official tables.{' '}
          <Badge tone="warn">Projected</Badge> figures are the latest enacted values raised with inflation,
          used for years that have not been published. Results that rely on projected figures are marked on
          the screens that show them.
        </p>
        <p className="lv-small lv-muted" style={{ marginTop: 8 }}>
          Data release {DATA_RELEASE}: {datasets.length} datasets, {projected} of them projected or estimated.
        </p>
      </Card>
      <Card title="Methods" data-tour="methods-list">
        {!entries ? (
          <p className="lv-muted">Loading…</p>
        ) : (
          entries.map((m, i) => (
            <section
              key={m.id}
              id={m.id}
              className="method"
              tabIndex={-1}
              data-tour={i === 2 ? 'method-entry' : undefined}
            >
              <h3>{m.title}</h3>
              <p style={{ marginTop: 4 }}>{m.summary}</p>
              <code>{m.formula}</code>
              {m.sources.map((s) => (
                <p key={s.label} className="lv-small lv-muted">
                  {s.label}: {s.header.publisher}, retrieved {s.header.retrieved}.{' '}
                  <Badge tone={s.header.status === 'enacted' ? 'ok' : 'warn'}>{s.header.status}</Badge>{' '}
                  {s.header.lawRefs.length ? `Based on ${s.header.lawRefs.slice(0, 3).join('; ')}.` : ''}
                </p>
              ))}
              <p className="lv-small lv-muted">Features: {m.featureIds.join(', ')}</p>
            </section>
          ))
        )}
      </Card>
      <Card title="Datasets in this release" data-tour="data-sources">
        <div className="lv-table-wrap" tabIndex={0} role="region" aria-label="Datasets in this release">
          <table className="lv-table">
            <thead>
              <tr>
                <th scope="col">Dataset</th>
                <th scope="col">Publisher</th>
                <th scope="col">Retrieved</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {datasets.map((d) => (
                <tr key={d.path}>
                  <th scope="row" style={{ fontWeight: 400 }}>
                    {d.path.replace(/\.json$/, '')}
                  </th>
                  <td>{d.header.publisher}</td>
                  <td className="lv-num">{d.header.retrieved}</td>
                  <td>{d.header.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="lv-small lv-muted" style={{ marginTop: 8 }}>
          Marketplace benchmark premiums by county are loaded only for the states in your plan and are not
          listed here.
        </p>
      </Card>
    </>
  );
}

// ------------------------------------------------------------------ settings

function Pass({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}): ReactNode {
  return <TextField label={label} hint={hint} type="password" value={value} onChange={onChange} />;
}

function PlansCard(): ReactNode {
  const plans = useStore((s) => s.plans);
  const activeId = useStore((s) => s.settings.activePlanId);
  const sandbox = useStore((s) => !!s.sandbox);
  const { replacePlan, duplicatePlan, deletePlan, setActive, notify } = useStore.getState();
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const list = Object.values(plans);
  return (
    <Card
      title="Plans"
      data-tour="settings-plans"
      actions={
        <Link className="lv-btn" data-size="sm" to="/start">
          New plan
        </Link>
      }
    >
      {list.length === 0 ? <p className="lv-muted">No plans on this device yet.</p> : null}
      <ul className="lv-list">
        {list.map((p) => (
          <li key={p.id}>
            <div className="lv-grow">
              <strong>{p.name}</strong> {p.id === activeId ? <Badge tone="ok">Open</Badge> : null}
              <div className="lv-small lv-muted">Last changed {when(p.updatedAt)}</div>
            </div>
            {p.id !== activeId ? (
              <Button size="sm" disabled={sandbox} onClick={() => setActive(p.id)}>
                Open
              </Button>
            ) : null}
            <Button
              size="sm"
              disabled={sandbox}
              onClick={() => setRenaming({ id: p.id, name: p.name })}
              aria-label={`Rename ${p.name}`}
            >
              Rename
            </Button>
            <Button
              size="sm"
              disabled={sandbox}
              data-tour="duplicate-plan"
              onClick={() =>
                void duplicatePlan(p.id).then(() => notify(`Copied ${p.name}. The copy is now open.`, 'ok'))
              }
              aria-label={`Duplicate ${p.name}`}
            >
              Duplicate
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon="trash"
              disabled={sandbox}
              label={`Delete ${p.name}`}
              onClick={() => setDeleting(p.id)}
            />
          </li>
        ))}
      </ul>
      <Dialog
        open={!!renaming}
        title="Rename plan"
        onClose={() => setRenaming(null)}
        footer={
          <>
            <Button onClick={() => setRenaming(null)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!renaming?.name.trim()}
              onClick={() => {
                if (renaming)
                  void replacePlan(
                    {
                      ...plans[renaming.id],
                      name: renaming.name.trim(),
                      updatedAt: new Date().toISOString(),
                    },
                    { dirty: true },
                  );
                setRenaming(null);
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <TextField
          label="Plan name"
          value={renaming?.name ?? ''}
          onChange={(v) => setRenaming((r) => (r ? { ...r, name: v } : r))}
        />
      </Dialog>
      <Dialog
        open={!!deleting}
        title="Delete this plan?"
        onClose={() => setDeleting(null)}
        footer={
          <>
            <Button onClick={() => setDeleting(null)}>Keep it</Button>
            <Button
              variant="danger"
              onClick={() => {
                if (deleting) void deletePlan(deleting);
                setDeleting(null);
              }}
            >
              Delete plan
            </Button>
          </>
        }
      >
        <p>
          "{deleting ? plans[deleting]?.name : ''}" will be removed from this device
          {useStore.getState().settings.syncEnabled ? ' and from sync' : ''}. This cannot be undone. Export a
          backup first if you might want it again.
        </p>
      </Dialog>
    </Card>
  );
}

function BackupCard(): ReactNode {
  const plans = useStore((s) => s.plans);
  const last = useStore((s) => s.settings.lastBackupAt);
  const { importPlan, notify, setSettings } = useStore.getState();
  const [pass, setPass] = useState('');
  const [again, setAgain] = useState('');
  const [inPass, setInPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const list = Object.values(plans);
  const weak = pass.length > 0 && pass.length < 10;
  const doExport = async (): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      const name = await exportBackup(list, pass);
      setSettings({ lastBackupAt: new Date().toISOString() });
      setPass('');
      setAgain('');
      notify(`Backup saved as ${name}.`, 'ok');
    } catch (e) {
      setError(msg(e));
    }
    setBusy(false);
  };
  const doImport = async (): Promise<void> => {
    const f = file.current?.files?.[0];
    if (!f) {
      setError('Choose a backup file first.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const raw = await readBackup(f, inPass);
      for (const p of raw) await importPlan(p);
      setInPass('');
      if (file.current) file.current.value = '';
      setSettings({ onboarded: true });
      notify(`Imported ${raw.length} plan${raw.length === 1 ? '' : 's'}.`, 'ok');
    } catch (e) {
      setError(/decrypt|passphrase|auth/i.test(msg(e)) ? 'That passphrase does not open this file.' : msg(e));
    }
    setBusy(false);
  };
  return (
    <Card title="Backup" data-tour="settings-backup">
      <p className="lv-muted lv-small">
        Plans live in this browser's storage, which can be cleared. Keep an encrypted backup file somewhere
        safe. Last backup: {when(last)}.
      </p>
      {error ? (
        <div style={{ marginTop: 12 }}>
          <Notice tone="danger">{error}</Notice>
        </div>
      ) : null}
      <h3 style={{ marginTop: 16 }}>Export all plans</h3>
      <div className="form-grid" style={{ marginTop: 8 }} data-tour="export-backup">
        <Pass
          label="Backup passphrase"
          hint="At least 10 characters. There is no way to recover a forgotten passphrase."
          value={pass}
          onChange={setPass}
        />
        <Pass label="Passphrase again" value={again} onChange={setAgain} />
      </div>
      {weak ? (
        <p className="lv-small" style={{ color: 'var(--danger)', marginTop: 4 }}>
          Use at least 10 characters.
        </p>
      ) : null}
      <div style={{ marginTop: 12 }}>
        <Button
          icon="download"
          disabled={busy || list.length === 0 || pass.length < 10 || pass !== again}
          onClick={() => void doExport()}
        >
          Download encrypted backup
        </Button>
      </div>
      <h3 style={{ marginTop: 24 }}>Import a backup</h3>
      <div className="form-grid" style={{ marginTop: 8 }} data-tour="import-backup">
        <div className="lv-field">
          <label htmlFor="backup-file">Backup file</label>
          <input
            id="backup-file"
            ref={file}
            className="lv-input"
            type="file"
            accept=".longview,application/json"
          />
        </div>
        <Pass label="Its passphrase" value={inPass} onChange={setInPass} />
      </div>
      <div style={{ marginTop: 12 }}>
        <Button icon="upload" disabled={busy || !inPass} onClick={() => void doImport()}>
          Import
        </Button>
      </div>
    </Card>
  );
}

function SyncCard(): ReactNode {
  const sync = useSync();
  const url = useStore((s) => s.settings.syncUrl);
  const plans = useStore((s) => s.plans);
  const { setSettings, notify } = useStore.getState();
  const [mode, setMode] = useState<'setup' | 'connect' | 'recover'>('connect');
  const [pass, setPass] = useState('');
  const [again, setAgain] = useState('');
  const [recovery, setRecovery] = useState('');
  const [shown, setShown] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      await fn();
      setPass('');
      setAgain('');
      setRecovery('');
    } catch (e) {
      setError(msg(e));
    }
    setBusy(false);
  };
  const unlocked =
    sync.status === 'idle' ||
    sync.status === 'syncing' ||
    sync.status === 'offline' ||
    sync.status === 'error';
  const label: Record<typeof sync.status, string> = {
    off: 'Off',
    locked: 'Locked: enter your passphrase to sync',
    idle: 'Up to date',
    syncing: 'Syncing…',
    offline: 'Offline: changes are waiting',
    error: 'Could not sync',
  };
  const strong = pass.length >= 12 && pass === again;
  return (
    <Card title="Sync between devices" data-tour="settings-sync">
      <p className="lv-muted lv-small">
        Optional. Plans are encrypted on this device before upload, so the sync service only ever holds
        scrambled data. You need your own sync service address; see the setup guide in the project's docs
        folder.
      </p>
      <div className="lv-row" style={{ marginTop: 12 }} data-tour="sync-status" role="status">
        <Badge
          tone={
            sync.status === 'idle'
              ? 'ok'
              : sync.status === 'error'
                ? 'danger'
                : sync.status === 'off'
                  ? undefined
                  : 'warn'
          }
        >
          {label[sync.status]}
        </Badge>
        {unlocked ? <span className="lv-small lv-muted">Last synced {when(sync.lastSyncAt)}</span> : null}
        {sync.message ? <span className="lv-small">{sync.message}</span> : null}
      </div>
      {error ? (
        <div style={{ marginTop: 12 }}>
          <Notice tone="danger">{error}</Notice>
        </div>
      ) : null}
      {sync.conflicts.map((c) => (
        <div key={c.planId} style={{ marginTop: 12 }}>
          <Notice tone="warn">
            <div className="lv-stack" style={{ gap: 8 }}>
              <span>
                <strong>{c.planName}</strong>{' '}
                {c.deletedOnServer
                  ? 'was deleted on another device'
                  : `was also changed on another device (${when(c.serverUpdatedAt)})`}
                . A snapshot of this device's version is kept whichever you choose.
              </span>
              <span className="lv-row">
                <Button size="sm" onClick={() => void run(() => resolveConflict(c, 'mine'))}>
                  Keep this device's
                </Button>
                <Button size="sm" onClick={() => void run(() => resolveConflict(c, 'theirs'))}>
                  {c.deletedOnServer ? 'Delete here too' : "Use the other device's"}
                </Button>
                {plans[c.planId] ? (
                  <Button size="sm" onClick={() => void run(() => resolveConflict(c, 'both'))}>
                    Keep both
                  </Button>
                ) : null}
              </span>
            </div>
          </Notice>
        </div>
      ))}
      <div style={{ marginTop: 16, maxWidth: 520 }}>
        <TextField
          label="Sync service address"
          hint="For example https://longview-sync.your-name.workers.dev"
          type="url"
          value={url}
          onChange={(v) => setSettings({ syncUrl: v })}
          data-tour="sync-url"
        />
      </div>
      {unlocked ? (
        <div className="lv-stack" style={{ marginTop: 16 }}>
          <div className="lv-row">
            <Button
              icon="cloud"
              disabled={busy || sync.status === 'syncing'}
              onClick={() => void syncNow(true)}
            >
              Sync now
            </Button>
            <Button icon="lock" onClick={lockSync}>
              Lock
            </Button>
            <Button onClick={() => setChanging((v) => !v)}>Change passphrase</Button>
            <Button
              variant="ghost"
              onClick={() => void turnOffSync().then(() => notify('Sync is off. Plans stay on this device.'))}
            >
              Turn off sync on this device
            </Button>
          </div>
          {changing ? (
            <>
              <div className="form-grid">
                <Pass label="New passphrase" hint="At least 12 characters." value={pass} onChange={setPass} />
                <Pass label="New passphrase again" value={again} onChange={setAgain} />
              </div>
              <div>
                <Button
                  variant="primary"
                  disabled={busy || !strong}
                  onClick={() =>
                    void run(async () => {
                      await changeSyncPassphrase(pass);
                      setChanging(false);
                      notify('Passphrase changed. Other devices will ask for the new one.', 'ok');
                    })
                  }
                >
                  Save new passphrase
                </Button>
              </div>
            </>
          ) : null}
        </div>
      ) : (
        <div className="lv-stack" style={{ marginTop: 16 }}>
          <div style={{ maxWidth: 360 }}>
            <SelectField
              label="What do you want to do?"
              value={mode}
              onChange={setMode}
              options={[
                {
                  value: 'connect',
                  label:
                    sync.status === 'locked' ? 'Unlock with my passphrase' : 'Connect this device to my sync',
                },
                { value: 'setup', label: 'Set up sync for the first time' },
                { value: 'recover', label: 'I forgot my passphrase' },
              ]}
            />
          </div>
          {mode === 'recover' ? (
            <TextField
              label="Recovery key"
              hint="The key shown when sync was first set up."
              value={recovery}
              onChange={setRecovery}
            />
          ) : null}
          <div className="form-grid">
            <Pass
              label={mode === 'connect' ? 'Passphrase' : 'New passphrase'}
              hint={
                mode === 'connect'
                  ? undefined
                  : 'At least 12 characters. It encrypts your plans and is never sent anywhere.'
              }
              value={pass}
              onChange={setPass}
            />
            {mode !== 'connect' ? <Pass label="Passphrase again" value={again} onChange={setAgain} /> : null}
          </div>
          <div>
            {mode === 'connect' ? (
              <Button
                variant="primary"
                disabled={busy || !pass || !url}
                onClick={() => void run(() => unlockSync(pass))}
              >
                {sync.status === 'locked' ? 'Unlock' : 'Connect'}
              </Button>
            ) : null}
            {mode === 'setup' ? (
              <Button
                variant="primary"
                disabled={busy || !strong || !url}
                onClick={() =>
                  void run(async () => {
                    const r = await setUpSync(pass);
                    setShown(r.recoveryKey);
                  })
                }
              >
                Set up sync
              </Button>
            ) : null}
            {mode === 'recover' ? (
              <Button
                variant="primary"
                disabled={busy || !strong || !recovery || !url}
                onClick={() =>
                  void run(async () => {
                    await recoverSync(recovery.trim(), pass);
                    notify('Passphrase reset. Sync is unlocked.', 'ok');
                  })
                }
              >
                Reset passphrase
              </Button>
            ) : null}
          </div>
        </div>
      )}
      <Dialog
        open={!!shown}
        title="Write down your recovery key"
        onClose={() => setShown(null)}
        footer={
          <Button variant="primary" onClick={() => setShown(null)}>
            I have saved it
          </Button>
        }
      >
        <div className="lv-stack">
          <p>
            This key is shown once. It is the only way back in if you forget the passphrase. If you lose both,
            synced plans cannot be recovered by anyone.
          </p>
          <p
            className="lv-num"
            style={{
              fontSize: 'var(--text-md)',
              wordBreak: 'break-all',
              background: 'var(--surface-2)',
              padding: 12,
              borderRadius: 8,
            }}
            data-testid="recovery-key"
          >
            {shown}
          </p>
          <div>
            <Button
              size="sm"
              icon="copy"
              onClick={() =>
                void navigator.clipboard?.writeText(shown ?? '').then(() => notify('Recovery key copied.'))
              }
            >
              Copy
            </Button>
          </div>
        </div>
      </Dialog>
    </Card>
  );
}

function DeviceCard(): ReactNode {
  const { notify } = useStore.getState();
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [usage, setUsage] = useState('');
  useEffect(() => {
    void navigator.storage?.persisted?.().then(setPersisted);
    void navigator.storage
      ?.estimate?.()
      .then((e) => setUsage(e.usage ? `${(e.usage / 1024 / 1024).toFixed(1)} MB used` : ''));
  }, []);
  return (
    <Card title="This device" data-tour="settings-data">
      <dl className="lv-explain" style={{ maxWidth: 520 }}>
        <dt>App version</dt>
        <dd style={{ textAlign: 'right' }}>{__APP_VERSION__}</dd>
        <dt>Data release</dt>
        <dd style={{ textAlign: 'right' }}>{DATA_RELEASE}</dd>
        <dt>Storage</dt>
        <dd style={{ textAlign: 'right' }}>
          {persisted
            ? 'Protected from automatic clearing'
            : 'May be cleared by the browser when space is short'}
          {usage ? ` · ${usage}` : ''}
        </dd>
      </dl>
      <div className="lv-row" style={{ marginTop: 12 }}>
        {persisted === false ? (
          <Button
            onClick={() =>
              void navigator.storage.persist().then((ok) => {
                setPersisted(ok);
                notify(
                  ok
                    ? 'Storage is now protected.'
                    : 'The browser declined. Installing the app or keeping a backup helps.',
                  ok ? 'ok' : 'warn',
                );
              })
            }
          >
            Ask the browser to protect storage
          </Button>
        ) : null}
        <Button
          data-tour="error-log"
          onClick={() =>
            void errorLog().then((log) =>
              download(
                'longview-error-log.json',
                JSON.stringify(
                  { app: __APP_VERSION__, data: DATA_RELEASE, userAgent: navigator.userAgent, log },
                  null,
                  2,
                ),
                'application/json',
              ),
            )
          }
        >
          Download error log
        </Button>
        <Link className="lv-btn" to="/help/methods">
          Data sources
        </Link>
      </div>
      <p className="lv-small lv-muted" style={{ marginTop: 12 }}>
        The error log stays on this device and holds no plan data. Nothing is sent anywhere; download it only
        if you want to report a problem.
      </p>
    </Card>
  );
}

export function SettingsPage(): ReactNode {
  const theme = useStore((s) => s.settings.theme);
  const { setSettings } = useStore.getState();
  return (
    <>
      <PageHead title="Settings" intro="Appearance, your plans, backups, sync and this device." />
      <Card title="Appearance" data-tour="settings-theme">
        <div style={{ maxWidth: 320 }}>
          <SelectField<Theme>
            label="Theme"
            value={theme}
            onChange={(v) => setSettings({ theme: v })}
            options={[
              { value: 'system', label: 'Match my device' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
          />
        </div>
      </Card>
      <PlansCard />
      <BackupCard />
      <SyncCard />
      <DeviceCard />
    </>
  );
}
