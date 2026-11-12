/**
 * Parity-matrix coverage (docs/parity-matrix.md): one describe block per feature row that had no dedicated test.
 * Every expectation is worked out by hand from the inputs and the bundled 2026/2027 data files; the comments show
 * the arithmetic. Plans use flat (zero) returns and no inflation wherever that makes the numbers exact.
 *
 * Tests commented "Regression" pin engine bugs found by this file and since fixed.
 */
import { loadEngineData } from '@fisim/data/src/node';
import { describe, expect, it } from 'vitest';
import {
  acaExpectedOop,
  compilePlan,
  fixedPath,
  generatePath,
  pickYear,
  PlanZ,
  project,
  runPath,
  type Plan,
  type YearRecord,
} from '../src';

const data = loadEngineData();
const D = (n: number): number => Math.round(n * 100);

type Over = Record<string, unknown>;
const person = (id: string, birthDate: string, extra: Over = {}): Over => ({
  id,
  name: id,
  birthDate,
  residence: [{ state: 'TX', fromYear: 2026 }],
  socialSecurity: { mode: 'none' },
  longevity: { age: 95 },
  ...extra,
});
/** Zero returns on every class, no dividends or bond interest. */
const flat = (extra: Over = {}): Over => ({
  returns: { fixed: { usStocks: 0, usBonds: 0, cash: 0, intlStocks: 0, reits: 0 } },
  dividendYield: 0,
  bondYield: 0,
  ...extra,
});
const mk = (o: Over): Plan =>
  PlanZ.parse({
    id: 't',
    schemaVersion: 2,
    name: 't',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    settings: { startYear: 2026, timing: 'end' },
    healthcare: { enabled: false },
    ...o,
  });
const cash = (id: string, dollars: number, owner = 'p1'): Over => ({
  id,
  ownerId: owner,
  name: id,
  type: 'cash',
  balance: D(dollars),
  fixedYield: { rate: 0, basis: 'nominal' },
});
const rec = (recs: YearRecord[], year: number): YearRecord => {
  const r = recs.find((x) => x.year === year);
  if (!r) throw new Error(`no record for ${year}`);
  return r;
};
const run = (p: Plan): YearRecord[] => project(p, data).records;

// ------------------------------------------------------------------------------------------------ PLAN-02
describe('PLAN-02 inherited IRA, annuity and I-bond accounts', () => {
  const inherited = (o: { yearOfDeath: number; started: boolean; timing?: string; ret?: number }): Plan =>
    mk({
      settings: { startYear: 2026, timing: o.timing ?? 'end' },
      people: [person('p1', '1976-03-01')],
      accounts: [
        cash('c', 500000),
        {
          id: 'inh',
          ownerId: 'p1',
          name: 'Inherited IRA',
          type: 'inheritedIra',
          balance: D(100000),
          allocation: { usStocks: 1 },
          inherited: { yearOfDeath: o.yearOfDeath, decedentHadStartedRmds: o.started },
        },
      ],
      strategies: { surplusDefaultAccountId: 'c' },
      assumptions: o.ret
        ? flat({ returns: { fixed: { usStocks: o.ret, usBonds: 0, cash: 0, intlStocks: 0, reits: 0 } } })
        : flat(),
    });

  it('10-year rule without prior RMDs: nothing required until the 10th year, then the whole balance', () => {
    // Death in 2020: 2026 is year 6 after death. Years 6-9 (2026-2029) need nothing; year 10 (2030) empties it.
    const r = run(inherited({ yearOfDeath: 2020, started: false }));
    for (const y of [2026, 2027, 2028, 2029]) {
      expect(rec(r, y).withdrawals.rmd).toBe(0);
      expect(rec(r, y).balances.inh).toBeCloseTo(100000, 6);
    }
    const y10 = rec(r, 2030);
    expect(y10.withdrawals.rmd).toBeCloseTo(100000, 6);
    expect(y10.balances.inh ?? 0).toBeCloseTo(0, 6);
    // Taxed as ordinary income, with no 10% penalty even though the beneficiary is 54.
    expect(y10.taxes.agi).toBeCloseTo(100000, 0);
    expect(y10.taxes.penalties).toBe(0);
  });

  it('decedent had started RMDs: single-life divisor less one each year, empty by year 10', () => {
    // Death in 2025, beneficiary born 1976 is 50 in 2026: divisor = singleLife[50] = 36.2, then 35.2, 34.2, ...
    const sl50 = data.rmd.singleLife['50'];
    expect(sl50).toBe(36.2);
    const r = run(inherited({ yearOfDeath: 2025, started: true }));
    let bal = 100000;
    for (let i = 0; i < 9; i++) {
      const want = bal / (sl50 - i); // 2026: 100,000 / 36.2 = 2,762.43
      expect(rec(r, 2026 + i).withdrawals.rmd).toBeCloseTo(want, 4);
      bal -= want;
    }
    // 2035 = year 10 after death: whatever is left comes out.
    expect(rec(r, 2035).withdrawals.rmd).toBeCloseTo(bal, 4);
    expect(rec(r, 2035).balances.inh ?? 0).toBeCloseTo(0, 4);
    expect(rec(r, 2026).withdrawals.rmd).toBeCloseTo(2762.43, 2);
  });

  // Regression: the year-10 clean-out withdrew the prior year-end balance, and with mid- or end-of-year timing the
  // account still earned that year's return, leaving 146,410 x (1.10 - sqrt(1.10)) = 7,494.90 past the deadline. The
  // clean-out is now taken at the start of the year, so the account is empty by 31 December of year 10.
  it('10-year rule leaves nothing in the account after the deadline year (mid-year timing)', () => {
    const r = run(inherited({ yearOfDeath: 2020, started: false, timing: 'mid', ret: 0.1 }));
    expect(rec(r, 2030).balances.inh ?? 0).toBeLessThan(1);
  });

  it('an annuity income stream pays its amount and taxes only the part above the exclusion ratio', () => {
    // $60,000 a year, flat nominal; 25% of each payment is return of basis, so $45,000 is taxable.
    const r = run(
      mk({
        people: [person('p1', '1956-03-01')],
        accounts: [cash('c', 10000)],
        incomes: [
          {
            id: 'ann',
            ownerId: 'p1',
            name: 'SPIA',
            kind: 'annuity',
            amount: D(60000),
            growth: { rate: 0, basis: 'nominal' },
            taxCharacter: 'ordinary',
            annuityExclusionRatio: 0.25,
          },
        ],
        assumptions: flat(),
      }),
    );
    for (const y of [2026, 2030]) {
      expect(rec(r, y).income.annuity).toBeCloseTo(60000, 6);
      expect(rec(r, y).taxes.agi).toBeCloseTo(45000, 4);
    }
  });

  const deferredAnnuity = (birth: string): Plan =>
    mk({
      people: [person('p1', birth)],
      accounts: [
        {
          id: 'ann',
          ownerId: 'p1',
          name: 'Deferred annuity',
          type: 'annuity',
          balance: D(100000),
          costBasis: D(95000),
        },
      ],
      expenses: [{ id: 'e', name: 'Living', category: 'other', amount: D(30000) }],
      assumptions: flat(),
    });
  it('a deferred annuity is drawn gains first: only the $5,000 of gain is taxable', () => {
    // Balance 100,000, basis 95,000. Age 66: no penalty. The first $5,000 out is gain (ordinary), the rest basis.
    const y = run(deferredAnnuity('1960-03-01'))[0];
    expect(y.withdrawals.other).toBeCloseTo(30000, 2); // AGI 5,000 is under the deduction: no tax
    expect(y.taxes.agi).toBeCloseTo(5000, 4);
    expect(y.taxes.penalties).toBe(0);
    expect(y.balances.ann).toBeCloseTo(100000 - y.withdrawals.other, 4);
  });
  it('before 59 1/2 the annuity gain also carries the 10% penalty', () => {
    // AGI 5,000 is under the standard deduction, so the only tax is 10% x 5,000 = 500.
    const y = run(deferredAnnuity('1976-03-01'))[0];
    expect(y.taxes.agi).toBeCloseTo(5000, 4);
    expect(y.taxes.penalties).toBeCloseTo(500, 4);
    expect(y.withdrawals.other).toBeCloseTo(30500, 2);
  });

  it('an I-bond accrues its real fixed rate plus inflation, untaxed until redeemed', () => {
    // Fixed rate 1% real + 2.5% inflation = 3.5% nominal: 10,000 -> 10,350 at the end of 2026, no taxable interest.
    // In 2027 spending of $5,000 (5,125 nominal) is met from the bond, gains first, so AGI is the $350 of interest.
    const r = run(
      mk({
        people: [person('p1', '1970-03-01')],
        accounts: [
          {
            id: 'ib',
            ownerId: 'p1',
            name: 'I bonds',
            type: 'iBond',
            balance: D(10000),
            costBasis: D(10000),
            fixedYield: { rate: 0.01, basis: 'real' },
          },
        ],
        expenses: [
          {
            id: 'e',
            name: 'Living',
            category: 'other',
            amount: D(5000),
            start: { type: 'year', year: 2027 },
          },
        ],
        assumptions: flat({ inflation: { rate: 0.025 } }),
      }),
    );
    expect(rec(r, 2026).balances.ib).toBeCloseTo(10350, 6);
    expect(rec(r, 2026).taxes.agi).toBe(0);
    expect(rec(r, 2027).taxes.agi).toBeCloseTo(350, 4);
    expect(rec(r, 2027).withdrawals.other).toBeCloseTo(5125, 2);
  });
  it('I-bond purchases from surplus stop at the $10,000-per-person annual cap', () => {
    // Surplus waterfall points at the I-bond first; $10,000 goes in (end-of-year timing, so no growth on it) and the
    // rest of the surplus sweeps to cash.
    const r = run(
      mk({
        people: [person('p1', '1980-03-01')],
        accounts: [cash('c', 0), { id: 'ib', ownerId: 'p1', name: 'I bonds', type: 'iBond', balance: 0 }],
        incomes: [{ id: 'w', ownerId: 'p1', name: 'Job', kind: 'wages', amount: D(100000) }],
        strategies: {
          surplusWaterfall: [{ type: 'account', accountId: 'ib' }],
          surplusDefaultAccountId: 'c',
        },
        assumptions: flat(),
      }),
    );
    expect(rec(r, 2026).balances.ib).toBeCloseTo(10000, 6);
    expect(rec(r, 2026).balances.c).toBeGreaterThan(50000);
  });
});

