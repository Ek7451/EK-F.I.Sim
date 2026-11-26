# Validation report

Status of the validation suite (plan §9), the release gate (plan §16) and the known limitations of this
build. Data release `data-2026.1`. Reproduce everything here with the commands in the last section.

Every figure the app shows is an estimate. This report says how far those estimates have been checked
against outside references, and where they have not.

## Summary

| Area                                   | Result                                                                                  |
| -------------------------------------- | --------------------------------------------------------------------------------------- |
| Unit, property and validation tests    | 432 pass, 2 marked todo (`pnpm test`)                                                   |
| Browser tests (phone, tablet, desktop) | 107 pass, 8 skipped by design (`pnpm e2e`), including one-screen layout checks          |
| Guided tours                           | All 25 complete with the keyboard alone on phone and desktop sizes; every target exists |
| Accessibility (automated)              | axe WCAG 2.2 A/AA: no violations on any of 21 screens, light and dark, three sizes      |
| Dataset checks                         | 177 datasets valid, 55 of them projected or estimated (`pnpm validate:data`)            |
| Lighthouse (simulated mid-range phone) | Performance 100, accessibility 100, best practices 100; LCP 1.80 s, CLS 0, TBT 10 ms    |
| Initial JavaScript                     | 130 KB gzipped (budget 250 KB); the engine and datasets load after the first screen     |
| Engine speed (this desktop)            | Projection 1.6 ms (budget 50); 1,000 simulated runs 0.55 s on one thread (budget 8 s)   |

The v1.0 gate is **not met**. The open items are listed under "Release gate" below.

## Validation cases

| Case | Reference                                                              | Result                | Detail                                                                                                                                                                                                                                                                                                                                                 |
| ---- | ---------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| V-01 | Bengen (1994), 50/50 portfolio, worst start years                      | **Outside tolerance** | Direction and worst cohort match (mid-1960s; a 3% withdrawal lasts 50 years from every start). At 4% the 1966 cohort lasts 29 years here against Bengen's 33. The bundled bond series is the 10-year Treasury (Shiller); Bengen used intermediate-term Treasuries (Ibbotson), which lost less in the 1970s. The test asserts a gap of at most 4 years. |
| V-02 | Trinity study (1998), Table 3                                          | **Outside tolerance** | Mean gap 4.1 points across the table; worst cell 17 points. The plan asks for ±2. Same cause: the study used Ibbotson long-term corporate bonds, which are not freely redistributable and are not bundled. Stock-heavy rows track closely; bond-heavy rows drift most.                                                                                 |
| V-03 | FIRECalc and cFIREsim default run ($1M, $40k, 30 years, 75/25)         | **Partly within**     | Success 96.83% against cFIREsim 96.06% (within 1 point) and FIRECalc 95.2% (1.6 points; the two tools differ from each other by 0.9). Median ending balance $1,819,739 against cFIREsim $1,719,109: 5.9% apart, where the plan asks for 2%. Likely cause, not confirmed: a different convention for reinvesting dividends within the year.             |
| V-04 | PSL Tax-Calculator 6.9.0, 294 households, tax year 2026                | **Pass**              | Federal income tax and payroll tax agree within $1 for every household, all filing statuses. For married-filing-separately Social Security the test follows the oracle's convention, noted in the test. Tax year 2027 has no valid oracle yet: Tax-Calculator's own 2027 parameters are projections, not the enacted figures bundled here.             |
| V-05 | SSA worked examples (PIA, 2027 eligibility)                            | **Pass**              | Exact match. Spousal benefits and the earnings test have no published worked example in the suite.                                                                                                                                                                                                                                                     |
| V-06 | Premium tax credit                                                     | **Partly covered**    | The credit arithmetic passes (prior-year poverty guideline, applicable-percentage interpolation, the 400% cliff in force for 2026 and 2027). Benchmark-premium lookups against HealthCare.gov for sample ZIP codes are **not automated** (todo): they need live lookups.                                                                               |
| V-07 | Retiree healthcare cost estimators (Fidelity, Vanguard, BiggerPockets) | **Not done**          | Marked todo. None of the references has a machine-readable interface, so no automated comparison exists. A manual comparison has not been made.                                                                                                                                                                                                        |
| V-08 | RMDs against the IRS Uniform Lifetime Table                            | **Pass**              | Every age; start age 73 or 75 by birth year.                                                                                                                                                                                                                                                                                                           |
| V-09 | Simulation statistics                                                  | **Pass**              | In raw-history mode, resampled returns match the source mean and variance within sampling error. In the default re-centred mode, real log returns centre on the plan's expected return and keep the historical variance. Seeded runs reproduce exactly; chunked runs merge to the same answer as one pass.                                             |

