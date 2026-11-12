/**
 * Return-path generators: block bootstrap (SIM-02), parametric (SIM-03), historical cohorts (SIM-04), longevity (SIM-08).
 *
 * Return convention (C1): every "expected return" in the plan is a GEOMETRIC (compound) nominal annual rate,
 * read at the plan's inflation rate. The deterministic projection compounds it as-is; the parametric model uses
 * it as the lognormal median; the bootstrap re-centres each class's historical log returns on it (keeping the
 * history's volatility, cross-correlation and sequence) unless `bootstrapMeans` is 'historical'.
 */
import type { MarketHistory } from '@fisim/data';
import { expectedMeans, NC, type Compiled } from '../compile';
import type { PathInputs } from '../projection';
import { sampleDeathAge } from './mortality';
import { cholesky, Rng } from './rng';

export { sampleDeathAge, survivalProbability } from './mortality';

export interface PathSettings {
  method: 'bootstrap' | 'parametric';
  blockLength: number;
  inflation: 'fixed' | 'sampled';
  stochasticLongevity: boolean;
  /**
   * Bootstrap only. 'assumptions' (default) re-centres the historical US stock, bond, cash and inflation log returns
   * on the plan's expected returns and inflation; 'historical' replays raw history with its own means.
   */
  bootstrapMeans?: 'assumptions' | 'historical';
}

interface Prepared {
  n: number;
  hist: MarketHistory;
  realStocks: Float64Array;
  realBonds: Float64Array;
  realCash: Float64Array;
  /** Historical real log returns for US stocks, bonds, cash, and log(1 + inflation). */
  logReal: [Float64Array, Float64Array, Float64Array];
  logInfl: Float64Array;
  /** Means of the arrays above. */
  histLogMean: [number, number, number];
  histInflLogMean: number;
  /** Log-return standardisation of the US stock series (to correlate the parametric classes with it). */
  stockLogMean: number;
  stockLogSd: number;
  /** Plan's target nominal log mean per class: ln(1 + geometric expected return). */
  mu: number[];
  /** Lognormal sigma per class from the plan's (or default) standard deviation. */
  sigma: number[];
  chol: number[][];
  /** ln(1 + plan inflation). */
  inflLog: number;
  inflMean: number;
  inflSd: number;
  /** Lag-1 autocorrelation of annual inflation (1928 on), used by the parametric AR(1) inflation model. */
  inflPhi: number;
  rhoIntl: number;
  rhoReit: number;
}

const prepCache = new WeakMap<Compiled, Prepared>();
const CLASS_NAMES = ['usStocks', 'usBonds', 'cash', 'intlStocks', 'reits'];

/**
 * Lognormal parameters for a GEOMETRIC mean `g` (the median of 1 + r is 1 + g) and a standard deviation `sd` of
 * simple returns. Solves Var = (1+g)^2 u (u - 1) for u = exp(sigma^2).
 */
export function lognormalParams(g: number, sd: number): [number, number] {
  const ratio = sd / (1 + g);
  const u = (1 + Math.sqrt(1 + 4 * ratio * ratio)) / 2;
  return [Math.log(1 + g), Math.sqrt(Math.log(u))];
}

export function prepare(c: Compiled): Prepared {
  const hit = prepCache.get(c);
  if (hit) return hit;
  const hist = c.data.market;
  const n = hist.years.length;
  const realStocks = new Float64Array(n);
  const realBonds = new Float64Array(n);
  const realCash = new Float64Array(n);
  const logReal: [Float64Array, Float64Array, Float64Array] = [
    new Float64Array(n),
    new Float64Array(n),
    new Float64Array(n),
  ];
  const logInfl = new Float64Array(n);
  const histLogMean: [number, number, number] = [0, 0, 0];
  let histInflLogMean = 0;
  for (let i = 0; i < n; i++) {
    const d = 1 + hist.inflation[i];
    realStocks[i] = (1 + hist.usStocks[i]) / d - 1;
    realBonds[i] = (1 + hist.usBonds[i]) / d - 1;
    realCash[i] = (1 + hist.cash[i]) / d - 1;
    logReal[0][i] = Math.log(1 + realStocks[i]);
    logReal[1][i] = Math.log(1 + realBonds[i]);
    logReal[2][i] = Math.log(1 + realCash[i]);
    logInfl[i] = Math.log(d);
    for (let k = 0; k < 3; k++) histLogMean[k] += logReal[k][i] / n;
    histInflLogMean += logInfl[i] / n;
  }
  const lm = histLogMean[0];
  let lv = 0;
  for (let i = 0; i < n; i++) lv += (logReal[0][i] - lm) ** 2;
  // Inflation persistence over the same window as the parametric defaults (1928 on).
  const from = Math.max(0, hist.years.indexOf(1928));
  let im = 0;
  for (let i = from; i < n; i++) im += hist.inflation[i];
  im /= Math.max(1, n - from);
  let iv = 0;
  let ic = 0;
  for (let i = from; i < n; i++) {
    iv += (hist.inflation[i] - im) ** 2;
    if (i > from) ic += (hist.inflation[i] - im) * (hist.inflation[i - 1] - im);
  }
  const inflPhi = iv > 0 ? Math.max(0, Math.min(0.95, ic / iv)) : 0;

  const ra = c.data.returnAssumptions;
  const A = c.plan.assumptions;
  const expected = expectedMeans(c);
  const means = expected.classes;
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
    logReal,
    logInfl,
    histLogMean,
    histInflLogMean,
    stockLogMean: lm,
    stockLogSd: Math.sqrt(lv / (n - 1)),
    mu,
    sigma,
    chol: cholesky(corr),
    inflLog: Math.log(1 + expected.inflation),
    inflMean: expected.inflation,
    inflSd: ra.inflationStdDev,
    inflPhi,
    rhoIntl: corr[0][3],
    rhoReit: corr[0][4],
  };
  prepCache.set(c, p);
  return p;
}

