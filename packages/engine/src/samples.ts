/** Built-in sample plans (plan 10.2). Used by guided tours, onboarding and tests. All people and figures are invented. */
import { PlanZ, type Plan, type PlanInput } from './schema';

const D = (dollars: number): number => Math.round(dollars * 100);
const stamp = '2026-01-01T00:00:00.000Z';

/** A new, empty plan for one person. */
export function blankPlan(id: string, name: string, startYear: number, birthYear = startYear - 35): Plan {
  return PlanZ.parse({
    id,
    schemaVersion: 1,
    name,
    createdAt: stamp,
    updatedAt: stamp,
    settings: { startYear },
    people: [
      {
        id: 'p1',
        name: 'You',
        birthDate: `${birthYear}-06-15`,
        residence: [{ state: 'TX', fromYear: startYear }],
      },
    ],
  } satisfies PlanInput);
}

/** sample-basic: a single person, working, a simple portfolio. */
export function sampleBasic(startYear = 2026): Plan {
  const input: PlanInput = {
    id: 'sample-basic',
    schemaVersion: 1,
    name: 'Sample: getting started',
    createdAt: stamp,
    updatedAt: stamp,
    settings: { startYear },
    people: [
      {
        id: 'p1',
        name: 'Riley',
        birthDate: `${startYear - 34}-04-12`,
        sex: 'female',
        longevity: { mode: 'fixed', age: 95 },
        residence: [{ state: 'CO', countyFips: '08031', fromYear: startYear }],
        socialSecurity: { mode: 'earnings', earnings: [], claimAge: { years: 67, months: 0 } },
      },
    ],
    accounts: [
      {
        id: 'a-cash',
        ownerId: 'p1',
        name: 'Savings',
        type: 'cash',
        balance: D(18000),
        fixedYield: { rate: 0.035, basis: 'nominal' },
      },
      {
        id: 'a-brokerage',
        ownerId: 'p1',
        name: 'Brokerage',
        type: 'taxable',
        balance: D(42000),
        costBasis: D(33000),
        allocation: { usStocks: 0.7, intlStocks: 0.2, usBonds: 0.1 },
        fees: { expenseRatio: 0.0005 },
      },
      {
        id: 'a-401k',
        ownerId: 'p1',
        name: '401(k)',
        type: 'trad401k',
        balance: D(96000),
        allocation: { usStocks: 0.6, intlStocks: 0.2, usBonds: 0.2 },
        fees: { expenseRatio: 0.002 },
        contribution: {
          incomeId: 'i-salary',
          employeePct: 0.1,
          employerMatch: [{ matchPct: 1, upToPctOfSalary: 0.04 }],
        },
        ruleOf55: true,
      },
      {
        id: 'a-roth',
        ownerId: 'p1',
        name: 'Roth IRA',
        type: 'rothIra',
        balance: D(31000),
        rothBasis: { contributions: D(24000), firstContributionYear: startYear - 8 },
        allocation: { usStocks: 0.8, intlStocks: 0.2 },
      },
    ],
    assets: [
      {
        id: 'as-car',
        ownerId: 'p1',
        name: 'Car',
        kind: 'vehicle',
        value: D(16000),
        appreciation: { rate: -0.12, basis: 'nominal' },
      },
    ],
    debts: [
      {
        id: 'd-student',
        ownerId: 'p1',
        name: 'Student loan',
        kind: 'student',
        principal: D(14500),
        rate: 0.049,
        payment: D(310),
      },
    ],
    incomes: [
      {
        id: 'i-salary',
        ownerId: 'p1',
        name: 'Salary',
        kind: 'wages',
        amount: D(92000),
        growth: { rate: 0.01, basis: 'real' },
        end: { type: 'milestone', milestoneId: 'm-retire', offset: 0 },
      },
    ],
    expenses: [
      { id: 'e-rent', name: 'Rent', category: 'housing', amount: D(21600) },
      { id: 'e-living', name: 'Everyday living', category: 'food', amount: D(19200) },
      { id: 'e-transport', name: 'Getting around', category: 'transport', amount: D(5400) },
      {
        id: 'e-fun',
        name: 'Travel and fun',
        category: 'travel',
        amount: D(7200),
        essential: false,
        followsPhases: true,
      },
      {
        id: 'e-newcar',
        name: 'Replace the car',
        category: 'transport',
        amount: D(28000),
        recurrence: { type: 'interval', everyYears: 10 },
        start: { type: 'year', year: startYear + 5 },
      },
    ],
    milestones: [
      {
        id: 'm-fi',
        name: 'Financially independent',
        kind: 'fi',
        when: { type: 'condition', metric: 'fi', fiMultiple: 25 },
      },
      {
        id: 'm-retire',
        name: 'Retire',
        kind: 'retirement',
        personId: 'p1',
        when: { type: 'age', personId: 'p1', age: 60 },
      },
    ],
    strategies: {
      surplusWaterfall: [
        { type: 'emergencyFund', accountId: 'a-cash', months: 6 },
        { type: 'account', accountId: 'a-roth' },
        { type: 'debt', debtId: 'd-student', maxAnnual: D(3000) },
        { type: 'account', accountId: 'a-brokerage' },
      ],
      spendingPhases: [
        { name: 'Go-go', fromAge: 60, multiplier: 1.15 },
        { name: 'Slow-go', fromAge: 75, multiplier: 0.9 },
        { name: 'No-go', fromAge: 85, multiplier: 0.7 },
      ],
    },
    healthcare: {
      enabled: true,
      people: [
        {
          personId: 'p1',
          coverage: [
            { type: 'employer', from: { type: 'year', year: startYear } },
            { type: 'aca', from: { type: 'milestone', milestoneId: 'm-retire', offset: 0 }, metal: 'silver' },
          ],
        },
      ],
    },
  };
  return PlanZ.parse(input);
}