## Release gate (plan §16)

| Gate item                                                 | State                                                                                                               |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Every parity-matrix row done                              | **Not met.** 64 done, 1 implemented without a dedicated test, 11 partial. See [parity-matrix.md](parity-matrix.md). |
| Validation cases V-01 to V-09 within tolerance            | **Not met.** V-01, V-02 and part of V-03 are outside tolerance; V-06 lookups and V-07 are not done.                 |
| All 25 tours pass e2e on phone and desktop, keyboard only | Met.                                                                                                                |
| Accessibility                                             | Automated checks met. A manual screen-reader audit has **not** been done.                                           |
| Performance budgets on both reference devices             | Lighthouse budgets met under simulated throttling. The physical reference phones were **not** measured.             |
| Security review                                           | Runbook written (`runbooks/security-review.md`); the review itself has **not** been carried out.                    |
| Sync deployed and restore drill run                       | The existing production site serves the account API. A schema 3 production restore drill is outstanding.            |
| Usability check with a new user (T-B01 to T-B05)          | **Not done.**                                                                                                       |
| CI green                                                  | Pull requests run the build and desktop browser smoke suite. The full device matrix and Lighthouse run locally.     |

## November 2026 accuracy review

Three independent read-only audits (tax, Social Security and healthcare rules and data; the projection engine;
the simulations and every figure the screens derive) found the defects below. Each is fixed and pinned by
`packages/engine/test/audit-2026-11.test.ts` or `apps/web/src/lib/audit-2026-11.test.ts`.

| Area       | Defect                                                                                                                                                                       | Effect before the fix                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| State tax  | CO, IA, ID, MT and ND start from federal taxable income, but the federal deduction was added back                                                                            | Tax on federal AGI: about $700 a year too much at $100k single                              |
| Federal    | QBI thresholds were not re-based on each year's table                                                                                                                        | One inflation step low from 2027                                                            |
| Federal    | Senior deduction phased out from $150,000 for a qualifying surviving spouse                                                                                                  | Up to $2,700 too much deduction                                                             |
| Medicare   | Top IRMAA tier started above, not at, its threshold                                                                                                                          | Wrong tier at exactly $500,000 / $750,000                                                   |
| Projection | A year's effective tax rate left required distributions out of its base                                                                                                      | A retiree on RMDs could be shown 77% instead of 16%                                         |
| Projection | The independence milestone tested living costs only                                                                                                                          | Independence dated years early for anyone with a mortgage or healthcare costs               |
| Projection | "Net worth today" mixed start-of-year investments with year-end property and debt                                                                                            | Off by a year of appreciation and principal                                                 |
| Projection | Rule of 55 granted to people who left work before 55                                                                                                                         | 10% penalty missing on 401(k) withdrawals from 55 to 59½                                    |
| Projection | HSA family limit granted to each spouse when the non-primary spouse's account came first                                                                                     | Up to twice the legal family contribution                                                   |
| Projection | A drained account could leave a residue that overflowed the cost-basis ratio into NaN                                                                                        | The year read as funded with no withdrawals; the solver now reports such a year as unfunded |
| Projection | An income floor (MAGI target) taxed a conversion with nowhere to convert into                                                                                                | Phantom conversion income when no Roth IRA existed                                          |
| Projection | 529-to-Roth rollovers were counted as cash in                                                                                                                                | Bookkeeping only; balances were right                                                       |
| Simulation | Funded runs that missed an ending goal were listed under failure year -1                                                                                                     | Histogram overcounted failures                                                              |
| Screens    | The cash-flow diagram did not draw (links named a node the chart could not find), and crashed in compact mode in credit years                                                | Diagram blank                                                                               |
| Screens    | 99.6% success printed as "100%"; "-$0"; "$-1.0M" and "$1000k" on axes; raw cents in change lists                                                                             | Display only                                                                                |
| Screens    | The average tax rate was nominal-weighted beside a real lifetime tax; both now use today's dollars and one base                                                              | About 1.5 points on the early-retiree sample                                                |
| Screens    | Progress anchored the reference path at 1 January                                                                                                                            | A plan frozen in November read 9% behind on day one                                         |
| Screens    | History said incomplete cohorts "repeat"; they stop when the data stops. Outcomes said replayed history ignores your return assumptions; by default it is re-centred on them | Wrong explanation                                                                           |

