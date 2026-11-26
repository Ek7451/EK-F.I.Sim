# Mobile navigation and scrolling implementation plan

Give people a predictable place to edit their financial plan, read results, and manage the app. On a phone, the first tap from Home should take someone to all plan inputs. A person scrolling a chart should be able to continue reading or tap a destination without dismissing a floating value card first.

## Current behavior and evidence

| Finding | Implementation consequence |
| --- | --- |
| Photo 1 shows a hazy plan toolbar. Photo 2 shows page text in the status-bar area after scrolling. The app applies an 18px backdrop blur to both navigation bars. The phone header scrolls with the document, and its top safe-area padding scrolls away with it. | Treat header legibility and coverage behind the system status bar as two checks. Verify Safari and standalone behavior on a device before attributing all visible blur to CSS. |
| Photo 2 shows the 2072 chart detail crossing the bottom tabs. The chart tooltip already sets `confine: true`. | The chart can extend behind a fixed bar while its own tooltip remains inside the chart bounds. Test paint order, hit testing, and touch gestures. Investigate ordinary card boundaries separately if overlap remains after dismissing the tooltip. |
| The six phone controls are hard-coded in `Shell.tsx`. The desktop rail and phone More panel use `PRIMARY_NAV`. The primary Plan link opens Projection. The secondary Plan inputs link follows six results links in a horizontally scrolling row. | Changing one menu leaves other paths, active states, breadcrumbs, and tours inconsistent. Define destination ownership once and render the appropriate subset on each surface. |
| Home’s “Build the plan” advertises multiple inputs and opens the accounts page. Projection’s “Edit plan” opens a draft editor with retirement timing, market assumptions, and spending. | Send general edit links to the inputs directory. Give the draft action a name that covers what the editor actually does. |
| Device settings, saved plan settings, and temporary chart controls have different storage and side effects. | Name each entry by task and retain its existing owner. Moving a chart control must not accidentally write to a saved plan or start a calculation. |

## Destination and control map

| Phone destination | URL or action | What the user finds |
| --- | --- | --- |
| Home | `/` | Current plan overview. Put a visible **Edit plan** link by the plan title, available while results are loading. |
| Edit plan | New `/plan` route | A single-column directory of all eight inputs. Links lead directly to existing editors. |
| Results | `/explore/projection` | Projection opens first. A visible **Results pages** control lists Projection, Cash flow, Taxes, Outcomes, History, and Estate. Show the current page name when closed. |
| Compare | `/compare` | Existing scenario comparison. |
| More | Button opens the existing navigation panel | Progress and Reports first, followed by App settings and Help. Preserve access to guided tours, calculation methods, and release information through their existing paths. |

**Input directory.** Use real links with visible names. Use a short description only where it helps someone decide. The working labels below can be checked in a first-use walkthrough before release.

| Label | Existing route | What belongs here |
| --- | --- | --- |
| Household | `/plan/household` | People, residence, filing status, Social Security |
| Accounts, assets and debts | `/plan/snapshot` | Balances, property, loans, and account contributions |
| Income | `/plan/income` | Jobs and other income streams |
| Spending | `/plan/spending` | Recurring and one-time expenses |
| Timeline and milestones | `/plan/timeline` | Retirement dates and other life events |
| Saving and withdrawal strategy | `/plan/strategy` | Surplus savings, withdrawal order, and whether the HSA pays medical bills |
| Healthcare | `/plan/healthcare` | Coverage and care costs |
| Assumptions and plan settings | `/plan/assumptions` | Returns, inflation, plan name, start year, dollar display, and timing |

**Settings ownership.** Use **Chart options** beside the chart for display mode and axis choices. Keep the current chart choice and access to its data table visible. Keep year details and editing as distinct actions. Put theme, account, backup, recovery, sync, and device controls under **App settings**. Its existing plan-management card can continue to handle managing saved plans. The top plan-name menu keeps switching and creating plans. The account menu keeps sign-in and account actions. Audit the public-cloud phone toolbar and the local-only toolbar separately. Move duplicate theme controls to App settings, retain reachable Undo, Redo, and page tours, and give the remaining toolbar menu a descriptive accessible name.

## Implementation sequence

### 1. Reproduce both photographs and establish a baseline

