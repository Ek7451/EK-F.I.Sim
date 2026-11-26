/**
 * The app moved from longview-planner.pages.dev to longviewplanner.pages.dev. A browser keeps saved plans per address, so
 * plans made at the old address without an account would be left behind. The old address hands them to the new one
 * inside the link itself: compressed into the part after `#`, which browsers never send to any server. The new
 * address imports them and wipes them from the address bar at once.
 */
import type { Plan } from '@fisim/engine';

export const HOME = 'https://longviewplanner.pages.dev';
export const HOME_NAME = 'longviewplanner.pages.dev';
const OLD_HOST = 'longview-planner.pages.dev';
const KEY = 'move=';
/** Links get unreliable well before this; a larger set is moved with a backup file instead. */
const MAX_LINK = 1_500_000;

export const onOldHome = (): boolean => window.location.hostname === OLD_HOST;

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
  if (packed.length > MAX_LINK) throw new Error('Transfer link is too large.');
  const stream = new Blob([fromBase64Url(packed).slice()])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'));
  const reader = stream.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let length = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    length += part.value.length;
    if (length > 16 * 1024 * 1024) {
      await reader.cancel();
      throw new Error('Transfer exceeds the 16 MiB import limit.');
    }
    chunks.push(part.value.slice());
  }
  const json = await new Blob(chunks).arrayBuffer();
  const data = JSON.parse(new TextDecoder().decode(json)) as { kind?: string; plans?: unknown[] };
  if (data?.kind !== 'longview-move' || !Array.isArray(data.plans)) throw new Error('Not a plan hand-over.');
  if (!data.plans.length || data.plans.length > 200)
    throw new Error('A transfer can contain 1 to 200 plans.');
  return data.plans;
}

/**
 * Old address: send the plans to the new one. Returns false (and goes nowhere) when they are too large for a link;
 * the caller then suggests a backup file.
 */
export async function movePlansHome(plans: Plan[]): Promise<boolean> {
  const packed = await packPlans(plans);
  if (packed.length > MAX_LINK) return false;
  window.location.replace(`${HOME}/#${KEY}${packed}`);
  return true;
}

/** Read once before rendering. Reviewing, canceling and decoding never change saved plans. */
export function takeTransfer(): string | null {
  const hash = window.location.hash;
  if (!hash.startsWith('#' + KEY)) return null;
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  return hash.slice(1 + KEY.length);
}
