import { Badge, Button, Icon, Menu, Notice } from '@fisim/ui';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useStore, type Theme } from '../state/store';
import { tourForRoute } from '../tours/catalog';
import { useTour } from '../tours/TourEngine';
import { DISCLAIMER, NAV, PRIMARY_NAV } from './nav';
import { useDraft } from '../state/draft';

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
  const saveStatus = useStore((s) => s.saveStatus[s.settings.activePlanId ?? '']);
  const draft = useDraft((s) => s.transaction);
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
  const scenarioId = useStore((s) => s.scenarioId);
  const active = sandbox ? sandbox.plan : settings.activePlanId ? plans[settings.activePlanId] : undefined;
  const scenario = scenarioId ? active?.scenarios.find((x) => x.id === scenarioId) : undefined;
  const crumb = breadcrumb(loc.pathname);
  const collapsed = settings.railCollapsed;
  return (
    <div className="app" data-rail={collapsed ? 'collapsed' : 'open'}>
      <a className="lv-btn skip" href="#main">
        Skip to content
      </a>
      <nav className="rail" aria-label="Main" data-open={menu} data-tour="nav">
        <div className="rail-head">
          <Link className="brand" to="/" aria-label="Longview Planner home">
            <img src="/icon.svg" alt="" />
            <span className="rail-text">
              Longview <small style={{ display: 'block', fontSize: 11, fontWeight: 500 }}>Planner</small>
            </span>
          </Link>
        </div>
        <div className="rail-scroll">
          {PRIMARY_NAV.map((g) => (
            <div className="nav-group" key={g.id} data-tour={`nav-${g.id}`}>
              <h2 className="rail-text">{g.label}</h2>
              <ul>
                {g.items.map((it) => (
                  <li key={it.to}>
                    <Link
                      className="nav-link"
                      to={it.to}
                      aria-current={
                        (
                          it.label === 'Plan'
                            ? /^\/(plan|explore)\//.test(loc.pathname)
                            : it.to === loc.pathname
                        )
                          ? 'page'
                          : undefined
                      }
                      title={collapsed ? it.label : undefined}
                    >
                      <Icon name={it.icon} size={18} />
                      <span className="rail-text">{it.label}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="rail-toggle hide-phone"
          aria-label={collapsed ? 'Show navigation labels' : 'Collapse navigation to icons'}
          title={collapsed ? 'Show labels' : 'Collapse'}
          aria-pressed={collapsed}
          onClick={() => setSettings({ railCollapsed: !collapsed })}
        >
          <Icon name="panel" size={18} />
          <span className="rail-text">Collapse</span>
        </button>
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
          <Link className="brand only-phone" to="/" aria-label="Longview Planner home">
            <img src="/icon.svg" alt="" />
          </Link>
          <Menu
            label="Plans"
            items={[
              ...Object.values(plans).map((p) => ({
                id: p.id,
                label: p.name,
                checked: p.id === settings.activePlanId,
                onSelect: () => setActive(p.id),
              })),
              { id: '__new', label: 'New plan…', icon: 'plus', divider: true, onSelect: () => nav('/start') },
            ]}
            trigger={({ open, ...p }) => (
              <button
                {...p}
                type="button"
                id="plan-switch"
                className="plan-switch"
                data-tour="plan-switcher"
                disabled={!!sandbox}
                aria-label={`Plan: ${active?.name ?? 'No plan yet'}`}
                aria-haspopup="menu"
              >
                <span className="plan-dot" aria-hidden="true" />
                <span className="lv-ellipsis">{active?.name ?? 'No plan yet'}</span>
                <Icon name={open ? 'up' : 'down'} size={16} />
              </button>
            )}
          />
          {crumb ? (
            <nav className="crumbs hide-phone" aria-label="Breadcrumb">
              <Icon name="chevron" size={14} />
              <span>{crumb.group}</span>
              <Icon name="chevron" size={14} />
              <span aria-current="page">{crumb.page}</span>
            </nav>
          ) : null}
          {scenario ? (
            <span data-tour="scenario-chip">
              <Badge tone="warn">What-if: {scenario.name}</Badge>
            </span>
          ) : null}
          <span className="spacer" />
          {active && (
            <span className="save-status" role="status">
              {draft?.base.id === active.id ? 'Draft · ' : ''}
              {saveStatus === 'saving' ? (
                'Saving…'
              ) : saveStatus === 'error' ? (
                <button type="button" onClick={() => useStore.getState().retrySave()}>
                  Save failed · Retry
                </button>
              ) : (
                'Saved on device'
              )}
            </span>
          )}
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
          to="/explore/projection"
          className={() => ''}
          aria-current={/^\/(plan|explore)\//.test(loc.pathname) ? 'page' : undefined}
        >
          <Icon name="projection" />
          Plan
        </NavLink>
        <NavLink to="/compare">
          <Icon name="compare" />
          Compare
        </NavLink>
        <NavLink to="/track">
          <Icon name="progress" />
          Progress
        </NavLink>
        <NavLink to="/reports">
          <Icon name="reports" />
          Reports
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

/** Where a route sits in the navigation, for the top bar ("Explore › Projection"). */
function breadcrumb(path: string): { group: string; page: string } | null {
  for (const g of NAV)
    for (const it of g.items)
      if (it.to === path || (it.to !== '/' && path.startsWith(it.to + '/')))
        return g.id === 'home' ? null : { group: g.label, page: it.label };
  return null;
}

/** Secondary navigation between the screens of one task group (also the phone's way around a group). */
export function SubNav({ group }: { group: 'plan' | 'explore' }): ReactNode {
  const g = NAV.find((x) => x.id === group)!;
  return (
    <nav className="subnav lv-segmented" aria-label={`${g.label} screens`} data-tour={`subnav-${group}`}>
      {g.items.map((it) => (
        <NavLink key={it.to} to={it.to}>
          <Icon name={it.icon} size={15} />
          {it.label}
        </NavLink>
      ))}
      <NavLink to={group === 'explore' ? '/plan/household' : '/explore/projection'}>
        {group === 'explore' ? 'Plan inputs' : '← Projection'}
      </NavLink>
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
    document.title = `${title} · Longview Planner`;
  }, [title]);
  return (
    <>
      {group ? <SubNav group={group} /> : null}
      <div className="page-head">
        <div className="page-title">
          <h1>{title}</h1>
          {intro ? <p>{intro}</p> : null}
        </div>
        {actions ? <div className="lv-row">{actions}</div> : null}
      </div>
    </>
  );
}
