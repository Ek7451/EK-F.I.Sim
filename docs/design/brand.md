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
- The mark is the Longview icon (a rising line on an emerald tile) beside the word, set semibold in the UI font.
- Never place the name next to another product's name in the UI. The reference product is not named
  anywhere in the app, the reports or the tours.

## 2. Visual language: a calm, modern instrument

Revised 2026-11 (review plan, Phase 4). The first release used a "paper and ink" look: warm off-white, serif
numerals, flat fills. Testing showed it read as dated and made dense results hard to scan. Longview now looks
like a polished modern dashboard: neutral surfaces, one confident emerald primary, clear hierarchy, and numbers
that are large where they matter and compact everywhere else. It keeps its own name, mark and palette and
borrows no other product's look (section 6 and the reference-map guardrails).

### 2.1 Palette intent

Token names and exact values live in `packages/ui/src/styles.css`. This table fixes the intent.

| Role            | Light theme                       | Dark theme                                  | Notes                                                                  |
| --------------- | --------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------- |
| Page background | Cool neutral grey (#F5F6F8)       | Near-black with a faint blue cast (#0F1115) | Cards sit on it as white (light) or one step lighter (dark).           |
| Surface         | White, with a hairline border     | #171A21, raised #1F232C                     | Elevation is a soft shadow plus the border, never a heavy drop shadow. |
| Text            | Near-black ink, two quieter steps | Off-white, two quieter steps                | Body and secondary text meet WCAG 2.2 AA (4.5:1) on every surface.     |
| Primary         | Emerald (#0B7A62)                 | Emerald, lightened (#34C29C)                | Primary actions, the selected navigation item, the headline series.    |
| Accent          | Amber                             | Amber                                       | Sparingly: the one thing to notice (a milestone, a changed value).     |
| Status          | Green, amber, red                 | Same hues, lightened                        | Always paired with a word or an icon; never colour alone.              |
| Projected data  | Reduced strength plus a hatch     | Same                                        | Marks `projected` parameters (plan §1.3, TAX-13).                      |

Rules:

- The primary is emerald, not blue. Blue appears only as one chart series.
- Gradients appear in one place only: the fill under a chart area, fading to transparent. Surfaces, borders
  and buttons are solid. No glass panels; the sticky top bar may blur what scrolls beneath it.
- Semantic colour is never the only signal.
- The chart palette (section 4) is eight validated hues, defined once and shared by every chart.

### 2.2 Type

- **System fonts, modern stack:** Inter when the device has it, then Segoe UI Variable, the platform UI font
  (SF Pro), Roboto. No web font is downloaded for now: it keeps the first load small, works offline and sends no
  third-party request (plan §2.7). The CSP already allows self-hosted fonts, so a bundled woff2 can be added
  later without a policy change.
- **One family** for text, headings and numerals. Headings are semibold with slightly tight tracking.
- **Numbers:** tabular lining numerals wherever money is shown. Hero figures (net worth, chance of success) are
  2.25 to 3rem semibold, card figures 1.5rem, table figures body size.
- **Labels** are sentence case, 12 to 13px, medium weight, in the secondary ink. No letter-spaced upper-case
  micro-labels.
- Scale: 12, 13, 14, 16, 20, 24, 32 and 44px.

### 2.3 Shape, depth and density

- Radius scale 6 (inputs, buttons), 10 (cards), 14 (dialogs) and 20 (hero panels).
- Three shadow levels (resting card, raised menu, dialog), plus a hover lift on interactive cards.
- Compact density: 36px inputs and buttons on desktop (44px on touch), an 8px grid, 16px card padding.
- **One screen, no scroll.** On a 1440×900 desktop, and on a 1366×768 laptop, each major screen shows its key
  visual and headline numbers without scrolling. Detail sits below the fold, behind tabs or in drawers.

### 2.4 Iconography

- One line-icon set drawn for Longview (24px grid, 1.8px stroke). Icons support labels and never replace
  them, except in the collapsed navigation rail, where each icon has a tooltip and an accessible name.
- **Icon tiles** identify item types (account, income, expense, milestone, debt): a line icon on a softly
  tinted square, always beside the item's name and type label.
- No pictorial illustrations and no emoji.

### 2.5 Motion

Plan UX-06. Motion explains a change (a chart easing to its new shape, a sheet arriving). Durations are 120
to 220ms. Nothing loops. `prefers-reduced-motion` turns every non-essential transition into a cut.

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
- **Home is a statement, not a dashboard.** It shows a handful of key numbers as large figures and a
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

Charts are built on ECharts with our own theme layer (`apps/web/src/charts/Chart.tsx`, decision D3).

1. **Eight hues in a fixed order:** emerald, blue, amber, violet, olive, rose, cyan, rust. Each is stepped
   separately for light and dark and checked for colour-vision separation and contrast. Colour follows the
   thing (pre-tax is always the same hue), never its rank. More than eight categories fold into "Other".
2. **Areas fade.** Stacked areas use a vertical gradient from the series colour to nearly transparent, with a
   2px line on top. Bars have 4px rounded data ends.
3. **A legend plus direct labels.** Two or more series always get a legend; up to four may also be labelled at
   the line end.
4. **Quiet scaffolding.** Solid hairline gridlines on the value axis only, no chart border, axis labels in the
   muted ink.
5. **Rich tooltips.** A card with a header (year and ages), a swatch row per series, bold values and a total
   line, and the arithmetic behind the point where it helps. A crosshair follows the pointer.
6. **Uncertainty is a band.** Ranges are nested percentile bands around a median line (10/25/50/75/90). The
   chance of success is a large percentage with the run count in words beside it; never a gauge or ring.
7. **Milestones are markers on a rail** beneath the plot: a small glyph and a label, spread apart when two fall
   in the same year.
8. **Estimated and projected are visible.** Values computed from `projected` parameters carry the hatch
   treatment and a footnote marker (plan §1.3).
9. **A table is always available** (UX-09).
10. **Time ranges** can be brushed on a slim strip or chosen with range chips (5Y, 10Y, 20Y, All).
11. **One value axis.** Never two y-scales.
12. **Money formatting.** Whole dollars in tables; compact form (`$1.2M`) in chart labels and stat tiles. The
    basis (today's or future dollars) is always stated.

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
  product (plan §1.3, §10.1 guardrails). Using a common convention (a stacked area chart, a row of key figures,
  an icon tile) is fine; reproducing another product's arrangement or colours is not.
- No third-party fonts, scripts, analytics or embeds (plan §2.7).
- No dark patterns: no upsell, no nag, no streaks. The only reminder the app gives is to make a backup
  (plan §14.4).

## 7. Change control

A change to anything in sections 1 to 5 needs: an edit to this file, the matching token or component change
in `packages/ui`, and a re-run of the differentiation checklist in
[reference-map.md](reference-map.md#differentiation-checklist) for the screens it touches.
