# Longview Planner public hosting and optional accounts

Production: https://longview-planner.pages.dev. The calculator is public; accounts are optional and open to anyone. This replaces the original invitation-only Access/R2 plan for the public deployment. The older Access Worker remains available for private self-hosting.

## Using the site

Plans save locally without a login. In Settings, create a username/password account and save the account recovery code. Then choose “Set up sync for the first time” in the encrypted vault, set a separate vault passphrase, and save its recovery key. Other devices sign in and choose “Connect this device to my sync.” Changes sync after a short delay while the vault is unlocked; a reload requires unlocking again. Conflicting changes require a choice, and local snapshots are retained.

The account recovery code resets the login password, rotates itself, and revokes existing sessions. It cannot decrypt plans. The vault recovery key resets the encryption passphrase locally. Neither an administrator nor an account-password reset can recover a vault when both its passphrase and recovery key are lost. A signed-in user with their current password can replace a lost account recovery code.

Sign-out stops cloud sync, but local plan copies remain in that browser. Use a private window on shared computers. A browser's local vault is bound to one account to prevent accidental uploads into someone else's account; use separate browser profiles for different accounts. Export before clearing any site's local storage.

Plans at `ek-fi-sim.pages.dev` or localhost remain at those origins. Transfer them through Settings → encrypted backup/export and import. The previous site stays available for this purpose.

## Architecture and free limits

- Cloudflare Pages serves static assets. `_routes.json` invokes the Pages Worker only for `/api/*`; service-worker navigation fallback excludes these routes.
- Same-origin Better Auth sessions use secure, HttpOnly, SameSite=Strict cookies. Public signup uses usernames, not email delivery. Better Auth's required email column is an internal identifier under the reserved `.invalid` domain. The public router permits only the implemented account routes. Better Auth telemetry is disabled.
- D1 stores account/password hashes, sessions, hashed high-entropy recovery codes, rate-limit buckets, encrypted plan bytes, wrapped vault keys, and sync metadata. There is no R2 subscription. Password hashing and session handling use Better Auth; recovery consumes a code, replaces the password, and revokes sessions in one atomic D1 batch.
- Every plan/document query is scoped to the authenticated user. Browser sync also supplies the locally bound account ID. Writes require the version previously read; storage quotas and ciphertext/version updates commit in one SQL statement. Compression-safe version headers are supported.
- Per account: 20 live plans, 256 KiB per encrypted plan, 2 MiB of plan ciphertext, 16 KiB wrapped key bundle and 64 KiB encrypted settings. Tombstones preserve deletion conflicts, with a 200-row lifetime history cap per account. Local planning is independent of these quotas.
- Provider Free limits apply to the entire service: [Workers requests](https://developers.cloudflare.com/workers/platform/pricing/) and [D1 storage/queries](https://developers.cloudflare.com/d1/platform/pricing/). D1 allows 5 million rows read/day, 100,000 written/day and 5 GB across databases; this database has a [500 MB cap](https://developers.cloudflare.com/d1/platform/limits/). Capacity is finite, not unlimited free storage. Exhausted quotas can temporarily stop cloud requests; local saving and encrypted exports continue. No paid plan was selected.
- No request bodies, cookies, passwords, recovery codes, vault passphrases or plan plaintext are logged by application code. Cloudflare and the auth library still process operational metadata such as addresses and session timestamps.

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
