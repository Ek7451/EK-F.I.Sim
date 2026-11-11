# EK-F.I.Sim — Personal Finance Scenario Modeler: Build Plan v2

| | |
|---|---|
| **Version** | 2.1 |
| **Date** | 2026-11-10 |
| **Supersedes** | [v1](archive/build-plan-v1.md) |
| **Review of v1** | [REVIEW.md](REVIEW.md) |
| **Status** | Approved for build. Open items are listed in §3.2. |

**Changelog**
- **2.1:** Added the ProjectionLab UI reference board as a design input (§10.1) and a guided-tour system with basic and advanced tour series (UX-10 to UX-12, §10.2).
- **2.0:** First rewrite of v1 after review.

---

## 1. Goals, Non-Goals and Disclaimers

### 1.1 Goals
- A personal planning and scenario-modeling app with **feature parity with ProjectionLab, including its Premium features** (§4), plus an **early-retiree healthcare module** (§9).
- Modern, polished and fast. Charts recalculate instantly and look like an original product.
- Grounded in recognized methods and **named, citable, versioned public data**.
- Local-first and private, with optional end-to-end-encrypted sync across devices.
- Equally good on phone and desktop, delivered as an installable PWA.

### 1.2 Non-goals (v1.0)
- Commercial use, multiple tenants, or advisor and client features.
- Account aggregation or bank linking (Plaid and similar). Balances are entered by hand.
- Tax *filing* or advice. The tax engine produces estimates for planning.
- Non-US tax systems.
- Native app-store builds. Capacitor comes after v1 (§3.1).

### 1.3 Disclaimers (shown in app and in reports)
- "For personal educational planning only. Not financial, tax, legal or medical advice."
- Every result is labelled **estimated**. Projected (indexed) parameters are visibly marked as different from enacted ones.
- **Original visual identity and information architecture.** Nothing is copied from ProjectionLab or any other product: no screens, copy, icons, names or assets. Parity means equal *capability*, not a matching look. The ProjectionLab UI reference board (§10.1) is used only to study capability and workflow.

## 2. Guiding Principles
1. **Feature parity:** every capability in §4 is built, tested and checked off in the parity matrix before v1.0.
2. **Grounded in standards:** established simulation methods, validated against published results with numeric tolerances (§7.4).
3. **Trusted data only:** every assumption traces to a named source with a version, a retrieval date and a checksum (§8).
4. **Data separate from code:** tax rules, limits, premiums and market history live in versioned data files. Yearly updates change data, not code.
5. **Engine correctness first:** a pure, deterministic and fully tested engine. Every number can be explained in the UI.
6. **Delightful UI:** a design system, fluid charts and instant recalculation are core requirements.
7. **Privacy first:** balances are entered by hand, data stays local by default, sync is E2E-encrypted, and there are no ads, no analytics and no third-party scripts.
8. **Deployable from day one:** CI/CD and preview deploys start in Phase 1, and every merge to `main` ships somewhere.

## 3. Decisions Log

### 3.1 Settled
| # | Decision | Choice | Notes |
|---|---|---|---|
| D1 | Frontend framework | **React 18 + Vite + TypeScript (strict)** | Brings the biggest chart, form, a11y and testing ecosystem. |
| D2 | State store | **Zustand** with an immer-style patch log | The patch log also drives undo/redo (UX-04). |
| D3 | Charts | **Apache ECharts** (via a thin React wrapper) with a custom theme layer | Sankey, fan and stacked-area charts are built in. D3 is used only for special cases. |
| D4 | Hosting | **Cloudflare Pages** | Free tier, global CDN, PR preview deploys, instant rollback. |
| D5 | Sync backend | **Cloudflare Workers + D1** (metadata and versions) **+ R2** (ciphertext blobs) | Same provider as hosting, and the free tier doesn't pause from inactivity. Replaces Supabase. |
| D6 | Mobile delivery | **Installable PWA** for v1.0. Capacitor shell comes after v1. | |
| D7 | Simulation granularity | **Yearly time step** by default | The engine is built on a `TimeStep` abstraction so monthly can be added later without a rewrite. |
| D8 | Release strategy | **Full parity before v1.0.** Private preview deploys run from Phase 1. | The 8-phase order from v1 stays the same. The v1.0 gate is §16. |
| D9 | State income tax | **The user's current state and retirement state first**, then more | The states still need to be named (§3.2). |
| D10 | Monorepo tooling | **pnpm workspaces** | Turborepo is optional, for caching. |
| D11 | Testing | **Vitest** (unit), **fast-check** (property), **Playwright** (e2e and visual), **axe-core** (a11y) | |
| D12 | Guided tours | **An in-house tour engine** built on the design system's popover primitive (Floating UI), with tours defined as data | We control accessibility, theming and mobile behavior, with no third-party licensing questions (§10.2). |
| D13 | Design reference | **The ProjectionLab UI breakdown and image board** (made by a separate research task) is a required design input | Used for capability and workflow reference only (§10.1). |

### 3.2 Open (must be closed before the phase noted)
| # | Item | Needed by |
|---|---|---|
| O1 | Name the **current state** and **retirement state** for TAX-05 | Start of Phase 4 |
| O2 | Repo visibility (private or public) and license. If the repo is public, `research/` (third-party screenshots and help content) must be in `.gitignore` | Phase 1 |
| O5 | Link the finished UI breakdown and image board from the research task into §10.1 | Phase 1 |
| O3 | Sync auth: **Cloudflare Access** (email OTP or GitHub IdP) or **WebAuthn passkeys** in the Worker. Access is the default. | Phase 7 |
| O4 | Custom domain (optional) | Phase 7 |

## 4. Feature Scope and Parity Matrix

Each feature has an ID. Phases, issues, tests and the release gate all use these IDs. Status lives in GitHub Issues/Projects, with one label per ID. This table is the parity matrix.

