import '@fisim/ui/src/styles.css';
import './font.css';
import './app.css';
import { StrictMode, useEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { HelpProvider } from '@fisim/ui';
import { App } from './App';
import { helpText } from './lib/help';
import { logError } from './state/db';
import { useStore } from './state/store';

window.addEventListener('error', (e) => void logError(`error: ${e.message} at ${e.filename}:${e.lineno}`));
window.addEventListener(
  'unhandledrejection',
  (e) => void logError(`rejection: ${e.reason instanceof Error ? e.reason.message : String(e.reason)}`),
);

function Root(): ReactNode {
  const theme = useStore((s) => s.settings.theme);
  const [updateReady, setUpdateReady] = useState(false);
  const update = useRef<((reload?: boolean) => Promise<void>) | null>(null);

  useEffect(() => {
    void useStore.getState().init();
    // Sync, its encryption code and the service worker are not needed for the first screen, so they load a moment
    // after it has painted instead of competing with it. Updates wait for the user (plan 14.3).
    const t = setTimeout(() => {
      void import('./lib/sync').then((m) => m.initSync());
      if (import.meta.env.PROD && 'serviceWorker' in navigator) {
        void import('virtual:pwa-register').then(({ registerSW }) => {
          update.current = registerSW({ onNeedRefresh: () => setUpdateReady(true) });
        });
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
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#101827' : '#4f5dd5');
  }, [theme]);

  return (
    <HelpProvider value={helpText}>
      <App updateReady={updateReady} applyUpdate={() => void update.current?.(true)} />
    </HelpProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
