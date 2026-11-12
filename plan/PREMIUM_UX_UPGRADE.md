# Longview premium financial-modeling experience

Prepared November 11, 2026. Status: implementation proposal based on repository review, a live local walkthrough, and current ProjectionLab public materials. This document plans the upgrade; it does not claim it has been implemented.

Implementation update, November 12, 2026: see [UI implementation status](UI_IMPLEMENTATION_STATUS.md) for delivered scope, validation evidence and release policy. The original proposal below is retained as the specification and planning record.

## 1. Recommendation

Evolve Longview into a chart-centered planning workspace where a person can change a life decision, watch its consequences, inspect a year, and compare an alternative without losing context. Match the visual sophistication and interaction qualities the user values in ProjectionLab: generous plots, restrained surfaces, coordinated color, rich year inspectors, visible life events, responsive feedback, and accessible depth.

The existing application already has much of the difficult foundation: React, TypeScript, ECharts, a worker-based simulation engine, versioned financial datasets, Monte Carlo and historical analysis, scenario patches, local persistence, undo/redo, reports, and accessible component primitives. Keep these investments. Concentrate the upgrade on workspace composition, transactional editing, chart orchestration, consistent metric semantics, and finish quality.

The first delivery should be a complete vertical slice: open the fictional retirement example, move retirement from 50 to 51, see the baseline and draft projections together, inspect the retirement year, review changes in wealth and taxes, save a scenario, and undo the action. This is the benchmark interaction against which the rest of the product should be judged.

## 2. Evidence and limits

### Review performed

- Read the app shell, design tokens, shared chart wrapper, projection and analysis screens, timeline, plan store, worker/result orchestration, result definitions, existing design documents, and layout-test policy.
- Started the app locally and used its fictional “Couple retiring at 50” example. Inspected the dashboard, projection, what-if controls, timeline, milestone editor, cash flow, comparison entry, and completed Monte Carlo results.
- Exercised keyboard year selection, changed retirement from 50 to 51, and verified Undo restored the previous result. Opening and closing the milestone editor returned focus to the invoking edit button.
- Captured and inspected eight local screenshots and three public-reference captures. Evidence and a visual walkthrough live locally at `research/ux-review-2026-11-11/`; that directory remains ignored by Git.
- Observed the local UI at its default 1280 × 720 viewport. This is not a mobile, dark-mode, zoom, screen-reader, or full accessibility audit.
- ProjectionLab's app and “get started” link redirected to sign-up in this browser. No account was created. Its public screenshots and documentation are comparative research, not a hands-on audit of its authenticated app. Some currently published marketing screenshots visibly show an older app version; they establish visual direction, not exact current controls or timings.
- Existing automated tests were inspected, not rerun for this planning-only change. No claim is made that the full repository is defect-free or numerically validated by this review.

### Local walkthrough findings

| Step / capture        | Health                                                    | Finding and implication                                                                                                                                                                                                                                                                                                                                  |
| --------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01 — Home             | Good foundation; moderate hierarchy gap                   | Strong net-worth figure, clear primary chart, and coherent cards. The long sidebar scrolls; quick-action descriptions truncate. Give the current plan and next meaningful action more prominence than the route inventory.                                                                                                                               |
| 02 — Projection       | High-priority layout gap                                  | Sidebar and horizontal navigation repeat Explore routes. Header, badges, KPI notes, legend and zoom strip consume vertical space. The actual plot is shallow despite a tall surrounding card. Milestone labels compete with legend/data.                                                                                                                 |
| 03 — What-if edit     | Functional; high-priority context gap                     | Retirement keyboard adjustment changed ending wealth from approximately $5.3M to $6.3M; Undo restored it. These are illustrative sample results, not a benchmark or advice. The app displayed an 8 ms recompute for that edit, but this does not measure full input-to-paint latency. Controls appear below the chart and directly alter the saved plan. |
| 04 — Timeline         | Functional; high-priority integration gap                 | A draggable/keyboard-operable milestone timeline already exists. It occupies a separate screen, so financial consequences are not visible beside the event. Reuse the behavior and integrate it with the projection.                                                                                                                                     |
| 05 — Milestone editor | Usable; moderate interaction gap                          | Persistent labels and visible focus are strengths. A centered modal obscures context; linked incomes/expenses are described indirectly. Provide a contextual editor with an affected-items preview and explicit draft/apply behavior.                                                                                                                    |
| 06 — Cash flow        | Good visualization foundation; high-priority labeling gap | Sankey exists and conveys the big picture. The federal/payroll-tax label is clipped at the right edge in the captured viewport. Thin streams and muted fills need deliberate handling.                                                                                                                                                                   |
| 07 — Compare          | High-priority workflow gap                                | The default compares the plan with itself when no variant exists. Large creation and selection forms push the plot below the fold. Lead with a suggested experiment and visible before/after outcomes.                                                                                                                                                   |
| 08 — Success          | Good underlying data; moderate hierarchy gap              | Completed runs show probability, percentile wealth, a fan chart and explanatory copy. Extreme sample trajectories dominate the scale; full completion progress remains visually prominent. Make typical outcomes, downside exposure and run status easier to distinguish.                                                                                |

