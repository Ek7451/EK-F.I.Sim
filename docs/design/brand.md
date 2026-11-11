# Longview: brand and design decisions

This is the design decisions document called for in plan §10 and §11 (`docs/design/`). It records what the
product is called, how it looks, how it is organised and how it speaks. `packages/ui` implements these
decisions as tokens and components; when the two disagree, fix one of them in the same PR.

The companion document [reference-map.md](reference-map.md) records, screen by screen, how these decisions
make Longview differ from the ProjectionLab reference board (plan §10.1).

## 1. Name

**Longview.** The repository and package scope keep the working name (`EK-F.I.Sim`, `@fisim/*`); the name
users see is Longview everywhere: app title, PWA manifest, PDF report header, export file names.

Why this name: the app's job is to help someone look a long way ahead and stay calm about it. The name says
that without using "FI", "lab", "projection", "plan" or any other word that leans on another product.

Rules:

- One word, capital L only. No tagline lock-up, no mascot.
- The mark is typographic: the word set in the display serif. No pictorial logo for v1.0.
- Never place the name next to another product's name in the UI. The reference product is not named
  anywhere in the app, the reports or the tours.

## 2. Visual language: paper and ink

The app should feel like a well-kept ledger or a printed annual statement, not a software dashboard.

### 2.1 Palette intent

Token names and exact values live in `packages/ui`. This table fixes the intent so that any value change can
be judged against it.

| Role                | Light theme                                     | Dark theme                        | Notes                                                                                                           |
| ------------------- | ----------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Page background     | Warm off-white "paper"                          | Deep ink-navy                     | Never pure white or neutral near-black. The warmth (light) and the blue cast (dark) are the identity.           |
| Surface             | Paper, one step lighter or darker than the page | Ink, one step lighter             | Surfaces are separated by hairline rules and spacing first, elevation last.                                     |
| Text                | Ink (near-black navy)                           | Paper (warm off-white)            | Body text meets WCAG 2.2 AA (4.5:1) on every surface.                                                           |
| Primary             | Evergreen                                       | Evergreen, lightened for contrast | Primary actions, the selected navigation item, the "your plan" series in charts.                                |
| Accent              | Ochre                                           | Ochre                             | Used sparingly: the single thing to notice on a screen (a milestone marker, a changed value, a focused series). |
| Caution / shortfall | Brick (a muted red-brown)                       | Brick, lightened                  | Shortfalls and failed runs. Always paired with a text label or pattern; never colour alone.                     |
| Projected data      | Ink at reduced strength plus a hatch pattern    | Same                              | Marks `projected` parameters (plan §1.3, TAX-13). Enacted values get no decoration.                             |

Rules:

- No blue primary, no teal success colour, no saturated rainbow categorical palette, no gradients on
  surfaces or borders, no translucent "glass" panels.
- Semantic colour is never the only signal. Each state also has a word, an icon shape or a pattern.
- The chart palette (section 4) is derived from the same four families: evergreen, ochre, ink and brick,
  plus two muted earth tones. It is defined once and shared by every chart.

### 2.2 Type

- **System fonts only.** No web-font download: it keeps the first load small (plan §13), works offline and
  sends no request to a third party (plan §2.7, §12.1 CSP).