### 4.1 Core planning (PLAN)
| ID | Feature |
|---|---|
| PLAN-01 | One or two **people**: date of birth, planning horizon, life-expectancy setting, state residence over time, and a filing-status timeline. |
| PLAN-02 | **Accounts:** taxable brokerage (tracks cost basis), cash/HYSA, traditional 401(k)/403(b)/457(b)/IRA, SEP/SIMPLE/solo 401(k), Roth 401(k)/IRA, HSA, 529, inherited IRA, I-bonds and T-bills, and annuities. |
| PLAN-03 | **Real estate:** primary residence and rentals, appreciation, mortgage amortization, refinancing, property tax, insurance, maintenance, and a sale with the §121 exclusion. Rent-vs-buy comparison via scenarios. |
| PLAN-04 | **Other assets** (vehicles with depreciation, other) and **debts** (amortizing loans, student loans, revolving debt). |
| PLAN-05 | **Income streams:** wages and bonus, self-employment, rental, pension (COLA and survivor %), annuity, Social Security, and other. Each has a growth rate, start and end milestones, and a tax character. |
| PLAN-06 | **Social Security:** enter the earnings record (from the SSA statement), PIA calculation, claiming age 62–70, spousal and survivor benefits, earnings test, COLA, and an optional trust-fund-shortfall benefit-cut scenario. |
| PLAN-07 | **Expenses:** categories with their own inflation rates, spending phases (go-go, slow-go, no-go), one-time and recurring-interval items, and linkage to healthcare costs (§9). |
| PLAN-08 | **Milestones and triggers:** based on date, age or a condition (e.g. "net worth ≥ X", "FI reached"). Milestones can start, stop or change other plan items. Covers retirement, a home purchase, children, college, relocation, a career change, a sabbatical, and windfalls. |
| PLAN-09 | **Cash-flow priorities:** an ordered **surplus waterfall** (emergency fund, employer match, HSA, Roth, debt payoff, taxable) and a **withdrawal order**, with all contribution limits enforced. |
| PLAN-10 | **Couples:** separate incomes and accounts, filing-status changes (marriage, divorce, death of a spouse leading to qualifying-surviving-spouse status and then single), and survivor scenarios. |
| PLAN-11 | **Fees:** fund expense ratios and an advisory AUM fee for each account. |
| PLAN-12 | **Early-access rules:** the 10% early-withdrawal penalty and its exceptions, Rule of 55, 457(b) without a penalty, 72(t)/SEPP schedules, the Roth contribution-basis and conversion 5-year rules, ladder seasoning, and HSA withdrawals after 65. |
| PLAN-13 | **Contribution strategies:** employer match formulas, catch-up and age 60–63 super catch-up, mandatory Roth catch-up for high earners, backdoor Roth (with the pro-rata rule), and mega-backdoor Roth. |
| PLAN-14 | **Education:** 529 qualified withdrawals and the 529-to-Roth rollover (lifetime cap, account-age rules). |

### 4.2 Simulation (SIM)
| ID | Feature |
|---|---|
| SIM-01 | Deterministic yearly projection (§6). |
| SIM-02 | Monte Carlo: **block-bootstrap** resampling of historical annual real returns, with chance of success and 10/25/50/75/90 percentile bands. |
| SIM-03 | Monte Carlo: **parametric** mode (lognormal, with a correlation matrix between asset classes). |
| SIM-04 | **Historical backtesting** over every available start year (Shiller, from 1871), with success rate and worst-case sequence reporting. |
| SIM-05 | Return assumptions: fixed, historical, or user-defined mean, volatility and correlation. |
| SIM-06 | Asset-allocation **glide paths** and **rebalancing** (by calendar or by threshold band). |
| SIM-07 | **Inflation:** CPI-U history for backtests. For forward runs, either a user-set rate or a historically sampled one. |
| SIM-08 | **Stochastic longevity** from the SSA period life tables (optional SOA tables), with joint survival for couples. |
| SIM-09 | **Stochastic healthcare inflation**, kept separate from CPI (§9). |
| SIM-10 | **Result metrics:** success rate, percentile bands, the distribution of failure years, ending-wealth distribution, and the worst historical cohort. |

### 4.3 Tax (TAX)
| ID | Feature |
|---|---|
| TAX-01 | Federal ordinary income brackets, the standard or itemized deduction (with the current SALT cap rules), and age-based and senior deductions. |
| TAX-02 | Capital gains and qualified dividend brackets, and NIIT. |
| TAX-03 | FICA, self-employment tax, and the Additional Medicare Tax. |
| TAX-04 | Taxation of Social Security benefits (provisional income). |
| TAX-05 | **State income tax**, starting with the user's two states (O1): brackets, retirement-income exclusions, and residency changes in the middle of a plan. |
| TAX-06 | **RMDs:** Uniform Lifetime Table, starting age 73 or 75 by birth year, inherited-IRA 10-year rule, and no RMDs for Roth 401(k)s. |
| TAX-07 | **Roth conversions:** fixed amount, bracket-filling up to a target, and conversion ladders. Tracks each conversion's 5-year clock. |
| TAX-08 | **Capital gains harvesting** in the 0% bracket and **loss harvesting**, with carryforward and the ordinary-income offset limit. |
| TAX-09 | **Withdrawal-order strategies:** taxable first, proportional, bracket-targeted, and custom. |
| TAX-10 | **IRMAA:** two-year MAGI lookback, applied to Part B and Part D (shared with §9). |
| TAX-11 | Key credits: the child tax credit and the premium tax credit (§9). Others are added only as needed. |
| TAX-12 | AMT estimate. |
| TAX-13 | **Law and data years:** enacted versus projected (inflation-indexed) parameters, plus law-change hooks with effective dates. |
| TAX-14 | Federal estate tax against the exemption, and step-up in basis (used by STRAT-03). |

### 4.4 Strategy (STRAT)
| ID | Feature |
|---|---|
| STRAT-01 | **Flexible spending and guardrails:** Guyton-Klinger-style rules, percent-of-portfolio, and floor and ceiling. |
| STRAT-02 | **ACA MAGI management:** target a MAGI band so subsidy rules are kept in view when picking Roth conversions and withdrawals (§9). |
| STRAT-03 | **Estate planning:** projected estate value, heirs, step-up, and the tax drag heirs face on inherited pre-tax accounts. |
| STRAT-04 | **Tax analytics:** effective and marginal rates over time, and lifetime tax paid by strategy. |

### 4.5 Healthcare (HC): see §9 for HC-01 to HC-12.

### 4.6 Analysis and reporting (RPT)
| ID | Feature |
|---|---|
| RPT-01 | **Compare mode:** scenarios side by side, with diffed charts and key metrics. |
| RPT-02 | Multiple plans, plan duplication, and variants. |
| RPT-03 | **Progress tracking:** log actual balances over time and compare them with the original projection. |
| RPT-04 | Client-side **PDF reports**. |
| RPT-05 | **CSV export** (per-year detail for each scenario). |
| RPT-06 | **"How this is calculated" panel:** sources, formulas and data versions for every result. |

### 4.7 Persistence and sync (SYNC)
| ID | Feature |
|---|---|
| SYNC-01 | Local-first storage in IndexedDB. |
| SYNC-02 | End-to-end-encrypted cloud sync across devices (§11, §12). |
| SYNC-03 | Encrypted JSON **export and import** for backups. |
| SYNC-04 | Offline edit queue, plus a conflict prompt using optimistic versions. |

