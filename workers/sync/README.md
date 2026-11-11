# @fisim/sync-worker

Cloudflare Worker that stores each user's **ciphertext** (R2) and its metadata (D1). It never sees plaintext
or keys (build plan §11, §12): the client encrypts with `@fisim/crypto` before uploading.

- `src/index.ts` - `fetch` entry point
- `src/app.ts` - routing, CORS, error handling
- `src/auth.ts` - Cloudflare Access JWT verification
- `src/plans.ts` - plan routes (D1 + R2)
- `src/docs.ts` - key bundle and settings routes (D1)
- `migrations/0001_init.sql` - schema

## API

All routes are under `/v1`. Errors are JSON: `{ "error": "<code>", "message": "..." }`.

| Route                  | Request                                  | Response                                                                                                     |
| ---------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `GET /v1/health`       | no auth                                  | `{ "ok": true }`                                                                                             |
| `GET /v1/plans`        |                                          | `[{ id, version, updatedAt, size, deleted }]` (tombstones included)                                          |
| `GET /v1/plans/:id`    |                                          | ciphertext (`application/octet-stream`), `ETag: "<version>"`, `X-Plan-Version`. `404` unknown, `410` deleted |
| `PUT /v1/plans/:id`    | body = ciphertext, `If-Match: <version>` | `{ id, version, updatedAt, size }`                                                                           |
| `DELETE /v1/plans/:id` | `If-Match: <version>`                    | `{ id, version, updatedAt, deleted: true }`; the blob is removed, the row stays as a tombstone               |
| `GET /v1/keys`         |                                          | wrapped key bundle JSON, `ETag`. `404` if none                                                               |
| `PUT /v1/keys`         | body = JSON object, `If-Match`           | `{ version, updatedAt, size }`                                                                               |
| `GET /v1/settings`     |                                          | opaque blob (`application/octet-stream`), `ETag`. `404` if none                                              |
| `PUT /v1/settings`     | body = bytes, `If-Match`                 | `{ version, updatedAt, size }`                                                                               |

**Versioning.** Every write needs `If-Match: <version the client last saw>`; quotes are optional, so an `ETag`
can be echoed back. `If-Match: 0` or `If-None-Match: *` means "create". On success the stored version becomes
exactly `If-Match + 1` (the client uses that number as AAD when encrypting a plan). On a mismatch nothing is
written and the response is **409** `{ error: "version_conflict", version, updatedAt, deleted? }` with the
current state (`version: 0, updatedAt: null` when nothing exists). A missing precondition is `428`.
Deleting bumps the version too, and re-creating a deleted plan needs `If-Match: <tombstone version>`, so
version numbers of a plan are never reused.

**Limits.** Plan body 5 MiB, 200 live plans per user (`403 plan_limit`), key bundle 16 KiB, settings 64 KiB;
larger bodies get `413`. Plan ids must match `[A-Za-z0-9_-]{1,64}`.

**Storage.** R2 key = `<user_id>/<plan_id>/<version>`. A write first claims the new version in D1 with a
conditional statement (so only one of two concurrent writers proceeds), then stores the object, then deletes the
previous version's object. If the R2 write fails, the D1 row is restored and the client gets `503`.
A `GET` that lands between the two steps of someone else's write also gets `503` and should retry.

## Security model

- **Auth is Cloudflare Access**, separate from encryption. The Worker verifies the `Cf-Access-Jwt-Assertion`
  JWT: RS256 only, signature against `https://<TEAM_DOMAIN>/cdn-cgi/access/certs` (cached in memory for one
  hour; an unknown `kid` triggers at most one refetch per minute), `iss`, `aud` = `ACCESS_AUD`, `exp`, `nbf`.
  The `sub` claim is the `user_id`. Missing Access configuration fails closed (`500`).
- **Every SQL statement filters on `user_id`**, and R2 keys are only built from the authenticated user id or
  read from a row selected with it. `test/sync.test.ts` has the cross-user tests required by §12.3.
- **Local bypass.** Only when `ENVIRONMENT === "local"` **and** `DEV_USER` is set, requests are treated as
  that user without a JWT. `DEV_USER` lives in `.dev.vars`, which wrangler never uploads; the deployed
  environments define neither `ENVIRONMENT = "local"` nor `DEV_USER`.
