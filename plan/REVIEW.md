# Review of Build Plan v1: Completeness and Deployment Readiness

| | |
|---|---|
| **Reviewed** | [archive/build-plan-v1.md](archive/build-plan-v1.md) |
| **Result** | [BUILD_PLAN.md](BUILD_PLAN.md) (v2) |
| **Date** | 2026-11-10 |

## Verdict

v1 has a strong vision, good data sourcing and sound modeling intent. **It isn't ready to build or deploy yet.** It describes *what* the app does, but not:

- how the engine computes results,
- how data is structured and versioned,
- how the app gets built, tested, shipped and rolled back,
- how the encrypted sync is kept safe,
- or how to tell when a phase is finished.

Several of its law and data assumptions are also out of date.

v2 keeps every v1 feature and the v1 phase order. It adds what's missing, as listed below.

**Severity:** **Critical** means it blocks the build or deployment. **Major** means a large correctness or scope gap. **Minor** means it should be fixed, but nothing is blocked.

## What v1 does well (carried into v2)
- A clear feature scope that maps to ProjectionLab, plus a distinctive healthcare module.
- Data kept separate from code, versioned by year, with sources cited.
- Recognized methods (block bootstrap, rolling cohorts) and a validation-suite intent.
- A local-first, privacy-first design with end-to-end encryption.
- Mobile considered from Phase 1.

## Critical

| # | Finding | Fixed in v2 |
|---|---|---|
| C1 | **Engine semantics are undefined.** There is no annual order of operations, no timing convention (start, mid or end of year), and no rule for nominal versus real values. The **circular dependencies** go unaddressed: withdrawals depend on tax, tax depends on withdrawals, and ACA subsidies depend on MAGI, which conversions change. A fixed-point solver with convergence rules is required. | §6.2–§6.4 |
| C2 | **No domain model or plan schema.** Entities, fields, money representation, `schemaVersion` and migrations are all missing. A local-first app with sync needs these from day one. | §5 |
| C3 | **Law baseline is out of date.** v1 plans around "sunsets", but OBBBA (July 2025) made the TCJA rates permanent and added new provisions (senior deduction, SALT cap changes, tips and overtime deductions, estate exemption, HSA eligibility). It also misses SECURE 2.0 (RMD age 73 or 75, super catch-up, Roth catch-up mandate, 529-to-Roth, no Roth 401(k) RMDs), the Social Security Fairness Act (WEP/GPO repeal), and the end of the enhanced ACA credits after 2025 (the 400% FPL cliff). | Appendix A, TAX-13, HC-04 |
| C4 | **No delivery pipeline.** There's no CI, no preview or production environments, no secrets handling, no branch protection, no release versioning and no rollback. "Hosting setup" is the only deployment item. | §14 |
| C5 | **No security model for E2E sync.** There's no threat model, no recovery path for a lost passphrase, and no separation of auth from the encryption key. It doesn't note that Argon2id isn't native to Web Crypto (it needs WASM, with stated PBKDF2 fallback parameters), or that XSS is the main risk to E2E (which calls for a strict CSP). IndexedDB is unencrypted at rest. | §12 |
| C6 | **No acceptance criteria.** Phases have no exit criteria, "parity" isn't measurable, and there's no release gate. | §4 (feature IDs as a parity matrix), §15, §16 |

## Major

