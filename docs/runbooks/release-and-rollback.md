# Runbook: release and rollback

Plan §14.3. Covers app releases (`vX.Y.Z`), how they relate to data releases (`data-YYYY.N`), how to roll
back each deployed part, and the PWA update-flow test that the v1.0 gate requires (plan §16).

## 1. What ships, and when

| Part                         | Where it runs                                       | How it ships                                           | Version                                                        |
| ---------------------------- | --------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------- |
| Web app (`apps/web/dist`)    | Cloudflare Pages project `ek-fi-sim`                | Every merge to `main` (`.github/workflows/deploy.yml`) | App semver `vX.Y.Z`                                            |
| Sync Worker (`workers/sync`) | Cloudflare Workers, envs `preview` and `production` | Same workflow: preview env first, then production      | Worker version ID (Cloudflare)                                 |
| Sync metadata schema         | D1, migrations in `workers/sync/migrations`         | Same workflow, applied before the Worker deploy        | Migration number                                               |
| Datasets (`packages/data`)   | Bundled with the web app, content-hashed            | With the web app                                       | `data-YYYY.N` ([annual-data-update.md](annual-data-update.md)) |

Every merge to `main` deploys (plan §2.8). A **release** is a named, tagged point on `main`; it does not
gate deployment. Production stays behind Cloudflare Access until the v1.0 gate decides otherwise.

Deploy order on `main`: full CI → D1 migrations and Worker to `preview` → D1 migrations and Worker to
`production` → Pages production. Because migrations are applied before the new Worker goes live, **every
migration must work with the Worker version that is already running** (expand first; remove or rename in a
later release, after no deployed Worker depends on the old shape).

## 2. App release with Changesets

Semver for a personal app, read from the user's side:

- **patch:** fixes; no change to stored data.
- **minor:** new features; a plan `schemaVersion` bump with a migration is allowed.
- **major:** reserved for v1.0 and for any change that needs user action.

### 2.1 During development

Every pull request that changes behaviour adds a changeset:

```sh
pnpm changeset          # choose the bump and write one user-facing line
git add .changeset && git commit -m "chore: changeset"
```

Data-only pull requests do not need a changeset; they get a data release tag instead.

### 2.2 Cutting the release

1. Make sure `main` is green and deployed, and that you have run the checks in section 3.
2. Create the release pull request:

   ```sh
   git switch main && git pull
   git switch -c release/vX.Y.Z
   pnpm changeset version        # consumes .changeset/*.md, bumps versions, writes CHANGELOG.md
   pnpm install --lockfile-only  # keep the lockfile in step with the bumped workspace versions
   git commit -am "release: vX.Y.Z"
   git push -u origin release/vX.Y.Z
   ```

3. Open the PR, wait for CI and the Pages preview, and merge it (linear history: squash or rebase).
4. Tag the merge commit and push the tag:

   ```sh
   git switch main && git pull
   git tag -a vX.Y.Z -m "Longview vX.Y.Z"
   git push origin vX.Y.Z
   ```

5. Create the GitHub release from the tag with the changelog section as its notes:

   ```sh
   gh release create vX.Y.Z --title "vX.Y.Z" --notes-file <changelog excerpt>
   ```

6. Watch the **Deploy** workflow for the merge commit finish. Open production, accept the update prompt,
   and check that Settings shows the new app version and the expected data release.
7. Record the release in section 7.

### 2.3 Tags

| Tag           | Meaning      | Created by                                                  |
| ------------- | ------------ | ----------------------------------------------------------- |
| `vX.Y.Z`      | App release  | This runbook, section 2.2                                   |
| `data-YYYY.N` | Data release | [annual-data-update.md](annual-data-update.md), section 3.5 |

Tags are annotated, never moved and never deleted. If a release is bad, roll back (section 4) and release a
new patch version.

## 3. Pre-release checks

- [ ] CI is green on the commit to be released, including Playwright, tours, axe, Lighthouse and the engine
      benchmark.
- [ ] If the plan `schemaVersion` changed: a migration exists, fixtures for the old version are in
      `packages/engine/test/fixtures/plans/vN/`, and the PWA update-flow test (section 5) has been run.
- [ ] If `workers/sync/migrations` changed: the migration is additive and was applied to the `preview`
      database by an earlier merge without errors.
- [ ] The disclaimers (plan §1.3) are present in the app and in a freshly generated PDF.
- [ ] You know the current good versions to return to: note the Pages deployment ID and the Worker version
      ID before you merge (section 4 shows how to list them).

