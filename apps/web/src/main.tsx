import '@fisim/ui/src/styles.css';
import './font.css';
import './app.css';
import { StrictMode, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { HelpProvider } from '@fisim/ui';
import { App } from './App';
import { applyUpdate, canApplyQuietly, updateWasWaiting } from './lib/appUpdate';
import { helpText } from './lib/help';
import { alreadyMoved, goHome, onOldHome, receivePlans } from './lib/new-home';
import { MovedHome } from './pages/MovedHome';
import { logError } from './state/db';
import { useStore } from './state/store';

window.addEventListener('error', (e) => void logError(`error: ${e.message} at ${e.filename}:${e.lineno}`));
window.addEventListener(
  'unhandledrejection',
  (e) => void logError(`rejection: ${e.reason instanceof Error ? e.reason.message : String(e.reason)}`),
);

// The app moved to longviewplanner.app; the old address forwards there (see lib/new-home.ts).
const oldHome = onOldHome();

function Root(): ReactNode {
  const theme = useStore((s) => s.settings.theme);
  const ready = useStore((s) => s.ready);
  const [updateReady, setUpdateReady] = useState(false);
  const [stay, setStay] = useState(false);

  useEffect(() => {
    void useStore
      .getState()
      .init()
      .then(async () => {
        const store = useStore.getState();
        if (oldHome) {
          // Nothing saved here (or already moved): straight on to the new address.
          if (alreadyMoved() || Object.keys(store.plans).length === 0) goHome();
          return;
        }
        const { moved, failed } = await receivePlans(store.importPlan);
        if (moved)
          store.notify(
            moved === 1
              ? 'Moved your plan from the old address. It is saved in this browser.'
              : `Moved ${moved} plans from the old address. They are saved in this browser.`,
            'ok',
          );
        if (failed)
          store.notify(
            `${failed === 1 ? 'A plan' : `${failed} plans`} could not be moved. Nothing was lost: the old address still has every plan.`,
            'warn',
          );
      });
    // Sync, its encryption code and the service worker are not needed for the first screen, so they load a moment
    // after it has painted instead of competing with it. An update that arrives while the app is in use waits
    // for the user (plan 14.3); one that was already waiting as the page opened is applied before anything is
    // touched, so a returning visitor does not start on the old version.
    const t = setTimeout(() => {
      void import('./lib/sync').then((m) => m.initSync());
      if (import.meta.env.PROD && 'serviceWorker' in navigator) {
        void Promise.all([import('virtual:pwa-register'), updateWasWaiting()]).then(
          ([{ registerSW }, wasWaiting]) => {
            registerSW({
              onNeedRefresh: () => {
                if (canApplyQuietly(wasWaiting)) void applyUpdate();
                else setUpdateReady(true);
              },
            });
          },
        );
      }
    }, 1200);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = theme;
    const dark =
      theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#070919' : '#f2f2fb');
  }, [theme]);

  if (oldHome && !stay) return ready ? <MovedHome onStay={() => setStay(true)} /> : null;

  return (
    <HelpProvider value={helpText}>
      <App updateReady={updateReady} applyUpdate={() => void applyUpdate()} />
    </HelpProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
