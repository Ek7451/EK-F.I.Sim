# Personal Finance Scenario Modeler — Build Plan

Goal: build a personal financial planning and scenario modeling app that matches the full feature set of ProjectionLab. It should feel just as modern and polished, use an original visual design, rest on recognized modeling methods and trustworthy data, and add early-retiree healthcare cost modeling.

## 1. Guiding Principles

- **Feature parity:** cover everything ProjectionLab offers across planning, simulation, tax strategy and reporting, including Premium features.
- **Grounded in standards:** use established simulation methods (historical bootstrapped Monte Carlo, rolling-period backtesting) and check them against published research results.
- **Trusted data only:** every assumption comes from a named, citable public source and carries a version and date.
- **Data separate from code:** tax rules, contribution limits, healthcare premiums and market history live in versioned data files. Yearly updates are data changes, not code changes.
- **Delightful UI:** a design system, fluid animated charts and instant recalculation are core requirements, not polish saved for the end.
- **Privacy first:** you enter balances by hand, data is stored locally by default, and there are no ads or account linking.

## 2. Feature Scope (ProjectionLab Parity)

### Core planning

- Plans built from a current-finances snapshot: accounts (taxable, traditional 401k/IRA, Roth, HSA, 529, cash), real estate, vehicles and other assets, debts and loans.
- Income streams with growth rates, start/end milestones, and tax treatment (wages, self-employment, rental, pension, Social Security, annuities).
- Expenses with inflation, phases (e.g. go-go/slow-go/no-go), one-time events and flexible spending rules.
- Life-event milestones: retirement, home purchase, children, college, relocation, career change, sabbatical, windfalls. Milestones can trigger other plan changes.
- Cash-flow priorities: an ordered waterfall for surplus (emergency fund, employer match, HSA, Roth, debt payoff, taxable investing) and for withdrawals.
- Couples planning: two people, separate incomes and accounts, filing status changes.

### Simulation

- A deterministic yearly (optionally monthly) projection engine.
- Monte Carlo simulation with a chance-of-success result and percentile bands (10th/25th/50th/75th/90th).
- Historical backtesting across every available start year (Shiller data from 1871 on), with success-rate and worst-case sequence reporting.
- Configurable return assumptions: fixed, historical, or user-defined mean/volatility with correlations between asset classes.
- Asset allocation glide paths and rebalancing.

### Tax and strategy (Premium-equivalent)

- Federal and state income tax estimates by year, including FICA, NIIT, capital gains brackets, Social Security benefit taxation, and IRMAA.
- Roth conversion modeling, including conversion ladders and bracket-filling.
- Capital gains harvesting (0% bracket) and loss harvesting.
- Withdrawal-order strategies (taxable first, proportional, bracket-targeted, custom) and RMDs.
- Flexible spending and guardrail strategies (e.g. Guyton-Klinger style, percent-of-portfolio, floor and ceiling).
- ACA subsidy planning: MAGI management against premium tax credit thresholds.
- Estate planning: projected estate value, heirs, and step-up in basis.
- Tax analytics: effective/marginal rates over time and lifetime tax paid by strategy.

### Analysis and reporting

- Compare mode: side-by-side scenarios with diffed charts and key metrics.
- Multiple plans per user, plus plan duplication and variants.
- Progress tracking: log actual balances over time and compare them with the original projection.
- Downloadable PDF reports and CSV export.

### New: early-retiree healthcare module

See Section 5.

## 3. Modeling and Simulation Standards

- **Monte Carlo:** block-bootstrap resampling from historical annual real returns, which keeps sequence and serial correlation. A parametric mode (lognormal with correlation matrix) is available as an alternative. Default 1,000 to 10,000 runs, with a seeded random generator for reproducibility.
- **Historical backtesting:** rolling start-year cohorts using the Trinity Study / Bengen methodology.
- **Validation suite:** automated tests that reproduce published results (Bengen 4% rule findings, Trinity Study success tables, cFIREsim/FIRECalc outputs for identical inputs) within tolerance.
- **Inflation:** CPI-U history for backtests; user-set or historical-sampled inflation for forward runs.
- **Longevity:** an optional stochastic lifespan using the SSA period life tables or Society of Actuaries mortality tables.
- **Methodology transparency:** an in-app "How this is calculated" panel that lists sources and formulas for each result.