### Code findings that affect polish

1. `apps/web/src/app.css` derives `--chart-h` from `100dvh - 510px`, with a 240px minimum. Projection then reserves 34px above and 74px below its main plot. On short screens, only a small portion of the chart container remains for data. Replace this layout policy with a protected plot area.
2. `apps/web/src/charts/Chart.tsx` keeps a chart instance alive and preserves zoom, which is useful. It nevertheless calls `setOption(..., { notMerge: true })` for updates. Investigate targeted updates with stable identities to preserve transitions and interaction state. Do not assert that every current update is visibly broken without measurement.
3. `ProjectionPage`, cash flow and taxes keep separate selected-year state. A shared selected year and view state are needed for connected analysis.
4. `Timeline.tsx` calls the normal store update from pointer movement. `store.ts` records each effective update as an undo entry and schedules persistence. Group an entire drag into one transaction; handle pointer cancellation and Escape.
5. `useResults.ts` already suppresses obsolete deterministic responses and exposes `stale`; most reviewed result consumers do not display that state. Monte Carlo stores its summary separately from the requested key and does not clear the old summary at run start. Add explicit result ownership and status so old or partial results cannot masquerade as current ones.
6. Scenario patches in `Analysis.tsx` target array indices. Richer scenario editing needs stable entity identities or validated rebasing when accounts, expenses or milestones are reordered/deleted.
7. In `EstatePage`, the chart's “Taxable and cash” calculation includes HSA/other, while its table row uses taxable/cash only. This is a code-level chart/table parity finding, not a live estate-flow test. Reconcile the category definition before reusing it in the new metric layer.
8. Several design documents contradict the present implementation: early reference-map rows still describe warm paper, six hues and no icon tiles, while current tokens use neutral surfaces, eight hues and icon tiles. Resolve this drift as part of the first phase.

## 3. What to carry over from ProjectionLab

