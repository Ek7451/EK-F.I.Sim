/**
 * Moving this page onto a new version of the app (plan 14.3).
 *
 * A new version arrives as a service worker that installs and then waits. Applying it means telling that worker to
 * take over and reloading the page under it. The stock helper reloads only when the browser reports the hand-over
 * in one particular way, which left "Reload now" doing nothing in some states (a page the old worker does not
 * control, a worker another tab already activated, a browser that never reports the change). Here every path ends
 * in a reload onto the new version.
 */

/** Activate the waiting version and reload onto it. */
export async function applyUpdate(): Promise<void> {
  const [{ flushLocalWrites, useStore }, { hasPendingDrafts }] = await Promise.all([
    import('../state/store'),
    import('../state/draft'),
  ]);
  const ready = () =>
    useStore.getState().ready &&
    !hasPendingDrafts() &&
    !document.querySelector(
      '[aria-modal="true"],dialog[open],.acct-code,form.acct-form,[aria-label="Review plan import"]',
    );
  if (!ready() || !(await flushLocalWrites()) || !ready()) {
    useStore
      .getState()
      .notify('Finish open edits and account steps, then save your plans before updating.', 'warn');
    return;
  }
  let reloaded = false;
  const reload = (): void => {
    if (reloaded) return;
    reloaded = true;
    void flushLocalWrites().then((saved) => {
      if (saved && ready()) window.location.reload();
      else useStore.getState().notify('The update is ready. Finish your edits before reloading.', 'warn');
    });
  };
  if (!('serviceWorker' in navigator)) return reload();
  let reg: ServiceWorkerRegistration | undefined;
  try {
    reg = await navigator.serviceWorker.getRegistration();
  } catch {
    return reload();
  }
  const waiting = reg?.waiting;
  // Nothing waiting: another tab already switched, so the new version is one reload away.
  if (!reg || !waiting) return reload();

  // The usual signal: this page's controlling worker changes.
  navigator.serviceWorker.addEventListener('controllerchange', reload, { once: true });
  // A page the old worker does not control (after a hard refresh) never gets that signal; the worker's own
  // state does change.
  waiting.addEventListener('statechange', () => {
    if (waiting.state === 'activated' || waiting.state === 'redundant') reload();
  });
  waiting.postMessage({ type: 'SKIP_WAITING' });
  // If the browser has already switched, a fresh readiness check is still required.
  window.setTimeout(reload, 4000);
}