- **CORS.** Only exact origins in `ALLOWED_ORIGINS` (comma-separated) are allowed; any other `Origin` is
  refused with `403` before the request is processed. Requests without an `Origin` header (non-browser
  clients) are not subject to CORS but still need a valid JWT.
- **Logging.** The Worker logs only an error message for unexpected failures. Request bodies and headers are
  never logged. Do not enable Logpush with request bodies for this Worker.
- Responses carry `Cache-Control: no-store`, `X-Content-Type-Options: nosniff` and HSTS.

## Setup

Run everything from `workers/sync`. `pnpm exec wrangler login` first.

### 1. Local development

```sh
cp .dev.vars.example .dev.vars                                   # sets DEV_USER for the local bypass
pnpm exec wrangler d1 migrations apply fisim-sync-local --local  # creates the local SQLite schema
pnpm exec wrangler dev                                           # http://localhost:8787
curl http://localhost:8787/v1/health
curl -X PUT -H "If-Match: 0" --data-binary "test" http://localhost:8787/v1/plans/demo
```

Local D1 and R2 are simulated under `.wrangler/` (git-ignored). The top-level section of `wrangler.toml` is
for local use only; never run `wrangler deploy` without `--env`. Use `pnpm deploy:preview` or `pnpm deploy:production`, which
always pass one.

### 2. Create the cloud resources (once per environment)

```sh
# preview
pnpm exec wrangler d1 create fisim-sync-preview          # copy database_id into [env.preview] in wrangler.toml
pnpm exec wrangler r2 bucket create fisim-sync-preview

# production
pnpm exec wrangler d1 create fisim-sync-production       # copy database_id into [env.production]
pnpm exec wrangler r2 bucket create fisim-sync-production
```

Replace every `REPLACE_ME` in `wrangler.toml` (`grep REPLACE_ME wrangler.toml` must print nothing before a deploy).

### 3. Apply migrations

```sh
pnpm exec wrangler d1 migrations apply fisim-sync-preview --env preview --remote
pnpm exec wrangler d1 migrations apply fisim-sync-production --env production --remote
```

### 4. Cloudflare Access

In the Zero Trust dashboard (Access > Applications) add a **self-hosted** application for each environment's
Worker hostname, with a policy that admits only the intended users. Then set, per environment, in
`wrangler.toml`:

- `TEAM_DOMAIN` - `<team>.cloudflareaccess.com` (Zero Trust > Settings > Custom Pages shows the team domain)
- `ACCESS_AUD` - the application's **Application Audience (AUD) Tag** (application > Overview)
- `ALLOWED_ORIGINS` - the exact origin(s) of the web app, e.g. `https://fisim.example.com`

These are identifiers, not secrets, so they are plain `[vars]`. Two Access settings matter for a browser client
on a different origin: in the application's CORS settings, enable **Bypass OPTIONS requests to origin** (so
preflights reach the Worker) and the web client must send credentials (`apps/web/src/sync/client.ts` does).
Disable the `workers.dev` route or put it behind Access as well; `workers_dev = false` is set at the top level
and should be kept for deployed environments by attaching a route / custom domain.

### 5. Deploy and roll back

```sh
pnpm exec wrangler deploy --env preview
pnpm exec wrangler deploy --env production

pnpm exec wrangler deployments list --env production     # find the previous version id
pnpm exec wrangler rollback --env production             # roll back to the previous version
pnpm exec wrangler rollback <version-id> --env production -m "reason"
```

A rollback reverts code only. D1 migrations are forward-only: write new migrations so that the previous
Worker version still runs against the new schema.

## Tests

```sh
pnpm vitest run --project sync            # from the repo root
pnpm --filter @fisim/sync-worker typecheck
```

The tests call `handleRequest` directly with in-memory fakes (`test/fakes.ts`). The D1 fake executes the real
migration and the real SQL on Node's built-in `node:sqlite` (Node 22.13+ without a flag), so the queries
themselves are exercised; R2 is a `Map`. JWTs are signed with an RSA key generated in the test and served
through an injected JWKS fetcher.
