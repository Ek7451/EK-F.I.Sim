/**
 * The engine (with the plan schema and zod) and the full data bundle load on demand, so the first screen can draw
 * before they arrive. The projection itself always runs in the workers; the main thread needs the engine only to
 * check and load plans and to summarise simulation results.
 */
let engine: Promise<typeof import('@fisim/engine')> | null = null;
let loadedEngine: typeof import('@fisim/engine') | null = null;
export function validationMessage(plan: import('@fisim/engine').Plan): string | null {
  if (!loadedEngine) return 'The plan validator is still loading. Try again.';
  const parsed = loadedEngine.PlanZ.safeParse(plan);
  return parsed.success
    ? null
    : parsed.error.issues
        .map((i) => i.path.join('.') + ' ' + i.message)
        .slice(0, 3)
        .join('. ');
}
export function loadEngine(): Promise<typeof import('@fisim/engine')> {
  engine ??= import('@fisim/engine')
    .then((module) => (loadedEngine = module))
    .catch((error) => {
      engine = null;
      throw error;
    });
  return engine;
}
let data: Promise<typeof import('@fisim/data/src/bundle')> | null = null;
export function loadDataBundle(): Promise<typeof import('@fisim/data/src/bundle')> {
  data ??= import('@fisim/data/src/bundle');
  return data;
}
