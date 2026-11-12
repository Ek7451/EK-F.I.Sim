/**
 * Guided-tour engine (UX-10). Tours are data (see catalog.ts); this renders them: a spotlight on the target, a step
 * card (popover on wide screens, sheet on phones), keyboard support and saved progress. A tour runs in a sandbox on a
 * sample plan, or in observe-only mode on the user's own plan with changes switched off.
 */
import { loadEngine } from '../engine/load';
import { Button, formatCompact, formatPct } from '@fisim/ui';
import { autoUpdate, flip, offset, shift, useFloating } from '@floating-ui/react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useMonteCarlo, useProjection } from '../engine/useResults';
import { useStore } from '../state/store';
import { useDraft, type DraftTransaction } from '../state/draft';
import { tourById, tourForRoute } from './catalog';
import type { TourDef, TourStep } from './types';

interface StartOptions {
  /** Run on the user's own plan with changes switched off, instead of the sample. */
  ownPlan?: boolean;
  /** Start from the first step even if there is saved progress. */
  restart?: boolean;
}
interface TourApi {
  start(id: string, opts?: StartOptions): void;
  stop(): void;
  activeId: string | null;
}
const Ctx = createContext<TourApi>({ start: () => undefined, stop: () => undefined, activeId: null });
export const useTour = (): TourApi => useContext(Ctx);

interface Active {
  tour: TourDef;
  step: number;
  returnTo: string;
}

