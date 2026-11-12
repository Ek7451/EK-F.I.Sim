# Runbook: one-time Cloudflare and GitHub set-up

Plan §14.1 and §14.2. Do this once, in Phase 1, before the first pull request needs a preview deploy. It
creates the hosting and sync resources for the **preview** and **production** environments, puts both
behind Cloudflare Access, and configures GitHub so the workflows in `.github/workflows/` can deploy.

Resource names used by the workflows and the other runbooks:

| Resource              | Preview                           | Production                             |
| --------------------- | --------------------------------- | -------------------------------------- |
| Pages project         | `ek-fi-sim` (preview deployments) | `ek-fi-sim` (production branch `main`) |
| Worker (wrangler env) | `preview`                         | `production`                           |
| D1 database           | `fisim-sync-preview`              | `fisim-sync-production`                |
| R2 bucket             | `fisim-plans-preview`             | `fisim-plans-production`               |

If you choose different D1 names, change `D1_DATABASE_PREVIEW` and `D1_DATABASE_PRODUCTION` at the top of
`.github/workflows/deploy.yml` and the names in [release-and-rollback.md](release-and-rollback.md).

## 0. Prerequisites

- A Cloudflare account (the free plan is enough; recheck limits at deploy time, plan §17).
- Admin rights on the GitHub repository, and the `gh` CLI signed in.
- A local checkout with dependencies installed (`pnpm install --frozen-lockfile`).

Wrangler is a dev dependency of `@fisim/sync-worker`. Run it from `workers/sync`:

```sh
cd workers/sync
pnpm exec wrangler login        # opens a browser; signs this machine in
pnpm exec wrangler whoami       # note the Account ID
```

## 1. Pages project

The project is a **direct upload** project: GitHub Actions builds `apps/web/dist` and uploads it. Do not
connect the repository to Pages in the dashboard, or every push would be built twice.

```sh
pnpm exec wrangler pages project create ek-fi-sim --production-branch main
pnpm exec wrangler pages project list
```

Result: production will be served at `https://ek-fi-sim.pages.dev`, and each pull request at
`https://pr-<number>.ek-fi-sim.pages.dev` (the workflow deploys with `--branch=pr-<number>`).

SPA routing, the CSP and other response headers come from the `_headers` and `_redirects` files that the
web build emits into `apps/web/dist`; nothing is configured in the dashboard for them.

## 2. D1 databases

```sh
pnpm exec wrangler d1 create fisim-sync-preview
pnpm exec wrangler d1 create fisim-sync-production
```

Each command prints a `database_id`. Put both into `workers/sync/wrangler.toml` under the matching
environment, with `migrations_dir = "migrations"`. The binding name must be the one the Worker code reads;
check `workers/sync/src`.

```toml
[[env.preview.d1_databases]]
binding = "<binding used by the Worker>"
database_name = "fisim-sync-preview"
database_id = "<id from the create command>"
migrations_dir = "migrations"

[[env.production.d1_databases]]
binding = "<binding used by the Worker>"
database_name = "fisim-sync-production"
database_id = "<id from the create command>"
migrations_dir = "migrations"
```

Database IDs are identifiers, not secrets, and are committed.

Apply the initial migrations once by hand to confirm the set-up (afterwards the deploy workflow does it):

```sh
pnpm exec wrangler d1 migrations apply fisim-sync-preview --env preview --remote
pnpm exec wrangler d1 migrations apply fisim-sync-production --env production --remote
pnpm exec wrangler d1 migrations list fisim-sync-production --env production --remote   # nothing pending
```

Check Time Travel is available and note the retention window for the rollback runbook:

```sh
pnpm exec wrangler d1 time-travel info fisim-sync-production --env production
```

## 3. R2 buckets

R2 must be enabled on the account once in the dashboard (**R2 → Get started**) before the first bucket.

```sh
pnpm exec wrangler r2 bucket create fisim-plans-preview
pnpm exec wrangler r2 bucket create fisim-plans-production
pnpm exec wrangler r2 bucket list
```

Add both to `workers/sync/wrangler.toml`:

