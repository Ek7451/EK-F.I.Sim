/**
 * Builds the market datasets from the raw sources (see shiller.ts, fred.ts, damodaran.ts):
 *
 *   packages/data/market/shiller-annual.json   MarketHistory      (market-history.v1)
 *   packages/data/market/damodaran.json        DamodaranHistory   (damodaran-history.v1)
 *   packages/data/market/assumptions.json      ReturnAssumptions  (return-assumptions.v1)
 *
 *   pnpm tsx tools/ingest/build-market.ts [--refresh]
 *
 * Raw downloads are cached in tools/ingest/.cache/ (git-ignored); --refresh re-downloads them.
 */
import { join } from 'node:path';
import type { DamodaranHistory, MarketHistory, ReturnAssumptions } from '../../packages/data/src/types';
import { loadDamodaran } from './damodaran';
import { buildCashSeries, loadTb3ms, TB3MS_SERIES_PAGE } from './fred';
import {
  MARKET_DIR,
  correlation,
  geoMean,
  isPositiveDefinite,
  mean,
  round,
  stdDev,
  writeJson,
} from './market-common';
import { loadShiller, SHILLER_LANDING } from './shiller';

/** Window for the US-class statistics in assumptions.json: the years in which no series is approximated. */
const ASSUMPTION_WINDOW_START = 1928;

/**
 * intlStocks / reits have no free, redistributable long history, so they are ASSUMPTIONS rather
 * than ingested data. The figures are summary statistics computed on 2026-11-10 from the
 * calendar-year total returns (USD) of the MSCI EAFE Index (1970-2025) and the FTSE Nareit All
 * Equity REITs Index (1972-2025) as tabulated at https://novelinvestor.com/historical-returns/
 * (arithmetic mean and sample standard deviation). Correlations are over 1972-2025 against
 * Damodaran's calendar-year S&P 500 / 10-year T-bond / 3-month T-bill returns, rounded to 2 dp.
 * The underlying index returns are not stored in this repository.
 */
const EXTERNAL_ASSUMPTIONS = {
  citation:
    'MSCI EAFE Index (1970-2025) and FTSE Nareit All Equity REITs Index (1972-2025) calendar-year total returns in USD, as tabulated by Novel Investor, "Historical Returns on Stocks, Bonds, and Countries", https://novelinvestor.com/historical-returns/ (retrieved 2026-11-10)',
  intlStocks: { mean: 0.114, stdDev: 0.21, window: '1970-2025' },
  reits: { mean: 0.124, stdDev: 0.181, window: '1972-2025' },
  /** Correlations with [usStocks, usBonds, cash], 1972-2025. */
  intlVsUs: [0.67, -0.03, 0.07],
  reitsVsUs: [0.56, 0.1, 0.03],
  intlVsReits: 0.4,
};

const pct = (x: number, dp = 2) => `${(x * 100).toFixed(dp)}%`;
const r6 = (xs: number[]) => xs.map((x) => round(x, 6));

const shiller = await loadShiller();
const damodaran = await loadDamodaran();
const tb3ms = await loadTb3ms();
const cash = buildCashSeries(shiller, tb3ms, damodaran);

// ------------------------------------------------------------------ shiller-annual.json

const { years, startYear, endYear } = shiller;
const spreadPts = (cash.proxySpread * 100).toFixed(2);

