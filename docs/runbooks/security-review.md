# Runbook: pre-release security review

Plan §12.3, part of the v1.0 gate (plan §16: "complete, with no open high or critical issues"). This turns
the §12.3 checklist into steps with a pass condition for each. Run it before v1.0, and again before any
release that changes `packages/crypto`, the sync Worker, the CSP or headers, or the authentication set-up.

**How to use it:** copy section 7 into a new issue titled `Security review vX.Y.Z`, work through sections
1 to 5, and record evidence (command output, screenshots of header scans, test names) in the issue. File a
separate issue for every finding with a severity.

| Severity | Meaning                                                              | Release effect           |
| -------- | -------------------------------------------------------------------- | ------------------------ |
| Critical | Plan data or keys can be read or lost by someone other than the user | Blocks release           |
| High     | A control from plan §12.1 or §12.2 is missing or does not work       | Blocks release           |
| Medium   | Defence in depth is weakened; no direct exposure                     | Fix or accept in writing |
| Low      | Hygiene                                                              | Schedule                 |

Scope reminder (plan §12.1): the main risk to end-to-end encryption is script injection or a malicious
dependency in the client. The server only ever holds ciphertext, so the client is where the review spends
most of its time.

## 1. Crypto code against the spec

Review `packages/crypto` and every caller against plan §12.2. Read the code; do not rely on tests alone.

| #    | Check             | Pass condition                                                                                                                                                                                         |
| ---- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1.1  | Primitives        | Only Web Crypto (`crypto.subtle`, `crypto.getRandomValues`) and the Argon2 WASM module. No hand-written ciphers, no `Math.random` anywhere near keys or nonces.                                        |
| 1.2  | Data key (DEK)    | 256 bits from `crypto.getRandomValues`, one per user.                                                                                                                                                  |
| 1.3  | Plan encryption   | AES-256-GCM with a fresh random 96-bit nonce for every encryption. The nonce is stored with the ciphertext and never reused or derived from a counter that can reset.                                  |
| 1.4  | Associated data   | AAD is `planId‖version`. Decrypting a blob under a different plan ID or version fails.                                                                                                                 |
| 1.5  | Passphrase wrap   | Argon2id with m = 64 MiB, t = 3, p = 1 and a random salt per user. Parameters and salt are stored with the wrapped key so they can be raised later.                                                    |
| 1.6  | Fallback          | PBKDF2-SHA256 with at least 600,000 iterations, used only when WASM is unavailable, and recorded in the envelope so the KDF is never guessed.                                                          |
| 1.7  | Recovery wrap     | The DEK is also wrapped with a random recovery key of at least 256 bits, shown once. The recovery key is not stored in IndexedDB, not sent to the server and not logged.                               |
| 1.8  | Passphrase change | Rewraps the DEK only; plans are not re-encrypted; the old wrapped key is replaced on the server.                                                                                                       |
| 1.9  | Key handling      | Keys are non-extractable `CryptoKey` objects where the flow allows. No key, passphrase or recovery key reaches `localStorage`, the URL, the console, the client error ring buffer or an error message. |
| 1.10 | Auth is separate  | Nothing from Cloudflare Access (or passkeys) is an input to key derivation, and no key material is sent in any request.                                                                                |
| 1.11 | Export format     | The encrypted export (SYNC-03) uses the same primitives, has a version field, and fails closed on a wrong passphrase or a modified file.                                                               |
| 1.12 | Tests             | Known-answer tests for the KDFs and AES-GCM; round-trip tests; negative tests for 1.4 and 1.11 (wrong AAD, flipped ciphertext bit, truncated file, wrong passphrase).                                  |

```sh
pnpm exec vitest run --project crypto
# Searches that should return nothing surprising:
git grep -nE "Math\.random|localStorage|console\.(log|debug|info)" -- packages/crypto apps/web/src
git grep -nE "eval\(|new Function\(|dangerouslySetInnerHTML|innerHTML" -- apps/web/src packages
```

Inspect what the server sees: with sync on, open DevTools → Network, edit a plan and read the `PUT
/v1/plans/:id` request. **Pass:** the body is opaque ciphertext; no names, amounts or plan JSON in the
body, the URL or the headers.

## 2. CSP and headers

Check the deployed **production** site and one **preview** deployment, and the Worker's responses.