```toml
[[env.preview.r2_buckets]]
binding = "<binding used by the Worker>"
bucket_name = "fisim-plans-preview"

[[env.production.r2_buckets]]
binding = "<binding used by the Worker>"
bucket_name = "fisim-plans-production"
```

Leave public access **off** on both buckets (the default). Only the Worker reads and writes them.

## 4. First Worker deploy

```sh
pnpm exec wrangler deploy --env preview
pnpm exec wrangler deploy --env production
```

Note the two Worker hostnames that are printed. The web app's sync endpoint for each environment is set at
build time (see `apps/web`); previews must point at the `preview` Worker and production at the `production`
Worker, so preview data never mixes with real data.

## 5. Cloudflare Access

Both environments sit behind Access (plan §14.1; production at least until the v1.0 gate decides
otherwise). Access decides who can reach the ciphertext. It never sees keys (plan §12.2).

In the dashboard: **Zero Trust**. The first visit asks for a team name and a plan; the free plan is enough.

### 5.1 Login method

**Zero Trust → Settings → Authentication → Login methods.** Keep **One-time PIN** (a code sent by email),
or add **GitHub** as an identity provider. This is open item O3; Access with email codes is the default.

### 5.2 Application for the web app

**Zero Trust → Access → Applications → Add an application → Self-hosted.**

| Field                         | Value                                                     |
| ----------------------------- | --------------------------------------------------------- |
| Name                          | `Longview`                                                |
| Session duration              | 1 month (a personal app; shorten if devices are shared)   |
| Public hostname 1             | `ek-fi-sim.pages.dev`                                     |
| Public hostname 2             | `*.ek-fi-sim.pages.dev` (covers every preview deployment) |
| Custom domain, if O4 adds one | add it here as well                                       |

### 5.3 Application for the sync Worker

Add a second self-hosted application named `Longview sync` with the two Worker hostnames from step 4 (or
the custom route, if one is configured). In the Worker's settings, either disable the public `workers.dev`
route once a custom route exists, or keep it and rely on the Worker rejecting requests without a valid
Access token.

Copy the **Application Audience (AUD) tag** of this application and your **team domain**
(`<team>.cloudflareaccess.com`). The Worker needs both to verify the Access JWT on every request; set them
as Worker variables for each environment as the Worker's configuration expects.

Set CORS on the Access application so the browser's preflight requests from the app origin are allowed
(**Advanced settings → CORS**): allowed origins are the production origin and the preview pattern;
credentials allowed.

### 5.4 Policy

Attach the same policy to both applications.

| Field       | Value                                                       |
| ----------- | ----------------------------------------------------------- |
| Policy name | `Owners`                                                    |
| Action      | Allow                                                       |
| Include     | Emails: the one or two email addresses that may use the app |

Do not use "Everyone" or an email-domain rule. There is no second policy.

### 5.5 Check

- [ ] `https://ek-fi-sim.pages.dev` in a private window shows the Access login, not the app.
- [ ] A preview URL shows the Access login.
- [ ] `curl -sI https://<worker-host>/v1/plans` returns a redirect to Access or a 401/403, never data.
- [ ] After signing in with an allowed email, the app loads and sync works.
- [ ] Signing in with a different email is refused.

Playwright and Lighthouse run locally against a locally served build, not the deployed preview (they are not
part of CI), so CI needs no Access service token.

## 6. API token for GitHub Actions

**My Profile → API Tokens → Create Token → Create Custom Token.** Name it `ek-fi-sim GitHub Actions`.

| Permission                   | Level |
| ---------------------------- | ----- |
| Account → Cloudflare Pages   | Edit  |
| Account → Workers Scripts    | Edit  |
| Account → D1                 | Edit  |
| Account → Workers R2 Storage | Edit  |
| Account → Account Settings   | Read  |
| User → User Details          | Read  |

- **Account resources:** include only this account.
- **Zone resources:** none, unless a custom domain route is added (O4); then add Zone → Workers Routes →
  Edit for that one zone.
- No Access or Zero Trust permission: CI never changes who can sign in.
- Set an expiry (one year) and a calendar reminder to rotate it.

The token is shown once. Go straight to step 7.

## 7. GitHub secrets

Repository → **Settings → Secrets and variables → Actions**, or:

