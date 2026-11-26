import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Plan } from '@fisim/engine';
import { loadEngine } from '../engine/load';
import { importRecords, type ImportRecord } from '../state/db';
import { flushLocalWrites, useStore } from '../state/store';

interface Entry {
  plan: Plan;
  revision: string | null;
  original?: unknown;
  action: 'import' | 'copy' | 'replace' | 'skip';
}

export default function ImportReview({ raw, onClose }: { raw: unknown[]; onClose(): void }): ReactNode {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const cloud = useStore((s) => s.settings.syncEnabled);
  useEffect(() => {
    let current = true;
    void loadEngine()
      .then(({ loadPlan }) => {
        if (!raw.length || raw.length > 200) throw new Error('Select a backup containing 1 to 200 plans.');
        const ids = new Set<string>();
        const state = useStore.getState();
        const list = raw.map((item): Entry => {
          const loaded = loadPlan(item);
          if (!loaded.plan) throw new Error(loaded.error ?? 'Update Longview to restore this backup.');
          const p = loaded.plan;
          if (ids.has(p.id)) throw new Error('This transfer contains duplicate plan IDs.');
          ids.add(p.id);
          const revision = state.plans[p.id]?.updatedAt ?? null;
          return {
            plan: p,
            revision,
            original: loaded.migrated ? item : undefined,
            action: state.meta[p.id] ? 'copy' : 'import',
          };
        });
        if (current) setEntries(list);
      })
      .catch((e) => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
    };
  }, [raw]);
  const commit = async (): Promise<void> => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      if (!(await flushLocalWrites())) throw new Error('Save pending edits before importing.');
      const records: ImportRecord[] = [];
      const added: Record<string, Plan> = {};
      for (const entry of entries) {
        if (entry.action === 'skip') continue;
        const state = useStore.getState();
        const copy = entry.action === 'copy';
        if (!copy && (state.plans[entry.plan.id]?.updatedAt ?? null) !== entry.revision)
          throw new Error('A local plan changed. Reopen the import to review it.');
        const p = {
          ...entry.plan,
          ...(copy ? { id: crypto.randomUUID(), name: entry.plan.name + ' (copy)' } : {}),
          updatedAt: new Date().toISOString(),
        };
        added[p.id] = p;
        records.push({
          record: {
            id: p.id,
            plan: p,
            updatedAt: p.updatedAt,
            syncVersion: copy ? 0 : (state.meta[p.id]?.syncVersion ?? 0),
            dirty: true,
          },
          expectedRevision: copy ? null : entry.revision,
          original: entry.original,
        });
      }
      await importRecords(records);
      useStore.setState((s) => {
        const meta = { ...s.meta },
          history = { ...s.history };
        for (const { record } of records) {
          meta[record.id] = { syncVersion: record.syncVersion, dirty: true, readOnly: false };
          history[record.id] = { undo: [], redo: [] };
        }
        return { plans: { ...s.plans, ...added }, meta, history };
      });
      if (records.length)
        useStore.getState().setSettings({ activePlanId: records[0].record.id, onboarded: true });
      useStore.getState().notify(`Imported ${records.length} plans.`, 'ok');
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed. Reopen the backup to retry.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <section className="lv-card" aria-label="Review plan import">
      <h2>Review plan import</h2>
      <p>
        {cloud
          ? 'Confirmed plans will be encrypted and saved to your signed-in account.'
          : 'Confirmed plans will be saved in this browser.'}
      </p>
      {error && <p role="alert">{error}</p>}
      {entries.map((e, i) => (
        <label className="lv-field" key={e.plan.id}>
          {e.plan.name} · incoming revision {e.plan.updatedAt}
          {e.revision && ` · current revision ${e.revision}`}
          <select
            disabled={busy}
            value={e.action}
            onChange={(ev) => {
              const action = ev.target.value as Entry['action'];
              setEntries((rows) => rows.map((r, j) => (i === j ? { ...r, action } : r)));
            }}
          >
            {!e.revision && !useStore.getState().meta[e.plan.id] && <option value="import">Import</option>}
            <option value="copy">Import as a new copy</option>
            {e.revision && <option value="replace">Replace the existing plan</option>}
            <option value="skip">Skip</option>
          </select>
        </label>
      ))}
      <button disabled={busy || !entries.some((e) => e.action !== 'skip')} onClick={() => void commit()}>
        Confirm import
      </button>
      <button disabled={busy} onClick={onClose}>
        Cancel import
      </button>
    </section>
  );
}