/** sample-early-retiree: a couple retiring at 50 with an ACA bridge, a Roth ladder and taxable accounts. */
export function sampleEarlyRetiree(startYear = 2026): Plan {
  const input: PlanInput = {
    id: 'sample-early-retiree',
    schemaVersion: 1,
    name: 'Sample: retiring at 50',
    createdAt: stamp,
    updatedAt: stamp,
    settings: { startYear },
    people: [
      {
        id: 'p1',
        name: 'Morgan',
        birthDate: `${startYear - 47}-02-20`,
        sex: 'female',
        longevity: { mode: 'fixed', age: 95 },
        residence: [{ state: 'NC', countyFips: '37183', fromYear: startYear }],
        socialSecurity: { mode: 'pia', piaMonthly: D(2650), claimAge: { years: 67, months: 0 } },
      },
      {
        id: 'p2',
        name: 'Devon',
        birthDate: `${startYear - 47}-09-03`,
        sex: 'male',
        longevity: { mode: 'fixed', age: 92 },
        residence: [{ state: 'NC', countyFips: '37183', fromYear: startYear }],
        socialSecurity: { mode: 'pia', piaMonthly: D(2200), claimAge: { years: 67, months: 0 } },
      },
    ],
    household: { filingStatus: [{ fromYear: startYear, status: 'mfj' }] },
    accounts: [
      {
        id: 'a-cash',
        ownerId: 'joint',
        name: 'Cash reserve',
        type: 'cash',
        balance: D(90000),
        fixedYield: { rate: 0.035, basis: 'nominal' },
      },
      {
        id: 'a-brokerage',
        ownerId: 'joint',
        name: 'Joint brokerage',
        type: 'taxable',
        balance: D(720000),
        costBasis: D(430000),
        allocation: { usStocks: 0.6, intlStocks: 0.15, usBonds: 0.25 },
        fees: { expenseRatio: 0.0006 },
      },
      {
        id: 'a-401k-1',
        ownerId: 'p1',
        name: "Morgan's 401(k)",
        type: 'trad401k',
        balance: D(610000),
        allocation: { usStocks: 0.6, intlStocks: 0.1, usBonds: 0.3 },
        contribution: {
          incomeId: 'i-1',
          maxOut: true,
          employerMatch: [{ matchPct: 0.5, upToPctOfSalary: 0.06 }],
        },
      },
      {
        id: 'a-401k-2',
        ownerId: 'p2',
        name: "Devon's 401(k)",
        type: 'trad401k',
        balance: D(480000),
        allocation: { usStocks: 0.6, intlStocks: 0.1, usBonds: 0.3 },
        contribution: {
          incomeId: 'i-2',
          employeePct: 0.12,
          employerMatch: [{ matchPct: 1, upToPctOfSalary: 0.03 }],
        },
      },
      {
        id: 'a-roth-1',
        ownerId: 'p1',
        name: "Morgan's Roth IRA",
        type: 'rothIra',
        balance: D(140000),
        rothBasis: { contributions: D(82000), firstContributionYear: startYear - 15 },
        allocation: { usStocks: 0.8, intlStocks: 0.2 },
      },
      {
        id: 'a-roth-2',
        ownerId: 'p2',
        name: "Devon's Roth IRA",
        type: 'rothIra',
        balance: D(118000),
        rothBasis: { contributions: D(74000), firstContributionYear: startYear - 14 },
        allocation: { usStocks: 0.8, intlStocks: 0.2 },
      },
      {
        id: 'a-hsa',
        ownerId: 'p1',
        name: 'HSA',
        type: 'hsa',
        balance: D(46000),
        allocation: { usStocks: 0.7, usBonds: 0.3 },
      },
    ],
    assets: [
      {
        id: 'as-home',
        ownerId: 'joint',
        name: 'Home',
        kind: 'primaryHome',
        value: D(520000),
        costBasis: D(340000),
        appreciation: { rate: 0.005, basis: 'real' },
        property: { propertyTaxRate: 0.009, insuranceAnnual: D(2400), maintenanceRate: 0.01 },
      },
    ],
    debts: [
      {
        id: 'd-mortgage',
        ownerId: 'joint',
        name: 'Mortgage',
        kind: 'mortgage',
        principal: D(168000),
        rate: 0.0325,
        payment: D(1480),
        linkedAssetId: 'as-home',
        interestDeductible: true,
      },
    ],
    incomes: [
      {
        id: 'i-1',
        ownerId: 'p1',
        name: "Morgan's salary",
        kind: 'wages',
        amount: D(165000),
        growth: { rate: 0.005, basis: 'real' },
        end: { type: 'milestone', milestoneId: 'm-retire', offset: 0 },
      },
      {
        id: 'i-2',
        ownerId: 'p2',
        name: "Devon's salary",
        kind: 'wages',
        amount: D(118000),
        growth: { rate: 0.005, basis: 'real' },
        end: { type: 'milestone', milestoneId: 'm-retire', offset: 0 },
      },
    ],
    expenses: [
      { id: 'e-core', name: 'Core living', category: 'food', amount: D(52000) },
      {
        id: 'e-travel',
        name: 'Travel',
        category: 'travel',
        amount: D(14000),
        essential: false,
        followsPhases: true,
      },
      { id: 'e-giving', name: 'Giving', category: 'giving', amount: D(4000), essential: false },
    ],
    milestones: [
      {
        id: 'm-retire',
        name: 'Both retire',
        kind: 'retirement',
        when: { type: 'age', personId: 'p1', age: 50 },
      },
    ],
    strategies: {
      surplusWaterfall: [{ type: 'account', accountId: 'a-brokerage' }],
      withdrawalOrder: { strategy: 'taxableFirst' },
      rothConversion: {
        mode: 'fillBracket',
        bracketRate: 0.12,
        start: { type: 'milestone', milestoneId: 'm-retire', offset: 0 },
        end: { type: 'age', personId: 'p1', age: 65 },
      },
      magiTarget: { enabled: true, maxFplPct: 3.95, minFplPct: 1.4 },
      gainHarvest: { enabled: false },
      spendingPhases: [
        { name: 'Go-go', fromAge: 50, multiplier: 1.1 },
        { name: 'Slow-go', fromAge: 72, multiplier: 0.9 },
        { name: 'No-go', fromAge: 84, multiplier: 0.75 },
      ],
      survivorSpendingPct: 0.75,
    },
    healthcare: {
      enabled: true,
      people: [
        {
          personId: 'p1',
          coverage: [
            { type: 'employer', from: { type: 'year', year: startYear }, hdhp: true },
            {
              type: 'cobra',
              from: { type: 'milestone', milestoneId: 'm-retire', offset: 0 },
              cobraMonths: 6,
            },
            { type: 'aca', from: { type: 'milestone', milestoneId: 'm-retire', offset: 1 }, metal: 'silver' },
          ],
        },
        {
          personId: 'p2',
          coverage: [
            { type: 'spouseEmployer', from: { type: 'year', year: startYear }, hdhp: true },
            {
              type: 'cobra',
              from: { type: 'milestone', milestoneId: 'm-retire', offset: 0 },
              cobraMonths: 6,
            },
            { type: 'aca', from: { type: 'milestone', milestoneId: 'm-retire', offset: 1 }, metal: 'silver' },
          ],
        },
      ],
    },
  };
  return PlanZ.parse(input);
}

