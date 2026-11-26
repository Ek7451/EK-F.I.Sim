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

/** Freeze the identity of legacy index-addressed entities before any structural edits. */
export function migrate_v1_to_v2(plan: Raw): Raw {
  const out = structuredClone(plan);
  out.schemaVersion = 2;
  const scenarios = out.scenarios as
    { patches?: { path: (string | number)[]; value?: unknown }[] }[] | undefined;
  for (const scenario of scenarios ?? [])
    for (const patch of scenario.patches ?? []) {
      let node: unknown = plan;
      patch.path = patch.path.map((part) => {
        const child: unknown =
          node && typeof node === 'object' ? (node as Record<string | number, unknown>)[part] : undefined;
        const anchored =
          Array.isArray(node) && typeof part === 'number'
            ? `@${child && typeof child === 'object' && 'id' in child ? String(child.id) : `missing-index-${part}`}`
            : part;
        // Numeric arrays without entity IDs (e.g. age schedules) retain positional semantics.
        const result =
          Array.isArray(node) && node.some((x: unknown) => x && typeof x === 'object' && 'id' in x)
            ? anchored
            : part;
        node = child;
        return result;
      });
    }
  return out;
}

const MIGRATIONS: Record<number, (p: Raw) => Raw> = {
  0: migrate_v0_to_v1,
  1: migrate_v1_to_v2,
  2: (p) => ({ ...p, schemaVersion: 3 }),
};

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
  removedSurplusSteps?: { position: number; accountId: string }[];
}

export function loadPlan(raw: unknown, options?: { reviewRecovery: true }): LoadedPlan {
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
    try {
      cur = m(cur);
    } catch {
      return {
        plan: null,
        fromVersion,
        migrated: false,
        readOnly: false,
        original: raw,
        error: 'Cannot migrate the stored plan. Its original contents are available for recovery.',
      };
    }
  }
  let parsed = PlanZ.safeParse(cur);
  const removedSurplusSteps: { position: number; accountId: string }[] = [];
  if (!parsed.success && options?.reviewRecovery) {
    // Only offer to drop fully formed surplus steps whose destination account is absent.
    // Use the validator's complete issue list, including issues beyond the banner's first five.
    const strategies = cur.strategies as Raw | undefined;
    const steps = strategies?.surplusWaterfall;
    if (
      Array.isArray(steps) &&
      parsed.error.issues.every(
        ({ path, message }) =>
          path.length === 4 &&
          path[0] === 'strategies' &&
          path[1] === 'surplusWaterfall' &&
          typeof path[2] === 'number' &&
          path[3] === 'accountId' &&
          message.startsWith('Unknown reference to accounts: '),
      )
    ) {
      const missing = new Set(parsed.error.issues.map(({ path }) => Number(path[2])));
      const remaining = steps.filter((step, index) => {
        if (!missing.has(index)) return true;
        removedSurplusSteps.push({ position: index + 1, accountId: step.accountId });
        return false;
      });
      const repaired = PlanZ.safeParse({
        ...cur,
        strategies: { ...strategies, surplusWaterfall: remaining },
      });
      // A positional scenario edit could point at a different step after removal.
      if (
        repaired.success &&
        !repaired.data.scenarios.some((s) =>
          s.patches.some(
            (p) => p.path[0] === 'strategies' && p.path[1] === 'surplusWaterfall' && p.path.length > 2,
          ),
        )
      )
        parsed = repaired;
    }
  }
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
    ...(removedSurplusSteps.length ? { removedSurplusSteps } : {}),
    fromVersion,
    migrated: fromVersion < SCHEMA_VERSION,
    readOnly: false,
    original: raw,
  };
}