- **Text:** the platform UI sans-serif stack.
- **Display numerals and headings:** the platform serif stack. Key numbers (net worth, chance of success,
  a year's tax) are set in the serif at a large size with old-style proportions where the platform font
  offers them.
- **Tables and anything compared digit by digit:** tabular lining numerals.
- No all-caps letter-spaced micro-labels. Labels are sentence case, at normal tracking.
- Scale, line heights and weights are tokens in `packages/ui`. Two weights are normally enough: regular and
  semibold.

### 2.3 Shape, depth and density

- Small corner radii. Cards look like sheets of paper, not pills.
- Hairline rules and whitespace do the grouping. Shadows are reserved for things that really float:
  popovers, bottom sheets, the tour step.
- Inputs are outlined with the label above the field, always visible. No filled grey fields with floating
  labels.
- Fewer, calmer screens over dense ones: each screen answers one question, with detail one tap away.

### 2.4 Iconography

- A small, single-weight line-icon set drawn for the product. Icons support labels; they never replace
  them.
- No coloured icon badges as the identity of an item. An account, an income or a milestone is identified by
  its name and a short type label in text.
- No pictorial illustrations of people, palm trees, flags and the like for life events. Milestones are
  typographic markers.

### 2.5 Motion

Plan UX-06. Motion explains a change (a chart easing to its new shape after an edit, a sheet arriving from
the bottom). Nothing loops and nothing decorates. `prefers-reduced-motion` turns every non-essential
transition into a cut.

## 3. Information architecture

The navigation is built from the questions a user brings, in the order they naturally arise. It is not a
list of plan tabs.

| Task         | Question it answers                                   | Routes                                                                                                                                             |
| ------------ | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Home**     | Where do I stand, and what changed?                   | `/`                                                                                                                                                |
| **Plan**     | What is true about my household and what do I intend? | `/plan/household`, `/plan/snapshot`, `/plan/income`, `/plan/spending`, `/plan/timeline`, `/plan/strategy`, `/plan/healthcare`, `/plan/assumptions` |
| **Explore**  | What does that lead to?                               | `/explore/projection`, `/explore/cashflow`, `/explore/taxes`, `/explore/success`, `/explore/history`, `/explore/estate`                            |
| **Compare**  | What if I did it differently?                         | `/compare`                                                                                                                                         |
| **Track**    | Am I on course?                                       | `/track`                                                                                                                                           |
| **Reports**  | What can I take away?                                 | `/reports`                                                                                                                                         |
| **Help**     | How do I use this, and how is it calculated?          | `/help/tours`, `/help/methods`                                                                                                                     |
| **Settings** | Where does my data live?                              | `/settings`                                                                                                                                        |

Decisions and reasons:

- **Inputs and results are separate groups.** Everything you tell the app lives under Plan; everything the
  app tells you lives under Explore. A user always knows whether they are stating a fact or reading a
  consequence. Results screens link back to the exact input that drives a number.
- **The plan is a context, not a destination.** A plan switcher sits at the top of the navigation. Every
  Plan, Explore, Compare and Track screen shows the selected plan. There is no "all plans" dashboard of
  preview cards.
- **Home is a statement, not a dashboard.** It shows a handful of key numbers in large serif numerals and a
  plain-language "what changed" strip (for example: what the last edit did to the chance of success, or
  which data year became enacted). No draggable widgets, no chart wall.
- **Strategy is one place.** Cash-flow priorities, withdrawal order, Roth conversions, harvesting and
  spending rules sit together at `/plan/strategy`, because they are all answers to "how should money
  move?". They are stated intentions, so they belong with inputs.
- **Healthcare is first-class.** `/plan/healthcare` is its own screen with a coverage timeline, because the
  bridge to Medicare is the central problem for an early retiree (plan §9), not an expense sub-type.
- **History and chance are separate screens.** `/explore/success` (Monte Carlo) and `/explore/history`
  (backtest by start year) answer different questions and use different pictures.
- **Methods are public.** `/help/methods` ("How this is calculated", RPT-06) is a top-level help
  destination and is linked from every explained number.

### 3.1 Layout by device

- **Desktop (designed at 1440 px):** a left rail grouped by the tasks above, with the plan switcher on top.
  Content sits in a single reading column with an optional side panel. No persistent top tab bar and no
  permanent input drawer under the chart.
- **Phone (designed at 360 px):** bottom navigation with five destinations: Home, Plan, Explore, Compare,
  More. Track, Reports, Help and Settings live under More. Editors open as bottom sheets. Tour steps are
  bottom-sheet cards (plan §10.2).
- Both sizes are designed together for every screen (plan §10). Nothing is desktop-only.

## 4. Chart styling principles

Charts are built on ECharts with our own theme layer (decision D3). These rules apply to every chart.

1. **Ink first.** Axes, labels and the primary series are ink on paper. Colour is added only where it
   separates things the reader must tell apart.
2. **One palette, six steps.** Evergreen, ochre, ink, brick and two muted earth tones. If a chart needs more
   than six categories, group the rest as "Other" and offer the data table.
3. **Label directly.** Series are labelled at the end of the line or inside the band. A separate legend box
   is a fallback for small screens only.
4. **Quiet scaffolding.** Solid hairline gridlines at low contrast on the value axis only; no chart border;
   no drop shadows; no gradient or translucent fills under lines. Areas are flat fills.
5. **Uncertainty is a band, not a dial.** Ranges are shown as nested percentile bands around a median line
   (10/25/50/75/90, plan SIM-02). A probability is stated as a sentence and a count ("912 of 1,000 runs"),
   never as a gauge.
6. **Milestones are annotations.** A thin vertical rule with a short text label on a rail beneath the plot.
   No floating pictorial icons over the data.
7. **Every number explains itself.** The tooltip shows the arithmetic behind the point and links to the
   matching entry in "How this is calculated" (plan §10, RPT-06). On touch, tap pins the tooltip.
8. **Estimated and projected are visible.** Values computed from `projected` parameters carry the hatch
   treatment and a footnote marker (plan §1.3).
9. **A table is always available.** Every chart has a "View as table" alternative with the same numbers
   (UX-09).
10. **Selection by brushing.** Time ranges are chosen by dragging on a slim overview strip (with keyboard
    equivalents), not by a row of preset range buttons.
11. **Comparison uses position and label first.** In Compare, scenarios are told apart by direct labels and
    a paired difference chart. Line dash style is not the primary encoding.
12. **Money formatting.** Whole dollars in tables; compact form (for example `$1.2M`) only in chart labels
    and Home. The basis (today's dollars or future dollars) is always stated in the chart subtitle.

## 5. Tone of voice

- **Plain and calm.** Short sentences, everyday words. Write as a careful friend who is good with numbers,
  not as a salesperson and not as a lawyer.
- **Estimates, said honestly.** Results are "estimated". Say "about" when precision is false. Never say
  "will"; say "in this projection" or "in 912 of 1,000 runs".
- **No verdicts on the person.** The app describes outcomes; it does not grade the user or the plan with
  labels such as good, bad, safe or failed-you. A shortfall is described as what happened and when: "money
  runs short in 2061, at age 88".
- **No advice.** Describe what a setting does and what changed. Do not tell the user what they should do
  (plan §1.3).
- **Name things by what they are.** Our own vocabulary, chosen for clarity:

  | Concept                          | Our term                                                       |
  | -------------------------------- | -------------------------------------------------------------- |
  | What you own and owe today       | Snapshot                                                       |
  | Life events that change the plan | Timeline, milestones                                           |
  | Where spare money goes           | Cash-flow priorities (the "surplus waterfall" in methods text) |
  | Order of drawing from accounts   | Withdrawal order                                               |
  | Monte Carlo result               | Chance of success, shown with the run count                    |
  | Historical backtest              | History                                                        |
  | Inflation-adjusted and nominal   | Today's dollars, future dollars                                |
  | Methodology panel                | How this is calculated                                         |
  | Actual balances against the plan | Track                                                          |

- **Sentence case** for every heading, button and label. No exclamation marks. No emoji.
- **Numbers before adjectives.** "Tax falls by about $4,200 a year" rather than "significant savings".
- **Errors say what happened and what to do next**, in that order, without blame.
- **Tour copy** follows plan §10.2: at most about 60 words a step, real numbers from the sample plan.
- **Disclaimers** use the exact wording in plan §1.3 and appear in the app footer, on first run and in every
  PDF report.

## 6. What we do not do

- No copied screens, layouts, icons, illustrations, palettes, product names or copy text from any other
  product (plan §1.3, §10.1 guardrails).
- No third-party fonts, scripts, analytics or embeds (plan §2.7).
- No dark patterns: no upsell, no nag, no streaks. The only reminder the app gives is to make a backup
  (plan §14.4).

## 7. Change control

A change to anything in sections 1 to 5 needs: an edit to this file, the matching token or component change
in `packages/ui`, and a re-run of the differentiation checklist in
[reference-map.md](reference-map.md#differentiation-checklist) for the screens it touches.