- Use a bundled two-person plan with a long name in dark mode, select Home → Cash flow, scroll until the chart intersects the bottom bar, tap near the lower edge, then swipe the chart and tap a bottom destination. Record the build, device, viewport, browser or installed mode, visible year, scroll position, and which element receives the tap. A synthetic fixture is sufficient for committed screenshots.
- Capture the header before scrolling, after the toolbar has left the viewport, during overscroll, and with Safari’s controls expanded and collapsed. Repeat with the account control visible. Compare the app-owned safe area with browser-owned chrome.
- Inspect chart tooltip parent and computed stacking contexts, the header background, the bottom bar, and card rectangles before and after interaction. Check whether the report includes a second overlap between ordinary cards. Record each reproducible failure with a corresponding acceptance test.
- **Exit condition.** A developer can replay both reported symptoms or identify precisely which symptom still requires a physical-device check. The remaining navigation work can proceed independently.

### 2. Fix the mobile shell and scrolling

- Work in `apps/web/src/app.css`, `shell/Shell.tsx`, and `main.tsx`. Keep the mobile toolbar in normal document flow to preserve reading space. Give it a solid theme surface. Keep an opaque backdrop behind the OS status-bar inset during scroll and bounce, with pointer events disabled on any decorative cover. Paint the tab bar and bottom safe area as one solid surface.
- Give the shell one source for the occupied bottom-bar height including the safe area. Use it for final-content clearance, scroll padding, toasts, and the tour prompt. Count the inset once. Reconcile existing separate offsets for the content, footer, open rail, draft bar, and sticky actions. Check left and right insets in landscape.
- Establish the relative layer order with real interactions. Page content and chart details sit below navigation. The open More panel accepts interaction and the underlying page is inert. Intentional modal dialogs, account menus, and tour controls remain usable above their appropriate surface. Reuse the shared dialog focus handling. Apply chart containment to the smallest necessary container so it cannot clip menus, focus rings, sheets, or sticky children.
- Use the existing visual viewport variables for short screens and the on-screen keyboard. Reconcile the initial theme color in `index.html`, the live theme update in `main.tsx`, and standalone launch colors in `vite.config.ts`. Check a live system light/dark change while the theme is set to System. Preserve the print stylesheet and verify exported reports.
- **Exit condition.** Toolbar text stays sharp, a scrolling page title stays out of the status area, the last action on a page is reachable, and tapping a visible tab opens it on the first attempt. Verify with the keyboard open, a long plan name, a scenario badge, and a failed-save notice.

### 3. Repair chart interaction with explicit behavior for each chart

- Start with Home in `pages/Home.tsx` and the shared wrapper in `charts/Chart.tsx`. On touch, a deliberate tap selects the nearest year. Show that year, ages, series labels, amounts, and any meaningful notes in document flow within the card. Reuse Home’s existing selected-year strip and the active view’s row definitions for a single detail experience. Cash flow must retain the amounts for Income, Withdrawals, and Spending and taxes. Preserve each view’s existing unit, rounding, and total rules.
- A vertical swipe scrolls the document. A canceled gesture leaves the prior year selected. Check actual touch events, including synthesized mouse events, so a swipe cannot pin a year, open a sheet, or leave a hover value overriding a deliberate tap. Suppress the floating tooltip on touch wherever an equivalent detail view exists. Keep precise-pointer hover and keyboard selection available on hybrid devices. Test the wrapper’s explicit keyboard `showTip` action as well as ECharts’ automatic tooltip.
- Reserve space or use the existing detail region so selecting another year leaves the plot stable. Keep the full table and a keyboard path to the same numbers. Use plan-scoped selected years from `state/workspace.ts`. Clear transient hover on chart, plan, or input-method changes and resolve an out-of-range year against the new result. Respect the existing Home view preference in session storage.
- Roll the shared change through every chart consumer using the matrix below. Opt in where tap behavior is understood. If a chart depends on a tooltip for unique information, first supply an accessible equivalent or contain its tooltip below the shell. Check every default and per-series formatter before broadening the behavior.