const market: MarketHistory = {
  header: {
    source: shiller.raw.url,
    publisher:
      'Robert J. Shiller (Yale University / shillerdata.com); cash from the Board of Governors of the Federal Reserve System via FRED and from Aswath Damodaran (NYU Stern)',
    retrieved: shiller.raw.retrieved,
    status: 'enacted',
    lawRefs: [],
    sha256: shiller.raw.sha256,
    schema: 'market-history.v1',
    notes: [
      `Calendar-year NOMINAL annual total returns, ${startYear}-${endYear}, as decimals. Built by tools/ingest/build-market.ts.`,
      `TIMING: stocks, bonds and inflation are January-to-January. The value for year Y runs from the January Y level to the January Y+1 level, where Shiller's monthly S&P price is the average of daily closes in the month, so "year Y" is effectively mid-January Y to mid-January Y+1 (the FIRECalc/cFIREsim convention), not December-to-December.`,
      `usStocks: S&P Composite total return from Shiller's P and D columns. The twelve monthly total returns from February Y to January Y+1 are compounded; each month's total return is (P_m + D_m/12) / P_(m-1), where D is Shiller's trailing-twelve-month dividend per share, so one twelfth of it is paid and reinvested each month at that month's average price.`,
      `usBonds: constant-maturity 10-year Treasury total return from Shiller's long interest rate column ("Rate GS10"). Each year a 10-year bond is bought at par at the January yield y0, pays one annual coupon y0, and is repriced one year later as a 9-year annual-coupon bond at the next January yield y1: ret = y0 + price(9y, coupon y0, yield y1) - 1.`,
      `inflation: January-to-January change in Shiller's CPI column (BLS CPI-U, not seasonally adjusted, from 1913; Shiller's spliced Warren-Pearson based index before 1913).`,
      `cash: ${CASH_NOTE(spreadPts)}`,
      `The sha256 in this header is of ie_data.xls (the copy linked from ${SHILLER_LANDING}; the older Yale copy at http://www.econ.yale.edu/~shiller/data/ie_data.xls ends in 2023 and is only a fallback). Last month in the workbook: ${shiller.lastMonth}; ${endYear} is the last year with a following-January row. Other raw inputs: TB3MS.csv sha256 ${tb3ms.raw.sha256} (${tb3ms.raw.url}, retrieved ${tb3ms.raw.retrieved}); histretSP.xlsx sha256 ${damodaran.raw.sha256} (${damodaran.raw.url}, retrieved ${damodaran.raw.retrieved}).`,
    ].join(' '),
    flags: {
      cash: `approximated before 1928: Shiller long rate minus a fixed ${spreadPts}-point term spread (floored at 0); 1928-1933 from Damodaran; 1934+ from FRED TB3MS`,
      usBonds: `synthetic return computed from yields in every year; before ${shiller.gs10From} the long rate is not GS10 but Shiller's older government-bond yield series, which is annual data interpolated to months`,
      usStocks:
        'before 1926 the S&P Composite is the Cowles Commission back-cast index; monthly prices are averages of daily closes',
      inflation: "before 1913 the CPI is Shiller's spliced Warren-Pearson based index, not BLS CPI-U",
    },
  },
  startYear,
  years,
  usStocks: r6(shiller.usStocks),
  usBonds: r6(shiller.usBonds),
  cash: r6(cash.cash),
  inflation: r6(shiller.inflation),
  approximatedBefore: { cash: 1928 },
};

function CASH_NOTE(spread: string): string {
  return (
    `1934 onward: FRED TB3MS (3-Month Treasury Bill Secondary Market Rate, discount basis, monthly; ${TB3MS_SERIES_PAGE}) averaged over the twelve months of calendar year Y (January-December, so about half a month ahead of the January-to-January window of the other series) and converted to an annual return by rolling 91-day bills: (1 - d*91/360)^(-365/91) - 1. ` +
    `1928-1933: Damodaran's published 3-month T-bill return for the year. ` +
    `Before 1928 (APPROXIMATED): calendar-year mean of Shiller's long rate minus a fixed term spread of ${spread} percentage points, floored at zero; the spread is the mean of (long rate - cash) over ${cash.proxySpreadWindow[0]}-${cash.proxySpreadWindow[1]}. Short-term commercial rates before 1928 were often above long government yields, so this proxy probably understates cash returns in that period.`
  );
}

for (const k of ['usStocks', 'usBonds', 'cash', 'inflation'] as const) {
  if (market[k].length !== years.length)
    throw new Error(`${k}: length ${market[k].length} != ${years.length}`);
  if (market[k].some((v) => !Number.isFinite(v))) throw new Error(`${k}: non-finite value`);
}
writeJson(join(MARKET_DIR, 'shiller-annual.json'), market);

// ------------------------------------------------------------------ damodaran.json