// ------------------------------------------------------------------------------------------------ PLAN-03
describe('PLAN-03 refinance and home sale with the section 121 exclusion', () => {
  it('a refinance re-amortizes the remaining principal at the new rate from the refinance year', () => {
    // $300,000 at 7% over 360 months: payment 1,995.91 a month = 23,950.89 a year.
    // Principal left at the start of 2028 (after 24 payments): 293,684.84.
    // Refinance to 5% over 30 years: 1,576.56 a month = 18,918.76 a year; closing costs 2% = 5,873.70.
    const r = run(
      mk({
        people: [person('p1', '1980-03-01')],
        accounts: [cash('c', 2000000)],
        debts: [
          {
            id: 'm',
            ownerId: 'p1',
            name: 'Mortgage',
            kind: 'mortgage',
            principal: D(300000),
            rate: 0.07,
            termMonths: 360,
            refinance: [{ when: { type: 'year', year: 2028 }, rate: 0.05, termYears: 30, costPct: 0.02 }],
          },
        ],
        assumptions: flat(),
      }),
    );
    expect(rec(r, 2026).expenses.debtService).toBeCloseTo(23950.89, 1);
    expect(rec(r, 2027).expenses.debtService).toBeCloseTo(23950.89, 1);
    expect(rec(r, 2026).expenses.debtInterest).toBeCloseTo(20903.46, 1);
    expect(rec(r, 2027).expenses.purchases).toBe(0);
    expect(rec(r, 2028).expenses.debtService).toBeCloseTo(18918.76, 1);
    expect(rec(r, 2028).expenses.purchases).toBeCloseTo(5873.7, 1);
    expect(rec(r, 2029).expenses.debtService).toBeCloseTo(18918.76, 1);
    // First-year interest at 5%: a little under 5% x 293,684.84 = 14,684.24.
    expect(rec(r, 2028).expenses.debtInterest).toBeLessThan(14684.24);
    expect(rec(r, 2028).expenses.debtInterest).toBeGreaterThan(14400);
  });

  const homeSale = (couple: boolean, basis: number): YearRecord =>
    run(
      mk({
        people: couple
          ? [person('p1', '1966-03-01'), person('p2', '1966-03-01')]
          : [person('p1', '1966-03-01')],
        accounts: [cash('c', 10000)],
        assets: [
          {
            id: 'h',
            ownerId: 'p1',
            name: 'Home',
            kind: 'primaryHome',
            value: D(900000),
            costBasis: D(basis),
            appreciation: { rate: 0, basis: 'nominal' },
            sale: { when: { type: 'year', year: 2026 }, sellingCostPct: 0.06 },
          },
        ],
        assumptions: flat(),
      }),
    )[0];
  it('single: gain above $250,000 is a long-term gain, taxed at the capital-gains rates', () => {
    // Net proceeds 900,000 x 0.94 = 846,000; gain over the 300,000 basis = 546,000; less 250,000 = 296,000 taxable.
    // Taxable income 296,000 - 16,100 = 279,900, all gain: 15% of (279,900 - 49,450) = 34,567.50.
    const y = homeSale(false, 300000);
    expect(y.income.assetSales).toBeCloseTo(846000, 4);
    expect(y.realizedGains).toBeCloseTo(296000, 4);
    expect(y.taxes.capitalGainsTax).toBeCloseTo(34567.5, 2);
    // NIIT: 3.8% of the smaller of the gain and AGI over 200,000 = 3.8% x 96,000 = 3,648.
    expect(y.taxes.niit).toBeCloseTo(3648, 2);
  });
  it('married filing jointly: the exclusion is $500,000', () => {
    // 546,000 - 500,000 = 46,000 taxable; taxable income 46,000 - 32,200 = 13,800 sits in the 0% band.
    const y = homeSale(true, 300000);
    expect(y.filingStatus).toBe('mfj');
    expect(y.realizedGains).toBeCloseTo(46000, 4);
    expect(y.taxes.capitalGainsTax).toBe(0);
  });
  it('a gain inside the exclusion is not taxed at all', () => {
    // Gain 846,000 - 700,000 = 146,000 < 250,000.
    const y = homeSale(false, 700000);
    expect(y.realizedGains).toBe(0);
    expect(y.taxes.agi).toBe(0);
  });
});

