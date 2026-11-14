/**
 * Guided-tour engine (UX-10). Tours are data (see catalog.ts); this renders them: a spotlight on the target, a step
 * card (popover on wide screens, sheet on phones), keyboard support and saved progress. A tour runs in a sandbox on a
 * sample plan, or in observe-only mode on the user's own plan with changes switched off.
 */
import './tour.css';
import { loadEngine } from '../engine/load';
import { Button, Icon, formatCompact, formatPct } from '@fisim/ui';
import { autoUpdate, flip, offset, shift, useFloating } from '@floating-ui/react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
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
  if (r.width <= 0 || r.height <= 0) return false;
  // What is inside a closed <details> can still report a size in some browsers; it is not on screen.
  for (let d = el.parentElement?.closest('details'); d; d = d.parentElement?.closest('details'))
    if (!d.open && !d.querySelector(':scope > summary')?.contains(el)) return false;
  return true;
};
/** First visible element for a `a|b` anchor list. */
export function findTarget(target: string | undefined): HTMLElement | null {
  if (!target) return null;
  for (const name of target.split('|')) {
    for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`))
      if (visible(el)) return el;
  }
  // A target inside a folded section: open the fold(s) around it so the tour can point at it.
  for (const name of target.split('|')) {
    for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)) {
      let opened = false;
      for (let d = el.parentElement?.closest('details'); d; d = d.parentElement?.closest('details'))
        if (!d.open) {
          d.open = true;
          opened = true;
        }
      if (opened && visible(el)) return el;
    }
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
  // The target found for this step. Keyed by the step, so the previous step's target is never shown for this one.
  const [found, setFound] = useState<{ step: TourStep; el: HTMLElement } | null>(null);
  const el = found?.step === step ? found.el : null;
  // The target could not be found in time: the card shows in the middle instead.
  const [lost, setLost] = useState<TourStep | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  // True once the target has stopped moving (after the scroll that brings it into view). Until then the spotlight
  // and the card stay hidden, so they appear in place instead of opening elsewhere and sliding over.
  const [settled, setSettled] = useState(false);
  const [acted, setActed] = useState(false);
  const card = useRef<HTMLDivElement | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const last = index === tour.steps.length - 1;

  // Go to the step's screen, then wait for its target to appear.
  useLayoutEffect(() => {
    if (loc.pathname !== step.route) {
      nav(step.route);
      return;
    }
    if (!step.target) return;
    let tries = 0;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const look = (): boolean => {
      const target = findTarget(step.target);
      if (!target) return false;
      // A folded section that is itself the target opens, so the step can point at what it describes.
      if (target instanceof HTMLDetailsElement && !target.open) target.open = true;
      target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
      setFound({ step, el: target });
      return true;
    };
    if (look()) return;
    const t = setInterval(() => {
      if (look()) clearInterval(t);
      else if (++tries > 40) {
        clearInterval(t);
        setLost(step);
      }
    }, 100);
    return () => clearInterval(t);
  }, [loc.pathname, step, nav]);

  // Follow the target every frame (scrolling, reflow), and note when it has come to rest.
  useLayoutEffect(() => {
    setSettled(false);
    if (!el) {
      setRect(null);
      return;
    }
    const same = (a: DOMRect | null, b: DOMRect): boolean =>
      !!a && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
    let prev: DOMRect | null = null;
    let still = 0;
    let rested = false;
    let raf = 0;
    const tick = (): void => {
      if (!el.isConnected) {
        // The screen re-rendered the target: find the new one.
        const again = findTarget(step.target);
        if (again) setFound({ step, el: again });
        else setLost(step);
        return;
      }
      const r = el.getBoundingClientRect();
      // A few unchanged frames in a row: the smooth scroll has finished (or never needed to start).
      still = same(prev, r) ? still + 1 : 0;
      if (!rested && still >= 4) {
        rested = true;
        setSettled(true);
      }
      prev = r;
      setRect((p) => (same(p, r) ? p : r));
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [el, step]);

  // "Try it" steps: notice when the user uses the control.
  useEffect(() => {
    if (!el || !step.action) return;
    const on = (): void => setActed(true);
    const types = step.action.on === 'click' ? ['click'] : ['input', 'change'];
    types.forEach((t) => el.addEventListener(t, on));
    return () => types.forEach((t) => el.removeEventListener(t, on));
  }, [el, step.action]);

  // Esc leaves; arrows step when focus is in the card.
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
  // Hidden while the step's target is still being found or scrolled to; a step with no target shows at once.
  const ready = el ? settled && !!rect : !step.target || lost === step;
  const lit = !!el && !!rect && settled;
  // Focus moves to the card on every step, once it is on screen (a hidden card cannot take focus).
  useEffect(() => {
    if (ready) heading.current?.focus({ preventScroll: true });
  }, [ready]);
  const pad = 6;
  const spot: React.CSSProperties =
    lit && rect
      ? {
          left: rect.left - pad,
          top: rect.top - pad,
          width: rect.width + pad * 2,
          height: rect.height + pad * 2,
        }
      : {};

  return (
    <>
      <div className="tour-spot" style={spot} data-empty={!lit} aria-hidden="true" />
      <div
        ref={setCard}
        className="tour-card lv-night"
        data-sheet={phone}
        data-ready={ready}
        style={style}
        role="dialog"
        aria-modal="false"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        data-testid="tour-card"
      >
        <div className="tour-head">
          <span className="tour-kicker" data-testid="tour-progress">
            {tour.title} · step {index + 1} of {tour.steps.length}
          </span>
          <button
            type="button"
            className="tour-close"
            aria-label="Leave the tour"
            title="Leave the tour (Esc)"
            onClick={stop}
          >
            <Icon name="close" size={15} />
          </button>
        </div>
        <h2 id="tour-title" ref={heading} tabIndex={-1}>
          {step.title}
        </h2>
        <p id="tour-body">{body}</p>
        {step.action ? (
          <p className="tour-try" data-done={acted}>
            <Icon name={acted ? 'check' : 'sparkle'} size={14} />
            {acted ? 'Done. Press Next when you are ready.' : step.action.prompt}
          </p>
        ) : null}
        {step.explain ? (
          <Link className="tour-link" to={`/help/methods#${step.explain}`} onClick={stop}>
            How this is calculated
          </Link>
        ) : null}
        <div className="tour-pips" aria-hidden="true">
          {tour.steps.map((_, i) => (
            <i key={i} data-on={i < index} data-now={i === index} />
          ))}
        </div>
        <div className="tour-foot">
          <span className="tour-keys" aria-hidden="true">
            <kbd>←</kbd> <kbd>→</kbd> move · <kbd>Esc</kbd> leave
          </span>
          <span className="tour-nav">
            {index > 0 ? (
              <Button size="sm" variant="ghost" onClick={() => go(-1)}>
                Back
              </Button>
            ) : null}
            <Button size="sm" variant="primary" onClick={() => go(1)} data-testid="tour-next">
              {last ? 'Finish' : 'Next'}
            </Button>
          </span>
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
    <aside className="tour-prompt lv-night" aria-label="Tour suggestion" data-testid="tour-prompt">
      <Icon name="sparkle" size={15} />
      <span className="tour-prompt-text">
        New here? <strong>{tour.title}</strong>, a {tour.minutes}-minute tour.
      </span>
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
        variant="ghost"
        icon="close"
        label="Not now"
        onClick={() => {
          quiet = true;
          dismiss();
        }}
      />
    </aside>
  );
}
