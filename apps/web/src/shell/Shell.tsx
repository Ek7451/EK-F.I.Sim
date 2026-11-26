import { Badge, Button, HelpTip, Icon, Menu, Notice } from '@fisim/ui';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, Outlet, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { useStore } from '../state/store';
import { tourForRoute } from '../tours/catalog';
import { useTour } from '../tours/TourEngine';
import { DISCLAIMER, NAV, PRIMARY_NAV, SETUP_NAV, ownsRoute } from './nav';
import { useDraft } from '../state/draft';
import { publicCloud } from '../lib/cloud-account';
import { AccountButton, AccountDialog } from '../pages/AccountDialog';

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

  const [reloading, setReloading] = useState(false);
  const loc = useLocation();
  const nav = useNavigate();
  const menu = !!(sandbox || plans[settings.activePlanId ?? '']) && loc.state?.workspaceMenu === true;
  const tour = useTour();
  const screenTour = tourForRoute(loc.pathname);
  const newer = Object.entries(meta).filter(([, m]) => m.readOnly);

  const navigationType = useNavigationType();
  const previousMenu = useRef(menu);
  const previousPath = useRef(loc.pathname);
  useEffect(() => {
    if (previousPath.current !== loc.pathname && !loc.hash && !loc.search && !sandbox && !tour.activeId) {
      document.getElementById('main')?.focus({ preventScroll: true });
      if (navigationType !== 'POP') window.scrollTo({ top: 0, behavior: 'instant' });
    } else if (previousMenu.current && !menu) {
      document.getElementById('mobile-menu-toggle')?.focus({ preventScroll: true });
    }
    previousPath.current = loc.pathname;
    previousMenu.current = menu;
  }, [loc.pathname, loc.hash, loc.search, menu, navigationType, sandbox, tour.activeId]);
  useEffect(() => {
    if (!menu) return;
    const phoneLayout = window.matchMedia('(max-width: 900px)');
    document.querySelector<HTMLElement>('.rail[data-open="true"] .nav-group:not(.hide-phone) a')?.focus();
    const closeOnResize = () => {
      if (!phoneLayout.matches) nav(-1);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        nav(-1);
        document.getElementById('mobile-menu-toggle')?.focus();
      }
    };
    closeOnResize();
    phoneLayout.addEventListener('change', closeOnResize);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      phoneLayout.removeEventListener('change', closeOnResize);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [menu, nav]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey;
      if (loc.pathname === '/start' || menu || sandbox) return;
      if (
        e.isComposing ||
        e.defaultPrevented ||
        document.querySelector('[aria-modal="true"],dialog[open]') ||
        (e.target instanceof HTMLElement && e.target.isContentEditable)
      )
        return;
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
  }, [undo, redo, menu, sandbox, loc.pathname]);

  const scenarioId = useStore((s) => s.scenarioId);
  const active = sandbox ? sandbox.plan : settings.activePlanId ? plans[settings.activePlanId] : undefined;
  const scenario = scenarioId ? active?.scenarios.find((x) => x.id === scenarioId) : undefined;
  const crumb = breadcrumb(loc.pathname);
  const groups = active ? PRIMARY_NAV : SETUP_NAV;
  const editingPlan = !!active && loc.pathname !== '/start';
  const historyTools =
    editingPlan && (tour.activeId === 'T-B07' || !!history?.undo.length || !!history?.redo.length);
  const collapsed = settings.railCollapsed;
  return (
    <div className="app" data-rail={collapsed ? 'collapsed' : 'open'}>
      <a className="lv-btn skip" href="#main">
        Skip to content
      </a>
      <nav id="workspace-navigation" className="rail" aria-label="Main" data-open={menu} data-tour="nav">
        <div className="rail-head">
          <Link className="brand" replace={menu} to="/" aria-label="Longview Planner home">
            <img src="/icon.svg" alt="" />
            <span className="rail-text">
              Longview <small>Planner</small>
            </span>
          </Link>
        </div>
        <div className="rail-scroll">
          {groups.map((g) => (
            <div
              className={`nav-group${g.id === 'workspace' ? ' hide-phone' : ''}`}
              key={g.id}
              data-tour={`nav-${g.id}`}
            >
              <h2 className="rail-text">{g.label}</h2>
              <ul>
                {g.items.map((it) => (
                  <li key={it.to}>
                    <Link
                      replace={menu}
                      className="nav-link"
                      to={it.to}
                      aria-current={ownsRoute(it.to, loc.pathname) ? 'page' : undefined}
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
      <div
        className="main"
        ref={(node) => {
          if (node) node.inert = menu;
        }}
      >
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
        <header className={`topbar${!active && !crumb && !publicCloud ? ' only-phone' : ''}`}>
          <Link className="brand only-phone" to="/" aria-label="Longview Planner home">
            <img src="/icon.svg" alt="" />
          </Link>
          {active && (
            <Menu
              key={loc.pathname}
              label="Plans"
              items={[
                ...Object.values(plans).map((p) => ({
                  id: p.id,
                  label: p.name,
                  checked: p.id === settings.activePlanId,
                  onSelect: () => {
                    if (p.id !== active.id) setActive(p.id);
                    if (loc.pathname === '/start') nav('/');
                  },
                })),
                {
                  id: '__new',
                  label: 'New plan…',
                  icon: 'plus',
                  divider: true,
                  onSelect: () => nav('/start'),
                },
              ]}
              trigger={({ open, ...p }) => (
                <button
                  {...p}
                  type="button"
                  id="plan-switch"
                  className="plan-switch"
                  data-tour="plan-switcher"
                  disabled={!!sandbox}
                  aria-label={`Plan: ${active.name}`}
                  aria-haspopup="menu"
                >
                  <span className="plan-dot" aria-hidden="true" />
                  <span className="lv-ellipsis">{active.name}</span>
                  <Icon name={open ? 'up' : 'down'} size={16} />
                </button>
              )}
            />
          )}
          {crumb ? (
            <nav className="crumbs hide-phone" aria-label="Breadcrumb">
              <Icon name="chevron" size={14} />
              <span>{crumb.group}</span>
              <Icon name="chevron" size={14} />
              <span aria-current="page">{crumb.page}</span>
            </nav>
          ) : null}
          {editingPlan && scenario ? (
            <span data-tour="scenario-chip">
              <Badge tone="warn">What-if: {scenario.name}</Badge>
            </span>
          ) : null}
          <span className="spacer" />
          {editingPlan && (
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
          <div className={`header-tools${publicCloud ? ' hide-phone' : ''}`}>
            {historyTools && (
              <>
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
              </>
            )}
            {screenTour ? (
              <Button
                variant="ghost"
                icon="help"
                label={`Take the tour: ${screenTour.title}`}
                onClick={() => tour.start(screenTour.id)}
                data-tour="screen-tour"
              />
            ) : null}
          </div>
          {publicCloud ? (
            <>
              {screenTour || (historyTools && !sandbox) ? (
                <div className="only-phone">
                  <Menu
                    label="Editing and help"
                    placement="bottom-end"
                    items={[
                      ...(historyTools && history?.undo.length && !sandbox
                        ? [{ id: 'undo', label: 'Undo', icon: 'undo', onSelect: undo }]
                        : []),
                      ...(historyTools && history?.redo.length && !sandbox
                        ? [{ id: 'redo', label: 'Redo', icon: 'redo', onSelect: redo }]
                        : []),
                      ...(screenTour
                        ? [
                            {
                              id: 'tour',
                              label: `Take the tour: ${screenTour.title}`,
                              icon: 'help',
                              onSelect: () => tour.start(screenTour.id),
                            },
                          ]
                        : []),
                    ]}
                    trigger={({ open: _open, ...props }) => (
                      <button
                        {...props}
                        type="button"
                        className="lv-btn"
                        data-variant="ghost"
                        data-icon=""
                        data-tour="editing-help"
                        aria-label="Editing and help"
                        title="Editing and help"
                      >
                        <Icon name="more" size={18} />
                      </button>
                    )}
                  />
                </div>
              ) : null}
              <AccountButton disabled={!!sandbox} />
            </>
          ) : null}
        </header>
        {publicCloud ? <AccountDialog /> : null}
        <main className="content" id="main" tabIndex={-1}>
          {updateReady ? (
            <Notice tone="ok">
              <div className="lv-spread">
                <span>A new version is ready. Finish open edits before reloading.</span>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={reloading}
                  onClick={async () => {
                    setReloading(true);
                    try {
                      await applyUpdate();
                    } finally {
                      setReloading(false);
                    }
                  }}
                >
                  {reloading ? 'Reloading…' : 'Reload now'}
                </Button>
              </div>
            </Notice>
          ) : null}
          {saveStatus === 'error' && (
            <Notice tone="danger">
              <span>Saving this plan failed. </span>
              <Button size="sm" onClick={() => useStore.getState().retrySave()}>
                Retry saving
              </Button>
            </Notice>
          )}
          {newer.length > 0 && !loc.pathname.startsWith('/settings') && (
            <Notice tone="warn">
              {newer.length === 1
                ? 'One saved plan needs attention.'
                : `${newer.length} saved plans need attention.`}{' '}
              <Link to="/settings">Review in Settings</Link>
            </Notice>
          )}
          {loc.pathname.startsWith('/settings') &&
            newer.map(([id, m]) => (
              <Notice key={id} tone="warn">
                {m.validationError
                  ? 'A saved plan needs recovery. Download the original, then open it in Restore a recovery file.'
                  : `A saved plan needs Longview schema v${m.newerVersion}. Update to open it.`}
                {m.validationError && (
                  <details>
                    <summary>Show plan errors</summary>
                    {m.validationError}
                  </details>
                )}
                <div className="lv-row">
                  <Button
                    size="sm"
                    onClick={async () => {
                      try {
                        const { db } = await import('../state/db');
                        const record = await (await db()).get('plans', id);
                        if (!record) throw new Error();
                        const { download } = await import('../lib/files');
                        download('longview-recovery.json', JSON.stringify(record.plan), 'application/json');
                      } catch {
                        useStore
                          .getState()
                          .notify(
                            'Recovery download failed. Your original is still on this device.',
                            'danger',
                          );
                      }
                    }}
                  >
                    Download original (unencrypted)
                  </Button>
                  {m.validationError && loc.pathname !== '/settings/recovery' && (
                    <Link className="lv-btn" data-size="sm" to="/settings/recovery">
                      Restore a recovery file
                    </Link>
                  )}
                </div>
              </Notice>
            ))}
          <Outlet />
        </main>
        <footer className="footer">
          <p>{DISCLAIMER}</p>
        </footer>
      </div>
      <nav
        className="bottom-nav"
        data-setup={!active || undefined}
        aria-label="Main (phone)"
        data-tour="bottom-nav"
      >
        {groups[0].items.map((it) => (
          <Link
            key={it.to}
            to={it.to}
            aria-current={ownsRoute(it.to, loc.pathname) ? 'page' : undefined}
            replace={menu}
          >
            <Icon name={it.icon} />
            {it.label}
          </Link>
        ))}
        {active && (
          <button
            id="mobile-menu-toggle"
            type="button"
            data-current={PRIMARY_NAV[1].items.some((it) => ownsRoute(it.to, loc.pathname)) || undefined}
            aria-controls="workspace-navigation"
            aria-expanded={menu}
            onClick={() =>
              menu
                ? nav(-1)
                : nav(loc.pathname + loc.search + loc.hash, {
                    state: { ...loc.state, workspaceMenu: true },
                    preventScrollReset: true,
                  })
            }
          >
            <Icon name={menu ? 'close' : 'more'} />
            {menu ? 'Close' : 'More'}
          </button>
        )}
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
  if (path === '/plan') return { group: 'Workspace', page: 'Edit plan' };
  for (const g of NAV)
    for (const it of g.items)
      if (it.to === path || (it.to !== '/' && path.startsWith(it.to + '/')))
        return g.id === 'home' ? null : { group: g.label, page: it.label };
  return null;
}

/** Secondary navigation between the screens of one task group (also the phone's way around a group). */
export function SubNav({ group }: { group: 'plan' | 'explore' }): ReactNode {
  const g = NAV.find((x) => x.id === group)!;
  const loc = useLocation();
  const navigate = useNavigate();
  if (group === 'plan')
    return (
      <Link className="all-inputs" to="/plan">
        All plan inputs
      </Link>
    );
  return (
    <label className="results-picker" data-tour="subnav-explore">
      Results pages
      <select value={loc.pathname} onChange={(e) => navigate(e.target.value)}>
        {g.items.map((it) => (
          <option key={it.to} value={it.to}>
            {it.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * The brand picture, drawn large: a horizon, a path climbing toward it and the first light it reaches.
 * Decorative only.
 */
export function HorizonArt(): ReactNode {
  return (
    <svg className="horizon-art" viewBox="0 0 640 260" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="ha-path" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#8f84ff" />
          <stop offset="0.45" stopColor="#c46bff" />
          <stop offset="0.75" stopColor="#ff5c9a" />
          <stop offset="1" stopColor="#ffb02e" />
        </linearGradient>
        <linearGradient id="ha-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#a14dff" stopOpacity="0.4" />
          <stop offset="1" stopColor="#a14dff" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="ha-sun" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ffe3a6" />
          <stop offset="0.35" stopColor="#ffb02e" stopOpacity="0.85" />
          <stop offset="1" stopColor="#ffb02e" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="560" cy="62" r="92" fill="url(#ha-sun)" opacity="0.55" />
      <path
        d="M0 226 C 110 218 170 196 240 160 S 380 118 440 96 S 520 70 560 62 L 640 56 L 640 232 L 0 232 Z"
        fill="url(#ha-fill)"
      />
      <path className="horizon-line" d="M0 232 H640" />
      <path
        className="horizon-path"
        pathLength="1"
        d="M0 226 C 110 218 170 196 240 160 S 380 118 440 96 S 520 70 560 62"
        fill="none"
        stroke="url(#ha-path)"
      />
      <circle cx="560" cy="62" r="11" fill="#ffc45c" />
      <g className="horizon-ticks">
        <path d="M80 232v8M200 232v8M320 232v8M440 232v8M560 232v8" />
      </g>
    </svg>
  );
}

export function PageHead({
  title,
  intro,
  context,
  actions,
  group,
}: {
  title: string;
  intro?: string;
  context?: string;
  actions?: ReactNode;
  group?: 'plan' | 'explore';
}): ReactNode {
  useEffect(() => {
    document.title = `${title} · Longview Planner`;
  }, [title]);
  return (
    <div className="page-head" data-group={group}>
      <div className="page-title">
        <h1>{title}</h1>
        {intro && <HelpTip label={`About ${title}`}>{intro}</HelpTip>}
        {context && <span className="page-context">{context}</span>}
      </div>
      {group && <SubNav group={group} />}
      {actions ? <div className="lv-row page-actions">{actions}</div> : null}
    </div>
  );
}
