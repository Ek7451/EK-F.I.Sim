/** Return-path generators: block bootstrap (SIM-02), parametric (SIM-03), historical cohorts (SIM-04), longevity (SIM-08). */
import type { MarketHistory, MortalityTable } from '@fisim/data';
import { NC, type Compiled } from '../compile';
import type { PathInputs } from '../projection';
import { cholesky, Rng } from './rng';

export interface PathSettings {
  method: 'bootstrap' | 'parametric';
  blockLength: number;
  inflation: 'fixed' | 'sampled';
  stochasticLongevity: boolean;
}

interface Prepared {
  n: number;
  hist: MarketHistory;
  realStocks: Float64Array;
  realBonds: Float64Array;
  realCash: Float64Array;
  /** Log-return standardisation of the US stock series (to correlate the parametric classes with it). */
  stockLogMean: number;
  stockLogSd: number;
  mu: number[];
  sigma: number[];
  chol: number[][];
  inflMean: number;
  inflSd: number;
  rhoIntl: number;
  rhoReit: number;
}

const prepCache = new WeakMap<Compiled, Prepared>();
const CLASS_NAMES = ['usStocks', 'usBonds', 'cash', 'intlStocks', 'reits'];

function lognormalParams(mean: number, sd: number): [number, number] {
  const s2 = Math.log(1 + (sd * sd) / ((1 + mean) * (1 + mean)));
  return [Math.log(1 + mean) - s2 / 2, Math.sqrt(s2)];
}

export function prepare(c: Compiled): Prepared {
  const hit = prepCache.get(c);
  if (hit) return hit;
  const hist = c.data.market;
  const n = hist.years.length;
  const realStocks = new Float64Array(n);
  const realBonds = new Float64Array(n);
  const realCash = new Float64Array(n);
  let lm = 0;
  for (let i = 0; i < n; i++) {
    const d = 1 + hist.inflation[i];
    realStocks[i] = (1 + hist.usStocks[i]) / d - 1;
    realBonds[i] = (1 + hist.usBonds[i]) / d - 1;
    realCash[i] = (1 + hist.cash[i]) / d - 1;
    lm += Math.log(1 + realStocks[i]);
  }
  lm /= n;
  let lv = 0;
  for (let i = 0; i < n; i++) lv += (Math.log(1 + realStocks[i]) - lm) ** 2;
  const ra = c.data.returnAssumptions;
  const A = c.plan.assumptions;
  const fixed = A.returns.fixed;
  const means = [fixed.usStocks, fixed.usBonds, fixed.cash, fixed.intlStocks, fixed.reits];
  const order = CLASS_NAMES.map((nm) => (ra.classes as string[]).indexOf(nm));
  const sds = CLASS_NAMES.map((nm) => A.returns.stdDev?.[nm] ?? ra.stdDev[nm] ?? 0.15);
  const corr =
    A.returns.correlation && A.returns.correlation.length === NC
      ? A.returns.correlation
      : CLASS_NAMES.map((_, i) =>
          CLASS_NAMES.map((__, j) =>
            order[i] >= 0 && order[j] >= 0 ? ra.correlation[order[i]][order[j]] : i === j ? 1 : 0,
          ),
        );
  const mu: number[] = [];
  const sigma: number[] = [];
  for (let k = 0; k < NC; k++) {
    const [m, s] = lognormalParams(means[k], sds[k]);
    mu.push(m);
    sigma.push(s);
  }
  const p: Prepared = {
    n,
    hist,
    realStocks,
    realBonds,
    realCash,
    stockLogMean: lm,
    stockLogSd: Math.sqrt(lv / (n - 1)),
    mu,
    sigma,
    chol: cholesky(corr),
    inflMean: A.inflation.rate,
    inflSd: ra.inflationStdDev,
    rhoIntl: corr[0][3],
    rhoReit: corr[0][4],
  };
  prepCache.set(c, p);
  return p;
}

/** Sample an age at death from period q(x), conditional on being alive at `ageNow`. */
export function sampleDeathAge(
  table: MortalityTable,
  sex: 'male' | 'female',
  ageNow: number,
  rng: Rng,
): number {
  const q = sex === 'male' ? table.male : table.female;
  for (let age = Math.max(0, ageNow); age < q.length; age++) if (rng.next() < q[age]) return age;
  return q.length - 1;
}

/** Probability of surviving from `fromAge` to `toAge`. */
export function survivalProbability(
  table: MortalityTable,
  sex: 'male' | 'female',
  fromAge: number,
  toAge: number,
): number {
  const q = sex === 'male' ? table.male : table.female;
  let s = 1;
  for (let a = fromAge; a < toAge && a < q.length; a++) s *= 1 - q[a];
  return s;
}