| Chart family | Behavior to preserve and verify |
| --- | --- |
| Home’s five views | Same values and units across plot, inline detail, and table. Home always reports today’s dollars. Links from the chart still reach the matching analysis. |
| Projection | Selected year, zoom window, age/year axis, timeline alignment, and existing year inspector. Deliberate selection can open the compact sheet. A swipe leaves it closed. |
| Cash flow and Taxes | A tap on a segment retains its breakdown or drilldown. Distinguish mark clicks from year selection. Preserve percentage and currency formatting on mixed-axis tax charts. |
| History and Outcomes | Historical lines select a start-year cohort. Distribution bins and percentile paths have their own units. A data index has different meanings on these charts. |
| Compare, Progress, Reports, Estate, Income/Spending, and Strategy | Preserve scenario names, actual versus projected values, totals, legends, and table access where offered. Check long labels, empty data, and report print output. |

**Exit condition.** A tap yields the intended information, a swipe scrolls, and a tab remains tappable throughout. Repeated selection, table toggles, theme changes, and rotation preserve the plot. Per-year selection and chart options create zero plan revisions, undo entries, or fresh simulation requests solely for the view change.

### 4. Introduce the input directory and change navigation together

- Add the lazy `/plan` route under `RequirePlan` in `App.tsx`. Build the directory from the input entries in `shell/nav.ts`. Reuse route metadata for Home, the rail, More, breadcrumbs, section links, accessible names, and active state. Replace the current special case that matches the visible text “Plan” and the six hard-coded mobile items.
- On each input screen show its heading and an **All plan inputs** link. On phone results pages use the labeled results selector from the destination map. Today `PageHead` hides grouped headings visually because it relies on the active pill. Change the heading and navigation together. Keep desktop section switching efficient and the collapsed rail labels accessible.
- Highlight Edit plan on `/plan` and its descendants and Results on `/explore/*`. For a More destination, indicate the current section on the button and the exact page inside the panel. Keep expanded state distinct from route selection. Handle repeat taps, selection of the current item, Escape, browser Back/Forward, rotation across the 900px shell breakpoint, and focus restoration on dismissal. On successful navigation move focus to the destination heading or main landmark.
- Keep `/track`, `/reports`, `/settings/recovery`, `/settings#cloud-account`, and all current editor and analysis URLs working from bookmarks and reloads. Exercise `/plan/income?edit=…` and `/plan/spending?edit=…` from timeline and contribution links. Route-level scroll behavior must honor anchors, entity editors, tour positioning, and history restoration.
- Replace Home’s duplicate generic “Build the plan” card with the prominent Edit plan entry. Keep contextual links for recorded balances, outcome testing, comparison, and backup status where their context helps. Make the hero’s “Explore a change” lead to an explicit preview action or label it **View projection** if it only opens that page.
- **Exit condition.** From Home, the actual taps **Edit plan → Income → Edit [income name]** open that income. **Edit plan → Saving and withdrawal strategy** reveals where to change HSA use. **More → Reports** and **More → App settings** each take two taps. All eight input sections and all six results pages can be found without horizontal searching.

### 5. Protect draft and account state at the new entry points

- Use **Preview changes** for the full Projection editor. The existing editor also changes inflation, expected returns, and spending. Use **Edit retirement timing** only for an action that actually lands on that milestone. Update both Projection triggers, the inspector title, and its “All plan inputs” link in `pages/workspace/PlanningTools.tsx`. Handle plans with multiple retirement milestones or none.
- Reuse `state/draft.ts` and the existing Apply, Save as scenario, Discard, and Undo behaviors. Opening the directory or browsing results is view-only. Closing the preview sheet retains its draft. If a user holding a draft starts a direct-saving edit that would invalidate the draft’s base revision, give them the existing resolution choices before the first conflicting write. Ordinary browsing should proceed immediately. Cover timeline drafts, invalid text still in an editor, save failures, external revision conflicts, and plan switches.
- Check selected-scenario behavior at the editor boundary. Draft edits already check `scenarioId`, while the direct store update path checks read-only metadata and sandbox state. When viewing a scenario, explicitly offer **Edit base plan** before entering a base-editing flow. Do not accidentally modify the base through a new shortcut or a bookmarked input URL. Keep scenario management in Compare working. Test with two plans that have matching entity IDs.
- Exercise first-run setup, sample-tour sandbox, observe-only tours, and recovery-only records. The directory requires an active plan. App settings, sign-in, help, and recovery remain reachable before setup. Keep save-error retry and update-ready actions accessible when condensing the toolbar. Check auth menus signed in and signed out in public-cloud mode and confirm local-only mode exposes its device and sync controls.
- **Exit condition.** A plain navigation round trip leaves the saved plan, undo history, active scenario, and draft contents intact. Apply changes exactly once. Discard restores the baseline. A stale draft cannot overwrite a newer saved revision.

