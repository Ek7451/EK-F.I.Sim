import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { LoadedPlan, Plan } from '@fisim/engine';
import { loadEngine } from '../engine/load';
import { importRecords, type ImportRecord } from '../state/db';
import { flushLocalWrites, useStore } from '../state/store';

interface Entry {
  plan: Plan;
  revision: string | null;
  original?: unknown;
  recovering: boolean;
  removedSteps?: LoadedPlan['removedSurplusSteps'];
  action: 'import' | 'copy' | 'replace' | 'skip';
}

export default function ImportReview({
  raw,
  recovery = false,
  onClose,
}: {
  raw: unknown[];
  recovery?: boolean;
  onClose(saved?: boolean): void;
}): ReactNode {
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
          const loaded = loadPlan(item, recovery ? { reviewRecovery: true } : undefined);
          if (!loaded.plan) throw new Error(loaded.error ?? 'Update Longview to restore this backup.');
          const p = loaded.plan;
          if (ids.has(p.id)) throw new Error('This transfer contains duplicate plan IDs.');
          ids.add(p.id);
          const quarantined = recovery ? state.meta[p.id]?.recoveryRevision : undefined;
          const revision = state.plans[p.id]?.updatedAt ?? quarantined ?? null;
          return {
            plan: p,
            revision,
            original: loaded.migrated || loaded.removedSurplusSteps ? item : undefined,
            removedSteps: loaded.removedSurplusSteps,
            recovering: quarantined !== undefined,
            action: quarantined !== undefined ? 'replace' : state.meta[p.id] ? 'copy' : 'import',
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
  }, [raw, recovery]);
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
        const revision =
          state.plans[entry.plan.id]?.updatedAt ??
          (entry.recovering ? state.meta[entry.plan.id]?.recoveryRevision : undefined) ??
          null;
        if (!copy && revision !== entry.revision)
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
      useStore
        .getState()
        .notify(
          recovery
            ? 'Plan restored. Review your surplus priorities in Strategy.'
            : `Imported ${records.length} plans.`,
          'ok',
        );
      onClose(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed. Reopen the backup to retry.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <section className="lv-card" aria-label={recovery ? 'Review recovery' : 'Review plan import'}>
      <h2>{recovery ? 'Review recovery' : 'Review plan import'}</h2>
      <p>
        {cloud
          ? 'Confirmed plans will be encrypted and saved to your signed-in account.'
          : 'Confirmed plans will be saved in this browser.'}
      </p>
      {error && (
        <p role="alert">
          {recovery && 'Restore could not finish. Your original is safe. '}
          {error}
        </p>
      )}
      {entries.map((e, i) => (
        <div key={e.plan.id}>
          {e.removedSteps && (
            <>
              <p>
                These surplus priorities point to missing accounts. Confirming removes the listed steps. You
                can choose new destinations in Strategy.
              </p>
              <ul>
                {e.removedSteps.map((step) => (
                  <li key={step.position}>
                    Step {step.position} · {step.accountId}
                  </li>
                ))}
              </ul>
            </>
          )}
          {e.recovering && <p>Restoring this plan saves a snapshot of the original on this device.</p>}
          <label className="lv-field">
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
              {e.revision && (
                <option value="replace">
                  {e.recovering ? 'Restore the saved plan' : 'Replace the existing plan'}
                </option>
              )}
              <option value="skip">Skip</option>
            </select>
          </label>
        </div>
      ))}
      <button disabled={busy || !entries.some((e) => e.action !== 'skip')} onClick={() => void commit()}>
        {recovery ? 'Confirm restore' : 'Confirm import'}
      </button>
      <button disabled={busy} onClick={() => onClose()}>
        {recovery ? 'Cancel restore' : 'Cancel import'}
      </button>
    </section>
  );
}