// ------------------------------------------------------------------------------------------------ PLAN-04
describe('PLAN-04 amortizing loans, revolving debt and vehicle depreciation', () => {
  const base = (o: Over): Plan =>
    mk({ people: [person('p1', '1980-03-01')], accounts: [cash('c', 500000)], assumptions: flat(), ...o });

  it('an amortizing loan pays its level payment and is gone at the end of its term', () => {
    // $20,000 at 6% over 36 months: 608.44 a month = 7,301.26 a year; paid off in the 36th month (end of 2028).
    const r = run(
      base({
        debts: [
          {
            id: 'l',
            ownerId: 'p1',
            name: 'Car loan',
            kind: 'auto',
            principal: D(20000),
            rate: 0.06,
            termMonths: 36,
          },
        ],
      }),
    );
    expect(rec(r, 2026).expenses.debtService).toBeCloseTo(7301.26, 1);
    expect(rec(r, 2027).expenses.debtService).toBeCloseTo(7301.26, 1);
    expect(rec(r, 2027).debts).toBeGreaterThan(6000);
    expect(rec(r, 2028).expenses.debtService).toBeCloseTo(7301.26, 0);
    expect(rec(r, 2028).debts).toBe(0);
    expect(rec(r, 2029).expenses.debtService).toBe(0);
    const total = r.slice(0, 3).reduce((s, x) => s + x.expenses.debtService, 0);
    expect(total).toBeCloseTo(36 * 608.4387, 0);
  });

  it('revolving debt pays its interest plus its percentage of principal each year', () => {
    // $10,000 at 20%, paying 10% of principal: year 1 interest 2,000 + principal 1,000 -> 9,000 owed;
    // year 2 interest 1,800 + principal 900 -> 8,100 owed.
    const r = run(
      base({
        debts: [
          {
            id: 'cc',
            ownerId: 'p1',
            name: 'Card',
            kind: 'revolving',
            principal: D(10000),
            rate: 0.2,
            revolvingPayPct: 0.1,
          },
        ],
      }),
    );
    expect(rec(r, 2026).expenses.debtService).toBeCloseTo(3000, 6);
    expect(rec(r, 2026).expenses.debtInterest).toBeCloseTo(2000, 6);
    expect(rec(r, 2026).debts).toBeCloseTo(9000, 6);
    expect(rec(r, 2027).expenses.debtService).toBeCloseTo(2700, 6);
    expect(rec(r, 2027).debts).toBeCloseTo(8100, 6);
  });

  it('a vehicle depreciates at its (negative) appreciation rate', () => {
    // Nominal -15%: 30,000 -> 25,500 -> 21,675. Real -15% at 2.5% inflation: 30,000 x 1.025 x 0.85 = 26,137.50.
    const veh = (basis: 'nominal' | 'real'): YearRecord[] =>
      run(
        base({
          assets: [
            {
              id: 'v',
              ownerId: 'p1',
              name: 'Car',
              kind: 'vehicle',
              value: D(30000),
              appreciation: { rate: -0.15, basis },
            },
          ],
          assumptions: flat({ inflation: { rate: 0.025 } }),
        }),
      );
    const n = veh('nominal');
    expect(rec(n, 2026).assets).toBeCloseTo(25500, 6);
    expect(rec(n, 2027).assets).toBeCloseTo(21675, 6);
    expect(rec(veh('real'), 2026).assets).toBeCloseTo(26137.5, 6);
  });
});

// ------------------------------------------------------------------------------------------------ PLAN-13
describe('PLAN-13 backdoor Roth (pro-rata) and mega-backdoor Roth', () => {
  const backdoor = (preTaxIra: number, on = true): YearRecord =>
    run(
      mk({
        people: [person('p1', '1986-03-01')],
        accounts: [
          cash('c', 0),
          { id: 'roth', ownerId: 'p1', name: 'Roth IRA', type: 'rothIra', balance: 0 },
          { id: 'ira', ownerId: 'p1', name: 'Rollover IRA', type: 'tradIra', balance: D(preTaxIra) },
        ],
        incomes: [{ id: 'w', ownerId: 'p1', name: 'Job', kind: 'wages', amount: D(250000) }],
        expenses: [{ id: 'e', name: 'Living', category: 'other', amount: D(60000) }],
        strategies: {
          surplusWaterfall: [{ type: 'account', accountId: 'roth' }],
          surplusDefaultAccountId: 'c',
          backdoorRoth: on,
        },
        assumptions: flat(),
      }),
    )[0];
  it('without the backdoor a high earner gets no direct Roth IRA contribution', () => {
    // MAGI ~250,000 is past the single phase-out (153,000-168,000).
    expect(backdoor(0, false).balances.roth ?? 0).toBe(0);
  });
  it('with no pre-tax IRA money the backdoor puts the full $7,500 in tax-free', () => {
    const y = backdoor(0);
    expect(y.balances.roth).toBeCloseTo(7500, 6);
  });
  it('the pro-rata rule taxes the conversion in proportion to existing pre-tax IRA balances', () => {
    // 30,000 pre-tax + 7,500 after-tax: 30,000 / 37,500 = 80% of the 7,500 conversion is taxable = 6,000.
    const clean = backdoor(0);
    const dirty = backdoor(30000);
    expect(dirty.balances.roth).toBeCloseTo(7500, 6);
    expect(dirty.taxes.agi - clean.taxes.agi).toBeCloseTo(6000, 0);
  });

  const mega = (salary: number): YearRecord =>
    run(
      mk({
        people: [person('p1', '1986-03-01')],
        accounts: [
          cash('c', 300000),
          {
            id: 'k',
            ownerId: 'p1',
            name: '401(k)',
            type: 'trad401k',
            balance: 0,
            contribution: {
              incomeId: 'w',
              maxOut: true,
              employerMatch: [{ matchPct: 0.5, upToPctOfSalary: 0.06 }],
              megaBackdoor: true,
              megaBackdoorRothAccountId: 'rk',
            },
          },
          { id: 'rk', ownerId: 'p1', name: 'Roth 401(k)', type: 'roth401k', balance: 0 },
        ],
        incomes: [{ id: 'w', ownerId: 'p1', name: 'Job', kind: 'wages', amount: D(salary) }],
        expenses: [{ id: 'e', name: 'Living', category: 'other', amount: D(40000) }],
        strategies: { surplusDefaultAccountId: 'c' },
        assumptions: flat(),
      }),
    )[0];
  it('mega-backdoor fills the 415(c) annual additions limit ($72,000 in 2026)', () => {
    // Salary 200,000: deferral 24,500; match 50% of the first 6% (12,000) = 6,000;
    // after-tax = 72,000 - 24,500 - 6,000 = 41,500, converted to the Roth 401(k).
    const lim = data.limits[2026].annualAdditions;
    expect(lim).toBe(72000);
    const y = mega(200000);
    expect(y.contributions.pretax).toBeCloseTo(24500, 6);
    expect(y.contributions.employer).toBeCloseTo(6000, 6);
    expect(y.contributions.roth).toBeCloseTo(41500, 6);
    expect(y.contributions.pretax + y.contributions.employer + y.contributions.roth).toBeCloseTo(lim, 6);
    expect(y.balances.rk).toBeCloseTo(41500, 6);
  });
  it('mega-backdoor is limited by the pay left after the deferral', () => {
    // Salary 50,000: deferral 24,500; match 50% x 3,000 = 1,500; room 46,000 but only 25,500 of pay is left.
    const y = mega(50000);
    expect(y.contributions.employer).toBeCloseTo(1500, 6);
    expect(y.contributions.roth).toBeCloseTo(25500, 6);
  });
});