const visible = (el: Element): boolean => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};
/** First visible element for a `a|b` anchor list. */
export function findTarget(target: string | undefined): HTMLElement | null {
  if (!target) return null;
  for (const name of target.split('|')) {
    for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`))
      if (visible(el)) return el;
  }
  return null;
}

export function TourProvider({ children }: { children: ReactNode }): ReactNode {
  const savedDraft = useRef<DraftTransaction | null>(null);
  const [active, setActive] = useState<Active | null>(null);
  const nav = useNavigate();
  const loc = useLocation();
  const path = useRef(loc.pathname);
  path.current = loc.pathname;

  const start = useCallback((id: string, opts: StartOptions = {}) => {
    const tour = tourById(id);
    if (!tour) return;
    const st = useStore.getState();
    const own = opts.ownPlan && st.settings.activePlanId ? st.plans[st.settings.activePlanId] : null;
    const returnTo = path.current;
    // The sample plans come with the engine, which may still be loading on a first visit.
    void loadEngine().then(({ SAMPLE_PLANS }) => {
      if (!useStore.getState().sandbox) savedDraft.current = useDraft.getState().transaction;
      useDraft.getState().discard();
      st.enterSandbox(own ?? SAMPLE_PLANS[tour.samplePlan](new Date().getFullYear()), !!own);
      const saved = useStore.getState().settings.tours[id];
      const step =
        !opts.restart && saved && !saved.completed ? Math.min(saved.step, tour.steps.length - 1) : 0;
      useStore.getState().setTour(id, { step, dismissed: false });
      setActive({ tour, step, returnTo });
    });
  }, []);

  const stop = useCallback(() => {
    setActive((a) => {
      if (a) {
        const st = useStore.getState();
        st.setTour(a.tour.id, { step: a.step });
        st.exitSandbox();
        useDraft.getState().restore(savedDraft.current);
        nav(a.returnTo);
      } else useStore.getState().exitSandbox();
      return null;
    });
  }, [nav]);

  const go = useCallback(
    (delta: number) => {
      setActive((a) => {
        if (!a) return a;
        const next = a.step + delta;
        const st = useStore.getState();
        if (next >= a.tour.steps.length) {
          st.setTour(a.tour.id, { completed: true, step: 0 });
          st.exitSandbox();
          useDraft.getState().restore(savedDraft.current);
          st.notify(`Tour finished: ${a.tour.title}.`, 'ok');
          nav('/help/tours');
          return null;
        }
        const step = Math.max(0, next);
        st.setTour(a.tour.id, { step });
        return { ...a, step };
      });
    },
    [nav],
  );

  const api = useMemo<TourApi>(
    () => ({ start, stop, activeId: active?.tour.id ?? null }),
    [start, stop, active?.tour.id],
  );
  return (
    <Ctx.Provider value={api}>
      {children}
      {active ? (
        <TourLayer key={`${active.tour.id}:${active.step}`} active={active} go={go} stop={stop} />
      ) : (
        <TourPrompt start={start} />
      )}
    </Ctx.Provider>
  );
}

function usePhone(): boolean {
  const [phone, setPhone] = useState(() => window.matchMedia('(max-width: 700px)').matches);
  useEffect(() => {
    const m = window.matchMedia('(max-width: 700px)');
    const on = (): void => setPhone(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return phone;
}

/** Fill `{placeholders}` with live numbers from the sandbox plan, so the copy always matches the screen. */
function useFilled(step: TourStep): string {
  const planName = useStore((s) => s.sandbox?.plan.name ?? '');
  const { result } = useProjection();
  const mc = useMonteCarlo(step.body.includes('{mc.'));
  const s = result?.summary;
  const values: Record<string, string | undefined> = {
    'plan.name': planName,
    netWorth: s ? formatCompact(s.currentNetWorth) : undefined,
    endNetWorth: s ? formatCompact(s.endingNetWorthReal) : undefined,
    fiYear: s ? (s.fiYear ? String(s.fiYear) : 'a year beyond the plan') : undefined,
    lifetimeTax: s ? formatCompact(s.lifetimeTaxReal) : undefined,
    'mc.successRate': mc.summary ? formatPct(mc.summary.successRate) : undefined,
  };
  return step.body.replace(/\{([\w.]+)\}/g, (_, k: string) => values[k] ?? '…');
}

function TourLayer({
  active,
  go,
  stop,
}: {
  active: Active;
  go: (d: number) => void;
  stop: () => void;
}): ReactNode {
  const { tour, step: index } = active;
  const step = tour.steps[index];
  const nav = useNavigate();
  const loc = useLocation();
  const phone = usePhone();
  const body = useFilled(step);
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [acted, setActed] = useState(false);
  const card = useRef<HTMLDivElement | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const last = index === tour.steps.length - 1;

  // Go to the step's screen, then wait for its target to appear.
  useEffect(() => {
    if (loc.pathname !== step.route) {
      nav(step.route);
      return;
    }
    if (!step.target) return;
    let tries = 0;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const look = (): boolean => {
      const found = findTarget(step.target);
      if (!found) return false;
      found.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
      setEl(found);
      return true;
    };
    if (look()) return;
    const t = setInterval(() => {
      if (look() || ++tries > 40) clearInterval(t);
    }, 100);
    return () => clearInterval(t);
  }, [loc.pathname, step.route, step.target, nav]);

  // Keep the spotlight on the target as the page scrolls or reflows.
  useEffect(() => {
    if (!el) {
      setRect(null);
      return;
    }
    const measure = (): void => {
      if (!el.isConnected) {
        setEl(findTarget(step.target));
        return;
      }
      const r = el.getBoundingClientRect();
      setRect((p) =>
        p && p.x === r.x && p.y === r.y && p.width === r.width && p.height === r.height ? p : r,
      );
    };
    measure();
    const t = setInterval(measure, 150);
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      clearInterval(t);
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [el, step.target]);

  // "Try it" steps: notice when the user uses the control.
  useEffect(() => {
    if (!el || !step.action) return;
    const on = (): void => setActed(true);
    const types = step.action.on === 'click' ? ['click'] : ['input', 'change'];
    types.forEach((t) => el.addEventListener(t, on));
    return () => types.forEach((t) => el.removeEventListener(t, on));
  }, [el, step.action]);

  // Focus moves to the card on every step; Esc leaves; arrows step when focus is in the card.
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        stop();
        return;
      }
      if (!card.current?.contains(document.activeElement)) return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        go(1);
      } else if (e.key === 'ArrowLeft' && index > 0) {
        e.preventDefault();
        go(-1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, stop, index]);

  const { refs, floatingStyles } = useFloating({
    strategy: 'fixed',
    placement: step.placement ?? 'bottom',
    elements: { reference: phone ? null : el },
    whileElementsMounted: autoUpdate,
    middleware: [offset(16), flip({ padding: 12 }), shift({ padding: 12, crossAxis: true })],
  });
  const setCard = (n: HTMLDivElement | null): void => {
    card.current = n;
    refs.setFloating(n);
  };

  // Phones get a sheet, docked at whichever edge is further from the target.
  const sheetTop = phone && !!rect && rect.top + rect.height / 2 > window.innerHeight / 2;
  const style: React.CSSProperties = phone
    ? sheetTop
      ? {
          top: 0,
          bottom: 'auto',
          borderRadius: '0 0 var(--radius-3) var(--radius-3)',
          paddingTop: 'calc(var(--space-4) + env(safe-area-inset-top))',
        }
      : {}
    : el
      ? floatingStyles
      : { position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)' };
  const pad = 6;
  const spot: React.CSSProperties = rect
    ? {
        left: rect.left - pad,
        top: rect.top - pad,
        width: rect.width + pad * 2,
        height: rect.height + pad * 2,
      }
    : { left: '50%', top: '50%', width: 0, height: 0, boxShadow: '0 0 0 9999px rgba(16, 26, 38, 0.55)' };

  return (
    <>
      <div className="tour-spot" style={spot} aria-hidden="true" />
      <div
        ref={setCard}
        className="tour-card"
        data-sheet={phone}
        style={style}
        role="dialog"
        aria-modal="false"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        data-testid="tour-card"
      >
        <div className="lv-spread">
          <span className="lv-muted lv-small" data-testid="tour-progress">
            {tour.title} · step {index + 1} of {tour.steps.length}
          </span>
          <Button size="sm" variant="ghost" icon="close" label="Leave the tour" onClick={stop} />
        </div>
        <h2 id="tour-title" ref={heading} tabIndex={-1}>
          {step.title}
        </h2>
        <p id="tour-body">{body}</p>
        {step.action ? (
          <p className="lv-small" style={{ color: acted ? 'var(--primary)' : undefined, fontWeight: 600 }}>
            {acted ? 'Done. Press Next when you are ready.' : step.action.prompt}
          </p>
        ) : null}
        {step.explain ? (
          <Link className="lv-small" to={`/help/methods#${step.explain}`} onClick={stop}>
            How this is calculated
          </Link>
        ) : null}
        <div className="lv-progress" aria-hidden="true">
          <div style={{ width: `${((index + 1) / tour.steps.length) * 100}%` }} />
        </div>
        <div className="lv-spread">
          <Button size="sm" disabled={index === 0} onClick={() => go(-1)}>
            Back
          </Button>
          <Button size="sm" variant="primary" onClick={() => go(1)} data-testid="tour-next">
            {last ? 'Finish' : 'Next'}
          </Button>
        </div>
      </div>
      <div
        className="lv-sr"
        aria-live="polite"
      >{`Step ${index + 1} of ${tour.steps.length}: ${step.title}. ${body}`}</div>
    </>
  );
}

