# Longview Planner

A personal finance scenario-modeling app: enter what you own, earn and spend, lay out the life events you
expect, and see where that leads, year by year, with taxes and healthcare costs estimated from versioned
public data. It runs in the browser as an installable PWA, keeps your data on your device, and can sync
between your devices with end-to-end encryption.

The repository's working name is **EK-F.I.Sim** (packages are scoped `@fisim/*`). The app is called
**Longview Planner** (Longview for short).

Status: in development. The full specification is the [build plan](plan/BUILD_PLAN.md); progress by feature
is in the [parity matrix](docs/parity-matrix.md).

## Disclaimers

- **For personal educational planning only. Not financial, tax, legal or medical advice.**
- Every result is an **estimate**. Parameters for future years are projected by indexing current law and
  are visibly marked as _projected_, as distinct from _enacted_ values.
- **Original name, copy and assets.** The chart-centered workspace follows the quality and interaction
  direction in the [premium UX specification](plan/PREMIUM_UX_UPGRADE.md).

The app is non-commercial and single-user. It never asks for Social Security numbers, account numbers or
credentials, links to no bank, and loads no ads, analytics or third-party scripts.

## What it does

- **Overview:** current position, retirement timing and the next planning decision.
- **Plan:** a selectable projection, integrated timeline and contextual draft editor, plus cash flow,
  taxes, simulation outcomes, historical cohorts and estate views. Full input forms remain available.
- **Compare** scenarios side by side, record actual balances in **Progress**, and produce PDF and CSV
  **Reports**.
- **Help:** guided tours on built-in sample plans, and a "How this is calculated" reference that cites the
  source, date and status of every dataset.

Scope, feature IDs and non-goals are in plan §1 and §4.

## Quick start

Requirements: **Node 22 or newer** and **pnpm 10** (the exact version is pinned in `package.json` under
`packageManager`; `corepack enable` will pick it up). Python 3.13 is needed only to regenerate the
Tax-Calculator test fixtures.

```sh
pnpm install            # install all workspace dependencies

pnpm dev                # start the web app (Vite dev server)

pnpm lint               # ESLint
pnpm format:check       # Prettier
pnpm typecheck          # tsc --noEmit in every package
pnpm test               # all Vitest projects (unit and property tests)
pnpm test:validation    # validation suite against published references (V-01 to V-09)
pnpm validate:data      # JSON-schema check of every dataset

pnpm build              # production build to apps/web/dist
pnpm preview            # serve the production build on http://localhost:4173

pnpm e2e                # Playwright: flows, guided tours and axe on phone, tablet and desktop sizes
pnpm bench              # engine benchmark, compared with packages/engine/bench/baseline.json
```

First time running the end-to-end tests, install the browsers:

```sh
pnpm --filter @fisim/e2e exec playwright install
```

The sync Worker runs locally with `pnpm --filter @fisim/sync-worker dev` (local D1 and R2 through
`wrangler dev`). The app works fully without it; sync is optional.

Data ingest scripts (`tools/ingest/*.ts`) run at authoring time, never in the client. `fred.ts` needs a
`FRED_API_KEY` in a local `.env`. See the [annual data update runbook](docs/runbooks/annual-data-update.md).

## Repository layout

```
apps/web/            React + Vite PWA: UI, state, Web Worker host, guided tours (src/tours/)
packages/engine/     Pure TypeScript simulation core: projection, tax, healthcare, Monte Carlo, backtest
packages/data/       Versioned JSON datasets with provenance headers, and their JSON Schemas
packages/ui/         Design system: tokens and accessible components
packages/crypto/     End-to-end encryption helpers (Web Crypto, Argon2 WASM)
workers/sync/        Cloudflare Worker sync API (D1 metadata, R2 ciphertext), migrations
tools/ingest/        Data ingestion scripts (Shiller, FRED, Damodaran, CMS)
tests/validation/    Validation suite against published research and oracles (Node, plus a Python oracle)
tests/e2e/           Playwright end-to-end, tour and accessibility tests
docs/                Runbooks, design decisions, parity matrix
plan/                Build plan, review, archive
.github/             CI, deploy and ingest workflows; Dependabot
research/            Local-only design reference material. Git-ignored; never committed or bundled
```

