/**
 * What cloud saving is doing right now. Kept apart from sync.ts so the header can show it on every screen without
 * loading the sync and encryption code.
 */
import { create } from 'zustand';

export interface SyncConflict {
  planId: string;
  planName: string;
  serverVersion: number;
  serverUpdatedAt: string | null;
  deletedOnServer: boolean;
  deletedLocally?: boolean;
}

export interface SyncState {
  status: 'off' | 'locked' | 'idle' | 'syncing' | 'offline' | 'error';
  message: string;
  lastSyncAt: string | null;
  conflicts: SyncConflict[];
  hasKeys: boolean;
}

export const useSync = create<SyncState>(() => ({
  status: 'off',
  message: '',
  lastSyncAt: null,
  conflicts: [],
  hasKeys: false,
}));

/** Save a small text file to the person's downloads (no encryption code needed). */
export function saveTextFile(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
