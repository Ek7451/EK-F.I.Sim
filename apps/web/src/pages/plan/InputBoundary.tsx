import { Button } from '@fisim/ui';
import { useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { InputWriteContext, usePlan, useStore } from '../../state/store';
import { useDraft } from '../../state/draft';
import { PageHead } from '../../shell/Shell';

export function InputBoundary() {
  const base = usePlan()!;
  const scenario = useStore((s) => s.scenarioId);
  const transaction = useDraft((s) => s.transaction);
  const route = useLocation();
  const [blockedAt, setBlockedAt] = useState<string | null>(null);
  if (scenario)
    return (
      <>
        <PageHead title="Edit base plan" />
        <p>You are viewing a scenario. Plan inputs belong to {base.name}.</p>
        <div className="lv-row">
          <Button onClick={() => useStore.getState().setScenario(null)}>Edit base plan</Button>
          <Link to="/compare">Compare scenarios</Link>
        </div>
      </>
    );
  if (blockedAt === route.key && transaction?.base.id === base.id)
    return (
      <>
        <PageHead title="Finish your preview" />
        <p>
          This input saves directly to {base.name}. Review your draft to apply it, save it as a scenario, or
          discard it before editing this input.
        </p>
        <div className="lv-row">
          <Link className="lv-btn" to="/explore/projection">
            Review draft
          </Link>
          <Button
            onClick={() => {
              useDraft.getState().discard();
              setBlockedAt(null);
            }}
          >
            Discard draft and edit
          </Button>
          <Button onClick={() => setBlockedAt(null)}>Keep browsing</Button>
        </div>
      </>
    );
  const write: ReturnType<typeof useStore.getState>['update'] = (...args) => {
    if (useDraft.getState().transaction?.base.id === base.id) {
      setBlockedAt(route.key);
      return;
    }
    useStore.getState().update(...args);
  };
  return (
    <InputWriteContext.Provider value={write}>
      <Outlet key={base.id} />
    </InputWriteContext.Provider>
  );
}