The R3 review revisited the November baseline. Schema 3 records the opening valuation month. The FI headline and condition use opening accessible assets and a recurring annual budget. Restricted HSA and education balances are excluded. Ordinary living costs, housing, debt service and healthcare enter the budget. Income taxes, guaranteed income offsets and one-off purchases are excluded. Zero recurring spending produces no FI date. A fixed-date milestone alone does not establish FI.

Available sale proceeds go to the selected cash or taxable account after debt, costs, taxes and household cash needs. Percent-of-portfolio and floor-and-ceiling rules size total living spending. The guardrail rule sizes a withdrawal after other income. Earned income drives the Social Security wage base and earnings-test index through the wage-growth assumption. Compare adjusts effective stock-class means. Raw historical replay preserves its historical stock series.

The November baseline used projected 2027 contribution limits and Medicare premiums. The R3 datasets use the November CMS announcement and IRS Notice 2026-66. State tax remains approximate, including retirement-income exemptions and local taxes. Tax liability is net of the premium credit and can be negative in subsidy years.

## Known limitations of the model

Tax

- State income tax is a simplified model for all 50 states and DC: brackets, standard deduction or
  exemption, and the main retirement-income exclusions. It has no external oracle. Known inaccuracies
  include Ohio's base amounts, South Carolina, Connecticut, Utah and Oregon credits and phase-outs,
  Maryland county tax, New York's bracket recapture and Arkansas's table structure. Treat state tax as a
  rough estimate.
- Contribution limits and Medicare premiums for 2027 use the published agency amounts.
- Rebalancing happens at the start of the year. The advance premium tax credit is treated as exact, so
  repaying excess credit at tax time is not modelled.
- The IRMAA life-changing-event appeal is applied in the year it names (an earlier note here said it was not).
- Mortgage interest is deductible unless the debt's "interest is deductible" flag is set to false (the flag
  was previously ignored for mortgages).

Healthcare

- Benchmark premiums are county-level for HealthCare.gov states. States that run their own exchange use
  a statewide average; the Healthcare screen says so and accepts your own figure.
- Medicare starts in the half-year nearest the 65th birthday month.
- Long-term-care costs are national medians, not regional.

Simulation

- Expected returns are **geometric** (compound) nominal annual rates, read at the plan's inflation rate,
  in all three models. The single-path projection compounds them as entered; the parametric model uses them
  as the lognormal median; the history-based model re-centres each class's historical log returns (and
  inflation) on them, keeping history's volatility, cross-correlation and year-to-year sequence. A "raw
  history" option replays past returns with their own averages (US stocks about 9.4% nominal, 7.1% real),
  and the results report which means were used.