// ------------------------------------------------------------------------------------------------ PLAN-14
describe('PLAN-14 529 qualified withdrawals and the 529-to-Roth rollover', () => {
  const edu = (category: 'education' | 'other'): YearRecord =>
    run(
      mk({
        people: [person('p1', '1976-03-01')],
        accounts: [
          { id: 'e529', ownerId: 'p1', name: '529', type: 'plan529', balance: D(50000), costBasis: D(30000) },
        ],
        expenses: [
          { id: 'tuition', name: 'Tuition', category, amount: D(20000), recurrence: { type: 'once' } },
        ],
        assumptions: flat(),
      }),
    )[0];
  it('qualified education spending comes out of the 529 untaxed', () => {
    const y = edu('education');
    expect(y.withdrawals.other).toBeCloseTo(20000, 6);
    expect(y.taxes.agi).toBe(0);
    expect(y.taxes.penalties).toBe(0);
    expect(y.balances.e529).toBeCloseTo(30000, 6);
  });
  it('non-qualified spending from a 529 taxes the earnings share and adds the 10% penalty', () => {
    // Earnings are 20,000 / 50,000 = 40% of each dollar out. Gross G with G = 20,000 + 10% x 0.4 G
    // -> G = 20,000 / 0.96 = 20,833.33; taxable earnings 8,333.33 (under the standard deduction); penalty 833.33.
    const y = edu('other');
    expect(y.withdrawals.other).toBeCloseTo(20833.33, 0);
    expect(y.taxes.agi).toBeCloseTo(8333.33, 0);
    expect(y.taxes.penalties).toBeCloseTo(833.33, 0);
  });

  const rollover = (opened: number, wages: number): YearRecord[] =>
    run(
      mk({
        people: [person('p1', '2001-03-01')],
        accounts: [
          cash('c', 0),
          {
            id: 'e529',
            ownerId: 'p1',
            name: '529',
            type: 'plan529',
            balance: D(100000),
            costBasis: D(60000),
            plan529: { openedYear: opened, rollToRoth: true, rothRolloverAccountId: 'roth' },
          },
          { id: 'roth', ownerId: 'p1', name: 'Roth IRA', type: 'rothIra', balance: 0 },
        ],
        incomes: wages ? [{ id: 'w', ownerId: 'p1', name: 'Job', kind: 'wages', amount: D(wages) }] : [],
        expenses: [{ id: 'e', name: 'Living', category: 'other', amount: D(20000) }],
        strategies: { surplusDefaultAccountId: 'c' },
        assumptions: flat({ inflation: { rate: 0 } }),
      }),
    );
  it('rolls over up to the IRA limit each year and stops at the $35,000 lifetime cap', () => {
    // 2026 and 2027 IRA limit 7,500 (no inflation after): 7,500 a year for four years = 30,000, then 5,000 in 2030.
    expect(data.limits[2026].rollover529ToRoth.lifetimeCap).toBe(35000);
    const r = rollover(2008, 60000);
    const roth = [2026, 2027, 2028, 2029, 2030, 2031, 2032].map((y) => rec(r, y).balances.roth);
    expect(roth[0]).toBeCloseTo(7500, 6);
    expect(roth[3]).toBeCloseTo(30000, 6);
    expect(roth[4]).toBeCloseTo(35000, 6);
    expect(roth[5]).toBeCloseTo(35000, 6);
    expect(roth[6]).toBeCloseTo(35000, 6);
    expect(rec(r, 2032).balances.e529).toBeCloseTo(65000, 6);
    // The rollover is not income.
    expect(rec(r, 2026).taxes.agi).toBeCloseTo(60000, 0);
  });
  it('needs the account to be 15 years old', () => {
    // Opened 2015: first eligible year 2030.
    const r = rollover(2015, 60000);
    expect(rec(r, 2029).balances.roth ?? 0).toBe(0);
    expect(rec(r, 2030).balances.roth).toBeCloseTo(7500, 6);
  });
  it('needs earned income for the Roth owner', () => {
    const r = rollover(2008, 0);
    expect(rec(r, 2026).balances.roth ?? 0).toBe(0);
  });
});

// ------------------------------------------------------------------------------------------------ SIM-06
describe('SIM-06 glide paths and threshold rebalancing', () => {
  it('a glide path interpolates linearly between ages and holds the end points outside them', () => {
    // 90/10 at 40 to 50/50 at 60. Stocks return 10%, bonds 0%, start-of-year timing, no flows, so each year's growth
    // is 10% x the stock weight for that year's age: age 50 -> 70% (7.0%), 51 -> 68%, 55 -> 60%, 60+ -> 50%.
    const plan = (birth: string): Plan =>
      mk({
        settings: { startYear: 2026, timing: 'start' },
        people: [person('p1', birth, { longevity: { age: 70 } })],
        accounts: [
          {
            id: 'r',
            ownerId: 'p1',
            name: 'Roth',
            type: 'rothIra',
            balance: D(100000),
            glidePathId: 'g',
          },
        ],
        glidePaths: [
          {
            id: 'g',
            name: 'g',
            points: [
              { age: 40, allocation: { usStocks: 0.9, usBonds: 0.1 } },
              { age: 60, allocation: { usStocks: 0.5, usBonds: 0.5 } },
            ],
          },
        ],
        assumptions: flat({
          returns: { fixed: { usStocks: 0.1, usBonds: 0, cash: 0, intlStocks: 0, reits: 0 } },
        }),
      });
    const growth = (r: YearRecord[], y: number): number =>
      rec(r, y).balances.r / (y === 2026 ? 100000 : rec(r, y - 1).balances.r) - 1;
    const r = run(plan('1976-03-01'));
    expect(growth(r, 2026)).toBeCloseTo(0.07, 10); // age 50
    expect(growth(r, 2027)).toBeCloseTo(0.068, 10); // age 51: 0.9 - 0.4 x 11/20
    expect(growth(r, 2031)).toBeCloseTo(0.06, 10); // age 55
    expect(growth(r, 2036)).toBeCloseTo(0.05, 10); // age 60
    expect(growth(r, 2040)).toBeCloseTo(0.05, 10); // age 64: held at the last point
    const young = run(plan('1991-03-01'));
    expect(growth(young, 2026)).toBeCloseTo(0.09, 10); // age 35: held at the first point
  });

  const drifting = (mode: 'threshold' | 'annual'): YearRecord[] =>
    run(
      mk({
        settings: { startYear: 2026, timing: 'start' },
        people: [person('p1', '1976-03-01')],
        accounts: [
          {
            id: 'tx',
            ownerId: 'p1',
            name: 'Brokerage',
            type: 'taxable',
            balance: D(100000),
            costBasis: D(100000),
            allocation: { usStocks: 0.6, usBonds: 0.4 },
          },
        ],
        strategies: { rebalance: { mode, band: 0.05 } },
        assumptions: flat({
          returns: { fixed: { usStocks: 0.2, usBonds: 0, cash: 0, intlStocks: 0, reits: 0 } },
        }),
      }),
    );
  it('threshold rebalancing trades only when a class drifts outside the band', () => {
    // 60/40 with stocks +20%: end of 2026 72,000 / 40,000 (64.3% stocks, drift 4.3% < 5%: no trade in 2027);
    // end of 2027 86,400 / 40,000 (68.4%, drift 8.35% > 5%): 2028 sells 86,400 - 0.6 x 126,400 = 10,560 of stock.
    // Gain share 1 - 100,000 / 126,400 = 20.89%, so the realized gain is 10,560 x 26,400 / 126,400 = 2,205.57.
    const r = drifting('threshold');
    expect(rec(r, 2026).realizedGains).toBe(0);
    expect(rec(r, 2027).realizedGains).toBe(0);
    expect(rec(r, 2027).balances.tx).toBeCloseTo(126400, 6);
    expect(rec(r, 2028).realizedGains).toBeCloseTo(2205.57, 2);
    // After the 2028 trade the mix is back to 60/40: 2028 grows 20% x 60% = 12%.
    expect(rec(r, 2028).balances.tx).toBeCloseTo(126400 * 1.12, 4);
  });
  it('annual rebalancing trades every year (contrast)', () => {
    // 2027: sells 72,000 - 0.6 x 112,000 = 4,800 at a gain share of 12,000 / 112,000 -> 514.29.
    const r = drifting('annual');
    expect(rec(r, 2027).realizedGains).toBeCloseTo(514.29, 2);
    expect(rec(r, 2027).balances.tx).toBeCloseTo(112000 * 1.12, 4);
  });
});