### 6. Update dependent guidance and release the change

- Update the welcome tour’s “Plan holds the projection and your inputs” step, Home’s hover instructions, theme and toolbar targets, Projection preview steps, and backup links in `tours/catalog.ts`. Give changed steps a visible target on phone and desktop. Preserve stable tour IDs and meaningful resume positions. Test focus, inert state, and positioning after More closes and after a tour exits.
- Update the app’s help text, settings headings, wizard handoff, recovery instructions that name old menus, and relevant user-facing docs. Include a short changeset naming where inputs, Progress, Reports, and App settings moved. Preserve release/version and recovery links.
- Build the production artifact. Check first load, direct reload of `/plan`, offline navigation after a cached visit, and update-from-previous-build with a draft open. Use the existing update prompt. Confirm the input directory does not pull every editor or the chart library into the initial bundle. Use the existing release-and-rollback runbook for deployment.

## Verification and release decisions

| Coverage | Implementation and pass criteria |
| --- | --- |
| Real navigation | Extend `tests/e2e/specs/core.spec.ts` and the route list in `helpers.ts`. Exercise the paths in step 4 by clicking visible controls. The existing `go()` helper pushes browser history and would miss broken or buried links. Check desktop and mobile active states, current-page announcements, titles, deep links, browser Back, no-plan redirects, and recovery access. |
| Scroll, layering and gestures | Extend `layout.spec.ts`. Start at touch coordinates inside the Home plot, swipe vertically and assert the document scrolls and selection stays unchanged. Tap the plot, check the inline year and numbers, then hit-test and tap each bottom destination. Intersect the chart with the bar intentionally. Check focused controls and the last item on a long form. Capture before/after screenshots for both reported positions. |
| State and data fidelity | Extend `workspace.spec.ts` and the result-safety coverage. Verify autosaved income survives reload and undo, drafts survive browsing, scenario previews and saved base values stay distinct, and year selection carries to other analyses for the same plan. Compare chart details with the table for the same fixture and year. Exercise delayed and failed recalculation with navigation still available. |
| Accessibility and findability | Extend `a11y.spec.ts` for the directory, More panel, chart detail, and results selector. Walk keyboard focus into and back from each overlay. Use VoiceOver to change year and identify the active section. Check 44 CSS-pixel touch targets, both themes, large text, 200% reflow, and reduced motion. Have a first-time user find income, HSA use, reports, and theme from Home without coaching. Record wrong turns and revise the relevant label or placement. |
| Device and breakpoint coverage | Exercise 320px and 390px phones, short landscape, tablet, 900/901px navigation switch, 1280/1281px inspector switch, and desktop. Test touch, mouse, and keyboard. Run a focused iPhone/WebKit project alongside current Chromium projects. On a physical iPhone check Safari with controls expanded/collapsed and the installed app, including scroll bounce, keyboard, orientation, and status text. Track a pending device check separately from automated passes. |
| Tours, performance and CI | Run the existing tours, accessibility, layout, and stress suites against the production build. CI currently installs Chromium and runs desktop smoke tests. Add a narrowly scoped WebKit/phone navigation and scroll smoke job with the matching browser install. Keep the Chromium-only CDP pinch test in its existing project. Inspect desktop and phone visual diffs before accepting baseline updates. Check the existing 250 KB initial JS budget. |

**Delivery order.** Review the shell and Home chart fixes first so the reported scrolling problem can ship independently. Deliver the route map, directory, new navigation, affected tour paths, and draft/scenario handling as one coherent user-facing change. Start navigation work after the route map is agreed in code review. Run regression tests with each change, then exercise the combined build on the device matrix. Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and the relevant `pnpm e2e` projects.

**Release decision.** Hold the affected change if ordinary scrolling opens an editor, a chart intercepts a tab tap, a primary task is unreachable, a saved revision changes during browsing, or an editor writes to the wrong plan. If the issue appears after release, revert the affected frontend change through the normal release process. Retain a working `/plan` destination or compatibility redirect if the directory has already shipped. This design requires frontend changes only and uses existing saved-plan and backup formats.
