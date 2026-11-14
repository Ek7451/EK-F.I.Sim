/**
 * The app moved from longview-planner.pages.dev to longviewplanner.app. A browser keeps saved plans per address, so
 * plans made at the old address without an account would be left behind. The old address hands them to the new one
 * inside the link itself: compressed into the part after `#`, which browsers never send to any server. The new
 * address imports them and wipes them from the address bar at once.
 */
import type { Plan } from '@fisim/engine';

export const HOME = 'https://longviewplanner.app';
export const HOME_NAME = 'longviewplanner.app';
const OLD_HOST = 'longview-planner.pages.dev';
const KEY = 'move=';
/** Remembered at the old address once its plans have moved, so later visits go straight to the new one. */
const MOVED = 'lv-moved-home';
/** Links get unreliable well before this; a larger set is moved with a backup file instead. */
const MAX_LINK = 1_500_000;

export const onOldHome = (): boolean => window.location.hostname === OLD_HOST;

export function alreadyMoved(): boolean {
  try {
    return localStorage.getItem(MOVED) === '1';
  } catch {
    return false;
  }
}

/** Open the same screen at the new address. */
export function goHome(): void {
  window.location.replace(`${HOME}${window.location.pathname}${window.location.search}`);
}

const toBase64Url = (bytes: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromBase64Url = (s: string): Uint8Array => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
};
type Codec = CompressionStream | DecompressionStream;
const pipe = async (bytes: Uint8Array, codec: Codec): Promise<Uint8Array> =>
  new Uint8Array(await new Response(new Blob([bytes.slice()]).stream().pipeThrough(codec)).arrayBuffer());

export async function packPlans(plans: Plan[]): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify({ kind: 'longview-move', plans }));
  return toBase64Url(await pipe(json, new CompressionStream('gzip')));
}

export async function unpackPlans(packed: string): Promise<unknown[]> {
  const json = await pipe(fromBase64Url(packed), new DecompressionStream('gzip'));
  const data = JSON.parse(new TextDecoder().decode(json)) as { kind?: string; plans?: unknown[] };
  if (data?.kind !== 'longview-move' || !Array.isArray(data.plans)) throw new Error('Not a plan hand-over.');
  return data.plans;
}

/**
 * Old address: send the plans to the new one. Returns false (and goes nowhere) when they are too large for a link;
 * the caller then suggests a backup file.
 */
export async function movePlansHome(plans: Plan[]): Promise<boolean> {
  const packed = await packPlans(plans);
  if (packed.length > MAX_LINK) return false;
  try {
    localStorage.setItem(MOVED, '1');
  } catch {
    // Without storage the next visit simply offers the move again.
  }
  window.location.replace(`${HOME}/#${KEY}${packed}`);
  return true;
}

/**
 * New address: take in plans handed over in the link, after wiping them from the address bar. Returns how many
 * arrived; plans that fail to load are skipped and counted in `failed`.
 */
export async function receivePlans(
  importPlan: (raw: unknown) => Promise<string>,
): Promise<{ moved: number; failed: number }> {
  const hash = window.location.hash;
  if (!hash.startsWith(`#${KEY}`)) return { moved: 0, failed: 0 };
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
  let raw: unknown[];
  try {
    raw = await unpackPlans(hash.slice(1 + KEY.length));
  } catch {
    return { moved: 0, failed: 1 };
  }
  let moved = 0;
  let failed = 0;
  for (const p of raw) {
    try {
      await importPlan(p);
      moved++;
    } catch {
      failed++;
    }
  }
  return { moved, failed };
}