```sh
curl -sI https://<production-host>/ | sort
curl -sI https://<production-host>/index.html | sort
curl -sI https://<worker-host>/v1/plans | sort
```

Then run a securityheaders-style scan against the production host (it sits behind Access, so either scan
from an authenticated browser with DevTools, or temporarily scan a preview with a service token) and keep
the result.

| #    | Check                   | Pass condition                                                                                                                                                                                                                                                                                                  |
| ---- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1  | Content-Security-Policy | Present on every HTML response. `script-src 'self' 'wasm-unsafe-eval'`; no `'unsafe-inline'`, no `'unsafe-eval'`, no third-party origin in any directive. `default-src 'self'`; `object-src 'none'`; `base-uri 'self'`; `frame-ancestors 'none'`; `connect-src` lists only `'self'` and the sync Worker origin. |
| 2.2  | Trusted Types           | `require-trusted-types-for 'script'` is set, and the app runs without Trusted Types violations in the console on every route.                                                                                                                                                                                   |
| 2.3  | No inline script        | View source of `index.html`: no inline `<script>` and no inline event handlers.                                                                                                                                                                                                                                 |
| 2.4  | No third-party requests | Load every top-level route with DevTools → Network open and the cache disabled. **Every** request goes to the app origin or the sync Worker. No fonts, analytics, CDNs or images from elsewhere.                                                                                                                |
| 2.5  | Transport               | HTTP redirects to HTTPS. `Strict-Transport-Security` with `max-age` of at least one year and `includeSubDomains`.                                                                                                                                                                                               |
| 2.6  | Other headers           | `X-Content-Type-Options: nosniff`; `Referrer-Policy: no-referrer` (or `strict-origin-when-cross-origin`); a restrictive `Permissions-Policy`; `Cross-Origin-Opener-Policy: same-origin`.                                                                                                                        |
| 2.7  | Service worker          | Served from the app origin with a correct scope; it caches only same-origin responses; it does not cache sync API responses.                                                                                                                                                                                    |
| 2.8  | Worker CORS             | `Access-Control-Allow-Origin` is the exact app origin (production and the preview pattern), never `*`. Credentials are allowed only for those origins.                                                                                                                                                          |
| 2.9  | Worker logging          | The Worker never logs request bodies (plan §12.2). Read the code and tail the logs while pushing a plan: `pnpm --filter @fisim/sync-worker exec wrangler tail --env preview`.                                                                                                                                   |
| 2.10 | CSP in tests            | An e2e check fails on any CSP violation report, so regressions are caught in CI.                                                                                                                                                                                                                                |

## 3. Sync API authorisation

Goal: a user can reach only their own rows and objects (plan §11 sync API, §12.3).

Automated tests live with the Worker:

```sh
pnpm exec vitest run --project sync
```

They must cover, and a reviewer must confirm by reading them:

| #   | Case            | Pass condition                                                                                                                                                                                    |
| --- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.1 | No identity     | Every route returns 401 or 403 without a valid Access identity. The identity comes from the verified Access JWT (signature, audience, expiry), never from a client-supplied header or body field. |
| 3.2 | List isolation  | `GET /v1/plans` as user A returns only A's plans.                                                                                                                                                 |
| 3.3 | Read isolation  | `GET /v1/plans/:id` as user B for A's plan returns 404 (not 403, so existence is not revealed).                                                                                                   |
| 3.4 | Write isolation | `PUT` and `DELETE` as user B on A's plan ID do not change A's row or object. If B "creates" the same plan ID, it is stored under B's namespace only.                                              |
| 3.5 | Version check   | `PUT` with a stale `If-Match` returns 409 and changes nothing. `PUT` without `If-Match` on an existing plan is rejected.                                                                          |
| 3.6 | Storage keys    | The R2 key is derived on the server from the authenticated user ID and plan ID. No request parameter can name an R2 key or another user's prefix.                                                 |
| 3.7 | SQL             | Every D1 query is a prepared statement with bound parameters and includes `user_id` in its `WHERE` clause.                                                                                        |
| 3.8 | Limits          | A request body above the size limit is rejected before it is written. Methods and paths outside the API return 404 or 405.                                                                        |
| 3.9 | Tombstones      | `DELETE` marks the row deleted; a deleted plan cannot be read by anyone, including through a guessed R2 key.                                                                                      |

Then repeat 3.2 to 3.4 by hand against the **preview** environment with two real Access identities (two
email addresses). Record the requests and responses.