### 4.8 UI/UX (UX)
| ID | Feature |
|---|---|
| UX-01 | Design system: tokens for color, type, spacing and motion, and light and dark themes. |
| UX-02 | Charts: stacked net-worth area, Monte Carlo fan, cash-flow Sankey, tax breakdown bars, and a milestone timeline. |
| UX-03 | Instant recalculation in Web Workers. |
| UX-04 | Drag-and-drop milestone timeline, inline editing, a tooltip that explains each number, and undo/redo. |
| UX-05 | Guided wizard for the first plan. |
| UX-06 | Purposeful motion that respects `prefers-reduced-motion`. |
| UX-07 | Installable PWA that works offline. |
| UX-08 | Mobile UX: touch charts (pinch-zoom, tap tooltips), bottom navigation, and simplified editors. |
| UX-09 | Accessibility to WCAG 2.2 AA. |
| UX-10 | **Guided tour engine:** step-by-step tours defined as data, with a tour catalog, progress tracking, resume, contextual "Take the tour" prompts, and a sandbox sample plan (§10.2). |
| UX-11 | **Basic tour series:** explains the core features (T-B01 to T-B08). |
| UX-12 | **Advanced tour series:** explains the complex features (T-A01 to T-A17). |

## 5. Domain Model and Plan Schema

### 5.1 Entities (key fields)
| Entity | Key fields |
|---|---|
| `Plan` | `id`, `schemaVersion`, `name`, `createdAt`, `updatedAt`, `settings` (start year, horizon, timing convention, display in real or nominal dollars, data-year policy), `people[]`, `accounts[]`, `assets[]`, `debts[]`, `incomes[]`, `expenses[]`, `milestones[]`, `strategies`, `healthcare`, `assumptions`, `scenarios[]` |
| `Person` | `id`, `name`, `birthDate`, `sex` (optional, used for mortality tables), `longevity` (fixed age or stochastic), `residence[]` (state + from-year), `ssEarnings[]`, `ssClaimAge` |
| `Account` | `id`, `ownerId`, `type` (enum per PLAN-02), `balance`, `costBasis` (taxable), `rothBasis` (contributions plus each conversion lot with its year), `allocation` / `glidePathId`, `fees`, `employerMatch` |
| `Asset` / `Debt` | `id`, `kind`, `value`/`principal`, `rate`, `term`, `payment`, `appreciation`, `linkedMilestones` |
| `IncomeStream` | `id`, `ownerId`, `kind`, `amount`, `growth`, `start`/`end` (as a `MilestoneRef` or a year), `taxCharacter` |
| `Expense` | `id`, `category`, `amount`, `inflationIndex` (cpi, healthcare, education or custom), `phase`, `recurrence`, `start`/`end` |
| `Milestone` | `id`, `kind`, `when` (date, age or condition expression), `effects[]` (patches applied to other entities) |
| `Strategy` | `surplusWaterfall[]`, `withdrawalOrder`, `rothConversion`, `gainHarvest`, `spendingRule`, `magiTarget`, `rebalance` |
| `HealthcarePlan` | each person's coverage timeline, region (state + county FIPS), utilization profile, Medicare choices, LTC settings |
| `Assumptions` | return model, inflation model, healthcare inflation, seed, number of runs |
| `ActualsLog` | `date`, balance for each account (RPT-03) |

All money is stored as **nominal USD in cents (integers)** in the plan file. The engine computes in float64 and rounds only at display and export.

### 5.2 Schema versioning and migrations
- A JSON Schema per `schemaVersion` lives in `packages/engine/schema/plan.vN.json`. Zod types are generated from it.
- Migrations are pure functions `migrate_vN_to_vN+1(plan)`, applied in a chain when a plan loads.
- **Before any migration runs, the app automatically saves a backup snapshot** to IndexedDB.
- If a plan has a newer schema than the app knows, it opens **read-only** with an "update the app" notice.
- Fixtures for every schema version live in `packages/engine/test/fixtures/plans/vN/`. CI migrates every fixture to the latest version and checks that it validates.

## 6. Engine Specification

### 6.1 Module layers (pure TypeScript, no framework dependencies)
`data-loaders` → `tax-engine` → `healthcare-engine` → `cashflow-engine` → `projection` (one path) → `monte-carlo` / `backtest` runners → `results-assembler`. Layers exchange typed DTOs. The engine does no I/O; data is injected.

### 6.2 Annual order of operations (for each year *t* on each path)
1. **Advance the clock:** ages; apply the effects of milestones and triggers that take effect this year (retirement, relocation, filing-status change).
2. **Resolve parameters:** filing status and state of residence; load the tax/health parameter year (enacted, or projected and flagged).
3. **Gross income:** wages, self-employment, pensions, annuities, Social Security, rental; compute **required RMDs**.
4. **Payroll-level contributions:** pre-tax and Roth 401(k), HSA, employer match, within the limits (PLAN-13).
5. **Spending need:** expenses, debt service, and healthcare premiums net of PTC (which depends on MAGI, so it is solved in step 6).
6. **Solve the household cash-flow and tax fixed point** (§6.3): withdrawals (in withdrawal order), planned Roth conversions, gain or loss harvesting and taxable rebalancing sales → federal and state tax, FICA, NIIT, IRMAA tier (for *t+2*) and PTC → repeat until converged.
7. **Surplus:** allocate it through the surplus waterfall.
8. **Market returns** apply under the plan's timing convention (§6.4).
9. **Fees**, then **rebalance** toward the target or glide path (any taxable sales were already included in step 6).
10. **Record the year state.** **Failure** = spending above the floor could not be funded after every allowed source was used.
11. **Inflate** amounts for *t+1* (CPI, healthcare index, custom indexes).

### 6.3 Fixed-point solver
- Unknown: **gross withdrawals W** (by source), given the target net spending.
- Iterate: W → taxable income/MAGI → taxes + PTC → required W′. Converge when |W′ − W| < **$1**.
- Fallback: switch to bisection if the iteration oscillates; stop after at most **25** iterations. If it fails to converge, emit a warning and record it in the result.
- Bracket-filling strategies (Roth conversions, gain harvesting, MAGI targets) are solved *inside* the same loop as constraints.

### 6.4 Conventions
- **Timing** is a plan setting: start, middle or end of year. The default is **mid-year** for income and expenses. Validation cases use whichever convention the reference tool uses (start of year for FIRECalc/cFIREsim).
- **Nominal internally.** Each path has its own inflation series. The "today's dollars" display divides by that path's cumulative CPI.
- **Determinism:** a seeded PRNG (xoshiro128\*\* or PCG32). The same plan, data version and seed always give byte-identical results.

### 6.5 Engine invariants (property-tested with fast-check)
- **Money is conserved:** opening balances + inflows − outflows − taxes − fees + returns = closing balances (within 1¢) every year.
- No negative balances, except debts.
- Contributions never exceed their limits, and RMDs are always met.
- Raising spending never raises the success rate, when everything else is the same.

