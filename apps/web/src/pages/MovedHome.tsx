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
  const count = list.length === 1 ? 'Your plan is' : `Your ${list.length} plans are`;

  const move = async (): Promise<void> => {
    setState('moving');
    if (!(await movePlansHome(list))) setState('too-big');
  };

  return (
    <main className="lv-card lv-state moved-home" data-variant="hero" aria-labelledby="moved-title">
      <span className="lv-state-mark" aria-hidden="true">
        <Icon name="home" size={22} />
      </span>
      <h1 id="moved-title">Longview Planner has moved to {HOME_NAME}</h1>
      <p>
        {count} saved in this browser at the old address. Bring {list.length === 1 ? 'it' : 'them'} with you
        in one step: the plans travel inside the link, straight to the new address in this browser, and are
        never sent to a server.
      </p>
      {state === 'too-big' ? (
        <p role="alert">
          These plans are too large to carry in a link. Open Settings here, download a backup, then import it
          at {HOME_NAME}.
        </p>
      ) : null}
      <div className="lv-row">
        {state === 'too-big' ? (
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
        <button type="button" className="lv-btn" data-variant="ghost" onClick={goHome}>
          Go without them
        </button>
      </div>
    </main>
  );
}