| Reference quality                    | Evidence                                                                                                                                                   | Longview application                                                                                                           |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| The projection is the main workspace | Public dashboard imagery shows a large plot, event markers and a detailed year panel. [Product overview](https://projectionlab.com/)                       | Put a large chart, timeline and year inspector into one coordinated workspace.                                                 |
| Financial flows are a visual story   | Public material documents annual Sankey views, withdrawals, expenses and changing life phases. [Cash flow](https://projectionlab.com/cash-flow)            | Preserve node positions between years, show readable amounts, and link a flow to the input that drives it.                     |
| Uncertainty is explorable            | Published features include Monte Carlo, historical testing, trial detail and selectable metrics. [Monte Carlo](https://projectionlab.com/monte-carlo)      | Keep existing bands and failure timing; progressively add representative-trial replay and richer result exploration.           |
| Taxes have multiple connected views  | Public material describes tax categories, effective brackets, yearly details and strategy inputs. [Tax analytics](https://projectionlab.com/tax-analytics) | Coordinate tax stacks, rate views, annual breakdowns and strategy controls through one selected year.                          |
| Strategies show tradeoffs            | Public material describes strategy comparison, heatmaps and objectives including taxes and legacy. [Optimize](https://projectionlab.com/optimize)          | Treat broad optimization as a later, independently specified engine feature; first make existing strategy comparisons legible. |

The visual recommendation is a closer family resemblance in density, hierarchy, color relationships and interaction continuity, with Longview's own name, text and assets. Use a slate navigation region, neutral workspace, white elevated panels, indigo primary actions and a coordinated teal/blue/violet financial palette. A new color alone will not accomplish the goal; layout and interactions come first.

## 4. Replace conflicting design policy

The user's current direction supersedes earlier repository preferences against similar UI patterns. No extra permission gate is needed to plan this change. During implementation, update the relevant portions of `README.md`, `plan/BUILD_PLAN.md`, `docs/design/brand.md`, and `docs/design/reference-map.md` together.

| Existing restriction                                   | Replacement                                                                                                                  |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Inputs and results must be separated, except one panel | Contextual input editing beside visible results is a primary workflow.                                                       |
| No plan-level tabs or permanent input rail             | Use a compact plan toolbar and contextual editing rail where they improve continuity.                                        |
| The primary must be emerald                            | Adopt the proposed indigo/teal direction and validate semantic contrast in both themes.                                      |
| Every key visual must fit in one viewport              | Protect chart readability first; fit the main task at target desktop sizes, allow detail scrolling, and test reflow at zoom. |
| Charts must look clearly different from the reference  | Evaluate clarity, precision, consistency and interaction quality against the benchmark.                                      |
| Never use event iconography on charts                  | Use original/library icons with names, age/year, clustering and keyboard access.                                             |

Continue keeping reference screenshots out of the shipped app and preserving the existing local-first data architecture. Replace the differentiation checklist with a quality and fidelity checklist.

## 5. Target information architecture and workspace

### Primary navigation

Use five primary destinations: **Overview, Plan, Compare, Progress, Reports**. Put Help and Settings in a stable lower region. Keep the active plan selector in the top bar. Within Plan, provide **Projection, Cash flow, Taxes, Outcomes, History, Estate** views with one shared toolbar. Household, accounts, income, spending, healthcare and assumptions become contextual editor categories, also reachable through a dedicated full-width “Plan inputs” view.

Preserve existing URLs initially as route aliases so bookmarks, tours and tests keep working. Reduce duplicate navigation before renaming routes. Retain an optional labeled collapsed rail; do not make unlabeled icons the only route discovery mechanism.

### Desktop arrangement

- Navigation: about 216px expanded or 64px collapsed.
- Top bar: 56px, showing plan, scenario/draft state, save state and undo/redo.
- Content spacing: 24px outer padding, 16–24px between major regions.
- Outcome strip: four compact metrics with definition access; approximately 80–96px high.
- Primary plotting surface: target 360–440px of actual data area at 1440 × 900, at least 280px at 1366 × 768. Measure the plot, not merely the card.
- Right inspector/editor: about 320–360px; switches between Year details and Edit item. Give the plot remaining width and offer an explicit close action.
- Timeline: 80–120px coordinated with chart zoom, below the plot. Display ages for each household member as appropriate.
- Supporting tables and advanced diagnostics: below the principal workspace, collapsible or in drawers.

At 1280px, collapse navigation or move the inspector into a drawer before making the plot illegible. At tablet sizes, retain the chart and use a sheet for detail. On phones, use one column, a compact outcome row, a year stepper, a touch-selectable chart and a bottom sheet with a sticky action area. Complex Sankey views get an equally complete list/table alternative. At 200% zoom, allow natural scrolling and wrapping.

### Core interaction contract

1. Hover previews a year; click or keyboard selection pins it. The pinned year survives switching from projection to cash flow, taxes and estate.
2. A milestone selection opens its editor and highlights its dependencies. A retirement milestone can reveal linked salary end dates, contributions and coverage transitions that are actually represented in the model.
3. Editing creates a draft preview. The saved baseline remains visible as a thin dashed line; draft outcomes and signed deltas use distinct labels.
4. **Apply to plan**, **Save as scenario**, and **Discard** have explicit meanings. Applying creates one undo entry. Closing an uncommitted editor must not silently save the draft.
5. Dragging previews the timeline position and recalculates at a bounded rate. Release commits the gesture to the draft; Escape/pointer cancellation restores its pre-drag state. Keyboard arrows offer the same outcome, with a numeric field for precision.
6. A “What changed” summary names the changed assumption and consequential metrics. Example: “Retirement moved from 50 to 51; ending wealth increased by approximately $1.0M in this expected-return scenario.” Avoid claiming that a larger balance makes a life choice objectively better.
7. Invalid input remains editable with a local error and the last valid preview. Pending calculations show “Updating”; failure keeps a clearly labeled last successful result and offers Retry.

## 6. Visual and motion specification

These are proposed tokens, to be finalized against real screens and contrast tests in phase 1.

| Element                   | Specification                                                                                                                                                                                             |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Light surfaces            | Workspace `#F4F6FA`, panel `#FFFFFF`, subtle panel `#EEF2F7`, primary text `#172033`.                                                                                                                     |
| Navigation and dark theme | Slate navigation around `#202C40`; dark workspace around `#101827`, raised panel around `#182336`. Use theme-specific text and chart contrast tokens.                                                     |
| Actions                   | Indigo around `#4F5DD5`; teal around `#159EAA` for selected financial emphasis. Reserve semantic red/amber for shortfalls and warnings.                                                                   |
| Type                      | Self-host a licensed Inter Variable font with tabular numerals and system fallbacks. Body 14–16px, secondary labels 12–13px, headings 24–28px, KPI values 28–36px. Test fallback and font-loading shifts. |
| Shape                     | 8px controls, 12–16px cards, 16–20px sheets. Use a small elevation scale and restrained borders; avoid a shadow on every nested item.                                                                     |
| Icons                     | One consistent line-icon family, optically aligned and sized at 16/20/24px. Entity color and icon meanings persist across lists, charts and editors.                                                      |
| Chart lines and fills     | Clear 2–2.5px primary strokes, subdued grids, translucent fills, strong zero/shortfall reference. Keep positive/negative amounts and stock/flow quantities distinct.                                      |
| Controls                  | 36–40px desktop height, 44px touch targets. Text inputs support currency, percentages, negative values, blank intermediate values and local validation.                                                   |

Use semantic chart tokens instead of assigning colors by array order: cash, taxable, pre-tax, Roth, HSA, property, debt, income, expense, tax, baseline and draft. Account categories and financial flows may need separate palettes; never imply that the same hue means two different things on adjacent plots. Use labels, line styles and optional patterns in addition to color.

| Interaction                       | Motion target                                             | Reduced motion                         |
| --------------------------------- | --------------------------------------------------------- | -------------------------------------- |
| Hover, selection, button feedback | 100–140ms color/opacity change                            | Immediate                              |
| Inspector or editor opening       | 180–220ms opacity and small translation                   | Immediate, focus still moves correctly |
| Projection after committed input  | 180–260ms data transition                                 | Immediate                              |
| Continuous scrub/drag             | Direct tracking; no easing lag on pointer position        | Same direct tracking                   |
| Scenario change                   | 200–300ms, preserving chart scale where appropriate       | Immediate                              |
| Completed simulation              | Brief settle; completed status replaces progress emphasis | Immediate                              |

Avoid spring overshoot in financial geometry, decorative continuous motion, and animated counters that obscure exact values. Curve smoothing is separate from animation: do not smooth annual jumps into fictitious intermediate financial states. Show annual observations accurately; use straight or step segments when appropriate. Do not animate error, risk or shortfall warnings out of view.

## 7. Screen-by-screen scope

| Surface              | Required upgrade                                                                                                                                      | Completion condition                                                                                                                                      |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overview             | Clear current position, plan summary, next milestone and meaningful next action. Show actuals and forecasts distinctly.                               | A user identifies current net worth, retirement timing and the next editable decision in one view.                                                        |
| Projection           | Large selectable plot, account/net-worth modes, age/year toggle, visible dollar basis, integrated events, pinned year inspector and draft comparison. | Editing retirement, spending or returns updates the same visible workspace without resetting selection or zoom.                                           |
| Accounts and debts   | Compact groups by tax treatment/type, account totals, contribution and withdrawal context, searchable item list.                                      | Click an account contribution/withdrawal and reach its driver; clearly separate balance from flow.                                                        |
| Income and spending  | Timeline-linked item cards, recurrence, growth and start/end summaries, expandable advanced change-over-time editor.                                  | Basic income is simple to add; complex schedules have a preview and validation.                                                                           |
| Timeline             | Multi-lane events and spans, collision-aware labels, derived/fixed event distinction, dependency highlighting.                                        | Dense events remain selectable; a drag is one undoable transaction; condition-based events edit conditions rather than pretending to be freely draggable. |
| Cash flow            | Stable node/link identities, aligned stages, compact/full detail modes, selectable year, complete labels and drilldown.                               | Values reconcile to the same year's ledger; small streams remain accessible; no text clips at supported sizes.                                            |
| Taxes and healthcare | Coordinated income/tax views, effective-rate panel, bracket detail, coverage phases and threshold context.                                            | Each selected-year amount has a definition and source; supported thresholds link to actual calculation inputs.                                            |
| Outcomes             | Readable probability, exact completed-run count, percentile bands, failure timing, spending-cut outcomes and method/seed disclosure.                  | Partial, final, stale, cancelled and failed runs are unmistakable; monetary metric matches its chart label.                                               |
| History              | Cohort heatmap/table, worst/median/best cohorts and selected-path inspection.                                                                         | Historical start-year definitions and horizon limits stay visible; results are not presented as future probabilities.                                     |
| Compare              | Baseline and candidate chips, compact change list, overlaid paths, separate delta plot and four headline tradeoffs.                                   | Starting with one plan invites an experiment rather than presenting an unexplained self-comparison.                                                       |
| Strategy             | Readable ordered priorities, conversion schedule preview and before/after results for existing strategies.                                            | Strategy changes can be simulated, inspected and saved without navigating through unrelated setup screens.                                                |
| Estate               | Clear gross estate to net-heirs bridge, annual composition and uncertainty where supported.                                                           | Chart, table and explanation share a single category calculation.                                                                                         |
| Progress             | Recorded balances overlaid on a frozen reference plan, dated entries and explanations for deviations.                                                 | Actuals are never interpolated or styled as if they were observed between snapshots.                                                                      |
| Reports              | Consistent typography, vector charts where feasible, printable tables and explicit scenario/year/basis metadata.                                      | Exported numbers match the visible committed scenario, with no cropped labels or draft ambiguity.                                                         |
| Onboarding/help      | Quick sample launch, progressive data entry, contextual definitions and non-blocking tours.                                                           | A fictional sample is immediately usable; deeper help is available without repeatedly obscuring the chart.                                                |

## 8. Metric definitions and presentation

Build a shared metric registry/view-model layer before proliferating new KPI cards. Each metric needs an ID, plain-language definition, computation source, unit, time basis, aggregation rule, available views and explanation link. The registry should say whether a signed change is neutral or has an unambiguous interpretation; lifetime spending and retirement age should not automatically receive green/red judgments.

| Metric                | Current support / rule                                                                                                  | Presentation requirement                                                                                                                                                    |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current net worth     | `summary.currentNetWorth`; distinguish opening position from the first projected year-end                               | Label “Start of year” versus “End of year.”                                                                                                                                 |
| Ending/peak net worth | Existing real summaries and annual `netWorth`                                                                           | Display horizon and dollar basis. A present-value summary cannot silently relabel itself as nominal.                                                                        |
| Investable assets     | Annual `investable` and account composition                                                                             | Distinguish from property-inclusive net worth and from immediately accessible cash.                                                                                         |
| FI date/age           | Existing `fiYear`; default 25× living, housing, debt service and healthcare spending; named FI milestone may override   | Explain that taxes and one-off purchases are excluded from the default test. “Not reached” is a valid result.                                                               |
| Retirement date/age   | Resolved retirement milestones; current summary uses the earliest                                                       | Show each person's retirement separately when relevant; do not equate FI with retirement.                                                                                   |
| Savings rate          | First-year employee contributions, excluding employer contributions, divided by gross income; currently clamped at zero | Preserve or deliberately revise the definition. Do not substitute a different cash-surplus formula under the same label.                                                    |
| Spending coverage     | Expected path shortfall and failed year                                                                                 | Separate deterministic coverage from Monte Carlo success.                                                                                                                   |
| Success probability   | Successful simulation runs divided by completed runs                                                                    | Show completed/requested count, method, seed and definition. A progress bar measures completion, not probability.                                                           |
| Percentile wealth     | Existing Monte Carlo distributions and bands                                                                            | State whether the quantity is investments, ending wealth or net estate. Percentile bands are not a single realizable path or a confidence interval for success probability. |
| Taxes                 | Annual components, effective rates and `lifetimeTaxReal`                                                                | Rates use documented denominators. Lifetime amounts must sum consistently deflated flows.                                                                                   |
| Healthcare burden     | Annual healthcare amounts and credits                                                                                   | Specify gross cost versus after-credit cost and prevent credit double counting.                                                                                             |
| Legacy                | Estate value, estate tax, heir pre-tax tax drag and net to heirs                                                        | Consistent year-end deflation and explicit scope of modeled estate taxes.                                                                                                   |
| Scenario differences  | Existing deterministic comparisons; expand through shared registry                                                      | Candidate minus baseline; money, years and percentage points formatted separately; missing data is not zero.                                                                |
| Spending resilience   | Existing Monte Carlo spending-cut statistics                                                                            | Expose frequency, duration and depth of spending reductions alongside solvency.                                                                                             |

Data contract: plan input amounts commonly use integer cents; the projection engine operates in nominal dollars. Use the existing compilation boundary, not ad hoc `/100` conversions in components. For real values, year-end balances use `cpiEnd`, while annual flows use `cpi`. Comparison of different start years needs a common purchasing-power base or an explicit warning that values are not aligned. Format values only after calculations; keep full precision for reconciliations.

Do not include a “safe to retire” verdict or “maximum safe spending” in the first release without a separately specified search algorithm and assumptions. A target-spending or retirement-age solver, detailed trial replay, broad tax optimization and configurable outcome thresholds are additional scope, not cosmetic work.

## 9. Implementation architecture

### Keep and extend the current stack

Keep React, Vite, TypeScript, Zustand/Immer, ECharts, Comlink workers, IndexedDB and the pure engine. Use CSS transitions for standard component motion and ECharts for plotted data transitions. Add an animation library only if a measured interaction requirement cannot be met cleanly. No WebGL or 3D subsystem is needed for the intended product quality.

ECharts supports incremental data updates and transition configuration; validate behavior against the version pinned by this repository before adopting any newer feature. See its official [data transition guide](https://echarts.apache.org/handbook/en/how-to/animation/transition/) and [dynamic data guide](https://echarts.apache.org/handbook/en/how-to/data/dynamic-data/).

### Proposed boundaries

| Area                 | Existing files                                                                                                             | Proposed change                                                                                                                                                          |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Design system        | `packages/ui/src/styles.css`, `components.tsx`                                                                             | Semantic tokens, theme preview, segmented controls, metric cards, inspector/sheet primitives, validation and motion states. Split oversized component modules as needed. |
| Workspace            | `apps/web/src/shell/Shell.tsx`, `shell/nav.ts`, `App.tsx`, `app.css`                                                       | Plan workspace layout, simplified navigation and route-compatible views.                                                                                                 |
| Chart platform       | `apps/web/src/charts/Chart.tsx`                                                                                            | Shared chart frame, stable series/data identity, domain controller, tooltip model, keyboard year selection and events API.                                               |
| Feature views        | `pages/Explore.tsx`, `pages/Analysis.tsx`                                                                                  | Extract focused projection, cash-flow, tax, outcomes, comparison and estate modules without changing engine math.                                                        |
| Timeline/editors     | `pages/plan/Timeline.tsx`, `IncomeSpending.tsx`, `Snapshot.tsx`, `Strategy.tsx`, `HealthAssumptions.tsx`, `lib/fields.tsx` | Reusable event timeline and contextual draft editors; retain full-form views for complex tasks.                                                                          |
| View state           | New `state/workspace.ts`                                                                                                   | Selected/pinned year, hover year, visible range, metric, chart mode, inspector entity and comparison selection. Hover and zoom do not mutate a financial plan.           |
| Edit transactions    | `state/store.ts`; new draft/transaction module                                                                             | Preview, apply, discard, scenario save, grouped undo and explicit persistence status. Keep transient draft state out of sync.                                            |
| Result orchestration | `engine/useResults.ts`, `pool.ts`, `worker.ts`                                                                             | Result envelopes with plan/scenario/revision/job identity, status, stale/partial flags, timestamps and errors.                                                           |
| Metric view models   | New `lib/metrics/`; existing `results.ts`, `lib/outcome.ts`                                                                | Shared selectors and definitions for chart, table, inspector and export.                                                                                                 |
| QA                   | `tests/e2e/specs/layout.spec.ts`, `core.spec.ts`, `a11y.spec.ts`, `tours.spec.ts`                                          | Visual snapshots and meaningful workflow tests, with plot readability replacing fit-only assertions.                                                                     |

### State and calculation rules

- Separate persisted plan, draft transaction, workspace view state and result cache. A hovered year must never trigger a simulation or IndexedDB write.
- Key results by plan/scenario revision, engine/data version and simulation parameters. Replace the current timestamp-plus-serialized-length key as the durable identity strategy; serialized length is not a content hash.
- Cancel obsolete work where possible and ignore every late result whose request identity no longer matches. Backtest and comparison results need the same discipline as deterministic projection.
- Keep the last successful result visible for the same plan while updating, clearly marked. Never carry another plan's success percentage across a switch without an explicit stale label.
- Coalesce drag previews to the newest request and a bounded cadence, initially around 50–100ms pending profiling. Commit only at explicit transaction boundaries. Keep the deterministic worker responsive while simulations run; test single-worker devices too.
- Reuse unchanged chart instances and update series by stable IDs. Preserve legend selections, zoom and pinned year; use explicit removal/replacement semantics when series disappear. A full reset remains appropriate for incompatible chart structures.
- Keep Sankey category order deterministic across adjacent years. Use chart-native behavior first; stable layout plus a short crossfade is acceptable if native geometry morphing cannot be made reliable. Do not promise unsupported animation.
- Synchronize chart and timeline using one domain/scale contract. Separate transient hover preview from pinned selection so inspecting a tooltip does not unexpectedly overwrite the user's context.
- Validate scenario patch targets. Before permitting structural edits, use entity-ID-based changes or versioned rebasing; old scenario formats require migration and recovery fixtures.

## 10. Delivery roadmap

Estimates are engineering workdays for a developer familiar with the repository, with design review and some QA support. They are planning ranges, not measured delivery promises. The core scope totals roughly 40–59 workdays, or about 8–12 working weeks for one full-time developer; broader modeling features are separate.

| Phase                               | Effort    | Deliverables                                                                                                                   | Exit gate                                                                                            |
| ----------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| 0 — Baseline and contracts          | 3–4 days  | Reconcile design policy, agree metric semantics, fixed sample fixtures, screenshots and input-to-paint instrumentation.        | Reproducible baseline and approved implementation scope; no ambiguity about units or draft behavior. |
| 1 — Visual system and composition   | 5–7 days  | High-fidelity desktop/light, desktop/dark and mobile layouts; token/component gallery; shell and readable chart frame.         | Projection layout satisfies chart-area, text, focus and responsive criteria.                         |
| 2 — Complete planning interaction   | 8–12 days | Draft transaction layer, integrated timeline, contextual editor, synchronized year and before/after outcomes.                  | Retirement vertical slice works end to end, including discard, scenario save, undo and reload.       |
| 3 — Analysis visualization suite    | 8–12 days | Cash flow, taxes, outcomes, history and estate on the shared interaction layer; metrics/table parity.                          | Chart/inspector/table values reconcile; no stale result can be mistaken for current output.          |
| 4 — Compare and remaining workflows | 7–10 days | Scenario comparison, account/income/spending/strategy editors, progress, reports and onboarding finish.                        | Complete common workflows with coherent keyboard and touch behavior.                                 |
| 5 — Release polish and regression   | 9–14 days | Accessibility, dark/mobile/zoom pass, visual regression, performance profiling, export QA and migration/rollback verification. | Quality scorecard and existing financial validation gates pass.                                      |

Recommended pull-request sequence: design-policy/fixtures; tokens/component gallery; workspace shell; metric/result identities; draft transactions; projection/timeline vertical slice; Sankey/taxes; outcomes/history/estate; comparison and scenario migration; remaining editors/reports; release hardening. Keep each PR runnable. Merge the metric and transaction foundations before wiring dependent views.

Optional subsequent work: detailed Monte Carlo trial replay, configurable chart metrics, multi-variable sensitivity heatmaps, goal-seeking solvers and broad tax optimization. Scope and estimate these after confirming engine support and data requirements. Do not hide them inside the visual-redesign estimate.

## 11. Measurable quality bar

These are proposed acceptance targets. Current results were not benchmarked against them in this review.

| Category              | Target and verification                                                                                                                                                                                                |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Visual hierarchy      | Main plot and four key outcomes visible at 1440 × 900; protected plotting minima at 1366 × 768. No duplicate primary navigation, clipped labels or obscured key actions.                                               |
| Responsive design     | Exercise 360/390px phone, 768px tablet, 1280/1366px laptop, 1440/1920px desktop and 200% zoom. No unintended page-wide horizontal overflow. Tables may scroll within labeled regions.                                  |
| Input responsiveness  | p95 feedback within 100ms; p95 warm deterministic input-to-visible-result within 200ms on the agreed reference laptop/sample. Measure end to end, not worker time alone.                                               |
| Animation             | Aim for 60fps on the reference laptop; profile a repeated scrub/drag and inspect long tasks and dropped frames. Degrade animation complexity before delaying input.                                                    |
| Background simulation | Visible progress, cancel and retry; deterministic editing remains responsive. First progress target within 1s for a warm standard 1,000-run example, subject to baseline measurement. Partial results labeled.         |
| Loading               | Preserve layout with sized placeholders. Existing initial-JS gzip budget of 250KB remains; lazy-load charts and heavy editors. Track font bytes separately.                                                            |
| Web performance       | Preserve existing LCP ≤2.5s, CLS ≤0.1 and TBT ≤200ms targets on the defined test profile; add interaction measurements for the planning flow.                                                                          |
| Accessibility         | Target WCAG 2.2 AA; measured contrast, visible focus, meaningful labels, keyboard equivalents, accessible dialogs/sheets, reduced motion and chart/table alternatives. Automated scans are necessary but insufficient. |
| Numeric trust         | Chart, tooltip, inspector, table and export use identical selectors. Assert balances/flows and scenario deltas against engine outputs with explicit rounding tolerances.                                               |
| Transaction safety    | One drag = one undo step; discard leaves baseline untouched; failed save does not display “Saved”; reload restores committed state.                                                                                    |
| Result safety         | Rapid edits, scenario switches, cancellation and worker errors never attach one revision's numbers to another revision's labels.                                                                                       |
| Product completeness  | Loading, empty, invalid, error, stale, partial, shortfall, no-FI, long-name, many-event and large-account states are designed, not left to default markup.                                                             |

ECharts' ARIA descriptions and decal support can supplement accessibility, but cannot replace keyboard interaction and equivalent structured data. Use the official [accessibility guide](https://echarts.apache.org/handbook/en/best-practices/aria/) and verify options against the installed version.

## 12. Validation, rollout and first implementation brief

Create deterministic fixtures for a simple individual, early-retirement couple, high-debt/shortfall household, near-retirement household, no-income/zero-assets plan, long labels, dense milestones and extreme wealth distributions. Freeze input dates and simulation seeds for snapshots. Include mismatched scenario horizons and account removal/reordering in comparison tests.

Test the behaviors that create risk: chart/year synchronization; drag cancellation; one-step undo; monetary input parsing; calculation provenance; stale/partial result handling; old-scenario migration; chart/table/export parity; focus return; keyboard-only editing; screen-reader announcements; touch selection and reduced motion. Preserve existing engine/property/data-validation tests. New cosmetic tokens do not need tests that merely mirror their constants.

For implementation PRs, run the repository's relevant lint, typecheck, unit and validation gates, then production build, local Playwright/tour/axe checks and Lighthouse as applicable. Browser tests currently run locally rather than in CI; decide explicitly whether to move a small stable smoke/visual suite into CI. Replace fit-only layout assertions with bounding boxes for the actual plotting area, useful label space and visible controls. Use fixed datasets and disabled motion for screenshot baselines, then a separate motion pass.

Roll out behind a local settings flag or preview route while the vertical slice matures. Keep old routes and persisted plan schemas usable. If scenario storage changes, snapshot before migration and verify rollback/import/export with old fixtures. Remove the temporary flag and obsolete styling only after the new experience covers the full supported workflow matrix.

**First implementation brief:** build the new Plan/Projection workspace using the fictional couple fixture; make retirement editing transactional; place timeline and year detail beside a readable projection; show baseline/draft differences; save the draft as a scenario; prove undo, discard, keyboard access, narrow-screen behavior and numeric parity. Complete this interaction to the intended visual standard before extending the shell to every screen.