## 4. Data Sources and Annual Update Process

### Market and economic data

- Robert Shiller's U.S. stock market dataset (S&P composite prices, dividends, earnings, CPI, long rates from 1871 on).
- Federal Reserve FRED series: Treasury yields, T-bill rates, CPI-U, and I-bond/TIPS reference data.
- Aswath Damodaran's (NYU) annual historical returns on stocks, bonds and bills as a cross-check.

### Tax data

- IRS annual inflation-adjustment Revenue Procedure (published each fall): brackets, standard deduction, capital gains thresholds, AMT and more.
- IRS retirement plan limits notice: 401k/IRA/HSA contribution and catch-up limits.
- SSA: wage base, COLA, bend points, and benefit formula (Primary Insurance Amount calculation).
- CMS: Medicare Part B/D premiums and IRMAA brackets.
- State tax tables from each state's revenue department, starting with the states you need and expanding over time.
- Reference oracle: the Policy Simulation Library's open-source Tax-Calculator, used in automated tests to validate federal results.

### Annual update process

- Each tax year is one versioned data file (e.g. `tax/us-federal/2027.json`) with a schema validator.
- A yearly checklist runs in Oct–Nov when the IRS, SSA and CMS release new figures: update files, run the validation suite, and publish.
- Future years are projected by indexing the latest known parameters to inflation, and the app clearly flags projected values versus enacted ones.
- Law-change hooks: scheduled provisions (e.g. sunsets) are encoded with effective dates.
- Every data file has a source URL and retrieval date shown in the app.

## 5. Early-Retiree Healthcare Cost Module

This module models the gap between leaving employer coverage and Medicare at 65, then Medicare costs afterward.

### Pre-Medicare (ACA) phase

- Premiums are based on CMS marketplace data: benchmark second-lowest-cost silver plan (SLCSP) by county and age, using the federal ACA age-rating curve (a 64-year-old can be charged up to 3x a 21-year-old).
- Premium tax credit calculation tied to the plan's projected MAGI each year, with the current-law applicable percentage table versioned like tax data. This links directly to the Roth conversion and withdrawal strategy engine, because income choices change subsidies.
- COBRA bridge option (employer premium plus 2%, for up to 18 months).
- Out-of-pocket costs: deductible, coinsurance and the annual out-of-pocket maximum, with low/typical/high utilization settings.
- HSA modeling: contributions while eligible, tax-free qualified withdrawals.
- Inspiration and cross-check: the BiggerPockets Money ACA Cost Estimator to Age 65 (Oct 2026), which projects unsubsidized premiums to 65 from 2026 CMS data and sizes a FIRE healthcare buffer. Match its methodology for the unsubsidized case and extend it with subsidies and out-of-pocket costs.

### Medicare phase (65+)

- Part B and Part D premiums with IRMAA surcharges based on MAGI from two years earlier.
- Medigap or Medicare Advantage selection, plus dental/vision/hearing.
- Benchmark checks against Fidelity's annual Retiree Health Care Cost Estimate and Vanguard's health care cost methodology.

### Healthcare inflation

- Medical cost growth assumptions sourced from the CMS National Health Expenditure projections and KFF Employer Health Benefits Survey premium trends, kept separate from general CPI.
- Monte Carlo can optionally vary healthcare inflation.

### Research sources to track

- CMS marketplace public use files (rate and plan data, yearly).
- KFF health insurance marketplace calculator and subsidy research.
- CMS National Health Expenditure projections.
- Fidelity and Vanguard retiree cost studies.
- BiggerPockets Money healthcare cost projection article and estimator.

## 6. UI/UX and Visual Design

