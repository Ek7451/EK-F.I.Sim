import { Button, Icon, Notice } from '@fisim/ui';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useStore, type Theme } from '../state/store';
import { tourForRoute } from '../tours/catalog';
import { useTour } from '../tours/TourEngine';
import { DISCLAIMER, NAV } from './nav';

const THEMES: Theme[] = ['system', 'light', 'dark'];

export function Shell({
  updateReady,
  applyUpdate,
}: {
  updateReady: boolean;
  applyUpdate: () => void;
}): ReactNode {
  const plans = useStore((s) => s.plans);
  const meta = useStore((s) => s.meta);
  const settings = useStore((s) => s.settings);
  const sandbox = useStore((s) => s.sandbox);
  const history = useStore((s) => (s.settings.activePlanId ? s.history[s.settings.activePlanId] : undefined));
  const notices = useStore((s) => s.notices);
  const { setActive, undo, redo, setSettings, dismissNotice } = useStore.getState();
  const [menu, setMenu] = useState(false);
  const loc = useLocation();
  const nav = useNavigate();
  const tour = useTour();
  const screenTour = tourForRoute(loc.pathname);
  const newer = Object.entries(meta).filter(([, m]) => m.readOnly);

  useEffect(() => setMenu(false), [loc.pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (!mod || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey)) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  const nextTheme = THEMES[(THEMES.indexOf(settings.theme) + 1) % THEMES.length];
  return (
    <div className="app">
      <a className="lv-btn skip" href="#main">
        Skip to content
      </a>
      <nav className="rail" aria-label="Main" data-open={menu} data-tour="nav">
        <Link className="brand" to="/">
          <img src="/icon.svg" alt="" />
          Longview
        </Link>
        {NAV.map((g) => (
          <div className="nav-group" key={g.id} data-tour={`nav-${g.id}`}>
            <h2>{g.label}</h2>
            <ul>
              {g.items.map((it) => (
                <li key={it.to}>
                  <NavLink className="nav-link" to={it.to} end={it.to === '/'}>
                    {it.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className="main">
        {sandbox ? (
          <div className="sandbox-banner" role="status" data-tour="sandbox-banner">
            <span>
              <strong>Tour sandbox.</strong>{' '}
              {sandbox.observeOnly
                ? 'You are viewing your own plan; changes are switched off.'
                : 'This is a sample plan. Nothing you change here touches your own plans.'}
            </span>
            <Button size="sm" onClick={() => tour.stop()}>
              Leave the sandbox
            </Button>
          </div>
        ) : null}
        <header className="topbar">
          <Link className="brand only-phone" to="/" aria-label="Longview home">
            <img src="/icon.svg" alt="" />
          </Link>
          <label className="lv-sr" htmlFor="plan-switch">
            Plan
          </label>
          <select
            id="plan-switch"
            className="lv-select"
            data-tour="plan-switcher"
            disabled={!!sandbox}
            value={sandbox ? '__sandbox' : (settings.activePlanId ?? '')}
            onChange={(e) => {
              if (e.target.value === '__new') nav('/start');
              else setActive(e.target.value);
            }}
          >
            {sandbox ? <option value="__sandbox">{sandbox.plan.name}</option> : null}
            {Object.values(plans).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            {!sandbox ? <option value="__new">+ New plan…</option> : null}
          </select>
          <span className="spacer" />
          <Button
            variant="ghost"
            icon="undo"
            label="Undo"
            onClick={undo}
            disabled={!history?.undo.length || !!sandbox}
            data-tour="undo"
          />
          <Button
            variant="ghost"
            icon="redo"
            label="Redo"
            onClick={redo}
            disabled={!history?.redo.length || !!sandbox}
            data-tour="redo"
          />
          <Button
            variant="ghost"
            icon={settings.theme === 'dark' ? 'moon' : 'sun'}
            label={`Theme: ${settings.theme}. Switch to ${nextTheme}`}
            onClick={() => setSettings({ theme: nextTheme })}
            data-tour="theme-toggle"
          />
          {screenTour ? (
            <Button
              variant="ghost"
              icon="help"
              label={`Take the tour: ${screenTour.title}`}
              onClick={() => tour.start(screenTour.id)}
              data-tour="screen-tour"
            />
          ) : null}
        </header>
        <main className="content" id="main" tabIndex={-1}>
          {updateReady ? (
            <Notice tone="ok">
              <div className="lv-spread">
                <span>A new version is ready. Your work is saved; reload when it suits you.</span>
                <Button size="sm" variant="primary" onClick={applyUpdate}>
                  Reload now
                </Button>
              </div>
            </Notice>
          ) : null}
          {newer.map(([id, m]) => (
            <Notice key={id} tone="warn">
              A plan on this device was saved by a newer version of Longview (schema v{m.newerVersion}). It is
              kept untouched and hidden until you update the app.
            </Notice>
          ))}
          <Outlet />
        </main>
        <footer className="footer">
          <p>{DISCLAIMER}</p>
        </footer>
      </div>
      <nav className="bottom-nav" aria-label="Main (phone)" data-tour="bottom-nav">
        <NavLink to="/" end>
          <Icon name="home" />
          Home
        </NavLink>
        <NavLink
          to="/plan/snapshot"
          className={() => ''}
          aria-current={loc.pathname.startsWith('/plan') ? 'page' : undefined}
        >
          <Icon name="plan" />
          Plan
        </NavLink>
        <NavLink
          to="/explore/projection"
          className={() => ''}
          aria-current={loc.pathname.startsWith('/explore') ? 'page' : undefined}
        >
          <Icon name="explore" />
          Explore
        </NavLink>
        <NavLink to="/compare">
          <Icon name="compare" />
          Compare
        </NavLink>
        <button type="button" aria-expanded={menu} onClick={() => setMenu((v) => !v)}>
          <Icon name={menu ? 'close' : 'more'} />
          {menu ? 'Close' : 'More'}
        </button>
      </nav>
      <div className="toasts" aria-live="polite">
        {notices.map((n) => (
          <div key={n.id} className="lv-notice" data-tone={n.tone} style={{ boxShadow: 'var(--shadow-2)' }}>
            <span style={{ flex: 1 }}>{n.text}</span>
            <Button
              size="sm"
              variant="ghost"
              icon="close"
              label="Dismiss"
              onClick={() => dismissNotice(n.id)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Secondary navigation between the screens of one task group (also the phone's way around a group). */
export function SubNav({ group }: { group: 'plan' | 'explore' }): ReactNode {
  const g = NAV.find((x) => x.id === group)!;
  return (
    <nav className="subnav" aria-label={`${g.label} screens`} data-tour={`subnav-${group}`}>
      {g.items.map((it) => (
        <NavLink key={it.to} to={it.to}>
          {it.label}
        </NavLink>
      ))}
    </nav>
  );
}

export function PageHead({
  title,
  intro,
  actions,
  group,
}: {
  title: string;
  intro?: string;
  actions?: ReactNode;
  group?: 'plan' | 'explore';
}): ReactNode {
  useEffect(() => {
    document.title = `${title} · Longview`;
  }, [title]);
  return (
    <>
      {group ? <SubNav group={group} /> : null}
      <div className="page-head">
        <div className="lv-stack" style={{ gap: 4 }}>
          <h1>{title}</h1>
          {intro ? <p>{intro}</p> : null}
        </div>
        {actions ? <div className="lv-row">{actions}</div> : null}
      </div>
    </>
  );
}
