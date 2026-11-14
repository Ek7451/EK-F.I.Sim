# Longview Planner public hosting and optional accounts

Production: https://longview-planner.pages.dev. The calculator is public; accounts are optional and open to anyone. This replaces the original invitation-only Access/R2 plan for the public deployment. The older Access Worker remains available for private self-hosting.

## Using the site

Plans save locally without a login. To save them to the cloud, choose **Sign in** in the header, then **Create an account** (username and password) and save the recovery code it shows once. That is all: from then on every change is encrypted in the browser and uploaded a moment later, and a reload carries on without asking for anything. Other devices just sign in; their plans download and open. Conflicting changes require a choice, and local snapshots are retained. (Changed November 13, 2026: the separate vault, its passphrase and its recovery key are gone.)

One password does everything. The browser stretches it with Argon2id (64 MiB, 3 passes, salted by the username) and splits the result with HKDF into a **login key**, sent to the server in place of the password (Better Auth stores only its hash), and a **wrap key** that never leaves the browser and wraps the random data key that encrypts plans (key bundle v2, `packages/crypto/src/account.ts`). The **recovery code** shown at sign-up is split the same way: its auth half lets the server allow a reset, its wrap half re-opens the data key, so **Forgot password** sets a new password and keeps cloud plans readable. A reset, a password change and a new recovery code each replace the password hash or recovery check and the key bundle in one atomic D1 batch; a reset also revokes sessions and spends the old code. If both the password and the recovery code are lost, nobody can open the cloud plans; plans already on a device are unaffected and can be exported.

Sign-out first sends anything unsent (and asks before going ahead if something could not be sent, for example offline), then removes the account's plans, snapshots and key from that browser; they stay in the cloud and come back on the next sign-in. A browser stays bound to one account until it signs out, so cached plans are never uploaded into someone else's account. The data key is kept in IndexedDB as a non-extractable CryptoKey while signed in, so it can encrypt and decrypt there but cannot be read out by page script.

Plans at `ek-fi-sim.pages.dev` or localhost remain at those origins. Transfer them through Settings → encrypted backup/export and import. The previous site stays available for this purpose.

## Architecture and free limits

- Cloudflare Pages serves static assets. `_routes.json` invokes the Pages Worker only for `/api/*`; service-worker navigation fallback excludes these routes.
- Same-origin Better Auth sessions use secure, HttpOnly, SameSite=Strict cookies. Public signup uses usernames, not email delivery. Better Auth's required email column is an internal identifier under the reserved `.invalid` domain. The public router permits only the implemented account routes. Better Auth telemetry is disabled.
- D1 stores account/password hashes, sessions, hashed high-entropy recovery codes, rate-limit buckets, encrypted plan bytes, wrapped data keys (bundle v2), and sync metadata. There is no R2 subscription. Password hashing and session handling use Better Auth; recovery spends a code, replaces the password hash and the key bundle, and revokes sessions in one atomic D1 batch; the server never receives the typed password or recovery code, only keys derived from them.
- Every plan/document query is scoped to the authenticated user. Browser sync also supplies the locally bound account ID. Writes require the version previously read; storage quotas and ciphertext/version updates commit in one SQL statement. Compression-safe version headers are supported.
- Per account: 20 live plans, 256 KiB per encrypted plan, 2 MiB of plan ciphertext, 16 KiB wrapped key bundle and 64 KiB encrypted settings. Tombstones preserve deletion conflicts, with a 200-row lifetime history cap per account. Local planning is independent of these quotas.
- Provider Free limits apply to the entire service: [Workers requests](https://developers.cloudflare.com/workers/platform/pricing/) and [D1 storage/queries](https://developers.cloudflare.com/d1/platform/pricing/). D1 allows 5 million rows read/day, 100,000 written/day and 5 GB across databases; this database has a [500 MB cap](https://developers.cloudflare.com/d1/platform/limits/). Capacity is finite, not unlimited free storage. Exhausted quotas can temporarily stop cloud requests; local saving and encrypted exports continue. No paid plan was selected.
- No request bodies, cookies, passwords, recovery codes, derived keys or plan plaintext are logged by application code. Cloudflare and the auth library still process operational metadata such as addresses and session timestamps.

## Resources and release

Configuration: `apps/web/wrangler.toml`. Project: `longview-planner`; D1: `longview-planner`, ID `cbb94af7-2a67-469a-a471-1b6e63834a39`. The `AUTH_SECRET` is stored as a Cloudflare Pages production secret, not in Git. Production account APIs reject preview hostnames; preview builds cannot access accounts through the production API.

`pnpm build` builds the browser app and bundles `workers/sync/src/pages.ts` into `apps/web/dist/_worker.js`. The backend is not included in the browser's precache or initial JavaScript. Worker development dependencies include current Vitest/Vite versions because Better Auth exposes an optional Vitest peer; these do not change the repository's existing Vitest runner.

From the repository root after Wrangler login:

```powershell
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm audit --prod --audit-level high
pnpm build
pnpm e2e
pnpm lighthouse
node workers/sync/node_modules/wrangler/bin/wrangler.js d1 migrations apply longview-planner --remote --config apps/web/wrangler.toml
node workers/sync/node_modules/wrangler/bin/wrangler.js pages deploy dist --cwd apps/web --project-name longview-planner --branch main
```

Apply backward-compatible migrations before publication. For production release, prefer the exact `web-dist` artifact from the passing PR workflow. `.github/workflows/deploy.yml` performs migrations and publication when repository `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets are present; those secrets are currently absent, so uploads are manual. A green skipped deploy job is not evidence of publication. Never reuse the local OAuth token as a repository secret.

For local account development, run D1 migrations locally, set `AUTH_SECRET` in an ignored environment file, build with `VITE_PUBLIC_CLOUD=true`, and run Wrangler Pages dev with `APP_ORIGIN` set to the local URL. The private Access/R2 worker's `wrangler.toml` is separate.

Rollback a Pages deployment in Cloudflare without deleting D1. Leave the additive account/storage migrations intact. D1 Free includes seven days of point-in-time recovery; users should also keep encrypted exports. Review usage in the Cloudflare dashboard before increasing quotas.
