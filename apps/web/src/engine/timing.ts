import type { Plan } from '@fisim/engine';

/** User Timing entries are local diagnostics, never persisted or sent anywhere. */
const started = new WeakMap<Plan, number>();
export function markPreview(plan: Plan, start: number): void {
  started.set(plan, start);
}
export function measurePreviewPaint(plan: Plan): void {
  const start = started.get(plan);
  if (start === undefined || typeof requestAnimationFrame === 'undefined') return;
  started.delete(plan);
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      performance.measure('longview:input-to-result', { start, end: performance.now() });
    }),
  );
}