- For a single asset class the median simulated path lands within a few percent of the single-path
  projection (history's negative skew puts the bootstrap median slightly above it). For a rebalanced mix the
  simulated median runs above the single path by the diversification return, about 0.4% a year for 60/40,
  which a constant-rate path cannot show. This is expected, not an error.
- Today's-dollar figures: year-end balances deflate by year-end CPI (`cpiEnd`), flows by start-of-year CPI
  (`cpi`), through `toReal()`. The projection and Monte Carlo now use the same convention.
- Parametric inflation follows an AR(1) process with the historical lag-1 autocorrelation (about 0.6 for
  1928-2025); it is still independent of the return draws.
- Spending-cut statistics (share of runs and years below plan, lowest spending as a share of plan) and a
  net-estate distribution are reported. With random lifespans, runs that have ended drop out of the
  percentile bands (`activeShare` says how many remain) instead of carrying their last balance forward.
- Under "long-run historical averages" the single projection and the simulations both centre on the
  compound averages of the bundled history (`expectedMeans()`), so the two no longer disagree.
- Years are still whole years, with one refinement: pay that ends at an age runs to that birthday (by birth
  month and day), in the projection and in the Social Security earnings record. Health coverage still
  switches at the start of that year, so the retirement year counts a full year of the new coverage
  alongside part-year pay.
- Flexible spending rules never cut expenses marked essential; the flexible expenses absorb the cut.
- An optional ending net-worth goal can be reported or counted in the success rate (`legacyGoalForSuccess`).
- Optional SOA mortality tables are not included; longevity uses SSA period tables, with an optional annual
  mortality-improvement rate (off by default; about 0.8% is close to the Trustees' intermediate assumption).

Social Security

- Survivor benefits are figured from the deceased's own record: delayed credits stop at death, an early
  claimer's survivor is held to the larger of their benefit and 82.5% of the PIA, and a survivor who starts
  before the survivor FRA is reduced (to 71.5% at 60). The survivor benefit starts at the later of the death
  and the survivor's own claiming age (or survivor FRA if earlier); the model does not search for the best
  switching strategy.
- The spousal reduction uses the age when the spousal benefit starts (the later of the two filings).
- The earnings test counts only pre-FRA months in the FRA year, and withheld months are credited back from the
  first year that starts at or after FRA (SSA does it in the FRA month itself).
- The earnings record used for the PIA follows milestone stop effects; an income that ends on a condition
  milestone uses the year it fires in one deterministic pre-pass.

Healthcare and tax details

- Children under 26 are costed on the family's coverage: the employer family tier while a parent has
  employer coverage, family COBRA while it lasts, otherwise the marketplace (at most three children under 21
  charged). CHIP eligibility is estimated at the household level. The expansion-state income assumption can move automatic coverage to Medicaid. Explicit Marketplace enrollment keeps its premiums and estimated out-of-pocket costs, including when income implies Medicaid eligibility.
- IRMAA in the first two plan years uses MAGI entered for the years before the start, or else the first
  year's own MAGI estimate.
- Estate tax applies portability for married couples: the survivor adds the first spouse's unused exemption,
  fixed in the year of the first death, assuming everything passed to the spouse and the election was made.
- Pension amounts are the first-year benefit; the COLA compounds from the start year (nominal COLA: the amount
  is that year's nominal figure; real COLA: today's dollars carried forward by inflation).

App

- Trusted Types are not enforced in the Content Security Policy, because the charting library writes
  HTML for tooltips. The rest of the policy is strict (no inline scripts, no third-party origins).
- Storybook is not set up. Components are exercised through the app and the browser tests.
- The plan file's JSON Schema is generated from the Zod schema, the reverse of the plan's wording.
  `packages/engine/schema/plan.v2.json` is the current published artefact. The v1 artefact remains for recovery and compatibility fixtures.

## Open decisions

- **O1** (your two states): never answered, so all 50 states and DC were built at reduced depth.
- **O2** (repository visibility and licence): undecided. `research/` is git-ignored either way.
- **O3** (sync sign-in): the Worker expects Cloudflare Access, the plan's default. Not configured.
- **O4** (custom domain): undecided.
- **O5** (reference board): used for `design/reference-map.md`. That file proposes eight new feature IDs
  which need your approval before they join the matrix.

## Reproducing

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm validate:data
pnpm bench
pnpm build
pnpm --filter @fisim/e2e exec playwright install chromium
pnpm e2e
pnpm lighthouse
```

The Tax-Calculator fixtures are regenerated with `tests/validation/taxcalc/generate_fixtures.py` (see its
README); the committed fixtures are enough to run V-04.

### Opening balances and year-to-date payroll

Schema 3 treats earlier plans as January 1 valuations. Changing the opening month changes the valuation date within the first tax year. Enter actual balances from the first of the selected month. Each whole month is one twelfth of the year. Growth, annual fees and inflation compound for the remaining fraction. Regular living expenses and scheduled wages use the remaining months. Full annual tax brackets apply to prior and remaining wages, with payroll deferrals deducted once. Taxes already paid reduce the outstanding cash requirement. Annual liability in the tax view includes the opening payroll ledger.

Midyear openings currently cover investment balances, wage income, employee deferrals and annual living expenses. They assume prior taxable income consists entirely of wages. Healthcare, benefits, real property, debt, retirement distributions and other schedules require January valuations until the corresponding year-to-date records can be represented. Imports with unsupported combinations are available for recovery. Re-entering a different balance date requires supplying balances and payroll from that date.