/** After one "Not now", stay quiet until the app is next opened so the offers never nag. */
let quiet = false;

/** One-time offer of a screen's tour the first time the screen is opened (plan 10.2). */
function TourPrompt({ start }: { start: (id: string) => void }): ReactNode {
  const loc = useLocation();
  const settings = useStore((s) => s.settings);
  const hasPlan = useStore((s) => !!s.settings.activePlanId);
  const tour = tourForRoute(loc.pathname);
  if (quiet || !tour || !hasPlan || !settings.onboarded || loc.pathname === '/') return null;
  if (
    settings.tours[tour.id]?.completed ||
    settings.tours[tour.id]?.dismissed ||
    settings.promptsDismissed.includes(tour.id)
  )
    return null;
  const dismiss = (): void =>
    useStore.getState().setSettings({ promptsDismissed: [...settings.promptsDismissed, tour.id] });
  return (
    <aside className="tour-prompt" aria-label="Tour suggestion" data-testid="tour-prompt">
      <span>
        <strong>New here?</strong> Take the {tour.minutes}-minute tour: {tour.title}.
      </span>
      <span className="lv-row">
        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            dismiss();
            start(tour.id);
          }}
        >
          Take the tour
        </Button>
        <Button
          size="sm"
          onClick={() => {
            quiet = true;
            dismiss();
          }}
        >
          Not now
        </Button>
      </span>
    </aside>
  );
}
