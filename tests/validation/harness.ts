/** Shared helpers for the validation suite: a tax-free "pure withdrawal" plan and market-series substitution. */
import { loadEngineData } from '@fisim/data/src/node';
import type { EngineData, MarketHistory } from '@fisim/data';
import { PlanZ, type Plan } from '@fisim/engine';

export const data = loadEngineData();

/** A retiree drawing a fixed real amount from a Roth account: no tax, no Social Security, no healthcare module. */
export function withdrawalPlan(o: {
  portfolio: number;
  spend: number;
  years: number;
  stocks: number;
  fee?: number;
  timing?: 'start' | 'mid' | 'end';
  startYear?: number;
}): Plan {
  const startYear = o.startYear ?? 2026;
  return PlanZ.parse({
    id: 'validation',
    schemaVersion: 1,
    name: 'validation',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    settings: { startYear, timing: o.timing ?? 'start' },
    people: [
      {
        id: 'p1',
        name: 'P',
        birthDate: `${startYear - 62}-01-01`,
        longevity: { mode: 'fixed', age: 62 + o.years - 1 },
        residence: [{ state: 'TX', fromYear: startYear }],
        socialSecurity: { mode: 'none' },
      },
    ],
    accounts: [
      {
        id: 'a',
        ownerId: 'p1',
        name: 'Portfolio',
        type: 'rothIra',
        balance: Math.round(o.portfolio * 100),
        rothBasis: { contributions: Math.round(o.portfolio * 100), firstContributionYear: startYear - 20 },
        allocation: { usStocks: o.stocks, usBonds: 1 - o.stocks },
        fees: { expenseRatio: o.fee ?? 0 },
      },
    ],
    expenses: [{ id: 'e', name: 'Spending', category: 'other', amount: Math.round(o.spend * 100) }],
    healthcare: { enabled: false },
    strategies: { rebalance: { mode: 'annual' } },
  });
}

/** Engine data with the market history replaced (e.g. Damodaran's S&P 500 with corporate bonds for the Trinity study). */
export function withMarket(
  years: number[],
  stocks: number[],
  bonds: number[],
  cash: number[],
  inflation: number[],
): EngineData {
  const market: MarketHistory = {
    ...data.market,
    startYear: years[0],
    years,
    usStocks: stocks,
    usBonds: bonds,
    cash,
    inflation,
    approximatedBefore: {},
  };
  return { ...data, market };
}