## How it is built and shipped

- **CI** (`.github/workflows/ci.yml`) runs on every pull request: lint and format, typecheck, dependency
  audit, unit and property tests, data validation, the validation suite, the Tax-Calculator fixture check,
  build with an initial-JS budget, the engine benchmark, and a Cloudflare Pages preview deploy.
- **Browser tests and Lighthouse run locally, not in CI:** `pnpm build && pnpm e2e` (Playwright: flows,
  tours, axe) and `pnpm build && pnpm lighthouse` (budgets in `lighthouserc.json`). Run both before a
  release.
- **Deploy** (`.github/workflows/deploy.yml`) runs the same checks on every push to `main`, then applies D1
  migrations and publishes the web app plus its account API to Cloudflare Pages when deployment credentials are configured.
- **Data ingest** (`.github/workflows/ingest.yml`) refreshes market history each January and on demand, and
  opens a pull request with the data diff.

## Documentation

Hosted app: [Longview Planner](https://longview-planner.pages.dev) (public; no sign-in required). Anyone can optionally create a username/password account in Settings for private encrypted cloud saving. See the [public cloud runbook](docs/runbooks/public-cloud.md) and [deployment record](docs/deployments/2026-11-12.md).

| Document                                                                       | What it covers                                                                                 |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| [plan/BUILD_PLAN.md](plan/BUILD_PLAN.md)                                       | The specification: goals, feature IDs, engine, data, security, delivery, roadmap, release gate |
| [docs/parity-matrix.md](docs/parity-matrix.md)                                 | Every feature ID with phase, status, implementation and tests                                  |
| [docs/design/brand.md](docs/design/brand.md)                                   | Name, palette intent, type, information architecture, chart principles, tone of voice          |
| [docs/design/reference-map.md](docs/design/reference-map.md)                   | Design reference map and quality/fidelity review checklist                                     |
| [docs/runbooks/cloudflare-setup.md](docs/runbooks/cloudflare-setup.md)         | One-time set-up: Pages, D1, R2, Access, GitHub secrets, branch protection                      |
| [docs/runbooks/annual-data-update.md](docs/runbooks/annual-data-update.md)     | Yearly data calendar, ingest steps, legislation watch, data release tags                       |
| [docs/runbooks/release-and-rollback.md](docs/runbooks/release-and-rollback.md) | App releases, rollback of Pages, Worker and D1, PWA update-flow test                           |
| [docs/runbooks/restore-drill.md](docs/runbooks/restore-drill.md)               | Quarterly restore drill from an encrypted export and from the recovery key                     |
| [docs/runbooks/security-review.md](docs/runbooks/security-review.md)           | Pre-release security review procedure                                                          |

## Privacy and security in brief

- Local-first: plans live in IndexedDB on your device. The app works offline.
- Optional sync is end-to-end encrypted. The server stores encrypted plans and wrapped keys, plus account credentials and synchronization metadata. Vault passphrases and unwrapped encryption keys stay on the device.
- A strict Content Security Policy, no third-party origins, a pinned lockfile and weekly dependency
  updates.
- Make an encrypted export from Settings as your own backup. The app will remind you.

Details: plan §12.

## License

Not yet decided (plan open item O2). Until a license is added, all rights are reserved.

The active UI implementation specification is [the premium UX upgrade](plan/PREMIUM_UX_UPGRADE.md). It defines the chart-centered workspace, transactional drafts, shared year selection, analysis suite and release verification gates. Progress and evidence are tracked in [UI implementation status](plan/UI_IMPLEMENTATION_STATUS.md).
