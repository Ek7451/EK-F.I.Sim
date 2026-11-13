import { loadEngineData } from '@fisim/data/src/node';
import { PlanZ, SAMPLE_PLANS, project } from '@fisim/engine';
import { describe, expect, it } from 'vitest';
import { buildPlan } from '../pages/StartWizard';
import { fundedStat, fundedSummary } from './outcome';

const data = loadEngineData();
const year = 2026;

describe('projection chart parts', () => {
  it.each(Object.keys(SAMPLE_PLANS))(
    '%s: account types plus assets minus debts equal net worth every year',
    (id) => {
      const plan = PlanZ.parse(SAMPLE_PLANS[id as keyof typeof SAMPLE_PLANS]());
      const r = project(plan, data);
      for (const x of r.records) {
        const k = x.byKind;
        const parts = k.cash + k.taxable + k.pretax + k.roth + k.hsa + k.other + x.assets - x.debts;
        expect(Math.abs(parts - x.netWorth), `${id} ${x.year}`).toBeLessThan(1);
      }
    },
  );
});

describe('spending covered', () => {
  it('says how many years run short and when it starts', () => {
    const plan = PlanZ.parse(SAMPLE_PLANS['sample-basic']());
    // Spend far more than this household can afford so it runs short.
    plan.expenses[0].amount *= 6;
    const r = project(plan, data);
    const f = fundedSummary(r);
    expect(f.covered).toBe(false);
    expect(f.firstShort?.year).toBe(r.summary.failedYear);
    expect(fundedStat(r).value).toBe(`Short in ${f.shortYears} of ${r.records.length} years`);
  });
});

type Draft = Parameters<typeof buildPlan>[0];
const person = (o: Partial<Draft['people'][0]> = {}): Draft['people'][0] => ({
  name: 'Sam',
  birthYear: 1986,
  birthMonth: 6,
  sex: 'female',
  planUntil: 95,
  salary: 100000,
  deferPct: 0.1,
  roth: false,
  matchPct: 0.5,
  matchUpTo: 0.06,
  pretax: 50000,
  rothBalance: 10000,
  brokerage: 30000,
  hsa: 0,
  hsaContribution: 0,
  retireAge: 60,
  ...o,
});
const draft = (o: Partial<Draft> = {}): Draft => ({
  state: 'TX',
  partner: false,
  people: [person(), person({ name: 'Alex', salary: 70000, deferPct: 0.05, retireAge: 64, birthYear: 1984 })],
  cash: 20000,
  spending: 60000,
  phases: false,
  ...o,
});

describe('new-plan wizard', () => {
  it('gives each earner their own retirement plan, match and retirement age', () => {
    const plan = PlanZ.parse(buildPlan(draft({ partner: true }), year));
    expect(plan.people.map((p) => p.longevity.age)).toEqual([95, 95]);
    const k1 = plan.accounts.find((a) => a.id === 'a-401k-p1')!;
    const k2 = plan.accounts.find((a) => a.id === 'a-401k-p2')!;
    expect(k1.ownerId).toBe('p1');
    expect(k2.ownerId).toBe('p2');
    expect(k1.contribution?.incomeId).toBe('i-p1');
    expect(k2.contribution?.incomeId).toBe('i-p2');
    expect(k2.contribution?.employeePct).toBe(0.05);
    expect(k2.contribution?.employerMatch).toEqual([{ matchPct: 0.5, upToPctOfSalary: 0.06 }]);
    // The partner's pay ends at the partner's own retirement, not at the first person's.
    const i2 = plan.incomes.find((i) => i.id === 'i-p2')!;
    expect(i2.end).toEqual({ type: 'milestone', milestoneId: 'm-retire-p2', offset: 0 });
    const m2 = plan.milestones.find((m) => m.id === 'm-retire-p2')!;
    expect(m2.when).toEqual({ type: 'age', personId: 'p2', age: 64 });
    // Both partners actually contribute in year one.
    const r = project(plan, data);
    expect(r.records[0].contributions.pretax).toBeGreaterThan(100000 * 0.1 + 70000 * 0.05 - 1);
  });

  it('sends Roth deferrals to a Roth 401(k) and the match to the pre-tax plan', () => {
    const plan = PlanZ.parse(buildPlan(draft({ people: [person({ roth: true }), person()] }), year));
    const roth = plan.accounts.find((a) => a.id === 'a-roth401k-p1')!;
    expect(roth.type).toBe('roth401k');
    expect(roth.contribution?.employeePct).toBe(0.1);
    expect(plan.accounts.find((a) => a.id === 'a-401k-p1')?.contribution).toBeUndefined();
    const r = project(plan, data);
    expect(r.records[0].contributions.roth).toBeGreaterThan(9999);
    expect(r.records[0].contributions.employer).toBeGreaterThan(2999);
  });

  it('gives each partner their own brokerage account and health savings account', () => {
    const plan = PlanZ.parse(
      buildPlan(
        draft({
          partner: true,
          people: [
            person({ brokerage: 120000, hsa: 18000, hsaContribution: 4000 }),
            person({ name: 'Alex', salary: 70000, brokerage: 45000, hsa: 6000, hsaContribution: 0 }),
          ],
        }),
        year,
      ),
    );
    const by = (id: string) => plan.accounts.find((a) => a.id === id)!;
    expect(by('a-brokerage-p1')).toMatchObject({ ownerId: 'p1', type: 'taxable', balance: 12000000 });
    expect(by('a-brokerage-p2')).toMatchObject({ ownerId: 'p2', type: 'taxable', balance: 4500000 });
    expect(by('a-brokerage-p1').name).toBe("Sam's brokerage");
    expect(by('a-brokerage-p2').name).toBe("Alex's brokerage");
    expect(by('a-hsa-p1')).toMatchObject({ ownerId: 'p1', type: 'hsa', balance: 1800000 });
    expect(by('a-hsa-p2')).toMatchObject({ ownerId: 'p2', type: 'hsa', balance: 600000 });
    expect(plan.accounts.some((a) => a.ownerId === 'joint' && a.type === 'taxable')).toBe(false);
    // Sam pays into the HSA from pay, so Sam is on a high-deductible plan and the money actually goes in.
    expect(by('a-hsa-p1').contribution?.employeeAmount).toBe(400000);
    expect(by('a-hsa-p2').contribution).toBeUndefined();
    const r = project(plan, data);
    expect(r.records[0].contributions.hsa).toBeGreaterThan(3999);
    // Money left over still has somewhere to land.
    expect(plan.strategies.surplusWaterfall.at(-1)).toEqual({ type: 'account', accountId: 'a-brokerage-p1' });
  });

  it('a single person gets one brokerage account, and an HSA only when there is one', () => {
    const plan = PlanZ.parse(buildPlan(draft(), year));
    expect(plan.accounts.filter((a) => a.type === 'taxable').map((a) => a.name)).toEqual(['Brokerage']);
    expect(plan.accounts.some((a) => a.type === 'hsa')).toBe(false);
  });

  it('keeps spending level unless the age phases are chosen', () => {
    expect(PlanZ.parse(buildPlan(draft(), year)).strategies.spendingPhases).toEqual([]);
    expect(PlanZ.parse(buildPlan(draft({ phases: true }), year)).strategies.spendingPhases.length).toBe(3);
  });
});
