import { loadEngineData } from '@fisim/data/src/node';
import { explainCashFlow, project, SAMPLE_PLANS } from '@fisim/engine';
import { describe, expect, it } from 'vitest';
import { cashFlowView } from './cashFlow';
import { metricValue, outcomeDelta } from './index';
import { taxBracketView } from './tax';

const data = loadEngineData();
describe('shared financial view models', () => {
  it.each(Object.entries(SAMPLE_PLANS))(
    '%s reconciles full and compact flow views to the ledger',
    (_, sample) => {
      const result = project(sample(2026), data);
      for (const record of result.records) {
        const brackets = taxBracketView(data, sample(2026), result, record);
        expect(brackets.rows.reduce((sum, row) => sum + row.tax, 0)).toBeCloseTo(record.taxes.ordinaryTax, 2);
        const full = cashFlowView(record);
        const compact = cashFlowView(record, true);
        const total = (items: typeof full.sources): number =>
          items.reduce((sum, item) => sum + item.amount, 0);
        expect(full.residual).toBeCloseTo(explainCashFlow(record).result - record.contributions.afterTax, 6);
        // The two sides meet to within the solver's $1 tolerance; a larger gap gets an explicit residual row.
        expect(Math.abs(total(full.sources) - total(full.uses))).toBeLessThan(1.01);
        expect(total(compact.sources)).toBeCloseTo(total(full.sources), 6);
        expect(total(compact.uses)).toBeCloseTo(total(full.uses), 6);
        const estate =
          (record.byKind.pretax + record.byKind.roth) / record.cpiEnd +
          metricValue('taxableCash', record, 'real') +
          metricValue('otherAccounts', record, 'real') +
          metricValue('propertyNet', record, 'real');
        expect(estate).toBeCloseTo(metricValue('netWorth', record, 'real'), 6);
        expect(metricValue('housing', record, 'real')).toBeCloseTo(
          (record.expenses.housing + record.expenses.debtService + record.expenses.purchases) / record.cpi,
          6,
        );
      }
    },
  );
  it('missing FI timing is not treated as year zero', () => {
    const result = project(SAMPLE_PLANS['sample-basic'](2026), data);
    const missing = { ...result, summary: { ...result.summary, fiYear: null } };
    expect(outcomeDelta('fiYear', result, missing)).toBeNull();
  });
});