## 4. Rollback

Roll back the smallest part that fixes the problem. In order of preference: Pages only, then the Worker,
then D1. After any rollback, **stop the next deploy from undoing it**: revert the offending commit on
`main` through a normal PR (which redeploys the known-good code), or fix forward.

Wrangler commands below run from `workers/sync`, either with `cd workers/sync && pnpm exec wrangler ...` or
`pnpm --filter @fisim/sync-worker exec wrangler ...`. They need `wrangler login` or `CLOUDFLARE_API_TOKEN`
and `CLOUDFLARE_ACCOUNT_ID` in the environment.

### 4.1 Pages (web app): instant rollback

Use when the UI is broken or a bad build shipped.

1. List recent production deployments:

   ```sh
   pnpm --filter @fisim/sync-worker exec wrangler pages deployment list --project-name ek-fi-sim
   ```

2. In the Cloudflare dashboard: **Workers & Pages → ek-fi-sim → Deployments**, find the last good
   production deployment, open its menu and choose **Rollback to this deployment**. It takes effect within
   seconds and needs no rebuild.
3. Open production in a private window and confirm the old version is served.

What users see: installed PWAs that already updated keep the newer cached build until their service worker
sees the rolled-back files as an update and prompts again. That is the normal prompt-to-update path
(plan §14.3); nothing reloads by itself.

**Do not roll Pages back across a plan-schema migration.** A client that has already migrated its plans to
schema N+1 would be served an app that only knows schema N. The app then opens those plans read-only with
an "update the app" notice (plan §5.2), which is safe but unusable. In that case fix forward. The automatic
pre-migration backup snapshot in IndexedDB is the user's fallback.

### 4.2 Worker: `wrangler rollback`

Use when the sync API misbehaves (errors, wrong responses) after a deploy.

```sh
cd workers/sync
pnpm exec wrangler deployments list --env production          # find the last good version ID
pnpm exec wrangler rollback <version-id> --env production --message "Roll back: <reason>"
pnpm exec wrangler deployments list --env production          # confirm the active version
```

`wrangler rollback` without a version ID returns to the previous version. It restores code and
configuration only. It does not change D1 or R2 contents, and it cannot restore a version whose bindings
no longer exist.

If the rolled-back Worker is not compatible with a migration that was applied with the bad release, you
also need 4.3, which is why migrations must be additive.

### 4.3 D1: Time Travel

Use only when sync **metadata** is damaged (a bad migration, or a bug that wrote wrong rows). D1 holds
`plans(user_id, plan_id, version, updated_at, size, r2_key, deleted)`; the plan ciphertext is in R2 and is
not restored by this.