```sh
gh secret set CLOUDFLARE_API_TOKEN      # paste the token from step 6
gh secret set CLOUDFLARE_ACCOUNT_ID     # the Account ID from `wrangler whoami`
gh secret set FRED_API_KEY              # free key from the FRED website; used only by ingest.yml
gh secret list
```

| Secret                  | Used by                                 | Notes                                               |
| ----------------------- | --------------------------------------- | --------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | `ci.yml` (preview deploy), `deploy.yml` | Scoped as in step 6                                 |
| `CLOUDFLARE_ACCOUNT_ID` | `ci.yml`, `deploy.yml`                  | Not sensitive, kept as a secret for convenience     |
| `FRED_API_KEY`          | `ingest.yml` only                       | Never referenced by build, test or deploy workflows |

Dependabot pull requests do not receive these secrets, so their preview deploy is skipped by design. Do not
add them to the Dependabot secret store.

Other GitHub settings:

- **Settings → Environments:** create `production`. The deploy workflow's production jobs use it. Optional:
  add yourself as a required reviewer to make each production deploy a one-click approval.
- **Settings → Actions → General → Workflow permissions:** "Read repository contents and packages
  permissions" (workflows ask for more where needed), and tick **Allow GitHub Actions to create and approve
  pull requests** so the ingest workflow can open its PR.
- **Settings → Actions → General → Actions permissions:** allow actions from GitHub, plus the specific
  third-party actions used (`pnpm/action-setup`, `cloudflare/wrangler-action`,
  `peter-evans/create-pull-request`).
- **Settings → Code security:** enable Dependabot alerts and security updates. Version updates are
  configured in `.github/dependabot.yml` (weekly).

## 8. Branch protection

Plan §14.2: pull requests required, all checks required, linear history. Repository → **Settings → Rules →
Rulesets → New branch ruleset**, target the default branch (`main`).

| Setting                               | Value                                                                                                                            |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Restrict deletions                    | On                                                                                                                               |
| Block force pushes                    | On                                                                                                                               |
| Require linear history                | On                                                                                                                               |
| Require a pull request before merging | On. Required approvals: 0 for a solo repository (GitHub does not let you approve your own PR); raise it if a second person joins |
| Allowed merge methods                 | Squash and rebase only (no merge commits)                                                                                        |
| Require status checks to pass         | On, with "Require branches to be up to date before merging"                                                                      |
| Bypass list                           | Empty. The rules apply to administrators too                                                                                     |

Required status checks (the job names in `.github/workflows/ci.yml`; they can be selected after the first
CI run has reported them):

- `Lint and format`
- `Typecheck`
- `Dependency audit`
- `Unit and property tests`
- `Data schema validation`
- `Validation suite (V-01 to V-09)`
- `Tax-Calculator oracle fixtures`
- `Build`
- `Playwright (e2e, tours, axe)`
- `Lighthouse budgets`
- `Engine benchmark`
- `Pages preview deploy`

`Pages preview deploy` reports as skipped on Dependabot pull requests, and GitHub treats a skipped required
job as passing.

When a job is added to or renamed in `ci.yml`, update this list and the ruleset in the same change.

## 9. Verify the whole chain

1. Open a small pull request. All twelve checks run; the job summary of **Pages preview deploy** shows a
   preview URL; the URL is behind Access and serves the build.
2. Merge it. The **Deploy** workflow runs the checks again, applies D1 migrations and deploys the Worker to
   `preview` and then `production`, and deploys Pages production.
3. Open production, sign in through Access, create a plan and reload offline.
4. Try to push directly to `main`: it is rejected.
5. Record the date and the resource IDs below.

## 10. Record

| Item                         | Value       |
| ---------------------------- | ----------- |
| Set-up date                  |             |
| Cloudflare account ID        |             |
| Zero Trust team domain       |             |
| Pages project                | `ek-fi-sim` |
| D1 preview database ID       |             |
| D1 production database ID    |             |
| D1 Time Travel retention     |             |
| Worker hostname (preview)    |             |
| Worker hostname (production) |             |
| Access AUD tag (app)         |             |
| Access AUD tag (sync)        |             |
| API token expiry             |             |
| Custom domain (O4)           |             |
