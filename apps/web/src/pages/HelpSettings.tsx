import { DATA_RELEASE, type DatasetInfo } from '@fisim/data';
import { methodology, type MethodEntry } from '@fisim/engine';
import { Badge, Button, Card, Dialog, Icon, Notice, Segmented, SelectField, TextField } from '@fisim/ui';
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
import { CloudAccountCard } from './CloudAccountCard';
import './help-settings.css';
import { publicCloud } from '../lib/cloud-account';

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
      <article
        key={t.id}
        className="hs-tour"
        data-tour="tour-tile"
        data-tour-id={t.id}
        data-state={p?.completed ? 'done' : started ? 'started' : 'new'}
        title={[t.summary, missing.length ? `Easier after: ${missing.join(', ')}.` : '']
          .filter(Boolean)
          .join(' ')}
      >
        <span className="hs-tour-mark" aria-hidden="true">
          {p?.completed ? <Icon name="check" size={14} /> : t.id.replace(/^\D+/, '')}
        </span>
        <div className="hs-tour-text">
          <h3>
            {t.title}
            <span className="hs-tour-meta">
              {t.minutes} min · {t.steps.length} steps
              {p?.completed ? ' · completed' : started ? ` · step ${p.step + 1} of ${t.steps.length}` : ''}
            </span>
          </h3>
          <p>{t.summary}</p>
        </div>
        <div className="hs-tour-actions">
          <Button
            size="sm"
            variant={p?.completed ? 'default' : 'primary'}
            onClick={() => tour.start(t.id, { restart: !started })}
            aria-label={`${p?.completed ? 'Replay' : started ? 'Resume' : 'Start'} the tour: ${t.title}`}
          >
            {p?.completed ? 'Replay' : started ? 'Resume' : 'Start'}
          </Button>
          {hasPlan ? (
            <Button
              size="sm"
              variant="ghost"
              icon="user"
              onClick={() => tour.start(t.id, { ownPlan: true, restart: true })}
              label={`On my plan: run the tour ${t.title} with changes switched off`}
            />
          ) : null}
        </div>
      </article>
    );
  };
  return (
    <>
      <PageHead
        title="Guided tours"
        intro="Short walkthroughs of each part of the app. A tour runs on a sample plan, so nothing in it changes your own plans."
      />
      <section className="hs-band lv-night" data-tour="tours-progress">
        <div className="hs-band-main">
          <strong>
            {count} of {TOURS.length} tours completed
          </strong>
          <div
            className="lv-progress"
            role="progressbar"
            aria-label="Tours completed"
            aria-valuemin={0}
            aria-valuemax={TOURS.length}
            aria-valuenow={count}
          >
            <div style={{ width: `${(count / TOURS.length) * 100}%` }} />
          </div>
        </div>
        <span className="lv-row">
          {basic.every(done) ? <Badge tone="ok">Basics complete</Badge> : null}
          {advanced.every(done) ? <Badge tone="ok">Advanced complete</Badge> : null}
        </span>
        <p className="hs-band-note">
          Next and Back (or the arrow keys) move between steps; Esc leaves and your place is saved. The person
          button runs a tour on your own plan, with changes switched off.
        </p>
      </section>
      <div className="hs-tours" data-tour="tours-catalog">
        <Card title={`Basics · ${basic.length} tours`}>
          <div className="hs-tour-list">{basic.map(tile)}</div>
        </Card>
        <Card title={`Going further · ${advanced.length} tours`}>
          <div className="hs-tour-list" data-cols="2">
            {advanced.map(tile)}
          </div>
        </Card>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ how this is calculated (RPT-06)

export function MethodsPage(): ReactNode {
  const [entries, setEntries] = useState<MethodEntry[] | null>(null);
  const [datasets, setDatasets] = useState<DatasetInfo[]>([]);
  const [query, setQuery] = useState('');
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
    // A link to one method opens it and lands on its title.
    if (el instanceof HTMLDetailsElement) el.open = true;
    el?.scrollIntoView({ block: 'start' });
    el?.querySelector<HTMLElement>('summary')?.focus({ preventScroll: true });
  }, [entries, loc.hash]);
  const projected = datasets.filter((d) => d.header.status !== 'enacted').length;
  const q = query.trim().toLowerCase();
  const shown = (entries ?? []).filter(
    (m) => !q || `${m.title} ${m.summary} ${m.formula}`.toLowerCase().includes(q),
  );
  return (
    <>
      <PageHead
        title="How this is calculated"
        intro="Each method the app uses, in plain words, with its formula and the published source of its figures. Every result is an estimate built from these methods and your inputs."
      />
      <section className="hs-band lv-night" data-tour="data-status">
        <div className="hs-band-main">
          <strong>Data release {DATA_RELEASE}</strong>
          <span className="hs-band-sub">
            {datasets.length} datasets, {projected} of them projected or estimated
          </span>
        </div>
        <p className="hs-band-note">
          <Badge tone="ok">Enacted</Badge> figures come from published law and official tables.{' '}
          <Badge tone="warn">Projected</Badge> figures are the latest enacted values raised with inflation,
          for years not yet published. Screens that rely on them say so.
        </p>
      </section>
      <div className="hs-methods">
        <Card
          title={entries ? `Methods · ${shown.length}${q ? ` of ${entries.length}` : ''}` : 'Methods'}
          actions={
            <input
              className="lv-input hs-search"
              type="search"
              placeholder="Find a method"
              aria-label="Find a method"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          }
          data-tour="methods-list"
        >
          {!entries ? (
            <p className="lv-muted">Loading…</p>
          ) : (
            <div className="hs-method-list">
              {shown.map((m) => (
                <details
                  key={m.id}
                  id={m.id}
                  className="hs-method"
                  data-tour={entries.indexOf(m) === 2 ? 'method-entry' : undefined}
                >
                  <summary>
                    <strong>{m.title}</strong>
                    <span>{m.summary}</span>
                  </summary>
                  <div className="hs-method-body">
                    <p>{m.summary}</p>
                    <code>{m.formula}</code>
                    {m.sources.map((s) => (
                      <p key={s.label} className="lv-small lv-muted">
                        {s.label}: {s.header.publisher}, retrieved {s.header.retrieved}.{' '}
                        <Badge tone={s.header.status === 'enacted' ? 'ok' : 'warn'}>{s.header.status}</Badge>{' '}
                        {s.header.lawRefs.length
                          ? `Based on ${s.header.lawRefs.slice(0, 3).join('; ')}.`
                          : ''}
                      </p>
                    ))}
                    <p className="lv-small lv-muted">Features: {m.featureIds.join(', ')}</p>
                  </div>
                </details>
              ))}
              {shown.length === 0 ? <p className="lv-muted">No method matches that.</p> : null}
            </div>
          )}
        </Card>
        <Card title={`Datasets · ${datasets.length}`} data-tour="data-sources">
          <div
            className="lv-table-wrap hs-datasets"
            tabIndex={0}
            role="region"
            aria-label="Datasets in this release"
          >
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
            Marketplace premiums by county load only for the states in your plan and are not listed here.
          </p>
        </Card>
      </div>
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
        <Link className="lv-btn" data-size="sm" data-variant="primary" to="/start">
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
              variant="ghost"
              icon="edit"
              disabled={sandbox}
              label={`Rename ${p.name}`}
              onClick={() => setRenaming({ id: p.id, name: p.name })}
            />
            <Button
              size="sm"
              variant="ghost"
              icon="copy"
              disabled={sandbox}
              data-tour="duplicate-plan"
              label={`Duplicate ${p.name}`}
              onClick={() =>
                void duplicatePlan(p.id).then(() => notify(`Copied ${p.name}. The copy is now open.`, 'ok'))
              }
            />
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
    <Card
      title="Backup"
      data-tour="settings-backup"
      actions={<span className="lv-small lv-muted">Last backup: {when(last)}</span>}
    >
      <p className="lv-muted lv-small">
        Plans live in this browser, which can clear its storage. Keep an encrypted backup file somewhere safe.
      </p>
      {error ? (
        <div style={{ marginTop: 8 }}>
          <Notice tone="danger">{error}</Notice>
        </div>
      ) : null}
      <div className="hs-split">
        <section data-tour="export-backup">
          <h3>Export all plans</h3>
          <div className="form-grid">
            <Pass
              label="Backup passphrase"
              hint="At least 10 characters. A forgotten passphrase cannot be recovered."
              value={pass}
              onChange={setPass}
            />
            <Pass label="Passphrase again" value={again} onChange={setAgain} />
          </div>
          {weak ? <p className="field-error">Use at least 10 characters.</p> : null}
          <Button
            icon="download"
            disabled={busy || list.length === 0 || pass.length < 10 || pass !== again}
            onClick={() => void doExport()}
          >
            Download encrypted backup
          </Button>
        </section>
        <section data-tour="import-backup">
          <h3>Import a backup</h3>
          <div className="form-grid">
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
          <Button icon="upload" disabled={busy || !inPass} onClick={() => void doImport()}>
            Import
          </Button>
        </section>
      </div>
    </Card>
  );
}

