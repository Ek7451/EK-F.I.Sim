# Validation report

Status of the validation suite (plan §9), the release gate (plan §16) and the known limitations of this
build. Data release `data-2026.1`. Reproduce everything here with the commands in the last section.

Every figure the app shows is an estimate. This report says how far those estimates have been checked
against outside references, and where they have not.

## Summary

| Area                                   | Result                                                                                  |
| -------------------------------------- | --------------------------------------------------------------------------------------- |
| Unit, property and validation tests    | 318 pass, 2 marked todo (`pnpm test`)                                                   |
| Browser tests (phone, tablet, desktop) | 96 pass, 4 skipped by design (`pnpm e2e`)                                               |
| Guided tours                           | All 25 complete with the keyboard alone on phone and desktop sizes; every target exists |
| Accessibility (automated)              | axe WCAG 2.2 A/AA: no violations on any of 21 screens, light and dark, three sizes      |
| Dataset checks                         | 177 datasets valid, 55 of them projected or estimated (`pnpm validate:data`)            |
| Lighthouse (simulated mid-range phone) | Performance 99, accessibility 100, best practices 100; LCP 2.26 s, CLS 0, TBT 0 ms      |
| Initial JavaScript                     | 204 KB gzipped (budget 250 KB)                                                          |
| Engine speed (this desktop)            | Projection 1.6 ms (budget 50); 1,000 simulated runs 0.55 s on one thread (budget 8 s)   |

The v1.0 gate is **not met**. The open items are listed under "Release gate" below.

## Validation cases

| Case | Reference                                                              | Result                | Detail                                                                                                                                                                                                                                                                                                                                                 |
| ---- | ---------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| V-01 | Bengen (1994), 50/50 portfolio, worst start years                      | **Outside tolerance** | Direction and worst cohort match (mid-1960s; a 3% withdrawal lasts 50 years from every start). At 4% the 1966 cohort lasts 29 years here against Bengen's 33. The bundled bond series is the 10-year Treasury (Shiller); Bengen used intermediate-term Treasuries (Ibbotson), which lost less in the 1970s. The test asserts a gap of at most 4 years. |
| V-02 | Trinity study (1998), Table 3                                          | **Outside tolerance** | Mean gap 4.1 points across the table; worst cell 17 points. The plan asks for ±2. Same cause: the study used Ibbotson long-term corporate bonds, which are not freely redistributable and are not bundled. Stock-heavy rows track closely; bond-heavy rows drift most.                                                                                 |
| V-03 | FIRECalc and cFIREsim default run ($1M, $40k, 30 years, 75/25)         | **Partly within**     | Success 96.83% against cFIREsim 96.06% (within 1 point) and FIRECalc 95.2% (1.6 points; the two tools differ from each other by 0.9). Median ending balance $1,819,739 against cFIREsim $1,719,109: 5.9% apart, where the plan asks for 2%. Likely cause, not confirmed: a different convention for reinvesting dividends within the year.             |
| V-04 | PSL Tax-Calculator, 294 households, tax year 2026                      | **Pass**              | Federal income tax and payroll tax agree within $1 for every household, all filing statuses. For married-filing-separately Social Security the test follows the oracle's convention, noted in the test. Tax year 2027 has no valid oracle yet: Tax-Calculator's own 2027 parameters are projections, not the enacted figures bundled here.             |
| V-05 | SSA worked examples (PIA, 2027 eligibility)                            | **Pass**              | Exact match. Spousal benefits and the earnings test have no published worked example in the suite.                                                                                                                                                                                                                                                     |
| V-06 | Premium tax credit                                                     | **Partly covered**    | The credit arithmetic passes (prior-year poverty guideline, applicable-percentage interpolation, the 400% cliff in force for 2026 and 2027). Benchmark-premium lookups against HealthCare.gov for sample ZIP codes are **not automated** (todo): they need live lookups.                                                                               |
| V-07 | Retiree healthcare cost estimators (Fidelity, Vanguard, BiggerPockets) | **Not done**          | Marked todo. None of the references has a machine-readable interface, so no automated comparison exists. A manual comparison has not been made.                                                                                                                                                                                                        |
| V-08 | RMDs against the IRS Uniform Lifetime Table                            | **Pass**              | Every age; start age 73 or 75 by birth year.                                                                                                                                                                                                                                                                                                           |
| V-09 | Simulation statistics                                                  | **Pass**              | Resampled returns match the source mean and variance within sampling error; seeded runs reproduce exactly; chunked runs merge to the same answer as one pass.                                                                                                                                                                                          |

## Release gate (plan §16)

| Gate item                                                 | State                                                                                                                |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Every parity-matrix row done                              | **Not met.** 54 done, 10 implemented without a dedicated test, 12 partial. See [parity-matrix.md](parity-matrix.md). |
| Validation cases V-01 to V-09 within tolerance            | **Not met.** V-01, V-02 and part of V-03 are outside tolerance; V-06 lookups and V-07 are not done.                  |
| All 25 tours pass e2e on phone and desktop, keyboard only | Met.                                                                                                                 |
| Accessibility                                             | Automated checks met. A manual screen-reader audit has **not** been done.                                            |
| Performance budgets on both reference devices             | Lighthouse budgets met under simulated throttling. The physical reference phones were **not** measured.              |
| Security review                                           | Runbook written (`runbooks/security-review.md`); the review itself has **not** been carried out.                     |
| Sync deployed and restore drill run                       | **Not done.** Nothing has been deployed. The sync Worker and client have only been tested separately.                |
| Usability check with a new user (T-B01 to T-B05)          | **Not done.**                                                                                                        |
| CI green                                                  | The workflows in `.github/workflows/` have never run: nothing has been committed or pushed.                          |

## Known limitations of the model

Tax

- State income tax is a simplified model for all 50 states and DC: brackets, standard deduction or
  exemption, and the main retirement-income exclusions. It has no external oracle. Known inaccuracies
  include Ohio's base amounts, South Carolina, Connecticut, Utah and Oregon credits and phase-outs,
  Maryland county tax, New York's bracket recapture and Arkansas's table structure. Treat state tax as a
  rough estimate.
- Contribution limits for 2027 and Medicare premiums for 2027 are projected, not enacted.
- Rebalancing happens at the start of the year. The advance premium tax credit is treated as exact, so
  repaying excess credit at tax time is not modelled.
- The IRMAA life-changing-event appeal is stored in the plan but not applied.

Healthcare

- Benchmark premiums are county-level for HealthCare.gov states. States that run their own exchange use
  a statewide average; the Healthcare screen says so and accepts your own figure.
- Medicare starts in the half-year nearest the 65th birthday month.
- Long-term-care costs are national medians, not regional.

Simulation

- History-based simulation replays real past returns, which were higher than most forward-looking
  assumptions. It can look more generous than the single-path projection. The Chance of success screen
  says this; choose the parametric method to test your own return assumptions.
- Optional SOA mortality tables are not included; longevity uses SSA period tables.

App

- Trusted Types are not enforced in the Content Security Policy, because the charting library writes
  HTML for tooltips. The rest of the policy is strict (no inline scripts, no third-party origins).
- Storybook is not set up. Components are exercised through the app and the browser tests.
- The plan file's JSON Schema is generated from the Zod schema, the reverse of the plan's wording.
  `packages/engine/schema/plan.v1.json` is the published artefact either way.

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
pnpm dlx @lhci/cli@0.16.0 autorun --config=lighthouserc.json
```

The Tax-Calculator fixtures are regenerated with `tests/validation/taxcalc/generate_fixtures.py` (see its
README); the committed fixtures are enough to run V-04.
