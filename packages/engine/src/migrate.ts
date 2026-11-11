/**
 * Schema versioning and migrations (plan 5.2). Migrations are pure functions applied in a chain.
 * The caller (the app) must save a backup snapshot before using a migrated plan.
 */
import { PlanZ, SCHEMA_VERSION, type Plan } from './schema';

type Raw = Record<string, unknown>;

/**
 * v0 was the pre-release prototype format: money in whole dollars, `accounts[].kind`, a single
 * `filingStatus` string and no `household` block.
 */
export function migrate_v0_to_v1(plan: Raw): Raw {
  const toCents = (v: unknown): number => Math.round((typeof v === 'number' ? v : 0) * 100);
  const out: Raw = { ...plan, schemaVersion: 1 };
  const kindMap: Record<string, string> = {
    brokerage: 'taxable',
    savings: 'cash',
    '401k': 'trad401k',
    ira: 'tradIra',
    roth: 'rothIra',
    hsa: 'hsa',
  };
  out.accounts = ((plan.accounts as Raw[]) ?? []).map((a) => {
    const { kind, ...rest } = a;
    return {
      ...rest,
      type: kindMap[String(kind)] ?? 'taxable',
      balance: toCents(a.balance),
      ...(a.costBasis !== undefined ? { costBasis: toCents(a.costBasis) } : {}),
    };
  });
  out.incomes = ((plan.incomes as Raw[]) ?? []).map((i) => ({ ...i, amount: toCents(i.amount) }));
  out.expenses = ((plan.expenses as Raw[]) ?? []).map((e) => ({ ...e, amount: toCents(e.amount) }));
  const startYear = ((plan.settings as Raw | undefined)?.startYear as number) ?? new Date().getFullYear();
  out.household = {
    filingStatus: plan.filingStatus ? [{ fromYear: startYear, status: plan.filingStatus }] : [],
    dependents: [],
  };
  delete out.filingStatus;
  return out;
}

const MIGRATIONS: Record<number, (p: Raw) => Raw> = { 0: migrate_v0_to_v1 };

export interface LoadedPlan {
  plan: Plan | null;
  /** Version found in the file. */
  fromVersion: number;
  migrated: boolean;
  /** True when the file is newer than this app understands: show it read-only with an "update the app" notice. */
  readOnly: boolean;
  /** The untouched input, kept so the caller can snapshot it before migrating. */
  original: unknown;
  error?: string;
}

export function loadPlan(raw: unknown): LoadedPlan {
  const obj = (raw ?? {}) as Raw;
  const fromVersion = typeof obj.schemaVersion === 'number' ? obj.schemaVersion : 0;
  if (fromVersion > SCHEMA_VERSION)
    return { plan: null, fromVersion, migrated: false, readOnly: true, original: raw };
  let cur: Raw = structuredClone(obj);
  for (let v = fromVersion; v < SCHEMA_VERSION; v++) {
    const m = MIGRATIONS[v];
    if (!m)
      return {
        plan: null,
        fromVersion,
        migrated: false,
        readOnly: false,
        original: raw,
        error: `No migration from schema v${v}`,
      };
    cur = m(cur);
  }
  const parsed = PlanZ.safeParse(cur);
  if (!parsed.success)
    return {
      plan: null,
      fromVersion,
      migrated: fromVersion < SCHEMA_VERSION,
      readOnly: false,
      original: raw,
      error: parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .slice(0, 5)
        .join('; '),
    };
  return {
    plan: parsed.data,
    fromVersion,
    migrated: fromVersion < SCHEMA_VERSION,
    readOnly: false,
    original: raw,
  };
}