## 7. Simulation and Validation Standards

### 7.1 Monte Carlo
- **Block bootstrap** of historical annual *real* returns, applied jointly across asset classes (and inflation) to keep cross-correlation. Block length defaults to 5 years and can be changed. Circular wrapping keeps the end-of-series years from being under-sampled.
- **Parametric** mode: correlated lognormal using a Cholesky decomposition of the correlation matrix.
- 1,000 runs by default, up to 10,000. Seeded. Results stream in progressively and can be cancelled.
- **Result storage:** a summary for each run, plus per-year percentile accumulators; full paths are not stored. A few sample paths are kept for display.

### 7.2 Historical backtesting
- Rolling start-year cohorts (the Bengen / Trinity method) over every start year that has a complete horizon. Partial cohorts are reported separately.

### 7.3 Asset-class return series
| Class | Series | Coverage |
|---|---|---|
| US stocks | Shiller S&P Composite total return (price + dividends) | 1871– |
| US bonds | **Constant-maturity 10-year Treasury total return built from Shiller's long rate (GS10)** using par-bond repricing each year; cross-checked against Damodaran's T-bond returns | 1871– (cross-check 1928–) |
| Cash | T-bill rate: FRED TB3MS from 1934; Damodaran T-bill 1928–1933; before 1928, a proxy flagged as "approximated" | 1871– (flagged) |
| Inflation | Shiller CPI (before 1913), BLS CPI-U via FRED (1913–) | 1871– |
| International, REITs, other | No free long series: **parametric only** or user-defined | — |

