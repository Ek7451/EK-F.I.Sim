# UI implementation status

Implementation of [PREMIUM_UX_UPGRADE.md](PREMIUM_UX_UPGRADE.md), verified on November 12, 2026. The six delivery phases are implemented and merged through [PR #6](https://github.com/Ek7451/EK-F.I.Sim/pull/6). The first hosted release is available at [Longview Planner](https://longview-planner.pages.dev), publicly available without sign-in. See the [deployment record](../docs/deployments/2026-11-12.md).

## Delivery scorecard

| Phase                      | Delivered                                                                                                                                                                                                                    |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 — Baseline and contracts | Design policies reconciled; shared metric definitions; nine fixed-date, seeded fixtures; input-to-visible-result instrumentation.                                                                                            |
| 1 — Visual system          | Slate/indigo themes, self-hosted Inter with license, semantic chart colors, appearance gallery, five primary destinations, responsive inspector/dialogs, protected plot area and screenshot baselines.                       |
| 2 — Planning interaction   | Shared pinned year and chart range, integrated timeline, dependency highlights, contextual draft editors, baseline overlay, signed changes, explicit apply/save scenario/discard, one-step undo and cancellation.            |
| 3 — Analysis suite         | Ledger-based cash flow with list alternative and drilldown, tax brackets/rates and healthcare context, simulation status/bands/resilience, historical cohorts and annual paths, estate composition and optional uncertainty. |
| 4 — Remaining workflows    | Scenario comparison and suggested experiment, searchable accounts, schedule previews, strategy drafts, dated actuals and frozen progress reference, committed-revision reports, onboarding and guided tours.                 |
| 5 — Regression and finish  | Keyboard/focus, phone/tablet/desktop, light/dark, reflow, reduced motion, visual snapshots, worker failure/retry, migration recovery, performance and export checks.                                                         |

## Surface coverage

| Surface                       | Result                                                                                                                                             |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overview                      | Opening position, distinct recorded actuals, retirement decision and contextual next action.                                                       |
| Projection                    | Account/net-worth modes, age/year labels, selected-year inspector, coordinated range, draft comparison, exact-year keyboard and pointer selection. |
| Accounts and debts            | Search, type filtering, totals, contribution/withdrawal context and links to drivers.                                                              |
| Income and spending           | Recurrence/growth/start/end summaries, timeline previews and full schedule editors.                                                                |
| Timeline                      | Collision lanes, fixed/derived/condition events, linked income/spending spans, drag/keyboard editing and gesture rollback.                         |
| Cash flow                     | Stable identities and stages, full/compact/list views, complete ledger reconciliation and selected-year drilldown.                                 |
| Taxes and healthcare          | Ordinary bracket occupancy/tax, effective rates, premium/credit/HSA distinctions, coverage and MAGI/IRMAA context.                                 |
| Outcomes                      | Completed-run counts, seed/method, percentile bands and individual samples, failure timing, spending cuts and active-lifespan share.               |
| History                       | Cohort heatmap/table, best/median/worst cohorts and selected annual path, explicit historical horizon.                                             |
| Compare                       | Four neutral outcome deltas, baseline/candidate plot, separate delta plot, named assumption changes and start-year mismatch warning.               |
| Estate                        | Selected-year composition, distinct final settlement, tax drag and opt-in net-to-heirs simulation range.                                           |
| Progress                      | Dated actual observations, frozen reference path, deviations and explicit empty state. No invented monthly interpolation.                          |
| Reports                       | Scenario-aware PDF/CSV, dollar basis and calculation metadata, committed/current revision gating, printable preview.                               |
| Help, settings and onboarding | Existing URLs and tours preserved, appearance preview, actual persistence status/retry, offline backup/import workflows.                           |

## Architecture and numeric contracts

- Focused, lazy-loaded modules under `apps/web/src/pages/explore/` and `pages/analysis/` replace the large feature bundles. Compatibility re-export modules preserve existing imports.
- Persisted plan, draft transaction, workspace view state and result ownership are separate. Hover, zoom and drafts do not write financial plans or sync data. Applying a draft creates one undo entry; saving a scenario preserves baseline assumptions.
- Draft fields accept editable intermediate text with local validation. An invalid or outdated draft cannot be applied. Escape/pointer cancellation restores the pre-gesture transaction; closing a sheet preserves an explicitly labeled draft.
- Result identities include content, scenario and app/data versions. Obsolete responses cannot overwrite current results. Same-plan last results are labeled while updating or failed; a failed worker can be recreated through Retry. Single-worker Monte Carlo batches keep deterministic editing responsive.
- Persisted money remains integer cents; compiled engine results are dollars. Real balances use `cpiEnd`, annual flows use `cpi`. Metric definitions and selectors live in `lib/metrics/`; chart/table/inspector reconciliation tests use engine outputs before formatting.
- Simulation bands describe annual investment quantiles, not one realizable path or probability confidence intervals. Partial, stopped, failed and complete runs have different states. Historical cohorts are not presented as future probabilities.
- Schema v2 uses entity IDs in scenario paths. Removed targets fail explicitly; structural edits replace collections. Optional-field removal remains intact through JSON export. The original v1 schema and fixtures remain available. Initialization and import save the raw pre-migration snapshot before writing v2; recovery and migration tests verify ordering and intact input.

## Verification evidence

Local evidence is kept under ignored `output/`, `.lighthouseci/` and Playwright test-results directories. Reproducible source fixtures and screenshot baselines are included in the working tree.

| Check                                           | Result                                                                                                                                                                                                           |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit/property/financial validation, `pnpm test` | 446 passed; two pre-existing TODOs. 20 test files.                                                                                                                                                               |
| TypeScript and ESLint                           | Passed.                                                                                                                                                                                                          |
| Production build                                | Passed.                                                                                                                                                                                                          |
| Data validation                                 | All 177 datasets passed.                                                                                                                                                                                         |
| Initial JS gzip                                 | 134.81 KiB against 250 KiB budget; font is a separate 48,256 bytes.                                                                                                                                              |
| Full Playwright suite                           | 132 passed; 31 intentional project skips. All three viewport projects, including tours, axe, visual snapshots and result safety.                                                                                 |
| All-screen automated accessibility              | Light/dark scans pass on phone, tablet and desktop; keyboard/dialog/focus checks pass. This is not a claim of a complete human assistive-technology audit.                                                       |
| Plot and reflow                                 | Actual plot height 372px at 1440×900; at least 280px at the other tested sizes. Tested 360, 390, 768, 1280, 1366, 1440 and 1920px widths, plus a 720×450 CSS viewport representing 200% zoom.                    |
| Visual regression                               | Fixed-clock light/dark desktop and phone screenshots; actual theme setting used for chart and DOM colors.                                                                                                        |
| Warm input performance                          | Single-worker profile, 20 edits: result p95 36.2ms, feedback p95 18.9ms, frame interval p95 16.7ms, zero long tasks over 50ms. Targets: 200ms result / 100ms feedback.                                           |
| Engine benchmark                                | 60-year projection 1.93ms; couple 2.15ms; 1,000-run single-worker simulations 626.17ms / 585.29ms; estimated 10,000 runs on four workers 1,565.42ms. Passed existing budgets.                                    |
| Lighthouse                                      | Passed all assertions across three final-build runs. Median LCP 2.253s, CLS 0, TBT 0; performance 98, accessibility 100, best practices 100.                                                                     |
| Reports                                         | PDF and CSV download tests, metadata checks; rendered standard and long-title PDF pages visually inspected for chart, table and wrapped-label layout; stopped simulations block PDF export and can be restarted. |
| Recovery/result safety                          | IndexedDB failure/retry, draft conflict, one-step undo, v1 snapshot/migration, ID reorder/removal, worker crash/retry, cancellation and late-request ownership checks.                                           |

These timings describe local Windows/Chromium and Lighthouse's configured mobile simulation, not a universal device guarantee. The input profile simulates `hardwareConcurrency = 1`; the full suite covers seeded shortfall, empty, long-label, dense-event, extreme-wealth and many-account fixtures.

Deployment preparation resolved the 31 pre-existing formatting failures. The full repository formatting check now passes; `plan/BUILD_PLAN.md` retains the repository's existing formatter exclusion. The two existing financial-validation TODOs in `tests/validation/rules.test.ts` require external healthcare-estimator comparisons and remain unautomated.

## Release and recovery policy

Browser and Lighthouse checks remain explicit local release gates, matching the existing repository policy. They are not added to CI in this change. The new screenshot baselines are Windows/Chromium-specific; introducing a browser CI job should establish and review baselines on its chosen OS rather than silently replacing these images. Existing CI financial/data/build gates remain in place.

The finished workspace is the default experience, with old route URLs retained. There is no temporary preview flag. Existing v1 backups can be imported through migration, and pre-migration snapshots preserve recovery evidence. Reverting to an older app requires restoring a v1 backup/snapshot; a v2 export must not be misrepresented as readable by an older client. Existing encrypted backup/restore and local-first storage remain intact.

Reproduce with `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm validate:data`, `pnpm bench`, `pnpm build`, `pnpm e2e`, and `pnpm lighthouse`. Run benchmarks and Lighthouse while other browser workloads are idle.

The specification explicitly leaves goal-seeking retirement/spending solvers, broad tax optimization, configurable outcome thresholds, detailed Monte Carlo trial replay and multi-variable sensitivity maps for separately scoped modeling work. They are not unfinished parts of this UI implementation.