// ------------------------------------------------------------------------------------------------ SIM-09
describe('SIM-09 stochastic healthcare inflation, separate from CPI', () => {
  const plan = (stochastic: boolean): Plan =>
    mk({
      people: [person('p1', '1990-03-01')],
      accounts: [cash('c', 3000000)],
      expenses: [
        { id: 'cpi', name: 'Living', category: 'other', amount: D(10000) },
        {
          id: 'med',
          name: 'Medical',
          category: 'healthcare',
          amount: D(10000),
          inflationIndex: 'healthcare',
        },
      ],
      assumptions: flat({
        healthcareInflation: { excessOverCpi: 0.02, stochastic, stdDev: 0.015 },
        monteCarlo: { inflation: 'fixed' },
      }),
    });
  const settings = {
    method: 'parametric' as const,
    blockLength: 5,
    inflation: 'sampled' as const,
    stochasticLongevity: false,
  };

  it('draws the healthcare excess each year with the stated mean and sd, uncorrelated with CPI', () => {
    const c = compilePlan(plan(true), data);
    const he: number[] = [];
    const inf: number[] = [];
    for (let run_ = 0; run_ < 60; run_++) {
      const p = generatePath(c, settings, 7, run_);
      for (let t = 0; t < p.years; t++) {
        he.push(p.healthExcess[t]);
        inf.push(p.inflation[t]);
      }
    }
    const n = he.length; // 60 runs x 70 years = 4,200 draws
    const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
    const mh = mean(he);
    const mi = mean(inf);
    const sd = Math.sqrt(he.reduce((s, x) => s + (x - mh) ** 2, 0) / (n - 1));
    let cov = 0;
    let vi = 0;
    for (let i = 0; i < n; i++) {
      cov += (he[i] - mh) * (inf[i] - mi);
      vi += (inf[i] - mi) ** 2;
    }
    const corr = cov / Math.sqrt(vi * sd * sd * (n - 1));
    // Standard error of the mean 0.015 / sqrt(4,200) = 0.00023; allow 4 se.
    expect(mh).toBeGreaterThan(0.02 - 0.001);
    expect(mh).toBeLessThan(0.02 + 0.001);
    expect(sd).toBeGreaterThan(0.015 * 0.95);
    expect(sd).toBeLessThan(0.015 * 1.05);
    expect(Math.abs(corr)).toBeLessThan(0.06);
  });
  it('with stochastic off, every year uses the fixed excess', () => {
    const c = compilePlan(plan(false), data);
    const p = generatePath(c, settings, 7, 0);
    for (let t = 0; t < p.years; t++) expect(p.healthExcess[t]).toBe(0.02);
  });
  it('healthcare-indexed costs follow the healthcare draw while CPI-indexed costs do not', () => {
    // Same returns and inflation, different healthcare excess: 0% vs 5% a year on top of 2.5% CPI.
    // In 2028 (t = 2) the medical expense is 10,000 x 1.025^2 = 10,506.25 vs 10,000 x 1.075^2 = 11,556.25.
    const c = compilePlan(plan(false), data);
    const base = fixedPath(c);
    const lo = { ...base, healthExcess: new Float64Array(base.years).fill(0) };
    const hi = { ...base, healthExcess: new Float64Array(base.years).fill(0.05) };
    const a = runPath(c, lo, { detail: true }).records!;
    const b = runPath(c, hi, { detail: true }).records!;
    expect(rec(a, 2028).expenses.byCategory.healthcare).toBeCloseTo(10506.25, 6);
    expect(rec(b, 2028).expenses.byCategory.healthcare).toBeCloseTo(11556.25, 6);
    expect(rec(a, 2028).expenses.byCategory.other).toBeCloseTo(rec(b, 2028).expenses.byCategory.other, 9);
    expect(rec(a, 2028).cpi).toBe(rec(b, 2028).cpi);
  });
  it('in Monte Carlo paths with fixed CPI, healthcare costs still vary between runs', () => {
    const c = compilePlan(plan(true), data);
    const fixedInfl = { ...settings, inflation: 'fixed' as const };
    const med: number[] = [];
    const other: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = runPath(c, generatePath(c, fixedInfl, 11, i), { detail: true }).records!;
      med.push(rec(r, 2045).expenses.byCategory.healthcare);
      other.push(rec(r, 2045).expenses.byCategory.other);
    }
    // CPI-indexed: 10,000 x 1.025^19 in every run.
    for (const o of other) expect(o).toBeCloseTo(10000 * Math.pow(1.025, 19), 6);
    expect(new Set(med.map((m) => m.toFixed(2))).size).toBe(5);
    expect(Math.max(...med) / Math.min(...med)).toBeGreaterThan(1.02);
  });
});