/** sample-couple-ss: a couple near retirement focused on Social Security, RMDs and IRMAA. */
export function sampleCoupleSs(startYear = 2026): Plan {
  const earnings = (birthYear: number, final: number): { year: number; amount: number }[] => {
    const out: { year: number; amount: number }[] = [];
    for (let y = birthYear + 23; y < startYear; y++)
      out.push({ year: y, amount: D(Math.round(final * Math.pow(1.035, y - startYear))) });
    return out;
  };
  const input: PlanInput = {
    id: 'sample-couple-ss',
    schemaVersion: 1,
    name: 'Sample: nearing retirement',
    createdAt: stamp,
    updatedAt: stamp,
    settings: { startYear },
    people: [
      {
        id: 'p1',
        name: 'Pat',
        birthDate: `${startYear - 63}-03-08`,
        sex: 'male',
        longevity: { mode: 'fixed', age: 90 },
        residence: [{ state: 'OH', countyFips: '39049', fromYear: startYear }],
        socialSecurity: {
          mode: 'earnings',
          earnings: earnings(startYear - 63, 150000),
          claimAge: { years: 70, months: 0 },
        },
      },
      {
        id: 'p2',
        name: 'Sam',
        birthDate: `${startYear - 61}-11-22`,
        sex: 'female',
        longevity: { mode: 'fixed', age: 96 },
        residence: [{ state: 'OH', countyFips: '39049', fromYear: startYear }],
        socialSecurity: {
          mode: 'earnings',
          earnings: earnings(startYear - 61, 48000),
          claimAge: { years: 67, months: 0 },
        },
      },
    ],
    household: { filingStatus: [{ fromYear: startYear, status: 'mfj' }] },
    accounts: [
      {
        id: 'a-cash',
        ownerId: 'joint',
        name: 'Savings',
        type: 'cash',
        balance: D(70000),
        fixedYield: { rate: 0.035, basis: 'nominal' },
      },
      {
        id: 'a-brokerage',
        ownerId: 'joint',
        name: 'Brokerage',
        type: 'taxable',
        balance: D(380000),
        costBasis: D(210000),
        allocation: { usStocks: 0.5, usBonds: 0.4, cash: 0.1 },
      },
      {
        id: 'a-ira-1',
        ownerId: 'p1',
        name: "Pat's rollover IRA",
        type: 'tradIra',
        balance: D(1650000),
        allocation: { usStocks: 0.5, usBonds: 0.45, cash: 0.05 },
        glidePathId: 'g-1',
      },
      {
        id: 'a-401k-1',
        ownerId: 'p1',
        name: "Pat's 401(k)",
        type: 'trad401k',
        balance: D(240000),
        allocation: { usStocks: 0.5, usBonds: 0.5 },
        contribution: {
          incomeId: 'i-1',
          maxOut: true,
          employerMatch: [{ matchPct: 0.5, upToPctOfSalary: 0.06 }],
        },
        ruleOf55: true,
      },
      {
        id: 'a-ira-2',
        ownerId: 'p2',
        name: "Sam's IRA",
        type: 'tradIra',
        balance: D(310000),
        allocation: { usStocks: 0.5, usBonds: 0.5 },
      },
      {
        id: 'a-roth-2',
        ownerId: 'p2',
        name: "Sam's Roth IRA",
        type: 'rothIra',
        balance: D(95000),
        rothBasis: { contributions: D(60000), firstContributionYear: startYear - 12 },
        allocation: { usStocks: 0.7, usBonds: 0.3 },
      },
    ],
    glidePaths: [
      {
        id: 'g-1',
        name: 'Ease into bonds',
        points: [
          { age: 63, allocation: { usStocks: 0.55, usBonds: 0.4, cash: 0.05 } },
          { age: 80, allocation: { usStocks: 0.4, usBonds: 0.5, cash: 0.1 } },
        ],
      },
    ],
    assets: [
      {
        id: 'as-home',
        ownerId: 'joint',
        name: 'Home',
        kind: 'primaryHome',
        value: D(410000),
        costBasis: D(180000),
        appreciation: { rate: 0, basis: 'real' },
        property: { propertyTaxRate: 0.015, insuranceAnnual: D(1900), maintenanceRate: 0.01 },
      },
    ],
    incomes: [
      {
        id: 'i-1',
        ownerId: 'p1',
        name: "Pat's salary",
        kind: 'wages',
        amount: D(150000),
        growth: { rate: 0, basis: 'real' },
        end: { type: 'milestone', milestoneId: 'm-retire', offset: 0 },
      },
      {
        id: 'i-pension',
        ownerId: 'p2',
        name: "Sam's pension",
        kind: 'pension',
        amount: D(21600),
        taxCharacter: 'ordinary',
        pension: { cola: { rate: 0.01, basis: 'nominal' }, survivorPct: 0.5 },
      },
    ],
    expenses: [
      { id: 'e-core', name: 'Core living', category: 'food', amount: D(64000) },
      {
        id: 'e-travel',
        name: 'Travel',
        category: 'travel',
        amount: D(18000),
        essential: false,
        followsPhases: true,
      },
    ],
    milestones: [
      {
        id: 'm-retire',
        name: 'Pat retires',
        kind: 'retirement',
        personId: 'p1',
        when: { type: 'age', personId: 'p1', age: 65 },
      },
    ],
    strategies: {
      surplusWaterfall: [{ type: 'account', accountId: 'a-brokerage' }],
      withdrawalOrder: { strategy: 'bracketTargeted', bracketRate: 0.22 },
      rothConversion: {
        mode: 'fillBracket',
        bracketRate: 0.22,
        start: { type: 'milestone', milestoneId: 'm-retire', offset: 0 },
        end: { type: 'age', personId: 'p1', age: 73 },
      },
      spendingPhases: [
        { name: 'Go-go', fromAge: 65, multiplier: 1.1 },
        { name: 'Slow-go', fromAge: 76, multiplier: 0.9 },
        { name: 'No-go', fromAge: 86, multiplier: 0.75 },
      ],
      survivorSpendingPct: 0.7,
    },
    healthcare: {
      enabled: true,
      people: [
        {
          personId: 'p1',
          coverage: [{ type: 'employer', from: { type: 'year', year: startYear } }],
          medicare: { supplement: 'medigapG' },
        },
        {
          personId: 'p2',
          coverage: [
            { type: 'spouseEmployer', from: { type: 'year', year: startYear } },
            { type: 'aca', from: { type: 'milestone', milestoneId: 'm-retire', offset: 0 }, metal: 'silver' },
          ],
          medicare: { supplement: 'medigapN' },
          ltc: { mode: 'expected', careType: 'assistedLiving', onsetAge: 90, years: 3 },
        },
      ],
    },
  };
  return PlanZ.parse(input);
}

export const SAMPLE_PLANS = {
  'sample-basic': sampleBasic,
  'sample-early-retiree': sampleEarlyRetiree,
  'sample-couple-ss': sampleCoupleSs,
} as const;
export type SamplePlanId = keyof typeof SAMPLE_PLANS;