| # | Finding | Fixed in v2 |
|---|---|---|
| M1 | **Early-retiree access rules are missing**, even though they're the core of an early-retiree tool: the 10% penalty, Rule of 55, 457(b), 72(t)/SEPP, both Roth 5-year rules and ladder seasoning. | PLAN-12 |
| M2 | **Contribution strategies are missing:** backdoor Roth with the pro-rata rule, mega-backdoor Roth, employer match formulas, and catch-up variants. | PLAN-13 |
| M3 | **Account types are missing:** 403(b), 457(b), SEP/SIMPLE/solo 401(k), inherited IRA (10-year rule), I-bonds and T-bills, and annuities. | PLAN-02 |
| M4 | **Social Security is thin.** It lacks earnings-record input, the PIA calculation, claiming-age choice, spousal and survivor benefits, the earnings test, and a trust-fund shortfall scenario. | PLAN-06, V-05 |
| M5 | **Real estate and debt detail is missing:** amortization, refinancing, property tax and insurance, the §121 home-sale exclusion, and rent versus buy. | PLAN-03, PLAN-04 |
| M6 | **Survivor and filing-status changes are only implied.** There is nothing on death of a spouse, the move to qualifying surviving spouse and then single, or joint survival in longevity. | PLAN-10, SIM-08 |
| M7 | **ACA data has coverage holes.** The CMS Exchange PUFs cover only HealthCare.gov states, so **state-based exchanges** (e.g. CA, NY) need another source or user-entered data. State-specific age curves and community rating aren't covered, and neither is **Medicaid** (138% FPL, expansion status, the coverage gap), which low-MAGI early retirees can hit. | HC-02, HC-03, HC-05 |
| M8 | **Healthcare gaps:** cost-sharing reductions, COBRA extensions, the HSA stop at Medicare (6-month Part A look-back), the Part D out-of-pocket cap, Part A premiums, and **long-term care** (none at all). | HC-06 to HC-10 |
| M9 | **Market data construction isn't specified.** Shiller has no bond *total-return* series, so a construction method is needed. Cash returns before 1928/1934 need a proxy. There is no long free history for international stocks or REITs. | §7.3 |
| M10 | **Validation has no tolerances.** Worse, the Trinity Study used long-term corporate bonds while cFIREsim and FIRECalc use Shiller data, so each reference case must use its own data series or it will report false failures. Tax-Calculator is Python, so CI needs a Python job. | §7.4 |
| M11 | **No performance budget.** Monte Carlo with a full tax engine on a phone (1k–10k runs × ~60 years) has no target, no worker-pool design and no result-aggregation strategy. The roadmap puts Monte Carlo (Phase 3) before the tax engine (Phase 4), so early benchmarks will look better than reality. They have to be re-run in Phase 4. | §13, §7.1, §15 |
| M12 | **Data pipeline issues.** Raw dataset sizes aren't addressed (CMS county rate files are large), there's no lazy-loading or cache-busting plan, and client-side API keys (FRED) aren't ruled out. The annual calendar misses HHS poverty guidelines (January) and the ACA applicable-percentage Rev. Proc. (summer). | §8.1, §8.3 |
| M13 | **Open decisions with nothing deciding them.** Framework, states, mobile delivery and granularity were all left open, with no deadlines. | §3 (D1–D11 settled; O1–O4 tied to phases) |

## Minor

| # | Finding | Fixed in v2 |
|---|---|---|
| m1 | Fund expense ratios and advisory fees aren't modeled. | PLAN-11 |
| m2 | No PWA update strategy. Stale service-worker caches and schema migrations during an update are a common failure. | §14.3, §5.2 |
| m3 | Data licensing and redistribution terms aren't noted. KFF, Fidelity, Vanguard and CareScout are references or benchmarks, not redistributable datasets, and some FRED series are third-party licensed. | §8.2 |
| m4 | No "not financial advice" disclaimer, and no labeling of results as estimates. | §1.3 |
| m5 | "Match ProjectionLab's information architecture" could invite copying. v2 restates it as an original IA with no copied screens, copy or assets. | §1.3, §10 |
| m6 | No repo layout or module boundaries in the codebase. | §11 |
| m7 | No observability or backup-drill plan. | §14.4 |
| m8 | The engine has no testing strategy beyond "unit tests" (no property or invariant tests such as conservation of money). | §6.5, D11 |
| m9 | The sync conflict model ("last-write-wins with a conflict prompt") has no API contract. | §11 (If-Match / 409) |
| m10 | The Supabase-specific notes (pausing, keep-alive) don't apply now that the backend has moved to Cloudflare Workers, D1 and R2. | D5 |

## Changes from v1 decided in this review
- **Framework:** React + Vite + TypeScript (user decision).
- **State tax:** the user's current and retirement states first. *They still need to be named* (O1, before Phase 4).
- **Sync backend:** Cloudflare Workers + D1 + R2 instead of Supabase (user decision).
- **Release:** full parity before v1.0 in the original 8-phase order (user decision), with private preview and production deploys starting in Phase 1.
- **Mobile:** an installable PWA for v1.0, with Capacitor after v1.
- **Granularity:** yearly by default, with a `TimeStep` abstraction so monthly can be added later.

## Checking the carry-over
Every v1 feature bullet maps to a v2 feature ID:
- **Core planning:** PLAN-01 to PLAN-10
- **Simulation:** SIM-01 to SIM-06
- **Tax and strategy:** TAX-01 to TAX-10, TAX-14, STRAT-01 to STRAT-04
- **Analysis:** RPT-01 to RPT-05
- **Healthcare:** HC-01 to HC-12
- **Modeling standards:** SIM-02, SIM-04, SIM-07, SIM-08, V-01 to V-03, RPT-06
- **UI:** UX-01 to UX-09
- **Architecture, sync and mobile:** SYNC-01 to SYNC-04, §11, UX-07 and UX-08
