/** Lifespan helpers shared by the wizard, Household and Assumptions. */
import { bundledEngineData } from '@fisim/data/src/bundle';
import { survivalProbability, type Plan } from '@fisim/engine';
import { Switch } from '@fisim/ui';
import type { ReactNode } from 'react';
import { useUpdate } from '../state/store';

/**
 * Chance that someone born in `birthYear` and alive this year reaches `age`, from the bundled SSA period
 * life table. With no sex given it is the average of the male and female tables.
 */
export function survivalOdds(
  birthYear: number,
  sex: 'male' | 'female' | undefined,
  age: number,
  year: number,
): number | null {
  const now = year - birthYear;
  if (age <= now) return null;
  const table = bundledEngineData().mortality;
  return sex
    ? survivalProbability(table, sex, now, age)
    : (survivalProbability(table, 'female', now, age) + survivalProbability(table, 'male', now, age)) / 2;
}

/** One-line note shown under a plan-until age, or null when the age has already been reached. */
export function survivalNote(
  birthYear: number,
  sex: 'male' | 'female' | undefined,
  age: number,
  year: number,
): string | null {
  const odds = survivalOdds(birthYear, sex, age, year);
  if (odds === null) return null;
  const pct = odds < 0.01 ? 'under 1%' : `about ${Math.round(odds * 100)}%`;
  return `Chance of reaching ${age}: ${pct}${sex ? '' : ', average of men and women'} (SSA life tables).`;
}

/** True when any lifespan varies in simulations, whether set for the plan or (in older plans) per person. */
export function lifespansVary(plan: Plan): boolean {
  return (
    plan.assumptions.monteCarlo.stochasticLongevity ||
    plan.people.some((p) => p.longevity.mode === 'stochastic')
  );
}

/**
 * The single control for random lifespans. It is shown on Household and on Assumptions but is one
 * setting: turning it on or off applies to everyone in the plan.
 */
export function LifespanSwitch({ plan }: { plan: Plan }): ReactNode {
  const update = useUpdate();
  return (
    <Switch
      label="Let lifespans vary in simulations (SSA life tables)"
      checked={lifespansVary(plan)}
      onChange={(v) =>
        update((d) => {
          d.assumptions.monteCarlo.stochasticLongevity = v;
          for (const p of d.people) p.longevity.mode = v ? 'stochastic' : 'fixed';
        })
      }
      data-tour="lifespan-switch"
    />
  );
}