const dam: DamodaranHistory = {
  header: {
    source: damodaran.raw.url,
    publisher: 'Aswath Damodaran, NYU Stern School of Business',
    retrieved: damodaran.raw.retrieved,
    status: 'enacted',
    lawRefs: [],
    sha256: damodaran.raw.sha256,
    schema: 'damodaran-history.v1',
    notes: [
      `"Historical Returns on Stocks, Bonds and Bills" (histretSP), sheet "Returns by year", ${damodaran.years[0]}-${damodaran.years[damodaran.years.length - 1]}, copied without adjustment. sha256 is of the raw workbook.`,
      `TIMING: calendar year, end of December to end of December (unlike shiller-annual.json, which is January-average to January-average), nominal, decimals.`,
      `sp500: (year-end index - prior year-end index + dividends during the year) / prior year-end index; dividends are not reinvested within the year.`,
      `tBill3m: average 3-month T-bill rate during the year, used directly as the year's return.`,
      `tBond10y: constant-maturity 10-year Treasury; coupon at the prior year-end yield plus the price change of a 10-year par bond repriced at the new year-end yield with the maturity kept at 10 years.`,
      `baaCorporate: same construction applied to Moody's Baa corporate yield.`,
      `inflation: CPI-U (not seasonally adjusted) calendar-year change as published in the sheet.`,
      `Used as a cross-check on shiller-annual.json and as a corporate-bond series for Trinity-style comparisons (the Trinity study itself used Ibbotson long-term high-grade corporates, which this Baa series only approximates).`,
    ].join(' '),
  },
  years: damodaran.years,
  sp500: r6(damodaran.sp500),
  tBill3m: r6(damodaran.tBill3m),
  tBond10y: r6(damodaran.tBond10y),
  baaCorporate: r6(damodaran.baaCorporate),
  inflation: r6(damodaran.inflation),
};
writeJson(join(MARKET_DIR, 'damodaran.json'), dam);

// ------------------------------------------------------------------ assumptions.json

const w0 = years.indexOf(ASSUMPTION_WINDOW_START);
const win = {
  usStocks: shiller.usStocks.slice(w0),
  usBonds: shiller.usBonds.slice(w0),
  cash: cash.cash.slice(w0),
  inflation: shiller.inflation.slice(w0),
};
const us = ['usStocks', 'usBonds', 'cash'] as const;
const classes: ReturnAssumptions['classes'] = ['usStocks', 'usBonds', 'cash', 'intlStocks', 'reits'];
const X = EXTERNAL_ASSUMPTIONS;

const corr: number[][] = classes.map(() => new Array<number>(classes.length).fill(0));
for (let i = 0; i < 3; i++) {
  for (let j = 0; j < 3; j++) corr[i]![j] = i === j ? 1 : round(correlation(win[us[i]!], win[us[j]!]), 4);
}
for (let i = 0; i < 3; i++) {
  corr[i]![3] = corr[3]![i] = X.intlVsUs[i]!;
  corr[i]![4] = corr[4]![i] = X.reitsVsUs[i]!;
}
corr[3]![3] = corr[4]![4] = 1;
corr[3]![4] = corr[4]![3] = X.intlVsReits;
for (let i = 0; i < 5; i++)
  for (let j = 0; j < 5; j++)
    if (corr[i]![j] !== corr[j]![i]) throw new Error('correlation matrix is not symmetric');
if (!isPositiveDefinite(corr)) throw new Error('correlation matrix is not positive-definite');

