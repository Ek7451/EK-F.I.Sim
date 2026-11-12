import { create } from 'zustand';
import { usePlan } from './store';

interface View {
  year: number | null;
  hoverYear: number | null;
  range: [number, number];
  mode: 'accounts' | 'netWorth';
  axis: 'year' | 'age';
  inspector: boolean;
}
const initial: View = {
  year: null,
  hoverYear: null,
  range: [0, 100],
  mode: 'accounts',
  axis: 'year',
  inspector: true,
};
export const useWorkspace = create<{
  plans: Record<string, View>;
  set: (id: string, patch: Partial<View>) => void;
}>((set) => ({
  plans: {},
  set: (id, patch) =>
    set((s) => ({ plans: { ...s.plans, [id]: { ...(s.plans[id] ?? initial), ...patch } } })),
}));

/** View-only changes never touch the plan, history, persistence or engine. */
export function usePlanView(): View & { set: (patch: Partial<View>) => void } {
  const plan = usePlan();
  const view = useWorkspace((s) => s.plans[plan?.id ?? ''] ?? initial);
  return {
    ...view,
    set: (patch) => {
      if (plan) useWorkspace.getState().set(plan.id, patch);
    },
  };
}

export function useSelectedYear(): [number | null, (year: number | null) => void] {
  const view = usePlanView();
  return [view.year, (year) => view.set({ year })];
}
