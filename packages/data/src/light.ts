/**
 * The two small datasets the app's first screens need straight away (contribution limits for the wizard's
 * readouts, the life table for survival odds), without the full bundle. Everything else loads with the engine.
 */
import type { LimitsParams, MortalityTable } from './types';

const limitFiles = import.meta.glob('../limits/*.json', { eager: true, import: 'default' }) as Record<
  string,
  LimitsParams
>;
const mortalityFiles = import.meta.glob('../mortality/ssa-period-*.json', {
  eager: true,
  import: 'default',
}) as Record<string, MortalityTable>;

/** Contribution limits by tax year, as in EngineData.limits. */
export function contributionLimits(): Record<number, LimitsParams> {
  const out: Record<number, LimitsParams> = {};
  for (const [path, v] of Object.entries(limitFiles)) {
    const m = path.match(/(\d{4})\.json$/);
    if (m) out[+m[1]] = v;
  }
  return out;
}

/** The latest SSA period life table, as in EngineData.mortality. */
export function mortalityTable(): MortalityTable {
  let best = -1;
  let table: MortalityTable | null = null;
  for (const [path, v] of Object.entries(mortalityFiles)) {
    const y = +(path.match(/ssa-period-(\d{4})\.json$/)?.[1] ?? -1);
    if (y > best) {
      best = y;
      table = v;
    }
  }
  if (!table) throw new Error('No mortality table bundled');
  return table;
}