const windowLabel = `${ASSUMPTION_WINDOW_START}-${endYear}`;
const assumptions: ReturnAssumptions = {
  header: {
    source: shiller.raw.url,
    publisher:
      'Derived by tools/ingest/build-market.ts from Shiller, FRED TB3MS and Damodaran (US classes); MSCI and FTSE Nareit index statistics via Novel Investor (intlStocks, reits)',
    retrieved: shiller.raw.retrieved,
    status: 'enacted',
    lawRefs: [],
    sha256: shiller.raw.sha256,
    schema: 'return-assumptions.v1',
    notes: [
      `Default parametric-mode assumptions. These are HISTORICAL sample statistics, not forecasts. All values are nominal annual arithmetic means and sample standard deviations (n-1), as decimals.`,
      `usStocks, usBonds, cash, inflationMean/inflationStdDev and the 3x3 US block of the correlation matrix are computed from the series in shiller-annual.json over ${windowLabel} (${years.length - w0} January-to-January years; the window starts in ${ASSUMPTION_WINDOW_START} so that no approximated cash years are included).`,
      `intlStocks and reits are assumptions, not ingested data: arithmetic mean and sample standard deviation of the calendar-year USD total returns of the MSCI EAFE Index (${X.intlStocks.window}) and the FTSE Nareit All Equity REITs Index (${X.reits.window}); their correlations with the US classes and with each other are over 1972-2025 against Damodaran's calendar-year S&P 500, 10-year T-bond and 3-month T-bill returns, rounded to two decimals. Because the windows differ from the US block, the matrix is a composite; it is checked to be symmetric positive-definite (Cholesky) at build time.`,
      `sha256 is of ie_data.xls; TB3MS.csv sha256 ${tb3ms.raw.sha256}; histretSP.xlsx sha256 ${damodaran.raw.sha256}.`,
    ].join(' '),
    flags: {
      intlStocks: `assumption, user-editable. ${X.citation}. MSCI EAFE ${X.intlStocks.window}: developed markets ex-US/Canada only, no emerging markets.`,
      reits: `assumption, user-editable. ${X.citation}. FTSE Nareit All Equity REITs ${X.reits.window}.`,
      correlation:
        'rows/columns 4-5 (intlStocks, reits) are assumptions, user-editable (1972-2025, calendar-year); rows/columns 1-3 are computed from shiller-annual.json',
      window: `US classes and inflation: ${windowLabel}, January-to-January`,
    },
  },
  classes,
  mean: {
    usStocks: round(mean(win.usStocks), 4),
    usBonds: round(mean(win.usBonds), 4),
    cash: round(mean(win.cash), 4),
    intlStocks: X.intlStocks.mean,
    reits: X.reits.mean,
  },
  stdDev: {
    usStocks: round(stdDev(win.usStocks), 4),
    usBonds: round(stdDev(win.usBonds), 4),
    cash: round(stdDev(win.cash), 4),
    intlStocks: X.intlStocks.stdDev,
    reits: X.reits.stdDev,
  },
  correlation: corr,
  inflationMean: round(mean(win.inflation), 4),
  inflationStdDev: round(stdDev(win.inflation), 4),
};
writeJson(join(MARKET_DIR, 'assumptions.json'), assumptions);

// ------------------------------------------------------------------ report

const real = (xs: number[], infl: number[]) => xs.map((x, i) => (1 + x) / (1 + infl[i]!) - 1);
const line = (label: string, xs: number[], infl: number[]) => {
  const rr = real(xs, infl);
  console.log(
    `  ${label.padEnd(10)} nominal mean ${pct(mean(xs))} sd ${pct(stdDev(xs))} geo ${pct(geoMean(xs))} | real mean ${pct(mean(rr))} sd ${pct(stdDev(rr))} geo ${pct(geoMean(rr))}`,
  );
};
console.log(`shiller-annual.json  ${startYear}-${endYear} (${years.length} years)`);
for (const [label, from] of [
  ['full', 0],
  [`${ASSUMPTION_WINDOW_START}+`, w0],
] as const) {
  console.log(` ${label}:`);
  const infl = shiller.inflation.slice(from);
  line('usStocks', shiller.usStocks.slice(from), infl);
  line('usBonds', shiller.usBonds.slice(from), infl);
  line('cash', cash.cash.slice(from), infl);
  console.log(`  inflation  mean ${pct(mean(infl))} sd ${pct(stdDev(infl))} geo ${pct(geoMean(infl))}`);
}
const d0 = years.indexOf(damodaran.years[0]!);
const n = Math.min(years.length - d0, damodaran.years.length);
const cmp = (label: string, mine: number[], theirs: number[]) => {
  const a = mine.slice(d0, d0 + n);
  const b = theirs.slice(0, n);
  console.log(
    `  ${label.padEnd(22)} corr ${correlation(a, b).toFixed(4)}  mean diff ${((mean(a) - mean(b)) * 100).toFixed(3)} pts`,
  );
};
console.log(
  `cross-check vs Damodaran ${damodaran.years[0]}-${damodaran.years[n - 1]} (${n} years; Jan-Jan vs Dec-Dec):`,
);
cmp('usBonds vs tBond10y', shiller.usBonds, damodaran.tBond10y);
cmp('usStocks vs sp500', shiller.usStocks, damodaran.sp500);
cmp('cash vs tBill3m', cash.cash, damodaran.tBill3m);
cmp('inflation vs inflation', shiller.inflation, damodaran.inflation);
console.log(`cash proxy spread before 1928: ${spreadPts} pts`);
console.log(`assumptions.json correlation (${classes.join(', ')}):`);
for (const row of corr) console.log(`  ${row.map((v) => v.toFixed(4).padStart(8)).join('')}`);