Check the access set-up itself ([cloudflare-setup.md](cloudflare-setup.md)):

- [ ] The Access application covers the production host, the preview hosts and the Worker host. No route is
      reachable without Access (try each host in a private window).
- [ ] The Access policy allows only the intended identities.
- [ ] The Worker rejects requests that reach its `workers.dev` address directly without a valid Access JWT.

## 4. Restore drill from the recovery key

Run [restore-drill.md](restore-drill.md) in full: Drill A (encrypted export) and Drill B (recovery key) on
a clean browser profile.

**Pass:** both drills succeed, every reference value matches, and the row is added to the drill's results
log. Link that row from the review issue.

## 5. Dependency audit

```sh
pnpm install --frozen-lockfile
pnpm audit --prod --audit-level high      # shipped dependencies: must be clean
pnpm audit                                # everything: review each finding
python -m pip install pip-audit && pip-audit --requirement tests/validation/taxcalc/requirements.txt
```

| #   | Check                                  | Pass condition                                                                                                                                                                          |
| --- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5.1 | Shipped dependencies                   | No known high or critical advisory. Any medium advisory has a written reason it does not apply, or is fixed.                                                                            |
| 5.2 | Dev and test dependencies              | Reviewed. An advisory in a build-time tool matters if it can alter the build output.                                                                                                    |
| 5.3 | Lockfile                               | `pnpm-lock.yaml` is committed; CI installs with `--frozen-lockfile`; no dependency is fetched from a Git URL or a tarball URL.                                                          |
| 5.4 | Install scripts                        | Only the packages listed under `onlyBuiltDependencies` in `pnpm-workspace.yaml` run install scripts, and each one is expected.                                                          |
| 5.5 | Dependabot                             | No open Dependabot security alert. Weekly update PRs are not piling up.                                                                                                                 |
| 5.6 | Actions                                | Every third-party action in `.github/workflows` and `.github/actions` is pinned to a full commit SHA: `git grep -nE "uses: [^.].*@" -- .github` shows only 40-character SHAs.           |
| 5.7 | New dependencies since the last review | Each has a reason, a maintained upstream and an acceptable licence. Prefer removing to adding.                                                                                          |
| 5.8 | Bundle contents                        | The production bundle contains nothing from `research/`, no source maps with secrets, no `.env` values: `grep -rIl "FRED_API_KEY\|CLOUDFLARE_API_TOKEN" apps/web/dist` returns nothing. |

## 6. Privacy checks

Short, but part of the same sign-off (plan §2.7, §12.1, §14.4).

- [ ] No form in the app asks for an SSN, an account number or a credential for another service.
- [ ] No analytics, telemetry or error reporting leaves the device. The client error ring buffer is local
      and is exported only by the user.
- [ ] The GitHub secrets are scoped as in [cloudflare-setup.md](cloudflare-setup.md); `FRED_API_KEY` is
      referenced only in `.github/workflows/ingest.yml`.
- [ ] The device-theft choice (optional app lock, or reliance on OS disk encryption) is explained in the
      UI.
- [ ] If the repository is public: `research/` is not in the history. This prints nothing:
      `git log --all --oneline -- research`

## 7. Sign-off template

```markdown
## Security review vX.Y.Z

- Date:
- Reviewer:
- Commit:
- Environments checked: production <host>, preview <host>, Worker <host>

| Section                                                              | Result (pass / fail) | Evidence | Findings (issue links, severity) |
| -------------------------------------------------------------------- | -------------------- | -------- | -------------------------------- |
| 1. Crypto against spec (1.1 to 1.12)                                 |                      |          |                                  |
| 2. CSP and headers (2.1 to 2.10)                                     |                      |          |                                  |
| 3. Sync API authorisation (3.1 to 3.9, manual two-user test, Access) |                      |          |                                  |
| 4. Restore drill (A and B)                                           |                      |          |                                  |
| 5. Dependency audit (5.1 to 5.8)                                     |                      |          |                                  |
| 6. Privacy checks                                                    |                      |          |                                  |

Open high or critical findings: <none | list>

Decision: <pass | blocked>
```

The review passes only when every section passes and no high or critical finding is open. Keep the issue
as the record; link it from the v1.0 gate checklist.

## Review history

| Date | Version | Reviewer | Result | Issue |
| ---- | ------- | -------- | ------ | ----- |
|      |         |          |        |       |