/** Geometric nominal annual means a Monte Carlo run uses, per class and for inflation (reported with results). */
export interface ReturnMeans {
  basis: 'assumptions' | 'historical';
  usStocks: number;
  usBonds: number;
  cash: number;
  intlStocks: number;
  reits: number;
  inflation: number;
}

export function returnMeansUsed(c: Compiled, settings: PathSettings): ReturnMeans {
  const e = expectedMeans(c);
  const fromPlan: ReturnMeans = {
    basis: 'assumptions',
    usStocks: e.classes[0],
    usBonds: e.classes[1],
    cash: e.classes[2],
    intlStocks: e.classes[3],
    reits: e.classes[4],
    inflation: e.inflation,
  };
  if (settings.method !== 'bootstrap' || settings.bootstrapMeans !== 'historical') return fromPlan;
  const p = prepare(c);
  const inflLog = settings.inflation === 'sampled' ? p.histInflLogMean : p.inflLog;
  const nom = (k: number): number => Math.exp(p.histLogMean[k] + inflLog) - 1;
  return {
    ...fromPlan,
    basis: 'historical',
    usStocks: nom(0),
    usBonds: nom(1),
    cash: nom(2),
    inflation: Math.exp(inflLog) - 1,
  };
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
  const fixedInfl = p.inflMean;
  // Real log medians for the classes with no long free history (and for the parametric model).
  const muReal = p.mu.map((m) => m - p.inflLog);
  if (settings.method === 'bootstrap') {
    // Circular block bootstrap of joint real returns (and inflation), plan 7.1.
    const recentre = settings.bootstrapMeans !== 'historical';
    const shift = [0, 1, 2].map((k) => (recentre ? muReal[k] - p.histLogMean[k] : 0));
    const inflShift = recentre ? p.inflLog - p.histInflLogMean : 0;
    const L = Math.max(1, settings.blockLength);
    let idx = 0;
    for (let t = 0; t < years; t++) {
      if (t % L === 0) idx = rng.int(p.n);
      else idx = (idx + 1) % p.n;
      const infl = settings.inflation === 'sampled' ? Math.exp(p.logInfl[idx] + inflShift) - 1 : fixedInfl;
      const g = 1 + infl;
      path.inflation[t] = infl;
      for (let k = 0; k < 3; k++) path.returns[t * NC + k] = Math.exp(p.logReal[k][idx] + shift[k]) * g - 1;
      // No long free history for these two: lognormal draws correlated with the sampled US stock return.
      const z = (p.logReal[0][idx] - p.stockLogMean) / p.stockLogSd;
      const zi = p.rhoIntl * z + Math.sqrt(Math.max(0, 1 - p.rhoIntl * p.rhoIntl)) * rng.normal();
      const zr = p.rhoReit * z + Math.sqrt(Math.max(0, 1 - p.rhoReit * p.rhoReit)) * rng.normal();
      path.returns[t * NC + 3] = Math.exp(muReal[3] + p.sigma[3] * zi) * g - 1;
      path.returns[t * NC + 4] = Math.exp(muReal[4] + p.sigma[4] * zr) * g - 1;
    }
  } else {
    const z = new Array<number>(NC);
    // AR(1) inflation with the historical persistence; its stationary sd is the historical sd.
    const phi = p.inflPhi;
    const innov = p.inflSd * Math.sqrt(1 - phi * phi);
    let dev = 0;
    for (let t = 0; t < years; t++) {
      for (let k = 0; k < NC; k++) z[k] = rng.normal();
      let infl = fixedInfl;
      if (settings.inflation === 'sampled') {
        dev = phi * dev + innov * rng.normal();
        infl = Math.max(-0.05, p.inflMean + dev);
      }
      path.inflation[t] = infl;
      const g = 1 + infl;
      for (let i = 0; i < NC; i++) {
        let x = 0;
        for (let j = 0; j <= i; j++) x += p.chol[i][j] * z[j];
        path.returns[t * NC + i] = Math.exp(muReal[i] + p.sigma[i] * x) * g - 1;
      }
    }
  }
  const h = A.healthcareInflation;
  for (let t = 0; t < years; t++)
    path.healthExcess[t] = h.stochastic ? h.excessOverCpi + h.stdDev * rng.normal() : h.excessOverCpi;
  // Longevity (SIM-08): independent draws per person give joint survival for couples.
  const improveRate = A.mortalityImprovement;
  path.deathAge = c.people.map((person) =>
    person.stochasticLongevity
      ? Math.min(
          109,
          sampleDeathAge(
            c.data.mortality,
            person.sex,
            c.startYear - person.birthYear,
            rng,
            improveRate > 0 ? { rate: improveRate, birthYear: person.birthYear } : undefined,
          ),
        )
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
