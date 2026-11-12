import { pickYear, type EngineData, type Plan, type ProjectionResult, type YearRecord } from '@fisim/engine';

export function taxBracketView(data: EngineData, plan: Plan, result: ProjectionResult, record: YearRecord) {
  const picked = pickYear(data.federal, record.year);
  const referenceCpi = result.records.find((r) => r.year === picked.dataYear)?.cpi;
  const k =
    picked.dataYear >= record.year
      ? 1
      : referenceCpi !== undefined
        ? record.cpi / referenceCpi
        : record.cpi *
          Math.pow(1 + plan.assumptions.inflation.rate, plan.settings.startYear - picked.dataYear);
  let bottom = 0;
  const rows = picked.value.ordinaryBrackets[record.filingStatus === 'qss' ? 'mfj' : record.filingStatus].map(
    (bracket) => {
      const top = bracket.upTo === null ? Infinity : bracket.upTo * k;
      const amount = Math.max(0, Math.min(record.taxes.ordinaryTaxable, top) - bottom);
      const row = { bottom, top, rate: bracket.rate, amount, tax: amount * bracket.rate };
      bottom = top;
      return row;
    },
  );
  return { rows, dataYear: picked.dataYear, status: record.dataStatus, header: picked.value.header };
}