### 7.4 Validation suite (`tests/validation`, runs in CI)
| ID | Reference | Tolerance |
|---|---|---|
| V-01 | Bengen (1994) worst-case longevity at a 4% initial withdrawal, using matching data series | ±1 year |
| V-02 | Trinity Study (Cooley, Hubbard, Walz 1998) success-rate tables, run on its data (S&P 500 + long-term high-grade corporate bonds, via a Damodaran/Ibbotson-equivalent series) | ±2 pts per cell |
| V-03 | cFIREsim / FIRECalc with identical inputs (Shiller data, start-of-year timing) | success rate ±1 pt; median ending balance ±2% |
| V-04 | PSL **Tax-Calculator** on ≥200 fixture households per tax year | federal income tax and payroll tax within $1 |
| V-05 | SSA PIA (SSA's ANYPIA / benefit formula) on earnings fixtures | within $1 per month |
| V-06 | PTC against the IRS Form 8962 worksheet logic; SLCSP against HealthCare.gov lookups for sample ZIPs and ages | exact for PTC; SLCSP within $1 |
| V-07 | BiggerPockets Money ACA Cost Estimator, unsubsidized case | ±1% |
| V-08 | Medicare IRMAA tier assignment, and RMDs against the IRS Uniform Lifetime Table | exact |
| V-09 | Bootstrap statistics: the resampled mean and variance match the source within sampling error; seeded runs reproduce exactly | statistical test p > 0.01; byte-identical |

The CI job for Tax-Calculator runs Python with a pinned `taxcalc` version. It is a test-time oracle only and is never shipped.

## 8. Data Sources, Licensing and Annual Update Runbook

### 8.1 Dataset format
- `packages/data/<domain>/<region>/<year>.json`, e.g. `tax/us-federal/2027.json`, `health/aca/slcsp/2027.json`.
- Every file has a header block: `source` (URL), `publisher`, `retrieved` (ISO date), `status` (`enacted` | `projected`), `lawRefs[]`, `sha256` of the raw input, and `schema`. CI validates every file against its JSON Schema.
- The app shows source, date and status in RPT-06 and in tooltips.
- **Ingest scripts** (`tools/ingest/*`) pull raw data at **build or authoring time**, never from the client. API keys (e.g. FRED) live only in local `.env` or CI secrets.
- Large datasets (CMS county rate tables) are pre-reduced to the fields the app needs, split by state, and **lazy-loaded** with content-hashed URLs.

### 8.2 Sources and terms
| Domain | Source | Terms / use |
|---|---|---|
| Market history | Robert Shiller US stock market data (Yale) | Freely published; cite it and keep the processed series |
| Rates and CPI | FRED (Treasury yields, T-bills, CPI-U) | Use only public-domain government series (some FRED series are third-party licensed; avoid those) |
| Cross-check | Aswath Damodaran (NYU) historical returns | Freely published; cite |
| Federal tax | IRS inflation-adjustment Revenue Procedure; retirement-plan limits notice; enacted statutes | US government work |
| Social Security | SSA: wage base, COLA, bend points, PIA formula, period life tables | US government work |
| Medicare | CMS: Part B/D premiums, IRMAA brackets, Part D parameters | US government work |
| ACA | CMS Exchange public use files (HealthCare.gov states); state exchange publications for state-based exchanges; HHS poverty guidelines; IRS applicable-percentage Rev. Proc. | US / state government |
| Health inflation | CMS National Health Expenditure projections; KFF Employer Health Benefits Survey | CMS: government; KFF: cite as a reference, do not redistribute raw data |
| LTC costs | CareScout (Genworth) Cost of Care Survey | Defaults and benchmarks only; check terms |
| Benchmarks | Fidelity Retiree Health Care Cost Estimate; Vanguard health-cost methodology; BiggerPockets Money ACA estimator | Benchmarks only; not redistributed |
| State tax | Each state's revenue department (O1 states first) | Government |
| Oracle | PSL Tax-Calculator | Open source; test-time dependency only (check the license before vendoring anything) |
| Mortality | SSA period life tables (default); SOA tables (optional) | SSA: government; SOA: check the license |

### 8.3 Annual update runbook (`docs/runbooks/annual-data-update.md`)
| When | Release | Files |
|---|---|---|
| Jan | HHS poverty guidelines | `health/fpl/<year>.json` |
| Jul–Aug | IRS ACA applicable-percentage Rev. Proc. | `health/aca/applicable-pct/<year+1>.json` |
| Oct | SSA COLA, wage base, bend points | `ss/<year+1>.json` |
| Oct–Nov | IRS inflation-adjustment Rev. Proc. | `tax/us-federal/<year+1>.json` |
| Oct–Nov | CMS marketplace PUFs and rate data for the next plan year | `health/aca/slcsp/<year+1>/*.json` |
| Nov | IRS retirement-plan limits notice; CMS Medicare premiums and IRMAA | `limits/<year+1>.json`, `health/medicare/<year+1>.json` |
| Dec–Jan | State tax tables | `tax/us-<st>/<year+1>.json` |
| Each Jan | Shiller, FRED and Damodaran refresh | `market/*.json` |
| Ongoing | **Watch for legislation**: new federal or state law changes the `lawRefs` and effective-date hooks | as needed |

Steps each time: run ingest → diff against the prior year → update `status` → run the full validation suite → bump the data release (`data-YYYY.N`) → deploy.

Future years are projected by indexing the latest enacted parameters (by chained CPI where the law says so) and are flagged `projected`. Scheduled provisions are encoded with effective dates. Appendix A lists the baseline law to re-check.

## 9. Early-Retiree Healthcare Module

This module models the gap from leaving employer coverage to Medicare at 65, then Medicare itself. It is tightly coupled to the tax engine, because **MAGI drives subsidies and IRMAA**.

| ID | Feature |
|---|---|
| HC-01 | **Coverage timeline** for each person: employer, then COBRA, then ACA or Medicaid, then Medicare. Includes the option of a spouse's employer plan. |
| HC-02 | **ACA benchmark premiums:** the second-lowest-cost silver plan (SLCSP) by county and age. HealthCare.gov states use the CMS public use files. **State-based-exchange states** use state exchange data where it is published; otherwise the user enters the SLCSP (from the state site or the KFF calculator), and it is flagged. |
| HC-03 | **Age rating:** the federal 3:1 default curve, **state-specific age curves**, community-rated states, and optional tobacco rating. |
| HC-04 | **Premium tax credit:** a versioned applicable-percentage table; FPL from the *prior year's* HHS guidelines (AK and HI tables); household size; the **400% FPL cliff whenever current law has one**; and repayment of excess advance credit under current law. |
| HC-05 | **Medicaid/CHIP:** expansion versus non-expansion state, the 138% FPL threshold, and the coverage gap. An optional MAGI floor keeps the plan out of Medicaid if the user wants. |
| HC-06 | **COBRA bridge:** 102% of the full premium, for 18 months (with the 29- and 36-month extensions where they apply). |
| HC-07 | **Out-of-pocket costs:** deductible, coinsurance and OOP maximum by metal tier; cost-sharing reductions on silver plans at ≤250% FPL; low, typical or high utilization profiles. |
| HC-08 | **HSA:** eligibility (an HDHP, including the bronze and catastrophic marketplace plans that become eligible under current law), contributions plus the 55+ catch-up, stopping contributions at Medicare enrollment (with the 6-month Part A look-back), qualified tax-free withdrawals, and non-qualified withdrawals after 65 taxed but not penalized. |
| HC-09 | **Medicare:** Part A (premium-free with 40 quarters, otherwise a premium), Part B and Part D with **IRMAA on MAGI from two years earlier** (plus a life-changing-event appeal option), Medigap (e.g. Plans G and N) versus Medicare Advantage, the Part D out-of-pocket cap, and dental, vision and hearing. |
| HC-10 | **Long-term care (optional):** cost events (home care, assisted living, nursing home) with probability and duration assumptions, costs by region from CareScout, and optional LTC insurance. |
| HC-11 | **Healthcare inflation** separate from CPI: defaults from CMS NHE projections and KFF premium trends. It can vary stochastically in Monte Carlo (SIM-09). |
| HC-12 | **Benchmarks:** checks against Fidelity's and Vanguard's retiree cost estimates. Matches the BiggerPockets Money ACA Cost Estimator's method for the unsubsidized case (V-07), then extends it with subsidies, OOP, Medicaid and Medicare. |

## 10. UI/UX and Design System
- **Original brand**, with its own name, palette, type and iconography. The information architecture is designed from user tasks (Plan → Explore → Compare → Track), not copied from another product.
- **Design tokens** for color, type, spacing, radius, elevation and motion; light and dark themes; tokens documented in Storybook (`packages/ui`).
- **Components** are accessible by default: Radix-style primitives (headless) plus our own styling. **WCAG 2.2 AA** is checked automatically by axe in CI, plus a manual screen-reader pass before release.
- **Charts** (UX-02): animated transitions when inputs change; every point has a tooltip that explains how it was calculated ("$41,200 = wages $95,000 − 401(k) $23,500 − tax $18,900 − …"); a data-table alternative for a11y.
- **Instant feedback:** sliders give an optimistic deterministic recompute (≤50 ms), while Monte Carlo reruns in the background with a progress indicator.
- **Interaction:** a drag-and-drop milestone timeline, inline editing, undo/redo through the patch log, and keyboard equivalents for every drag.
- **Onboarding:** a wizard that builds a first plan in under 5 minutes, with sample plans to explore.
- **Motion:** purposeful micro-animations; `prefers-reduced-motion` turns off non-essential motion.
- **Mobile-first:** each screen is designed at 360 px and 1440 px together, with bottom navigation on mobile and touch charts.

### 10.1 Design reference: ProjectionLab UI breakdown and image board
A separate research task is building a UI breakdown of ProjectionLab with an image board, for reference while designing this tool.
- **Location:** `research/projectionlab/`, with screenshots in `screens/`, `ui/`, `ui-hd/` and `help/`, and manifests and help-article extracts in `data/`. Link the finished breakdown and board index here when they land (O5).
- **How it's used:**
  1. **Parity check.** Every screen, panel and control on the board maps to a feature ID in §4. Anything that doesn't map becomes a new ID or is recorded as deliberately out of scope.
  2. **Workflow and IA study.** What each screen helps the user do, the order of steps in each task flow, information density, and which numbers users expect to see together.
  3. **Differentiation pass.** For each reference screen, record what our original design does differently: layout, visual language, chart styling and wording.
- **Output:** `docs/design/reference-map.md`, a table with one row per reference screen showing the matching feature IDs, our screen, and the differences.
- **Guardrails:**
  - Reference only. Never trace or reuse layouts, assets, icons, illustrations, palettes, product names or copy text.
  - Design reviews compare our screens against the board to confirm they look clearly different.
  - The research folder holds third-party copyrighted material. It is never bundled into the app, and it stays out of any public repo (O2).

### 10.2 Guided tours (UX-10 to UX-12)
Tours are interactive walkthroughs that teach how to use the tool. They are separate from the onboarding wizard (UX-05), which *builds* a first plan; tours *explain* features. The wizard ends by offering T-B01.

**Engine (UX-10)**
- **Tours are data:** each one is a typed definition in `apps/web/src/tours/` with `id`, `title`, `level` (`basic` | `advanced`), `estMinutes`, `prerequisites[]` (other tour IDs), `featureIds[]`, `samplePlan`, and `steps[]`.
- **Each step has:** a `route`, a `target` (a stable `data-tour="…"` attribute, never a CSS class), `title`, `body` (short markdown), `placement`, and an optional `action` (`observe`, `click`, `input`) with an `advanceOn` event. An optional `explainLink` points to the matching "How this is calculated" entry (RPT-06).
- **Sandbox by default:** tours run on a read-only copy of a sample plan, so they never change the user's own plans. An option runs a tour on the user's current plan in observe-only mode.
- **Built-in sample plans:**
  - `sample-basic`: a single person, working, a simple portfolio.
  - `sample-early-retiree`: a couple retiring at 50 with an ACA bridge, a Roth ladder and taxable accounts.
  - `sample-couple-ss`: a couple near retirement focused on Social Security, RMDs and IRMAA.
- **Entry points:**
  - A Tours catalog under Help, showing progress and completion badges.
  - A "?" button on each screen that offers that screen's tour.
  - A one-time prompt the first time a user opens a feature. It can be dismissed for good.
  - The onboarding wizard's final step.
- **Progress:** stored in local settings (completed, dismissed, last step) so a tour resumes where it left off. Progress syncs with SYNC-02.
- **Accessibility:**
  - Focus moves to the step dialog, and Esc exits.
  - Each step is announced through `aria-live`, and every step has a "Next" button, so tours that ask for drag actions can also be completed with the keyboard.
  - The highlight spotlight respects `prefers-reduced-motion` and keeps WCAG contrast.
- **Mobile:** steps appear as bottom-sheet cards instead of popovers, and targets scroll into view.
- **Content:** written in plain language, at most about 60 words per step, and kept in one file per tour so it's easy to edit. Real numbers from the sample plan are pulled in through placeholders (e.g. "Your chance of success is {mc.successRate}").

**Basic tour series (UX-11)**
| ID | Tour | Covers |
|---|---|---|
| T-B01 | Welcome and getting around | Layout, navigation, switching plans, themes, where data is stored (local-first) |
| T-B02 | Your current snapshot | Adding accounts, assets and debts; cost basis; balances |
| T-B03 | Income and expenses | Growth rates, inflation, spending phases, one-time items |
| T-B04 | Milestones and the timeline | Adding and dragging milestones; how a milestone triggers plan changes |
| T-B05 | Reading your projection | Net-worth chart, cash-flow Sankey, explanation tooltips, today's dollars versus future dollars |
| T-B06 | Where your money goes | Surplus waterfall and withdrawal order |
| T-B07 | Trying what-ifs | Duplicating plans, variants, undo and redo |
| T-B08 | Saving and backups | Local storage and encrypted export and import |

**Advanced tour series (UX-12)**
| ID | Tour | Covers |
|---|---|---|
| T-A01 | Chance of success | Monte Carlo, percentile bands, number of runs, seeds |
| T-A02 | Testing against history | Historical backtesting, worst start years, sequence risk |
| T-A03 | Returns, inflation and allocation | Return models, correlations, glide paths, rebalancing |
| T-A04 | Understanding your taxes | Tax breakdown, effective and marginal rates, moving between states |
| T-A05 | Roth conversion ladders | Bracket-filling, conversion ladders, 5-year rules |
| T-A06 | Withdrawals and RMDs | Withdrawal strategies, RMDs, gain and loss harvesting |
| T-A07 | Getting at your money early | Rule of 55, 72(t)/SEPP, 457(b), the 10% penalty |
| T-A08 | The healthcare bridge | COBRA, then ACA, then Medicare; MAGI management; the subsidy cliff; Medicaid |
| T-A09 | Medicare and IRMAA | Parts B and D, Medigap versus Advantage, the two-year IRMAA lookback |
| T-A10 | Social Security strategy | Claiming age, spousal and survivor benefits, the earnings test |
| T-A11 | Flexible spending and guardrails | Guardrail rules, floor and ceiling, percent-of-portfolio |
| T-A12 | Estate and heirs | Projected estate, step-up, inherited-account tax drag |
| T-A13 | Comparing scenarios | Compare mode, diffed charts and metrics |
| T-A14 | Tracking progress | Logging actual balances and comparing them with the plan |
| T-A15 | Sync, encryption and recovery | Setting up sync, the passphrase, the recovery key, conflicts |
| T-A16 | How this is calculated | The methodology panel, data sources and versions, enacted versus projected values |
| T-A17 | Reports and export | PDF reports and CSV export |

**Definition of done:** a user-facing feature isn't done until its tour steps are written, its `data-tour` anchors exist, and its tour passes the e2e test (§14.2). Each tour is written in the same phase as the feature it covers (§15).

## 11. Architecture and Repo Layout

```
EK-F.I.Sim/
├─ apps/web/            React + Vite PWA (UI, state, workers host)
│  └─ src/tours/        Tour definitions, sample plans, tour engine (UX-10)
├─ packages/engine/     Pure TS simulation core (no DOM, no I/O)
├─ packages/data/       Versioned JSON datasets + JSON Schemas
├─ packages/ui/         Design system + Storybook
├─ packages/crypto/     E2E encryption helpers (Web Crypto + Argon2 WASM)
├─ workers/sync/        Cloudflare Worker sync API (D1 + R2)
├─ tools/ingest/        Data ingestion scripts (Shiller, FRED, CMS, IRS, SSA)
├─ tests/validation/    Research and oracle validation suite (Node + Python)
├─ tests/e2e/           Playwright e2e + visual regression
├─ docs/runbooks/       Annual data update, release, restore drill
├─ docs/design/         Reference map (§10.1), brand and design decisions
├─ research/            ProjectionLab UI breakdown and image board (reference only, never bundled)
├─ plan/                Build plan, review, archive
└─ .github/workflows/   CI/CD
```

- **Workers:** a pool of Web Workers (`navigator.hardwareConcurrency − 1`, at most 4) runs the engine, communicating through Comlink. Runs are split across the pool, and results are merged.
- **Persistence:** IndexedDB through `idb`, with stores for `plans`, `snapshots`, `actuals`, `syncQueue` and `settings`.
- **Sync API** (Worker):
  - `GET /v1/plans` lists `{id, version, updatedAt, size}`.
  - `GET /v1/plans/:id` returns the ciphertext.
  - `PUT /v1/plans/:id` with `If-Match: <version>`. A mismatched version gets **409**, and the client shows a conflict prompt (keep mine, keep theirs, or keep both as variants).
  - `DELETE` tombstones the plan.
  - D1 holds `plans(user_id, plan_id, version, updated_at, size, r2_key, deleted)`, and R2 holds the ciphertext objects.
- **Reporting:** PDFs are generated client-side (a print-optimized React render, then `pdf-lib` / the browser's print path), and CSV through a streaming writer.

## 12. Security and Privacy

### 12.1 Threat model
| Asset | Threats | Controls |
|---|---|---|
| Plan data (balances, income, health) | The sync provider is compromised or a cloud bucket is misconfigured | E2E encryption, so the server only ever holds ciphertext |
| | Network attacker | HTTPS only, HSTS |
| | XSS or a malicious dependency (**the main risk to E2E**) | Strict CSP (`script-src 'self' 'wasm-unsafe-eval'`, no inline scripts, no third-party origins), Trusted Types, pinned lockfile, Dependabot, `pnpm audit` in CI |
| | Device theft | Optional app lock that encrypts IndexedDB; otherwise relies on OS disk encryption (user's choice, explained in the UI) |
| Keys | Lost passphrase | Recovery key (below) |

- **Never collect** SSNs, account numbers or credentials.

### 12.2 Key management
- A random 256-bit **data key (DEK)** for each user encrypts each plan with **AES-256-GCM**: a random 96-bit nonce, and AAD = `planId‖version`.
- The DEK is **wrapped** twice:
  1. With a key derived from the passphrase: **Argon2id via WASM** (m=64 MiB, t=3, p=1), falling back to **PBKDF2-SHA256 at ≥600,000 iterations** if WASM is unavailable.
  2. With a random **recovery key**, shown once for the user to print or store.
- Changing the passphrase only rewraps the DEK; plans aren't re-encrypted.
- **Auth is separate from encryption.** Cloudflare Access (or passkeys, O3) gates who can reach their ciphertext, but auth never sees the DEK.
- The Worker never logs request bodies.

### 12.3 Pre-release security review (part of the §16 gate)
Review the crypto code against the spec above; check CSP and headers (securityheaders-style scan); confirm the sync API only lets a user reach their own rows (authz tests); run a restore drill from the recovery key on a clean browser profile; dependency audit is clean.

## 13. Performance Budgets
Reference devices: a **mid-range Android** (e.g. Pixel 6a or Galaxy A5x class) and an **iPhone 12**.

| Metric | Budget |
|---|---|
| Deterministic recompute, 60-year horizon, full tax and healthcare | ≤ 50 ms |
| Monte Carlo, 1,000 runs, full tax and healthcare | ≤ 2 s (worker pool, progressive) |
| Monte Carlo, 10,000 runs | ≤ 15 s, with progress and cancellation |
| Slider interaction | ≥ 30 fps, no main-thread task over 50 ms |
| Initial JS (gzip) | ≤ 250 KB; charts and heavy editors lazy-loaded |
| LCP on simulated 4G | ≤ 2.5 s |
| Memory, 10k-run Monte Carlo | ≤ 150 MB |

- An engine benchmark runs in CI, and **a regression above 20% fails the build**.
- Phase 3 sets the baseline for Monte Carlo without tax. **Phase 4 must re-benchmark with the full tax engine**, and Phase 5 again with healthcare.

## 14. Delivery and Operations

### 14.1 Environments
| Env | What | Access |
|---|---|---|
| Local | `vite dev` + `wrangler dev` (local D1 and R2) | — |
| Preview | Cloudflare Pages preview per PR, plus the Worker `preview` env with separate D1 and R2 | Behind Cloudflare Access |
| Production | Pages production on `main`, plus the Worker `production` env | Behind Cloudflare Access until v1.0; reviewed at the release gate |

### 14.2 CI/CD (GitHub Actions)
- **On PR:** install (pnpm, frozen lockfile) → lint (ESLint) and format check (Prettier) → `tsc --noEmit` → Vitest unit and property tests → data schema validation → validation suite (Node, plus a Python job for Tax-Calculator) → build → Playwright e2e and visual regression (phone, tablet and desktop sizes) → **tour tests** (every tour runs start to finish on phone and desktop sizes, and every `data-tour` target must exist) → axe → Lighthouse CI budgets → engine benchmark → Pages preview deploy.
- **On merge to `main`:** all of the above → deploy production Pages and Worker (`wrangler deploy`) → D1 migrations through `wrangler d1 migrations apply`.
- **Branch protection:** PRs required, all checks required, linear history.
- **Secrets:** `CLOUDFLARE_API_TOKEN` (scoped) and `CLOUDFLARE_ACCOUNT_ID` live in GitHub Actions secrets. `FRED_API_KEY` is used only by the ingest workflow.
- **Dependencies:** Dependabot weekly; Actions pinned to SHAs.

### 14.3 Releases and rollback
- **Semver app releases** through Changesets, with tags `vX.Y.Z`. **Data releases** are versioned separately (`data-YYYY.N`) and recorded in each plan's results.
- **Rollback:** Pages instant rollback; `wrangler rollback` for the Worker; D1 Time Travel (within its retention window) for metadata.
- **PWA updates:** `vite-plugin-pwa` (Workbox) with **prompt-to-update**, so the app never reloads automatically in the middle of an edit. Caches are versioned and data files are content-hashed. Schema migrations run after an update, behind the backup snapshot from §5.2.

### 14.4 Observability and backups
- No third-party telemetry. The Worker relies on Cloudflare's aggregate analytics. Client errors go to a local ring buffer the user can export for debugging.
- **Backups:** the app reminds the user to make an encrypted export (SYNC-03). A **quarterly restore drill** follows `docs/runbooks/restore-drill.md`.

## 15. Phased Roadmap
The order is the same as v1. Each phase ends at its **exit criteria**; every merge deploys to preview or production (§14), and **v1.0 ships only after §16 passes**. Each phase also writes the guided tours for the features it delivers (§10.2), and every exit below includes "this phase's tours pass their e2e tests."

### Phase 1: Foundations
- **Scope:** repo and monorepo setup, CI/CD and preview deploys (§14), the data-provenance framework and schema validator (§8.1), plan schema v1 and the migration framework (§5.2), design system and tokens (UX-01), a11y baseline (UX-09), PWA shell (UX-07), mobile-first layout (UX-08 baseline), a basic plan editor (PLAN-01, 02, 04, 05, 07 basic), IndexedDB persistence (SYNC-01), and encrypted export/import (SYNC-03).
- **Also in scope:** the design-reference study and `docs/design/reference-map.md` (§10.1); the tour engine (UX-10) with the `sample-basic` plan; tours T-B01, T-B02 and T-B08.
- **Exit:** a plan can be created on phone and desktop, edited, reloaded offline, exported and re-imported. CI is green with preview deploys working. The axe scan is clean. The reference map covers every board screen, and the brand looks clearly different from the board. O2 and O5 are closed.

### Phase 2: Deterministic engine
- **Scope:** SIM-01, the §6 order of operations and solver framework (with a placeholder flat tax), PLAN-03, 08, 09, 10, 11, SIM-06, SIM-07 (fixed rate), and charts: net worth and cash-flow Sankey (UX-02 partial), workers (UX-03), timeline and undo/redo (UX-04). Tours T-B03 to T-B07.
- **Exit:** the §6.5 property tests pass; recompute meets ≤50 ms; milestones trigger changes correctly in fixture plans.

### Phase 3: Simulation
- **Scope:** historical data ingest (§7.3), SIM-02, 03, 04, 05, 07 (sampled), 08 and 10, the fan chart, validation cases V-01, V-02, V-03 and V-09, and the first version of RPT-06. Tours T-A01 to T-A03 and T-A16.
- **Exit:** those validation cases pass within tolerance; the Monte Carlo baseline benchmark is recorded; seeded runs reproduce exactly.

### Phase 4: Tax engine
- **Scope:** TAX-01 through TAX-14 (federal first, then the O1 states), PLAN-06, 12, 13 and 14, the annual data pipeline and runbook (§8.3), validation cases V-04, V-05 and V-08 (RMD), and the tax breakdown chart. The `sample-couple-ss` plan; tours T-A04 to T-A07 and T-A10.
- **Data years:** 2026 enacted and 2027 enacted (the Rev. Proc. was published Oct–Nov 2026), with later years projected.
- **Exit:** V-04 passes within $1; the Monte Carlo benchmark is re-run with tax and still meets §13; O1 is closed at the start of the phase.

### Phase 5: Healthcare module
- **Scope:** HC-01 through HC-12, linked to TAX-10 and STRAT-02's inputs, SIM-09, and validation cases V-06 and V-07. The `sample-early-retiree` plan; tours T-A08 and T-A09.
- **Exit:** the ACA/PTC/Medicaid/IRMAA fixtures pass; an early-retiree sample plan shows a believable bridge cost against the benchmarks; perf is re-benchmarked.

### Phase 6: Advanced strategy
- **Scope:** STRAT-01 through STRAT-04, including MAGI-band targeting combined with Roth conversions. Tours T-A11 and T-A12.
- **Exit:** each strategy has fixtures plus property tests (e.g. guardrails never breach the floor or ceiling), and the tax analytics views are done.

### Phase 7: Analysis and sync
- **Scope:** RPT-01 through RPT-05, SYNC-02 and SYNC-04, the sync Worker with D1 and R2, and key management (§12.2). Tours T-A13 to T-A15 and T-A17, plus syncing tour progress. O3 and O4 are closed.
- **Exit:** two devices sync a plan, including an offline edit and a conflict; recovery-key restore works on a clean profile; PDF and CSV output match the on-screen numbers.

### Phase 8: Polish and hardening
- **Scope:** UX-05 and UX-06, a full a11y audit (automated and manual), perf tuning to §13 on the reference devices, finishing mobile UX, the security review (§12.3), and docs and runbooks. **Tour polish:** review all tour copy, finish the catalog and badges, link the wizard to T-B01, and run a usability check in which someone new to the app completes T-B01 to T-B05 without help. A final design-review pass against the reference board (§10.1).
- **Exit:** every item in the §16 checklist is satisfied.

## 16. v1.0 Release Gate (all must be true)
- [ ] Parity matrix (§4): every feature ID is implemented, tested, and marked done.
- [ ] Validation suite V-01 through V-09 passes within tolerance on the current data release.
- [ ] The current tax and health data year is loaded and `enacted` where published, with sources and dates shown in the app.
- [ ] Performance budgets (§13) are met on both reference devices.
- [ ] WCAG 2.2 AA: axe is clean and the manual screen-reader pass is done.
- [ ] The security review (§12.3) is complete, with no open high or critical issues.
- [ ] A restore drill succeeded (encrypted export and recovery key) on a clean profile.
- [ ] Disclaimers (§1.3) appear in the app and in PDF reports.
- [ ] All 25 guided tours (T-B01 to T-B08, T-A01 to T-A17) pass their e2e tests on phone and desktop sizes and can be completed with the keyboard alone.
- [ ] The reference map (§10.1) is complete, and the final design review confirms no copied layouts, assets or copy text.
- [ ] The PWA update flow has been tested from the previous build with a schema migration.
- [ ] Runbooks are done: annual data update, release and rollback, restore drill.
- [ ] Decision on whether to keep Cloudflare Access in front of production.

## 17. Risks and Mitigations
| Risk | Impact | Mitigation |
|---|---|---|
| Scope size under full parity (D8) | Long time before v1.0 | Private production deploys from Phase 1 let the app be used early; the feature IDs keep progress visible; exit criteria are strict |
| Tax and health law changes | Wrong estimates | Versioned law with effective dates, the legislation-watch step in the runbook, `projected` flags |
| No ACA data for state-based exchanges | Premium gaps in some states | State exchange data or SLCSP entered by the user, clearly flagged (HC-02) |
| Validation mismatches caused by differing data series | False failures or false confidence | Use each reference study's own series (§7.4) and document the differences |
| Monte Carlo slowed by the tax and healthcare engines | Budgets missed on phones | Re-benchmark in each phase, worker pool, progressive results, fewer default runs on low-end devices |
| Crypto implementation mistakes | Data exposure or loss | Standard primitives only, a small audited module (`packages/crypto`), recovery key, review at the gate |
| Free-tier limits change | Hosting or sync disruption | Recheck at deploy time; encrypted exports keep data independent of any provider |
| IP or trade-dress concerns | Legal risk | Original IA and visuals (§1.3), and no copied assets or copy; the reference board is used only under the §10.1 guardrails and kept out of public repos and the bundle |
| Tours break as the UI changes | Steps point at missing elements; users get confused | Stable `data-tour` anchors, tour e2e tests in CI (§14.2), and tours counted in each feature's definition of done |

## Appendix A — Baseline Law to Verify Each Data Year
These are the provisions the engine must encode as versioned law. **Re-check every item against the enacted text and current IRS, SSA and CMS guidance when loading a data year.**
- **OBBBA (P.L. 119-21, July 2025):** TCJA individual rate structure made permanent; standard-deduction changes; the age-65+ "senior" deduction (2025–2028, phased out by MAGI); the higher SALT cap with its MAGI phase-down and scheduled reversion; deductions for tip and overtime income (temporary); a higher estate and gift exemption indexed going forward; HSA eligibility for bronze and catastrophic marketplace plans; changes to repayment of excess advance PTC.
- **SECURE 2.0:** RMD age 73 (born 1951–1959) and 75 (born 1960 or later); age 60–63 super catch-up; mandatory Roth catch-up above the wage threshold (from 2026); 529-to-Roth rollovers; no lifetime RMDs on Roth 401(k)s; the inherited-IRA 10-year rule (with the final regulations' annual-RMD requirements where they apply).
- **Social Security Fairness Act (Jan 2025):** WEP and GPO repealed.
- **ACA premium tax credit:** the ARPA/IRA enhanced credits were scheduled to end after 2025, bringing back the 400% FPL cliff and higher applicable percentages. Encode whatever law is in force for each plan year, and model any extension as its own versioned rule.
- **Inflation Reduction Act (2022):** Part D out-of-pocket cap (indexed).
- **Medicare IRMAA:** tiers use MAGI from two years earlier; thresholds are indexed.
