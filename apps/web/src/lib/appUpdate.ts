/**
 * Moving this page onto a new version of the app (plan 14.3).
 *
 * A new version arrives as a service worker that installs and then waits. Applying it means telling that worker to
 * take over and reloading the page under it. The stock helper reloads only when the browser reports the hand-over
 * in one particular way, which left "Reload now" doing nothing in some states (a page the old worker does not
 * control, a worker another tab already activated, a browser that never reports the change). Here every path ends
 * in a reload onto the new version.
 */

const AUTO_KEY = 'lv-update-auto';

/** True once the person has touched this page. An update is never applied by itself after that. */
let interacted = false;
if (typeof window !== 'undefined') {
  const touch = (): void => {
    interacted = true;
  };
  window.addEventListener('pointerdown', touch, { once: true, capture: true });
  window.addEventListener('keydown', touch, { once: true, capture: true });
}

/** Is a newer version already installed and waiting? (Asked before this page registers the worker.) */
export async function updateWasWaiting(): Promise<boolean> {
  try {
    return !!(await navigator.serviceWorker.getRegistration())?.waiting;
  } catch {
    return false;
  }
}

/**
 * Should a waiting update be applied without asking? Only when it was already waiting as the page opened, nothing
 * has been touched yet, and this tab has not just tried (so a browser that refuses to switch cannot loop).
 */
export function canApplyQuietly(wasWaiting: boolean): boolean {
  if (!wasWaiting || interacted) return false;
  try {
    if (sessionStorage.getItem(AUTO_KEY)) return false;
    sessionStorage.setItem(AUTO_KEY, String(Date.now()));
    return true;
  } catch {
    return false;
  }
}

/** Activate the waiting version and reload onto it. */
export async function applyUpdate(): Promise<void> {
  let reloaded = false;
  const reload = (): void => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
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
  // Last resort, if the browser will not switch workers: drop the registration so the reload is served by the
  // network. The fresh page registers the worker again.
  const registration = reg;
  window.setTimeout(() => {
    if (reloaded) return;
    void registration
      .unregister()
      .catch(() => false)
      .then(reload);
  }, 4000);
}
