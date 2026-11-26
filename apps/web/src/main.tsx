import '@fisim/ui/src/styles.css';
import './font.css';
import './app.css';
import { StrictMode, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { HelpProvider } from '@fisim/ui';
import { App } from './App';
import { applyUpdate } from './lib/appUpdate';
import { helpText } from './lib/help';
import { goHome, onOldHome, takeTransfer, unpackPlans } from './lib/new-home';
import { lazy, Suspense } from 'react';
const ImportReview = lazy(() => import('./pages/ImportReview'));
import { MovedHome } from './pages/MovedHome';
import { logError } from './state/db';
import { useStore } from './state/store';

// The keyboard and browser chrome can reduce the visible area without resizing the layout on iOS.
const viewport = window.visualViewport;
if (viewport) {
  const syncViewport = () => {
    document.documentElement.style.setProperty('--visible-height', `${viewport.height}px`);
    document.documentElement.style.setProperty('--visible-top', `${viewport.offsetTop}px`);
  };
  syncViewport();
  viewport.addEventListener('resize', syncViewport);
  viewport.addEventListener('scroll', syncViewport);
}
// WebKit also exposes native two-finger page gestures separately from touch-action.
document.addEventListener(
  'gesturestart',
  (event) => {
    if (matchMedia('(pointer: coarse)').matches) event.preventDefault();
  },
  { passive: false },
);

window.addEventListener('storage', (event) => {
  if (event.key === 'lv-workspace-reset') window.location.reload();
});
window.addEventListener('error', (e) => void logError(`error: ${e.message} at ${e.filename}:${e.lineno}`));
window.addEventListener(
  'unhandledrejection',
  (e) => void logError(`rejection: ${e.reason instanceof Error ? e.reason.message : String(e.reason)}`),
);

// The app moved to longviewplanner.pages.dev; the old address forwards there (see lib/new-home.ts).
const oldHome = onOldHome();
const transfer = takeTransfer();

function Root(): ReactNode {
  const theme = useStore((s) => s.settings.theme);
  const ready = useStore((s) => s.ready);
  const [updateReady, setUpdateReady] = useState(false);
  const [incoming, setIncoming] = useState<unknown[] | null>(null);
  const [transferError, setTransferError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [openingError, setOpeningError] = useState(false);
  const [stay, setStay] = useState(false);

  useEffect(() => {
    void useStore
      .getState()
      .init()
      .then(async () => {
        const store = useStore.getState();
        if (oldHome) {
          // Nothing saved here (or already moved): straight on to the new address.
          if (Object.keys(store.meta).length === 0) goHome();
          return;
        }
        if (transfer !== null) {
          try {
            setIncoming(await unpackPlans(transfer));
          } catch {
            setTransferError(true);
          }
        }
      })
      .catch(() => setOpeningError(true));
  }, [attempt]);
  useEffect(() => {
    if (!ready || oldHome || incoming || transferError) return;
    const timer = setTimeout(() => {
      void import('./lib/sync').then((m) => m.initSync()).catch((error) => logError(String(error)));
      if (import.meta.env.PROD && 'serviceWorker' in navigator)
        void import('virtual:pwa-register').then(({ registerSW }) =>
          registerSW({ onNeedRefresh: () => setUpdateReady(true) }),
        );
    }, 1200);
    return () => clearTimeout(timer);
  }, [ready, incoming, transferError]);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = theme;
    const system = window.matchMedia('(prefers-color-scheme: dark)');
    const updateChrome = () => {
      const dark = theme === 'dark' || (theme === 'system' && system.matches);
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', dark ? '#070919' : '#f2f2fb');
    };
    updateChrome();
    system.addEventListener('change', updateChrome);
    return () => system.removeEventListener('change', updateChrome);
  }, [theme]);

  if (openingError)
    return (
      <main className="lv-card" role="alert">
        <h1>Couldn’t open saved plans</h1>
        <p>
          Check browser storage permissions and close other Longview tabs before retrying. Your saved data is
          retained.
        </p>
        <button
          autoFocus
          onClick={() => {
            setOpeningError(false);
            setAttempt((n) => n + 1);
          }}
        >
          Retry opening plans
        </button>
      </main>
    );
  if (transferError)
    return (
      <main className="lv-card" role="alert">
        <h1>Transfer could not be opened</h1>
        <p>
          Open Longview at the old address and export a backup from Settings. The original plans are still
          there.
        </p>
        <button onClick={() => setTransferError(false)}>Continue without importing</button>
      </main>
    );
  if (incoming)
    return (
      <Suspense fallback={<p role="status">Opening transfer…</p>}>
        <ImportReview raw={incoming} onClose={() => setIncoming(null)} />
      </Suspense>
    );
  if (oldHome && !stay) return ready ? <MovedHome onStay={() => setStay(true)} /> : null;

  return (
    <HelpProvider value={helpText}>
      <App updateReady={updateReady} applyUpdate={applyUpdate} />
    </HelpProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
