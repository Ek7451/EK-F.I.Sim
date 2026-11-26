/**
 * Shown at the old address (longview-planner.pages.dev) when this browser still has plans saved there. One button
 * carries them to the new address; see lib/new-home.ts.
 */
import { Icon } from '@fisim/ui';
import { useState, type ReactNode } from 'react';
import { HOME_NAME, goHome, movePlansHome } from '../lib/new-home';
import { useStore } from '../state/store';

/** `onStay` shows the app here instead, so a backup can be downloaded from Settings. */
export function MovedHome({ onStay }: { onStay: () => void }): ReactNode {
  const plans = useStore((s) => s.plans);
  const list = Object.values(plans);
  const [state, setState] = useState<'idle' | 'moving' | 'too-big'>('idle');
  const needsRecovery = useStore((s) => Object.values(s.meta).some((entry) => entry.readOnly));

  const move = async (): Promise<void> => {
    setState('moving');
    try {
      if (!(await movePlansHome(list))) setState('too-big');
    } catch {
      setState('too-big');
    }
  };

  return (
    <main className="lv-card lv-state moved-home" data-variant="hero" aria-labelledby="moved-title">
      <span className="lv-state-mark" aria-hidden="true">
        <Icon name="home" size={22} />
      </span>
      <h1 id="moved-title">Longview Planner has moved to {HOME_NAME}</h1>
      <p>
        {list.length > 0 && (
          <>
            Review {list.length === 1 ? 'your plan' : `your ${list.length} plans`} at the new address before
            importing. The transfer link contains your plan data. Keep it private.
          </>
        )}
        {needsRecovery && ' Open Settings here to recover plans that this version could not open.'}
      </p>
      {state === 'too-big' ? (
        <p role="alert">
          These plans could not be moved in a link. Open Settings here, download a backup, then import it at{' '}
          {HOME_NAME}.
        </p>
      ) : null}
      <div className="lv-row">
        {state === 'too-big' || !list.length ? (
          <button
            type="button"
            className="lv-btn"
            data-variant="primary"
            onClick={() => {
              window.history.replaceState(null, '', '/settings');
              onStay();
            }}
          >
            Open Settings
          </button>
        ) : (
          <button
            type="button"
            className="lv-btn"
            data-variant="primary"
            disabled={state === 'moving'}
            onClick={() => void move()}
          >
            {state === 'moving' ? 'Moving…' : `Move my plans to ${HOME_NAME}`}
          </button>
        )}
        {list.length > 0 && (
          <button type="button" className="lv-btn" onClick={onStay}>
            Open original plans here
          </button>
        )}
        <button type="button" className="lv-btn" data-variant="ghost" onClick={goHome}>
          Go without them
        </button>
      </div>
    </main>
  );
}