// ------------------------------------------------------------------------------------------------ TAX-08
describe('TAX-08 0% gain harvesting and loss harvesting with carryforward', () => {
  const harvestPlan = (ordinary: number, on = true): Plan =>
    mk({
      people: [person('p1', '1976-03-01')],
      accounts: [
        cash('c', 0),
        {
          id: 'tx',
          ownerId: 'p1',
          name: 'Brokerage',
          type: 'taxable',
          balance: D(200000),
          costBasis: D(100000),
          allocation: { usStocks: 1 },
        },
      ],
      incomes: ordinary
        ? [
            {
              id: 'o',
              ownerId: 'p1',
              name: 'Consulting',
              kind: 'other',
              amount: D(ordinary),
              growth: { rate: 0, basis: 'nominal' },
              taxCharacter: 'ordinary',
            },
          ]
        : [],
      strategies: { gainHarvest: { enabled: on }, surplusDefaultAccountId: 'c' },
      assumptions: flat({ inflation: { rate: 0 } }),
    });
  it('harvests gains up to the top of the 0% bracket with no capital-gains tax', () => {
    // Ordinary 40,000 - 16,100 deduction = 23,900 taxable; 0% band tops out at 49,450 -> harvest 25,550.
    const r = run(harvestPlan(40000));
    const y = rec(r, 2026);
    expect(y.gainsHarvested).toBeCloseTo(25550, 2);
    expect(y.taxes.taxableIncome).toBeCloseTo(49450, 2);
    expect(y.taxes.capitalGainsTax).toBeCloseTo(0, 6);
    // Basis rises by what was harvested, so later years harvest only the gain that is left: 100,000 in total.
    let total = 0;
    for (const x of r) {
      expect(x.taxes.capitalGainsTax).toBeCloseTo(0, 6);
      total += x.gainsHarvested;
    }
    expect(total).toBeCloseTo(100000, 2);
    expect(rec(r, 2026).balances.tx).toBeCloseTo(200000, 6); // harvesting is a sale and buy-back: no cash moves
  });
  it('does nothing when switched off', () => {
    const r = run(harvestPlan(40000, false));
    expect(r.every((x) => x.gainsHarvested === 0)).toBe(true);
  });
  // Regression: taxable income is floored at zero, and the harvest room used to ignore any unused standard
  // deduction. With no other income 49,450 + 16,100 = 65,550 of gain can be realized before any of it is taxed.
  it('with no other income, also uses the unused standard deduction (harvests 65,550)', () => {
    const y = run(harvestPlan(0))[0];
    expect(y.gainsHarvested).toBeCloseTo(65550, 0);
  });

  it('harvests a loss, deducts $3,000 a year against ordinary income and carries the rest forward', () => {
    // All-stock brokerage, 100,000 basis; stocks fall 40% in 2026 (only), so 2027 opens at 60,000 with a 40,000 loss.
    // 2027: harvest 40,000 -> deduct 3,000 (AGI 37,000), carry 37,000. 3,000 a year through 2039 (13 years =
    // 39,000), 1,000 in 2040, nothing after.
    const plan = mk({
      settings: { startYear: 2026, timing: 'start' },
      people: [person('p1', '1976-03-01')],
      accounts: [
        cash('c', 0),
        {
          id: 'tx',
          ownerId: 'p1',
          name: 'Brokerage',
          type: 'taxable',
          balance: D(100000),
          costBasis: D(100000),
          allocation: { usStocks: 1 },
        },
      ],
      incomes: [
        {
          id: 'o',
          ownerId: 'p1',
          name: 'Consulting',
          kind: 'other',
          amount: D(40000),
          growth: { rate: 0, basis: 'nominal' },
          taxCharacter: 'ordinary',
        },
      ],
      strategies: { lossHarvest: { enabled: true }, surplusDefaultAccountId: 'c' },
      assumptions: flat({ inflation: { rate: 0 } }),
    });
    const c = compilePlan(plan, data);
    const path = fixedPath(c);
    path.returns[0] = -0.4; // t = 0, US stocks
    const r = runPath(c, path, { detail: true }).records!;
    expect(rec(r, 2026).lossesHarvested).toBe(0);
    expect(rec(r, 2026).taxes.agi).toBeCloseTo(40000, 4);
    expect(rec(r, 2027).lossesHarvested).toBeCloseTo(40000, 4);
    expect(rec(r, 2027).realizedGains).toBeCloseTo(-40000, 4);
    for (let y = 2027; y <= 2039; y++) expect(rec(r, y).taxes.agi, String(y)).toBeCloseTo(37000, 4);
    expect(rec(r, 2040).taxes.agi).toBeCloseTo(39000, 4);
    expect(rec(r, 2041).taxes.agi).toBeCloseTo(40000, 4);
    // The basis was reset to the 60,000 value, so the position no longer shows a loss to harvest again.
    expect(rec(r, 2028).lossesHarvested).toBe(0);
  });

  // Regression: the compiler used to clamp a taxable account's basis to its balance, discarding an unrealized loss.
  // Here a 50,000 position bought for 80,000 harvests a 30,000 loss.
  it('keeps an entered cost basis above the balance so the loss can be harvested', () => {
    const y = run(
      mk({
        people: [person('p1', '1976-03-01')],
        accounts: [
          {
            id: 'tx',
            ownerId: 'p1',
            name: 'Brokerage',
            type: 'taxable',
            balance: D(50000),
            costBasis: D(80000),
            allocation: { usStocks: 1 },
          },
        ],
        strategies: { lossHarvest: { enabled: true } },
        assumptions: flat(),
      }),
    )[0];
    expect(y.lossesHarvested).toBeCloseTo(30000, 2);
  });
});

// ------------------------------------------------------------------------------------------------ HC-07
describe('HC-07 marketplace out-of-pocket: OOP maximum, utilization and cost-sharing reductions', () => {
  const cs = pickYear(data.costSharing, 2026).value;
  it('scales the expected spend by utilization and never exceeds the tier OOP maximum', () => {
    // Silver OOP max 8,900: low 5% = 445, typical 25% = 2,225, high 100% = 8,900 (the cap).
    expect(acaExpectedOop(cs, 'silver', 'low', 3)).toBeCloseTo(445, 6);
    expect(acaExpectedOop(cs, 'silver', 'typical', 3)).toBeCloseTo(2225, 6);
    expect(acaExpectedOop(cs, 'silver', 'high', 3)).toBeCloseTo(8900, 6);
    // Bronze 10,000 and gold 8,200 maxima.
    expect(acaExpectedOop(cs, 'bronze', 'high', 3)).toBeCloseTo(10000, 6);
    expect(acaExpectedOop(cs, 'bronze', 'typical', 3)).toBeCloseTo(2500, 6);
    expect(acaExpectedOop(cs, 'gold', 'low', 3)).toBeCloseTo(410, 6);
    for (const metal of ['catastrophic', 'bronze', 'silver', 'gold', 'platinum'] as const)
      for (const u of ['low', 'typical', 'high'] as const)
        expect(acaExpectedOop(cs, metal, u, 3)).toBeLessThanOrEqual(cs.tiers[metal].oopMax);
  });
  it('cost-sharing reductions lower silver costs at or below 250% FPL, capped at the reduced OOP maximum', () => {
    // Expected spend scales by (1 - AV) / (1 - 0.70):
    // 94% AV (<= 150% FPL): share 0.2 -> typical 445; high 1,780 capped at 1,750.
    expect(acaExpectedOop(cs, 'silver', 'typical', 1.4)).toBeCloseTo(445, 6);
    expect(acaExpectedOop(cs, 'silver', 'high', 1.4)).toBeCloseTo(1750, 6);
    // 87% AV (<= 200%): share 0.4333 -> typical 964.17; high 3,856.67 capped at 3,300.
    expect(acaExpectedOop(cs, 'silver', 'typical', 1.8)).toBeCloseTo(964.17, 2);
    expect(acaExpectedOop(cs, 'silver', 'high', 1.8)).toBeCloseTo(3300, 6);
    // 73% AV (<= 250%): share 0.9 -> typical 2,002.50; high 8,010 capped at 7,500.
    expect(acaExpectedOop(cs, 'silver', 'typical', 2.3)).toBeCloseTo(2002.5, 6);
    expect(acaExpectedOop(cs, 'silver', 'high', 2.3)).toBeCloseTo(7500, 6);
    // Above 250%: none. CSR is silver-only: gold at 140% is the plain 25% x 8,200.
    expect(acaExpectedOop(cs, 'silver', 'typical', 2.6)).toBeCloseTo(2225, 6);
    expect(acaExpectedOop(cs, 'gold', 'typical', 1.4)).toBeCloseTo(2050, 6);
  });

  const aca = (income: number, utilization: 'low' | 'typical' | 'high'): YearRecord =>
    run(
      mk({
        people: [person('p1', '1976-03-01')],
        accounts: [cash('c', 1000000)],
        incomes: income
          ? [
              {
                id: 'o',
                ownerId: 'p1',
                name: 'Consulting',
                kind: 'other',
                amount: D(income),
                taxCharacter: 'ordinary',
              },
            ]
          : [],
        expenses: [{ id: 'e', name: 'Living', category: 'other', amount: D(30000) }],
        healthcare: {
          enabled: true,
          people: [
            { personId: 'p1', utilization, coverage: [{ type: 'aca', from: { type: 'year', year: 2026 } }] },
          ],
        },
        assumptions: flat(),
      }),
    )[0];
  it('the projection charges the expected out-of-pocket for the solved FPL ratio', () => {
    // MAGI 47,000 / 2025 FPL 15,650 = 3.0: no CSR. Typical 2,225; high 8,900.
    const typ = aca(47000, 'typical');
    expect(typ.coverage[0]).toBe('aca');
    expect(typ.taxes.fplRatio).toBeCloseTo(47000 / 15650, 3);
    expect(typ.expenses.healthcare.outOfPocket).toBeCloseTo(2225, 4);
    expect(aca(47000, 'high').expenses.healthcare.outOfPocket).toBeCloseTo(8900, 4);
    // MAGI 28,000 -> 1.79 FPL: the 87% CSR variant, typical 964.17.
    const csr = aca(28000, 'typical');
    expect(csr.taxes.fplRatio).toBeGreaterThan(1.5);
    expect(csr.taxes.fplRatio).toBeLessThanOrEqual(2);
    expect(csr.expenses.healthcare.outOfPocket).toBeCloseTo(964.17, 2);
  });
  // Regression: CSRs need premium-credit eligibility (100%-250% FPL). Below 100% FPL in a non-expansion state (the
  // coverage gap: no credit, full-price premium) the plain silver plan applies: 2,225 for typical use, not 445.
  it('no cost-sharing reduction in the coverage gap below 100% FPL (Texas, no Medicaid expansion)', () => {
    const y = aca(0, 'typical');
    expect(y.taxes.ptc).toBe(0);
    expect(y.expenses.healthcare.outOfPocket).toBeCloseTo(2225, 4);
  });
});

