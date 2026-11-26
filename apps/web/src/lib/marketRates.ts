import market from '@fisim/data/market/shiller-annual.json';
import { expectedMeans, type Plan } from '@fisim/engine';

export const marketYears = `${market.years[0]}–${market.years.at(-1)}`;

/** Use the same series and rate selection as the deterministic projection, including any stock adjustment. */
export function projectionRates(plan: Plan) {
  const {
    classes: [usStocks, usBonds, cash, intlStocks, reits],
    inflation,
  } = expectedMeans({
    plan,
    data: { market },
  });
  return { usStocks, usBonds, cash, intlStocks, reits, inflation };
}
