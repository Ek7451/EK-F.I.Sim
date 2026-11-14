import { Component, Suspense, lazy, type ComponentType, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { Icon, Skeleton } from '@fisim/ui';
// The landing screens ship in the first download: no second round trip, and no layout shift, before first paint.
import { HomePage } from './pages/Home';
import { StartPage } from './pages/StartWizard';
import { Shell } from './shell/Shell';
import { logError } from './state/db';
import { usePlan, useStore } from './state/store';
import { TourProvider } from './tours/TourEngine';

/** Screens load on demand so the first view stays small (plan 13). */
const page = <M,>(load: () => Promise<M>, name: keyof M): ComponentType =>
  lazy(() => load().then((m) => ({ default: m[name] as ComponentType })));

const help = (): Promise<typeof import('./pages/HelpSettings')> => import('./pages/HelpSettings');
const incomeSpending = (): Promise<typeof import('./pages/plan/IncomeSpending')> =>
  import('./pages/plan/IncomeSpending');
const health = (): Promise<typeof import('./pages/plan/HealthAssumptions')> =>
  import('./pages/plan/HealthAssumptions');

const HouseholdPage = page(() => import('./pages/plan/Household'), 'HouseholdPage');
const SnapshotPage = page(() => import('./pages/plan/Snapshot'), 'SnapshotPage');
const IncomePage = page(incomeSpending, 'IncomePage');
const SpendingPage = page(incomeSpending, 'SpendingPage');
const TimelinePage = page(() => import('./pages/plan/Timeline'), 'TimelinePage');
const StrategyPage = page(() => import('./pages/plan/Strategy'), 'StrategyPage');
const HealthcarePage = page(health, 'HealthcarePage');
const AssumptionsPage = page(health, 'AssumptionsPage');
const ProjectionPage = page(() => import('./pages/explore/Projection'), 'ProjectionPage');
const CashFlowPage = page(() => import('./pages/explore/CashFlow'), 'CashFlowPage');
const TaxesPage = page(() => import('./pages/explore/Taxes'), 'TaxesPage');
const SuccessPage = page(() => import('./pages/explore/Success'), 'SuccessPage');
const HistoryPage = page(() => import('./pages/explore/History'), 'HistoryPage');
const EstatePage = page(() => import('./pages/explore/Estate'), 'EstatePage');
const ComparePage = page(() => import('./pages/analysis/Compare'), 'ComparePage');
const TrackPage = page(() => import('./pages/analysis/Track'), 'TrackPage');
const ReportsPage = page(() => import('./pages/analysis/Reports'), 'ReportsPage');
const ToursPage = page(help, 'ToursPage');
const MethodsPage = page(help, 'MethodsPage');
const SettingsPage = page(help, 'SettingsPage');

/** Screens that need a plan send a first-time visitor to the setup wizard. */
function RequirePlan(): ReactNode {
  const plan = usePlan();
  return plan ? (
    <Outlet />
  ) : (
    <>
      <Navigate to="/start" replace />
      <StartPage />
    </>
  );
}

/**
 * The outline of a screen (head, headline band, two cards) shown while it loads, so the layout does not jump
 * when it arrives. The words are for assistive tech; the shapes are decoration.
 */
function ScreenPlaceholder({ label }: { label: string }): ReactNode {
  return (
    <div className="lv-placeholder" role="status" aria-live="polite">
      <span className="lv-sr">{label}</span>
      <Skeleton height={26} width="38%" />
      <span className="lv-placeholder-band" aria-hidden="true" />
      <div className="lv-placeholder-grid" aria-hidden="true">
        <Skeleton height={320} />
        <Skeleton height={320} />
      </div>
    </div>
  );
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }
  override componentDidCatch(error: Error): void {
    void logError(`render: ${error.message}\n${error.stack ?? ''}`);
  }
  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="lv-card lv-state" role="alert">
        <span className="lv-state-mark" data-tone="danger" aria-hidden="true">
          <Icon name="warning" size={22} />
        </span>
        <h1>Something went wrong on this screen</h1>
        <p>
          Your plans are safe on this device. Reload to carry on. If it keeps happening, download the error
          log under Settings.
        </p>
        <div className="lv-row">
          <button
            type="button"
            className="lv-btn"
            data-variant="primary"
            onClick={() => window.location.assign('/')}
          >
            Reload
          </button>
          <a className="lv-btn" href="/settings">
            Settings
          </a>
        </div>
      </div>
    );
  }
}

export function App({
  updateReady,
  applyUpdate,
}: {
  updateReady: boolean;
  applyUpdate: () => void;
}): ReactNode {
  const ready = useStore((s) => s.ready);
  if (!ready)
    return (
      <div style={{ padding: 20 }}>
        <ScreenPlaceholder label="Opening your plans…" />
      </div>
    );
  return (
    <BrowserRouter>
      <TourProvider>
        <Routes>
          <Route element={<Shell updateReady={updateReady} applyUpdate={applyUpdate} />}>
            <Route
              element={
                <ErrorBoundary>
                  <Suspense fallback={<ScreenPlaceholder label="Loading…" />}>
                    <Outlet />
                  </Suspense>
                </ErrorBoundary>
              }
            >
              <Route path="/start" element={<StartPage />} />
              <Route path="/help/tours" element={<ToursPage />} />
              <Route path="/help/methods" element={<MethodsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route element={<RequirePlan />}>
                <Route path="/" element={<HomePage />} />
                <Route path="/plan/household" element={<HouseholdPage />} />
                <Route path="/plan/snapshot" element={<SnapshotPage />} />
                <Route path="/plan/income" element={<IncomePage />} />
                <Route path="/plan/spending" element={<SpendingPage />} />
                <Route path="/plan/timeline" element={<TimelinePage />} />
                <Route path="/plan/strategy" element={<StrategyPage />} />
                <Route path="/plan/healthcare" element={<HealthcarePage />} />
                <Route path="/plan/assumptions" element={<AssumptionsPage />} />
                <Route path="/explore/projection" element={<ProjectionPage />} />
                <Route path="/explore/cashflow" element={<CashFlowPage />} />
                <Route path="/explore/taxes" element={<TaxesPage />} />
                <Route path="/explore/success" element={<SuccessPage />} />
                <Route path="/explore/history" element={<HistoryPage />} />
                <Route path="/explore/estate" element={<EstatePage />} />
                <Route path="/compare" element={<ComparePage />} />
                <Route path="/track" element={<TrackPage />} />
                <Route path="/reports" element={<ReportsPage />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Route>
        </Routes>
      </TourProvider>
    </BrowserRouter>
  );
}