// ------------------------------------------------------------------------------------------------ HC-08
describe('HC-08 HSA contributions, Medicare cut-off and withdrawals', () => {
  const worker = (birth: string, o: Over = {}): Plan =>
    mk({
      people: [person('p1', birth)],
      accounts: [
        cash('c', 0),
        {
          id: 'hsa',
          ownerId: 'p1',
          name: 'HSA',
          type: 'hsa',
          balance: 0,
          contribution: { incomeId: 'w', maxOut: true },
        },
      ],
      incomes: [{ id: 'w', ownerId: 'p1', name: 'Job', kind: 'wages', amount: D(100000) }],
      expenses: [{ id: 'e', name: 'Living', category: 'other', amount: D(40000) }],
      healthcare: {
        enabled: true,
        people: [
          {
            personId: 'p1',
            coverage: [{ type: 'employer', from: { type: 'year', year: 2026 }, hdhp: true }],
          },
        ],
      },
      strategies: { surplusDefaultAccountId: 'c', hsaUse: 'save' },
      assumptions: flat(),
      ...o,
    });
  it('maxes the self-only limit, plus the $1,000 catch-up from 55', () => {
    // 2026 self-only 4,400; 2027 4,500 (Rev. Proc. 2026-24).
    const r54 = run(worker('1972-03-01'));
    expect(rec(r54, 2026).contributions.hsa).toBeCloseTo(4400, 6);
    const r56 = run(worker('1970-03-01'));
    expect(rec(r56, 2026).contributions.hsa).toBeCloseTo(5400, 6);
    expect(rec(r56, 2027).contributions.hsa).toBeCloseTo(5500, 6);
    // Payroll HSA money is exempt from FICA, as is the section 125 employer premium (KFF employee share 1,672):
    // 7.65% x (100,000 - 5,400 - 1,672) = 7,108.99.
    expect(rec(r56, 2026).taxes.fica).toBeCloseTo(0.0765 * 92928, 2);
  });
  it('stops contributing once the owner is on Medicare', () => {
    // Retiree on a bronze marketplace plan, funding the HSA from surplus. Born March 1962: 2026 at 64 gets
    // 4,400 + 1,000 = 5,400 (and it is deducted from AGI); Medicare starts in 2027, so nothing more goes in.
    const r = run(
      mk({
        people: [person('p1', '1962-03-15')],
        accounts: [cash('c', 0), { id: 'hsa', ownerId: 'p1', name: 'HSA', type: 'hsa', balance: 0 }],
        incomes: [
          {
            id: 'o',
            ownerId: 'p1',
            name: 'Consulting',
            kind: 'other',
            amount: D(80000),
            taxCharacter: 'ordinary',
          },
        ],
        healthcare: {
          enabled: true,
          people: [
            {
              personId: 'p1',
              coverage: [{ type: 'aca', from: { type: 'year', year: 2026 }, metal: 'bronze' }],
            },
          ],
        },
        strategies: {
          surplusWaterfall: [{ type: 'account', accountId: 'hsa' }],
          surplusDefaultAccountId: 'c',
          hsaUse: 'save',
        },
        assumptions: flat(),
      }),
    );
    expect(rec(r, 2026).coverage[0]).toBe('aca');
    expect(rec(r, 2026).balances.hsa).toBeCloseTo(5400, 6);
    expect(rec(r, 2026).taxes.agi).toBeCloseTo(80000 - 5400, 2);
    expect(rec(r, 2027).coverage[0]).toBe('medicare');
    expect(rec(r, 2027).balances.hsa).toBeCloseTo(5400, 6);
    expect(rec(r, 2030).balances.hsa).toBeCloseTo(5400, 6);
  });
  // Medicare look-back: someone who works past 65 on an employer HDHP and enrolls in Medicare after retiring gets
  // Part A backdated up to six months, so the HSA limit for the last working year is cut to the months before that:
  // 6/12 of 5,400 = 2,700 for a person retiring at the end of 2026 and enrolling in January 2027.
  it('applies the six-month Medicare look-back in the last year before enrolling', () => {
    const p = worker('1960-01-15', {});
    p.incomes[0].end = { type: 'year', year: 2027 };
    const r = run(p);
    expect(rec(r, 2027).coverage[0]).toBe('medicare');
    expect(rec(r, 2026).contributions.hsa).toBeCloseTo(2700, 0);
    // Still working (and so not enrolling) next year: the full 4,400 + 1,000 = 5,400.
    expect(rec(run(worker('1960-01-15')), 2026).contributions.hsa).toBeCloseTo(5400, 6);
    // Turning 65 in October of the last working year: Part A cannot be backdated before October, so
    // January-September (9 months) count: 9/12 x 5,400 = 4,050.
    const oct = worker('1961-10-15');
    oct.incomes[0].end = { type: 'year', year: 2027 };
    expect(rec(run(oct), 2026).contributions.hsa).toBeCloseTo(4050, 6);
  });

  const spender = (hsaUse: 'spend' | 'save'): YearRecord =>
    run(
      mk({
        people: [person('p1', '1981-03-01')],
        accounts: [cash('c', 0), { id: 'hsa', ownerId: 'p1', name: 'HSA', type: 'hsa', balance: D(20000) }],
        incomes: [{ id: 'w', ownerId: 'p1', name: 'Job', kind: 'wages', amount: D(80000) }],
        expenses: [{ id: 'e', name: 'Living', category: 'other', amount: D(30000) }],
        healthcare: {
          enabled: true,
          people: [{ personId: 'p1', coverage: [{ type: 'employer', from: { type: 'year', year: 2026 } }] }],
        },
        strategies: { surplusDefaultAccountId: 'c', hsaUse },
        assumptions: flat(),
      }),
    )[0];
  it('qualified medical spending comes out of the HSA tax- and penalty-free', () => {
    // Employer plan, typical use: 25% of the gold OOP maximum 8,200 = 2,050 paid from the HSA.
    const spend = spender('spend');
    const save = spender('save');
    expect(spend.expenses.healthcare.hsaPaid).toBeCloseTo(2050, 6);
    expect(spend.balances.hsa).toBeCloseTo(20000 - 2050, 6);
    expect(save.expenses.healthcare.hsaPaid).toBe(0);
    expect(spend.taxes.agi).toBeCloseTo(save.taxes.agi, 6);
    expect(spend.taxes.penalties).toBe(0);
  });

  const nonQualified = (birth: string): YearRecord =>
    run(
      mk({
        people: [person('p1', birth)],
        accounts: [{ id: 'hsa', ownerId: 'p1', name: 'HSA', type: 'hsa', balance: D(100000) }],
        expenses: [{ id: 'e', name: 'Living', category: 'other', amount: D(10000) }],
        strategies: { hsaUse: 'save' },
        assumptions: flat(),
      }),
    )[0];
  it('non-medical withdrawals are ordinary income, with the 20% penalty only before 65', () => {
    // At 70: 10,000 is taxable but under the deduction, so no tax and no penalty.
    const old = nonQualified('1956-03-01');
    expect(old.taxes.agi).toBeCloseTo(10000, 4);
    expect(old.taxes.penalties).toBe(0);
    // At 60: G = 10,000 + 20% G -> G = 12,500 (AGI still under the deduction), penalty 2,500.
    const young = nonQualified('1966-03-01');
    expect(young.withdrawals.hsa).toBeCloseTo(12500, 1);
    expect(young.taxes.penalties).toBeCloseTo(2500, 1);
  });
  // Regression: in spend mode the HSA used to pay only the out-of-pocket known before the tax solve (employer, COBRA,
  // Medicare, long-term care). Marketplace out-of-pocket is figured inside the solve and now comes from the HSA too:
  // silver, typical use at about 3x FPL is 2,225.
  it('pays marketplace out-of-pocket costs from the HSA in spend mode', () => {
    const y = run(
      mk({
        people: [person('p1', '1976-03-01')],
        accounts: [
          cash('c', 500000),
          { id: 'hsa', ownerId: 'p1', name: 'HSA', type: 'hsa', balance: D(20000) },
        ],
        incomes: [
          {
            id: 'o',
            ownerId: 'p1',
            name: 'Consulting',
            kind: 'other',
            amount: D(47000),
            taxCharacter: 'ordinary',
          },
        ],
        expenses: [{ id: 'e', name: 'Living', category: 'other', amount: D(30000) }],
        healthcare: {
          enabled: true,
          people: [{ personId: 'p1', coverage: [{ type: 'aca', from: { type: 'year', year: 2026 } }] }],
        },
        strategies: { hsaUse: 'spend', surplusDefaultAccountId: 'c' },
        assumptions: flat(),
      }),
    )[0];
    expect(y.expenses.healthcare.outOfPocket).toBeCloseTo(2225, 0);
    expect(y.expenses.healthcare.hsaPaid).toBeCloseTo(2225, 0);
    expect(y.balances.hsa).toBeCloseTo(20000 - 2225, 0);
    // Qualified: no tax and no penalty on it (AGI is the 47,000 of other income).
    expect(y.taxes.agi).toBeCloseTo(47000, 0);
    expect(y.taxes.penalties).toBe(0);
  });
});

