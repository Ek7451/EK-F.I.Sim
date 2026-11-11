# Runbook: restore drill

Plan §14.4 and §12.3. A backup that has never been restored is a hope, not a backup. This drill proves,
every quarter, that plan data can be brought back two ways on a machine that has never seen it:

- **Drill A:** from an encrypted export file (SYNC-03) and its passphrase.
- **Drill B:** from cloud sync using only the **recovery key**, with the passphrase treated as lost
  (SYNC-02, plan §12.2).

A successful run of both on a clean profile is a v1.0 gate item (plan §16) and part of the security review
([security-review.md](security-review.md)).

## When

- Quarterly: first week of January, April, July and October.
- After any change to `packages/crypto`, the export format, the sync API or the key-management flow.
- After any rollback that touched D1 or R2 ([release-and-rollback.md](release-and-rollback.md)).
- Before v1.0.

Drill B needs sync (Phase 7). Until then, run Drill A only and write "n/a (sync not built)" for B.

## What you need

- A device with the real, current data (the **source**).
- A **clean browser profile** on the same or another device (the **target**): no Longview data, no
  extensions, no saved passwords.

  ```sh
  # Chrome or Edge, throwaway profile
  chrome --user-data-dir="$(mktemp -d)" --no-first-run
  # PowerShell
  & "C:\Program Files\Google\Chrome\Application\chrome.exe" --user-data-dir="$env:TEMP\longview-drill-$(Get-Random)" --no-first-run
  # Firefox
  firefox --no-remote --profile "$(mktemp -d)"
  ```

  A private or guest window is acceptable only if it stays open for the whole drill; it does not test that
  restored data persists across a restart.

- The export passphrase, the sync passphrase and the **printed or separately stored recovery key**. Use the
  stored copy, not one read off the source device: finding it is part of the drill.
- About 30 minutes.

Use your real data. The drill is about your backups, not about fixtures. Nothing in the drill sends data
anywhere new: the export file stays on your devices and sync carries ciphertext only.

## Step 0: record reference values on the source

On the source device, write down (on paper or in the log, not in a cloud note):

1. The number of plans and their names.
2. For the main plan: net worth this year, net worth in the final year, this year's total tax, and the
   chance of success with its run count and seed.
3. The date and total of the most recent actuals entry on Track.
4. The app version and data release shown in Settings.

These are the values the restored copy must reproduce. The same plan, data release and seed always give
identical results (plan §6.4), so "close" is not a pass.

## Drill A: encrypted export restore

1. **Source:** Settings → Backups → create an encrypted export of all plans. Choose a passphrase (or use
   your standing backup passphrase). Save the file.
2. Move the file to the target by a route you would really use (USB stick, your own file share).
3. Inspect the file in a text editor. **Expect:** no readable names, balances or plan text; only the
   envelope metadata and ciphertext.
4. **Target (clean profile):** open the production app. **Expect:** the first-run screen, no plans.
5. Settings → Backups → import. Select the file and enter a **wrong** passphrase first. **Expect:** a clear
   error, nothing imported, no partial data.
6. Import again with the correct passphrase. **Expect:** all plans listed.
7. Compare against step 0, items 1 to 3. **Expect:** exact matches. If the target's app version or data
   release differs from the source, note it; numbers may then differ only as the changelogs explain.
8. Close the browser completely, reopen the same profile, and open the app. **Expect:** the plans are
   still there (IndexedDB persisted).
9. Go offline and reload. **Expect:** the app and the restored plans open.

## Drill B: recovery-key restore

The passphrase is treated as lost. Do not type it anywhere during this drill.

1. **Source:** confirm sync is on and shows everything as synced. Note the time.
2. Fetch the stored recovery key from wherever it is kept.
3. **Target (a second clean profile, not the one from Drill A):** open the production app and pass
   Cloudflare Access (email code or identity provider).
4. Settings → Sync → set up on this device → choose the "use recovery key" path. Enter a **wrong** key
   first (change one character). **Expect:** a clear error and no data.
5. Enter the correct recovery key. **Expect:** the app unwraps the data key, downloads and decrypts the
   plans.
6. **Expect:** the app asks for a new passphrase (the data key is re-wrapped; plans are not re-encrypted,
   plan §12.2). Set one and record it in your password manager.
7. Compare against step 0. **Expect:** exact matches, including actuals and tour progress.
8. Make a small edit on the target (for example add a note or rename a variant) and let it sync.
9. **Source:** wait for sync. **Expect:** the edit arrives. The source asks for the new passphrase if the
   old one no longer unwraps the key; enter it.
10. Confirm the recovery key itself still works or was rotated as the app says. If the app issued a new
    recovery key, store it now and destroy the old copy.
11. Undo the test edit.

## Clean-up

- Delete the export file from the transfer medium and the target device, unless it is your standing backup.
- Close the throwaway profiles and delete their directories.
- Remove the target device from Cloudflare Access sessions if it is not a device you normally use.
- Fill in the log below.

## If a step fails

A failed drill is a priority-one finding: stop feature work until it is understood.

1. Do **not** change anything on the source device. It holds the only known-good copy.
2. Make a fresh encrypted export on the source and verify it by re-running Drill A, steps 3 to 7.
3. Export the client error log from Settings (plan §14.4) on the target and attach it to an issue labelled
   with the feature ID (`SYNC-02` or `SYNC-03`).
4. If Drill B failed but Drill A passed, your data is safe in the export; treat sync as untrusted until
   fixed.
5. Re-run the full drill after the fix and log both runs.

## Results log

One row per drill run. "Match" means every reference value from step 0 matched exactly.

| Date | Run by | App version | Data release | Browser and OS (target) | Drill A: wrong passphrase rejected | Drill A: restored, match | Drill A: survives restart and offline | Drill B: wrong key rejected | Drill B: restored, match | Drill B: new passphrase set, edit synced back | Time taken | Result | Issues opened |
| ---- | ------ | ----------- | ------------ | ----------------------- | ---------------------------------- | ------------------------ | ------------------------------------- | --------------------------- | ------------------------ | --------------------------------------------- | ---------- | ------ | ------------- |
|      |        |             |              |                         |                                    |                          |                                       |                             |                          |                                               |            |        |               |