export function generatePath(c: Compiled, settings: PathSettings, seed: number, run: number): PathInputs {
  const p = prepare(c);
  const rng = new Rng(seed, run);
  const years = c.maxYears;
  const path: PathInputs = {
    years,
    returns: new Float64Array(years * NC),
    inflation: new Float64Array(years),
    healthExcess: new Float64Array(years),
  };
  const A = c.plan.assumptions;
  const fixedInfl = A.inflation.rate;
  if (settings.method === 'bootstrap') {
    // Circular block bootstrap of joint real returns (and inflation), plan 7.1.
    const L = Math.max(1, settings.blockLength);
    let idx = 0;
    for (let t = 0; t < years; t++) {
      if (t % L === 0) idx = rng.int(p.n);
      else idx = (idx + 1) % p.n;
      const infl = settings.inflation === 'sampled' ? p.hist.inflation[idx] : fixedInfl;
      const g = 1 + infl;
      const rs = p.realStocks[idx];
      path.inflation[t] = infl;
      path.returns[t * NC] = (1 + rs) * g - 1;
      path.returns[t * NC + 1] = (1 + p.realBonds[idx]) * g - 1;
      path.returns[t * NC + 2] = (1 + p.realCash[idx]) * g - 1;
      // No long free history for these two: lognormal draws correlated with the sampled US stock return.
      const z = (Math.log(1 + rs) - p.stockLogMean) / p.stockLogSd;
      const zi = p.rhoIntl * z + Math.sqrt(Math.max(0, 1 - p.rhoIntl * p.rhoIntl)) * rng.normal();
      const zr = p.rhoReit * z + Math.sqrt(Math.max(0, 1 - p.rhoReit * p.rhoReit)) * rng.normal();
      path.returns[t * NC + 3] = Math.exp(p.mu[3] + p.sigma[3] * zi) - 1 + (infl - fixedInfl);
      path.returns[t * NC + 4] = Math.exp(p.mu[4] + p.sigma[4] * zr) - 1 + (infl - fixedInfl);
    }
  } else {
    const z = new Array<number>(NC);
    for (let t = 0; t < years; t++) {
      for (let k = 0; k < NC; k++) z[k] = rng.normal();
      const infl =
        settings.inflation === 'sampled' ? Math.max(-0.05, p.inflMean + p.inflSd * rng.normal()) : fixedInfl;
      path.inflation[t] = infl;
      for (let i = 0; i < NC; i++) {
        let x = 0;
        for (let j = 0; j <= i; j++) x += p.chol[i][j] * z[j];
        path.returns[t * NC + i] = Math.exp(p.mu[i] + p.sigma[i] * x) - 1 + (infl - fixedInfl);
      }
    }
  }
  const h = A.healthcareInflation;
  for (let t = 0; t < years; t++)
    path.healthExcess[t] = h.stochastic ? h.excessOverCpi + h.stdDev * rng.normal() : h.excessOverCpi;
  // Longevity (SIM-08): independent draws per person give joint survival for couples.
  path.deathAge = c.people.map((person) =>
    person.stochasticLongevity
      ? Math.min(109, sampleDeathAge(c.data.mortality, person.sex, c.startYear - person.birthYear, rng))
      : person.deathAge,
  );
  // Long-term-care events (HC-10).
  path.ltc = c.people.map((person) => {
    const cfg = c.plan.healthcare.people.find((x) => x.personId === person.id)?.ltc;
    if (!cfg || cfg.mode !== 'stochastic') return null;
    const inc = c.data.ltc.incidence[person.sex];
    if (rng.next() >= inc.probability) return null;
    const onset = Math.max(66, Math.round(c.data.ltc.typicalOnsetAge + 6 * rng.normal()));
    const yrs = Math.max(0.25, -Math.log(1 - rng.next()) * inc.avgYears);
    return { onsetAge: onset, years: Math.min(15, yrs) };
  });
  return path;
}

/** Historical sequence starting at history index `start` (nominal returns and actual inflation). */
export function historicalPath(c: Compiled, start: number, years: number): PathInputs {
  const m = c.data.market;
  const n = Math.min(years, m.years.length - start);
  const path: PathInputs = {
    years: n,
    returns: new Float64Array(n * NC),
    inflation: new Float64Array(n),
    healthExcess: new Float64Array(n).fill(c.plan.assumptions.healthcareInflation.excessOverCpi),
  };
  for (let t = 0; t < n; t++) {
    const i = start + t;
    path.inflation[t] = m.inflation[i];
    path.returns[t * NC] = m.usStocks[i];
    path.returns[t * NC + 1] = m.usBonds[i];
    path.returns[t * NC + 2] = m.cash[i];
    // No long history for these classes: they follow US stocks in backtests (flagged in the UI).
    path.returns[t * NC + 3] = m.usStocks[i];
    path.returns[t * NC + 4] = m.usStocks[i];
  }
  return path;
}