- **Design system:** original brand, tokens for color/type/spacing, light and dark themes, and an accessible component library (WCAG 2.2 AA).
- **Charts:** fluid, animated, interactive charts with smooth transitions when inputs change. These include a stacked net-worth area chart, Monte Carlo fan chart, cash-flow Sankey, tax breakdown bars and a milestone timeline. Candidate libraries: Apache ECharts or D3 with a custom layer.
- **Instant feedback:** the simulation runs in Web Workers so sliders and inputs update charts in real time without blocking the UI.
- **Interaction design:** a drag-and-drop milestone timeline, inline editing, hover tooltips that explain every number, and undo/redo.
- **Onboarding:** a guided first-plan wizard to soften the learning curve.
- **Motion:** purposeful micro-animations with reduced-motion support.
- Match ProjectionLab's information architecture and ease of use, but keep the visual identity original.

## 7. Technical Architecture

- **Frontend:** TypeScript with a modern component framework (React or Svelte — decision pending), a state store, and Web Workers for simulation.
- **Simulation core:** a pure, framework-free TypeScript engine with layered modules (data loaders, tax engine, healthcare engine, cash-flow engine, Monte Carlo runner, results assembler) and DTOs between layers. It should be fully unit-testable.
- **Data layer:** versioned JSON datasets with schemas, loaded by tax year and region.
- **Persistence:** local-first (IndexedDB) on every device, with end-to-end encrypted cloud sync across devices (see Hosting and sync below).
- **Reporting:** client-side PDF generation and CSV export.
- **Testing:** unit tests per module, the validation suite against published research and Tax-Calculator, and visual regression tests for charts.

### Hosting and sync (personal, non-commercial, free tiers)

- **Use:** personal only, so free hobby tiers fit, including Vercel's non-commercial Hobby plan.
- **Web hosting:** Cloudflare Pages as the default (free, global CDN, custom domain). Alternatives: Vercel Hobby, Netlify free, GitHub Pages.
- **Cloud storage and sync:** Supabase free tier as the default (Postgres, built-in auth, row-level security). Alternatives: Firebase Spark, or Cloudflare D1/KV with Workers. Note that Supabase free projects pause after inactivity, so add a light keep-alive or accept a wake-up delay.
- **End-to-end encryption:** plans are encrypted in the browser with the Web Crypto API (AES-GCM, key derived from a passphrase via PBKDF2 or Argon2) before upload. The server stores only ciphertext plus timestamps.
- **Sync model:** each plan is an encrypted document with a version number; last-write-wins per plan with a conflict prompt, and offline edits queue until reconnect.
- **Backups:** encrypted JSON export/import so data never depends on one provider.
- Free-tier limits change; recheck them at deploy time.

### Mobile (built alongside web)

- **One codebase:** a mobile-first responsive design from Phase 1, so every screen is designed for phone and desktop together.
- **Installable PWA:** offline support via service worker and add-to-home-screen on iOS and Android, at no cost.
- **Optional native shell:** wrap the same app with Capacitor for App Store/Play builds if native features are wanted later. iOS sideloading for personal use needs an Apple Developer account, or free provisioning that must be re-signed every 7 days.
- **Mobile UX:** touch-friendly charts (pinch-zoom, tap tooltips), bottom navigation, simplified editors, and the simulation still running in Web Workers for responsiveness.
- **Testing:** device-size visual regression tests and performance budgets for mid-range phones.

## 8. Phased Roadmap

1. **Foundations:** data model, mobile-first design system, PWA shell, hosting setup, and basic plan editor (accounts, income, expenses).
2. **Deterministic engine:** yearly projection, cash-flow priorities, milestones, net-worth and cash-flow charts.
3. **Simulation:** historical data ingest, Monte Carlo, backtesting, fan charts, and the validation suite.
4. **Tax engine:** federal and state tax, Social Security, RMDs, withdrawal strategies, Roth conversions, gains harvesting, and the annual data pipeline.
5. **Healthcare module:** ACA premiums and subsidies, COBRA, HSA, Medicare/IRMAA, and healthcare inflation.
6. **Advanced strategy:** flexible spending/guardrails, estate planning, tax analytics.
7. **Analysis:** compare mode, multiple plans, progress tracking, reports and export, plus encrypted cloud sync across devices.
8. **Polish:** motion, onboarding, accessibility, performance tuning.

## 9. Open Decisions

- Frontend framework: React vs Svelte vs modular vanilla JS.
- Which states to support first for state tax.
- Mobile delivery: installable PWA only, or also a Capacitor native shell.
- Monthly vs yearly simulation granularity as the default.
