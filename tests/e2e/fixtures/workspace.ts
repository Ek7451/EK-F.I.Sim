import { blankPlan, PlanZ, SAMPLE_PLANS, type Plan } from '../../../packages/engine/src';

/** Fixed dates and seeds: shared visual, reflow and numerical stress fixtures. */
export function workspaceFixtures(): Record<string, Plan> {
  const basic = SAMPLE_PLANS['sample-basic'](2026);
  const early = SAMPLE_PLANS['sample-early-retiree'](2026);
  const shortfall = structuredClone(basic);
  shortfall.incomes = [];
  shortfall.accounts.forEach((a) => {
    a.balance = 10000;
  });
  shortfall.expenses.forEach((e) => {
    e.amount *= 5;
  });
  const empty = blankPlan('empty', 'No income or assets', 2026);
  empty.people[0].socialSecurity.mode = 'none';
  const long = structuredClone(early);
  long.name =
    'A deliberately long household plan name with retirement, education and multigenerational goals';
  long.accounts.forEach((a) => {
    a.name += ' — long account name with several details for reflow verification';
  });
  long.milestones[0].name = 'Retire from the first career and begin a new phase together';
  const dense = structuredClone(early);
  for (let i = 0; i < 18; i++)
    dense.milestones.push({
      id: `dense-${i}`,
      name: `Family event ${i + 1}`,
      kind: 'custom',
      when: { type: 'year', year: 2030 + (i % 4) },
      effects: [],
    });
  const wealth = structuredClone(early);
  wealth.accounts.forEach((a) => {
    a.balance *= 1000;
    if (a.costBasis) a.costBasis *= 1000;
  });
  const many = structuredClone(basic);
  for (let i = 0; i < 60; i++)
    many.accounts.push({
      ...structuredClone(basic.accounts[0]),
      id: `account-${i}`,
      name: `Additional savings ${i + 1}`,
    });
  const plans = {
    basic,
    early,
    shortfall,
    near: SAMPLE_PLANS['sample-couple-ss'](2026),
    empty,
    long,
    dense,
    wealth,
    many,
  };
  return Object.fromEntries(
    Object.entries(plans).map(([id, p]) => {
      p.id = `fixture-${id}`;
      p.assumptions.monteCarlo.seed = 42;
      p.assumptions.monteCarlo.runs = 1000;
      return [id, PlanZ.parse(p)];
    }),
  );
}