/** Self-hosted builds only: sync to your own service with its own passphrase. The public site uses the Account card. */
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
  if (publicCloud) return null;
  return (
    <Card title="Sync between devices" data-tour="settings-sync">
      <p className="lv-muted lv-small">
        Optional. Plans are encrypted on this device before upload, so the service only ever holds scrambled
        data. You need your own sync service address; see the setup guide in the project’s docs folder.
      </p>
      <div className="lv-row" style={{ marginTop: 8 }} data-tour="sync-status" role="status">
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
                {c.deletedLocally
                  ? 'was deleted here but changed on another device'
                  : c.deletedOnServer
                    ? 'was deleted on another device'
                    : `was also changed on another device (${when(c.serverUpdatedAt)})`}
                . A snapshot of this device's version is kept whichever you choose.
              </span>
              <span className="lv-row">
                <Button size="sm" onClick={() => void run(() => resolveConflict(c, 'mine'))}>
                  {c.deletedLocally ? 'Delete the cloud copy' : "Keep this device's"}
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
      {/* The public site never reaches here; this is the self-hosted service address. */}
      {url !== '/api' ? (
        <div style={{ marginTop: 10, maxWidth: 520 }}>
          <TextField
            label="Sync service address"
            hint="For example https://longview-sync.your-name.workers.dev"
            type="url"
            value={url}
            onChange={(v) => setSettings({ syncUrl: v })}
            data-tour="sync-url"
          />
        </div>
      ) : null}
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
          <Segmented
            label="What do you want to do?"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'connect', label: sync.status === 'locked' ? 'Unlock' : 'Connect this device' },
              { value: 'setup', label: 'Set up for the first time' },
              { value: 'recover', label: 'Forgot passphrase' },
            ]}
          />
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
        title="Save your vault recovery key"
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
  const theme = useStore((st) => st.settings.theme);
  const { notify, setSettings } = useStore.getState();
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
      <div className="hs-device">
        <div data-tour="settings-theme">
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
        <dl className="lv-facts">
          <div>
            <dt>App version</dt>
            <dd>{__APP_VERSION__}</dd>
          </div>
          <div>
            <dt>Data release</dt>
            <dd>{DATA_RELEASE}</dd>
          </div>
          <div>
            <dt>Storage</dt>
            <dd>
              {usage ? `${usage} · ` : ''}
              {persisted ? 'protected' : 'the browser may clear it'}
            </dd>
          </div>
        </dl>
      </div>
      <div className="lv-row" style={{ marginTop: 10 }}>
        {persisted === false ? (
          <Button
            size="sm"
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
            Protect storage
          </Button>
        ) : null}
        <Button
          size="sm"
          data-tour="error-log"
          title="Stays on this device and holds no plan data. Download it only to report a problem."
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
        <Link className="lv-btn" data-size="sm" to="/help/methods">
          Data sources
        </Link>
      </div>
      <p className="lv-small lv-muted" style={{ marginTop: 8 }}>
        The error log stays on this device and holds no plan data. Nothing is sent anywhere.
      </p>
    </Card>
  );
}

export function SettingsPage(): ReactNode {
  return (
    <>
      <PageHead
        title="Settings"
        intro={
          publicCloud
            ? 'Your account, plans, backups and this device.'
            : 'Your plans, backups, sync and this device.'
        }
      />
      <div className="hs-settings">
        <div className="hs-col">
          <PlansCard />
          <BackupCard />
        </div>
        <div className="hs-col">
          <CloudAccountCard />
          <DeviceCard />
          <SyncCard />
        </div>
      </div>
    </>
  );
}