// ------------------------------------------------------------------------------------------------ HC-10
describe('HC-10 long-term care: expected-cost mode and insurance', () => {
  const ltcPlan = (ltc: Over): YearRecord[] =>
    run(
      mk({
        people: [person('p1', '1946-03-01')],
        accounts: [cash('c', 3000000)],
        healthcare: { enabled: true, people: [{ personId: 'p1', ltc: { mode: 'expected', ...ltc } }] },
        assumptions: flat(),
      }),
    );
  // Assisted living 74,400 a year (CareScout 2025 national median, in 2025 dollars), grown by healthcare inflation
  // (2.5% + 2%) from 2025: x 1.045 in 2026, 1.045^2 in 2027, 1.045^3 in 2028.
  it('adds the care cost for exactly the stated years from the onset age', () => {
    // Born 1946: onset at 81 = 2027, two years -> 2027 and 2028.
    const r = ltcPlan({ careType: 'assistedLiving', onsetAge: 81, years: 2 });
    expect(rec(r, 2026).expenses.healthcare.ltc).toBe(0);
    expect(rec(r, 2027).expenses.healthcare.ltc).toBeCloseTo(74400 * 1.045 ** 2, 4); // 81,246.66
    expect(rec(r, 2028).expenses.healthcare.ltc).toBeCloseTo(74400 * 1.045 ** 3, 4); // 84,902.76
    expect(rec(r, 2029).expenses.healthcare.ltc).toBe(0);
    // A fractional duration charges the last part-year pro rata: 2.5 years -> half of 2029.
    const half = ltcPlan({ careType: 'assistedLiving', onsetAge: 81, years: 2.5 });
    expect(rec(half, 2029).expenses.healthcare.ltc).toBeCloseTo(74400 * 1.045 ** 4 * 0.5, 4);
    expect(rec(half, 2030).expenses.healthcare.ltc).toBe(0);
  });
  it('uses the cost of the chosen care type', () => {
    const r = ltcPlan({ careType: 'nursingHomePrivate', onsetAge: 80, years: 1 });
    expect(rec(r, 2026).expenses.healthcare.ltc).toBeCloseTo(129575 * 1.045, 4); // 135,405.88
  });
  it('insurance pays its benefit for its benefit years, and its premium is due until care starts', () => {
    // Premium 3,000 a year (CPI-indexed; CPI 1 in 2026), benefit 50,000 a year for one year.
    const none = ltcPlan({ careType: 'assistedLiving', onsetAge: 81, years: 2 });
    const ins = ltcPlan({
      careType: 'assistedLiving',
      onsetAge: 81,
      years: 2,
      insurance: { premiumAnnual: D(3000), annualBenefit: D(50000), benefitYears: 1 },
    });
    expect(
      rec(ins, 2026).expenses.healthcare.premiums - rec(none, 2026).expenses.healthcare.premiums,
    ).toBeCloseTo(3000, 4);
    expect(rec(ins, 2027).expenses.healthcare.ltc).toBeCloseTo(74400 * 1.045 ** 2 - 50000, 4); // 31,246.66
    expect(rec(ins, 2028).expenses.healthcare.ltc).toBeCloseTo(74400 * 1.045 ** 3, 4); // benefit used up
    expect(rec(ins, 2027).expenses.healthcare.premiums).toBeCloseTo(
      rec(none, 2027).expenses.healthcare.premiums,
      4,
    );
  });
  // Regression: the 2025 cost table used to be applied as-is in the 2026 start year.
  it('carries the 2025 cost table forward to the plan start year', () => {
    const r = ltcPlan({ careType: 'assistedLiving', onsetAge: 80, years: 1 });
    expect(rec(r, 2026).expenses.healthcare.ltc).toBeCloseTo(74400 * 1.045, 0);
  });
});