Time Travel restores the whole database to a point in time inside its retention window (check the current
window for the account's plan before relying on it). Everything written after that point is lost.

```sh
cd workers/sync

# 1. Stop writes: roll the Worker back (4.2) or take sync offline, so nothing changes mid-restore.

# 2. Record the current bookmark. This is your undo for the restore itself.
pnpm exec wrangler d1 time-travel info fisim-sync-production --env production

# 3. Find the bookmark for the moment just before the damage (RFC 3339 or Unix timestamp).
pnpm exec wrangler d1 time-travel info fisim-sync-production --env production --timestamp "2027-03-14T09:25:00Z"

# 4. Restore. Wrangler prints the previous bookmark; keep it.
pnpm exec wrangler d1 time-travel restore fisim-sync-production --env production --timestamp "2027-03-14T09:25:00Z"

# 5. Check.
pnpm exec wrangler d1 execute fisim-sync-production --env production --remote \
  --command "SELECT COUNT(*) AS plans, MAX(updated_at) AS newest FROM plans"
pnpm exec wrangler d1 migrations list fisim-sync-production --env production --remote
```

After a restore:

- Rows written after the restore point are gone, but their R2 objects still exist. Clients that hold a
  newer local version will get a version mismatch (409) on their next push and see the conflict prompt
  (SYNC-04). Choosing "keep mine" re-uploads the newer plan. No plan data is lost as long as one device
  still has it; this is by design (local-first).
- If the restore went past a migration, `migrations list` shows it as unapplied. Re-apply it (or deploy the
  fix) before turning the matching Worker back on.
- Practise on `fisim-sync-preview` with `--env preview` first if there is any doubt.

### 4.4 Data release

A bad dataset is fixed forward: correct the file, cut `data-YYYY.N+1`, deploy. If it must be withdrawn at
once, use 4.1 to return Pages to the previous deployment, then revert the data commit on `main`.

### 4.5 After any rollback

- [ ] Revert or fix on `main` so the next merge does not redeploy the fault.
- [ ] Add a row to the log in section 7 with the cause and the IDs you rolled back to.
- [ ] If user data could have been affected, run the [restore drill](restore-drill.md).

## 5. PWA update-flow test (previous build, with a schema migration)

v1.0 gate item (plan §16): "The PWA update flow has been tested from the previous build with a schema
migration." Also run it before any release that bumps the plan `schemaVersion` or changes the service
worker configuration.

The app uses prompt-to-update: a new version waits until the user accepts, so it never reloads in the
middle of an edit. After the update, schema migrations run behind an automatic backup snapshot (plan §5.2,
§14.3).

### 5.1 Set-up

Both builds must be served from the **same origin**, because the service worker and IndexedDB are per
origin. Use a fresh browser profile.

```sh
# Terminal 1: the previous release
git worktree add ../longview-prev vA.B.C        # the last released tag
cd ../longview-prev
pnpm install --frozen-lockfile
pnpm build
pnpm preview                                    # serves on http://localhost:4173 (strict port)
```

Open `http://localhost:4173` in a clean profile (for example
`chrome --user-data-dir="$(mktemp -d)" http://localhost:4173`).

### 5.2 Steps

1. **Seed data on the old build.** Create one plan with the wizard and import one fixture plan of the old
   schema version. Add at least one actuals entry. Note three numbers you can check later (for example the
   net worth in the final year, this year's tax, the chance of success with its seed).
2. Confirm the old build is installed for offline use: reload once, then switch DevTools to offline and
   reload again. The app still opens. Go back online.
3. Open a plan and **start an edit without finishing it** (leave an editor open with a changed value).
4. **Swap the build.** Stop the preview server in terminal 1. In the main checkout, on the commit to be
   released:

   ```sh
   pnpm install --frozen-lockfile
   pnpm build
   pnpm preview                                 # same port, 4173
   ```

5. In the browser, without reloading by hand, wait for the service worker to find the update (or trigger a
   check from DevTools → Application → Service workers → Update).
6. **Expect:** an update prompt appears. The page does **not** reload. The open editor and its unsaved
   value are still there.
7. Dismiss the prompt. Finish the edit and save. **Expect:** it saves on the old version, and the prompt
   can be reached again.
8. Accept the update. **Expect:** the app reloads into the new version; Settings shows the new app version.
9. **Expect, migration:** before any plan is migrated, a backup snapshot is written. Check DevTools →
   Application → IndexedDB → `snapshots`: there is a pre-migration entry for each plan. Each plan now has
   the new `schemaVersion`.
10. Open both plans. **Expect:** no errors; the edit from step 7 is present; the three numbers from step 1
    match, or differ only as the changelog says they should.
11. Go offline and reload. **Expect:** the new version opens offline.
12. **Newer-schema guard.** Stop the server, serve the old build again on the same port, and load the app
    in the same profile (accept the "update" back to the old files if prompted). **Expect:** plans with the
    newer schema open read-only with an "update the app" notice, and nothing is overwritten.
13. Restore from the pre-migration snapshot through the app's backup UI on one plan. **Expect:** it
    restores cleanly.

Remove the worktree afterwards: `git worktree remove ../longview-prev`.

### 5.3 Result log

| Date | From build | To build | Schema change | Prompt shown, no auto-reload | Unsaved edit kept | Backup snapshot written | Plans open, numbers match | Offline after update | Read-only guard | Result | Notes |
| ---- | ---------- | -------- | ------------- | ---------------------------- | ----------------- | ----------------------- | ------------------------- | -------------------- | --------------- | ------ | ----- |
|      |            |          |               |                              |                   |                         |                           |                      |                 |        |       |

Any "no" is a release blocker.

## 6. Hotfix

1. Decide quickly between rollback (section 4) and fix forward. If users' data could be written wrongly,
   roll back first.
2. Branch from `main`, fix, add a patch changeset, and open a PR. CI still has to pass: branch protection
   has no bypass.
3. Merge, then cut the patch release (section 2.2).

## 7. Release and rollback log

| Date | Version or tag | Type (release, rollback, hotfix) | Pages deployment ID | Worker version ID | D1 migration | Notes |
| ---- | -------------- | -------------------------------- | ------------------- | ----------------- | ------------ | ----- |
|      |                |                                  |                     |                   |              |       |
