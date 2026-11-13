# Longview Planner design system

Updated November 12, 2026. This revision ("First light") replaces the slate/indigo system of November 11. [The premium UX plan](../../plan/PREMIUM_UX_UPGRADE.md) remains the interaction specification; where it and this file disagree on appearance or motion, this file wins.

## 1. Identity and language

Longview retains its own name, assets, line icons and original explanatory copy. Reference research stays local and out of the shipped bundle. Evaluate quality, precision and interaction continuity against the reference experience; do not copy its screens, palette or artwork.

The picture behind the name is a long look toward a horizon at first light. That one idea supplies every loud element: a night-sky instrument panel for the things that are read first, and a dawn spectrum (indigo, violet, rose, amber) for the things that move forward in time. Everything else stays quiet paper so the figures carry the screen.

Use sentence case, explicit units and tabular numerals in tables and ledgers. Describe estimated outcomes and tradeoffs without declaring a life choice safe or objectively better. Distinguish expected-return projections from simulation probabilities, retirement from financial independence, and actuals from forecasts.

## 2. Tokens and composition

Tokens live in `packages/ui/src/styles.css`.

- **Dawn spectrum** (brand constants, same in both themes): indigo `#5B4DFF`, violet `#A14DFF`, rose `#FF4D94`, amber `#FFB02E`. `--grad-dawn` runs them left to right.
- **Night panel**: `#060818` to `#171C4D`, with its own ink and hairline tokens. Any element with `.lv-night`, a hero card or the KPI band re-scopes the ordinary tokens (`--ink`, `--surface`, `--primary`…) to night values, so components placed inside it need no special cases.
- **Light theme**: paper `#F2F2FB`, white panels, ink `#131432`, primary `#4A41E6` to `#7A3BF0`.
- **Dark theme**: `#070919` ground, `#10132E` panels, ink `#F0F1FF`, primary `#A99FFF`.
- Semantic risk colors remain red and amber. Financial chart colors are named by what they stand for (`--financial-cash`, `-taxable`, `-pretax`, `-roth`, `-hsa`, `-property`, `-debts`).

Type: self-hosted Bricolage Grotesque (variable, optical size) sets page titles, the brand and headline figures; self-hosted Inter Variable sets everything else. Both are OFL (see `apps/web/public/fonts/OFL.txt`). Figures that change while a year is scrubbed (the inspector, tables) stay in Inter with tabular numerals so they do not jitter. Body text is 14–16px; secondary text 12–13px; page titles 28–36px; headline figures 32–56px.

Shape: controls are capsules (38px, at least 44px for touch); inputs 10px radius with persistent labels; cards 18px; hero panels 26px. Shadows are tinted indigo, never neutral grey.

Where the night panel appears, and nowhere else:

1. The navigation rail (always night, with a faint star field).
2. The headline band of a screen: `KpiStrip`, or `Card variant="hero"` where a screen's first figures need more room (Overview, Outcomes, Taxes, History, Estate, What you have). One per screen.
3. The welcome banner.

The dawn gradient appears on: the primary button, the active rail marker, progress and slider fills, the hairline of first light on the headline band, and headline paths in charts (§4). It is not a background wash for ordinary cards.

Navigation is about 216px wide and the top bar 56px high. Four headline figures lead to a protected chart plotting area: at least 360px at 1440×900 and 280px at 1366×768, measured on the data plot, not its card. `tests/e2e/specs/layout.spec.ts` enforces this; changing the height of anything above the chart means re-measuring. At 200% zoom, natural reflow takes precedence over fitting a viewport.

## 3. Navigation and editing

Five primary destinations: Overview, Plan, Compare, Progress and Reports. Help and Settings stay in the lower navigation. Existing URLs remain usable. Plan contains Projection, Cash flow, Taxes, Outcomes, History and Estate, plus full-width Plan inputs. A compact toolbar and contextual input rail are part of the main workflow.

Keep saved plan, draft, result ownership and view state distinct. Hover previews; selection pins a year across analysis screens. Draft editing shows a dashed baseline and signed changes. Apply creates one undo entry, Save as scenario preserves the baseline, and Discard leaves it untouched. Closing an editor never implicitly applies changes. Pointer cancellation and Escape restore the pre-gesture draft.

On narrower screens use a drawer or sheet before compressing the plot. Phones use a single column, year stepper, chart selection, equivalent structured data and a bottom sheet with explicit actions. Controls retain keyboard equivalents and focus return.

## 4. Financial charts

Shared styling lives in `apps/web/src/charts/Chart.tsx`: `axis`, `tooltip` and `tooltipCard` (a frosted-glass card), `areaSeries`, `barFill`, and the headline-path helpers `dawn`, `dawnLine`, `dawnFill`.

- A plan's headline path (net worth on Overview and in net-worth mode, the simulation median) takes the dawn stroke with a soft bloom: indigo at the start of the plan, amber at its end. In stacked account view the total stays an ink line, because there the layers carry the color.
- Stacked layers use the named financial colors at high density; single series fade toward the axis.
- Annual data uses straight or step segments, never invented smoothed intermediate values. Use stable series identities and preserve legend selection and zoom. Timeline markers share the chart domain; dense events stay selectable.
- Axis money goes through `short()` (sign before the dollar; k, M, B). Shares of runs go through `formatShare()` so 99.6% never prints as 100%.

Balances use year-end CPI; annual flows use annual CPI. Calculations precede formatting. Chart, tooltip, inspector, table and exports share metric definitions. Missing comparison data is not zero. Rates use percentage points for differences.

## 5. Motion and accessibility

Motion is allowed to be seen, in three places:

1. **Arrival of the headline band**: the hairline of first light sweeps across and each figure settles (about 0.6s, staggered 70ms). This is the one orchestrated moment per screen.
2. **Charts drawing in** (about 0.9s on first paint, 0.26s on updates) and the welcome banner's path drawing itself once.
3. **Answers to an action**: the sheen across a primary button on hover, cards lifting, the success dial filling as runs complete.

No looping decorative motion and no animated numerals: a figure is always its true value, so tests and screen readers never see a number mid-count. Direct manipulation tracks the pointer without easing. `prefers-reduced-motion` removes all of it while preserving focus behavior.

Target WCAG 2.2 AA with measured contrast, visible focus, accessible dialogs, local validation, keyboard interactions, readable touch targets and chart/table alternatives. Decorative artwork (the horizon, the dial, the journey line) is `aria-hidden`; the figure it pictures is always present as text. Automated scans supplement keyboard, touch and screen-reader review.

## 6. Review gate

Use the quality checklist in reference-map.md and the full workflow/verification matrix in PREMIUM_UX_UPGRADE.md. Screens are complete only after responsive, theme, numeric, transaction and result-ownership evidence is recorded. Do not ship reference images or copy.
