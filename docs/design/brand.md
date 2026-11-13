# Longview Planner design system

Updated November 11, 2026. [The premium UX plan](../../plan/PREMIUM_UX_UPGRADE.md) is the implementation specification. It supersedes the earlier differentiation policy.

## 1. Identity and language

Longview retains its own name, assets, line icons and original explanatory copy. Reference research stays local and out of the shipped bundle. Evaluate quality, precision and interaction continuity against the reference experience. Similar composition, contextual editors and event icons are welcome where they improve the task.

Use sentence case, explicit units and tabular numerals. Describe estimated outcomes and tradeoffs without declaring a life choice safe or objectively better. Distinguish expected-return projections from simulation probabilities, retirement from financial independence, and actuals from forecasts.

## 2. Tokens and composition

The workspace uses light neutral #F4F6FA, white panels, #172033 text, indigo #4F5DD5 primary actions and teal financial emphasis. Navigation uses slate #202C40. Dark surfaces use #101827 and #182336 with theme-specific text, action and chart contrast. Semantic risk colors remain red and amber. Tokens live in packages/ui/src/styles.css.

Use self-hosted licensed Inter Variable with system fallbacks. Body text is 14–16px; secondary text 12–13px; headings 24–28px; outcomes 28–36px. Controls are 36–40px on desktop and at least 44px for touch. Cards use 12–16px radii and restrained elevation; inputs use persistent labels.

Navigation is approximately 216px wide and the top bar 56px high. Content uses 24px outer padding. Four compact outcome metrics lead to a protected chart plotting area: 360–440px at 1440×900 and at least 280px at 1366×768. Measure the data plot, not its card. Detail may scroll. At 200% zoom, natural reflow takes precedence over fitting a viewport.

## 3. Navigation and editing

Five primary destinations: Overview, Plan, Compare, Progress and Reports. Help and Settings stay in the lower navigation. Existing URLs remain usable. Plan contains Projection, Cash flow, Taxes, Outcomes, History and Estate, plus full-width Plan inputs. A compact toolbar and contextual input rail are part of the main workflow.

Keep saved plan, draft, result ownership and view state distinct. Hover previews; selection pins a year across analysis screens. Draft editing shows a dashed baseline and signed changes. Apply creates one undo entry, Save as scenario preserves the baseline, and Discard leaves it untouched. Closing an editor never implicitly applies changes. Pointer cancellation and Escape restore the pre-gesture draft.

On narrower screens use a drawer or sheet before compressing the plot. Phones use a single column, year stepper, chart selection, equivalent structured data and a bottom sheet with explicit actions. Controls retain keyboard equivalents and focus return.

## 4. Financial charts

Use semantic colors for cash, taxable, pre-tax, Roth, HSA, property, debt, income, expense, tax, baseline and draft. Labels and line styles supplement color. Annual data uses straight or step segments, never invented smoothed intermediate values. Use stable series identities and preserve legend selection and zoom. Timeline markers share the chart domain; dense events stay selectable.

Balances use year-end CPI; annual flows use annual CPI. Calculations precede formatting. Chart, tooltip, inspector, table and exports share metric definitions. Missing comparison data is not zero. Rates use percentage points for differences. Taxable/cash step-up excludes HSA and other account classes.

## 5. Motion and accessibility

Use 100–140ms feedback, 180–220ms panel transitions and 180–260ms projection updates. Direct manipulation tracks directly without easing lag. Reduced motion removes transitions while preserving focus behavior. No decorative continuous motion, spring overshoot or animated numerical counters.

Target WCAG 2.2 AA with measured contrast, visible focus, accessible dialogs, local validation, keyboard interactions, readable touch targets and chart/table alternatives. Automated scans supplement keyboard, touch and screen-reader review.

## 6. Review gate

Use the quality checklist in reference-map.md and the full workflow/verification matrix in PREMIUM_UX_UPGRADE.md. Screens are complete only after responsive, theme, numeric, transaction and result-ownership evidence is recorded. Visual resemblance is not a rejection criterion. Do not ship reference images or copy.
