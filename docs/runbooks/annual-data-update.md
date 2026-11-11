# Runbook: annual data update

Plan §8.3. Tax rules, limits, premiums and market history live in versioned data files under
`packages/data/`. A yearly update changes data, not code (plan §2.4). This runbook says when each file is
due, how to produce it, how to mark it `enacted`, and how to release it.

Each pass through this runbook ends with a data release tag `data-YYYY.N`.

## 1. Calendar

`<year>` is the current calendar year; `<year+1>` is the coming tax or plan year.

| When                | What is published                                                                                               | Publisher                              | Files to update                                    | How                                |
| ------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------- | -------------------------------------------------- | ---------------------------------- |
| January             | Poverty guidelines (48 states, AK, HI)                                                                          | HHS                                    | `health/fpl/<year>.json`                           | Transcribe                         |
| Each January        | Prior-year market returns, rates and CPI                                                                        | Shiller, FRED, Damodaran               | `market/*.json`                                    | Ingest workflow (scheduled 15 Jan) |
| July to August      | ACA applicable-percentage table (Rev. Proc.)                                                                    | IRS                                    | `health/aca/applicable-pct/<year+1>.json`          | Transcribe                         |
| October             | COLA, wage base, bend points, earnings-test amounts                                                             | SSA                                    | `ss/<year+1>.json`                                 | Transcribe                         |
| October to November | Inflation-adjustment Rev. Proc. (brackets, standard deduction, capital-gains thresholds, AMT, estate exemption) | IRS                                    | `tax/us-federal/<year+1>.json`                     | Transcribe                         |
| October to November | Marketplace public use files and rate data for the next plan year                                               | CMS                                    | `health/aca/slcsp/<year+1>/*.json`                 | Ingest script                      |
| November            | Retirement-plan limits notice                                                                                   | IRS                                    | `limits/<year+1>.json`                             | Transcribe                         |
| November            | Medicare Part B and D premiums, IRMAA brackets, Part D parameters                                               | CMS                                    | `health/medicare/<year+1>.json`                    | Transcribe                         |
| December to January | State tax tables for the O1 states                                                                              | State revenue departments              | `tax/us-<st>/<year+1>.json`                        | Transcribe                         |
| Ongoing             | New federal or state law                                                                                        | Congress, state legislatures, agencies | `lawRefs`, effective-date hooks, any affected file | Section 4                          |

All paths are relative to `packages/data/`.

Put a reminder in your calendar for the first week of each month named above. Publication dates move; when a
release is late, leave the file `projected` and try again in two weeks.

## 2. Before you start

```sh
git switch main && git pull
git switch -c data/<year+1>-<what>      # for example data/2028-federal-tax
pnpm install --frozen-lockfile
```

For local ingest runs that use FRED, put the key in a local `.env` (never committed; `.env` is in
`.gitignore`):

```sh
FRED_API_KEY=<your key>
```

API keys live only in local `.env` or CI secrets. They are never read by the client (plan §8.1).

## 3. Steps for every update

Plan §8.3: run ingest → diff against the prior year → update `status` → run the full validation suite →
bump the data release → deploy.

### 3.1 Produce the new file

**Ingested datasets** (scripts in `tools/ingest/`):

```sh
# Market history (each January)
pnpm exec tsx tools/ingest/shiller.ts
pnpm exec tsx tools/ingest/fred.ts          # needs FRED_API_KEY
pnpm exec tsx tools/ingest/damodaran.ts
pnpm exec tsx tools/ingest/build-market.ts  # combines the three into market/*.json

# ACA benchmark premiums for a plan year (October to November)
pnpm exec tsx tools/ingest/slcsp.ts <year+1>
```

Or run the **Data ingest** workflow (`.github/workflows/ingest.yml`) from the Actions tab. It runs the same
scripts with the `FRED_API_KEY` secret and opens a pull request with the diff. Set `slcsp_year` to run the
SLCSP ingest. Pull requests opened by the workflow do not start CI by themselves: close and reopen the PR,
or push a commit to its branch, before review.

**Transcribed datasets** (everything else on the calendar):

1. Download the primary source document (the Rev. Proc., notice, fact sheet or table) and keep the file.
2. Compute its checksum:

   ```sh
   sha256sum <downloaded file>                       # Git Bash, macOS, Linux
   Get-FileHash <downloaded file> -Algorithm SHA256  # PowerShell
   ```

3. Copy the prior year's file to the new year and edit the values from the source document. Do not use a
   secondary source (news article, summary site) for any number.
4. Fill in the header block (plan §8.1):

   | Field       | Value                                                                                                                                  |
   | ----------- | -------------------------------------------------------------------------------------------------------------------------------------- |
   | `source`    | URL of the primary document                                                                                                            |
   | `publisher` | For example `IRS`, `SSA`, `CMS`, `HHS`                                                                                                 |
   | `retrieved` | Today's date, ISO format                                                                                                               |
   | `status`    | `enacted` (section 5) or `projected`                                                                                                   |
   | `lawRefs`   | The statute sections, Rev. Proc. or notice numbers the values come from                                                                |
   | `sha256`    | The checksum from step 2. If the body was typed by hand and there is no single raw file, hash the canonical body and say so in `notes` |
   | `schema`    | Unchanged unless the shape changed                                                                                                     |

5. For state-based-exchange states with no published data, leave the SLCSP as user-entered and keep the
   flag (HC-02).

### 3.2 Diff against the prior year

```sh
git diff --stat -- packages/data
git diff -- packages/data/<domain>/<region>/<year+1>.json
# Year over year, for a transcribed file:
git diff --no-index packages/data/tax/us-federal/<year>.json packages/data/tax/us-federal/<year+1>.json
```

Check, and write the answers in the pull request:

- Every changed number moved in the expected direction and by a plausible amount (indexed amounts usually
  rise by roughly inflation; unindexed ones such as the NIIT thresholds do not move).
- Values that were `projected` last year and are now published: note the size of the projection error. A
  large miss means the indexing rule in the engine needs a look.
- No field disappeared. A structural change in the source usually means a law change: go to section 4.
- For market data: only the newest year was added, and earlier years are unchanged apart from documented
  revisions by the source.

### 3.3 Update `status`

Set `enacted` or `projected` on each file you touched (section 5).

### 3.4 Validate

```sh
pnpm validate:data        # every dataset against its JSON Schema
pnpm test                 # unit and property tests
pnpm test:validation      # V-01 to V-09
```

If the federal tax year changed, regenerate the Tax-Calculator fixtures for that year (V-04). CI fails if
the committed fixtures differ from what the pinned oracle produces.

```sh
python -m venv tests/validation/taxcalc/.venv
# activate it: `source tests/validation/taxcalc/.venv/bin/activate`
#          or  `tests\validation\taxcalc\.venv\Scripts\Activate.ps1`
python -m pip install --requirement tests/validation/taxcalc/requirements.txt
python tests/validation/taxcalc/generate_fixtures.py   # rewrites tests/validation/fixtures/taxcalc-<year>.json
pnpm test:validation
```

If the pinned `taxcalc` version does not yet know the new year's parameters, bump the pin in
`tests/validation/taxcalc/requirements.txt` in the same pull request and commit the regenerated fixtures.
If no release supports the year yet, keep validating the latest supported year and open an issue labelled
`TAX-13` to revisit.

A validation failure after a data change is a finding, not noise. Either the data was transcribed wrongly,
or the law changed shape and the engine needs a versioned rule (section 4).

### 3.5 Release

1. Bump the data release identifier. Format: `data-YYYY.N`, where `YYYY` is the newest tax or plan year the
   release contains as `enacted` federal data, and `N` starts at 1 and counts releases within that year.
   Example: the release that first carries enacted 2028 federal tables is `data-2028.1`; the next release
   (say, Medicare premiums for 2028) is `data-2028.2`. The identifier is exported by `@fisim/data`, shown
   in Settings and in "How this is calculated", and recorded in each plan's results (plan §14.3).
2. Open the pull request. Title: `data: <what> <year>`. Include the diff notes from 3.2 and links to the
   source documents.
3. After CI is green and the PR is merged, tag the merge commit:

   ```sh
   git switch main && git pull
   git tag -a data-2028.1 -m "Data release 2028.1: federal tax 2028 enacted"
   git push origin data-2028.1
   ```

4. The merge to `main` deploys automatically (`.github/workflows/deploy.yml`). Open the production app,
   accept the update prompt, and confirm in Settings that the new data release and the file's source, date
   and status appear.

Data releases are independent of app releases (`vX.Y.Z`, see
[release-and-rollback.md](release-and-rollback.md)). A data-only change needs no app version bump.

## 4. Legislation watch

Law changes are the main risk to correct estimates (plan §17). The yearly files only capture indexed
changes; a new statute can change the rules themselves.

**When:** at every calendar item above, and once more in mid-year (June).

**What to check:**

- Congress.gov for enacted public laws touching the Internal Revenue Code, the Social Security Act, the
  ACA or Medicare since the last check.
- The IRS newsroom and Internal Revenue Bulletin for new guidance on items in section 6.
- SSA and CMS announcements (fact sheets, final rules) for benefit, premium and Part D changes.
- The revenue departments and legislatures of the O1 states.
- For ACA plan years: whether the premium tax credit rules in force (cliff, applicable percentages,
  repayment limits) changed for the coming year.

**What to do when something changed:**

1. Record the law in `lawRefs` of every affected file (public law number, section, effective date).
2. If only numbers changed, update the affected data files and mark them per section 5.
3. If the rule's shape changed (a new deduction, a new phase-out, a new threshold type), it needs a
   versioned rule with an effective date in the engine (TAX-13). Open an issue with the feature ID label,
   link the enacted text, and do not mark the affected year `enacted` until the rule ships.
4. A scheduled future change (a sunset or a phase-in) is encoded with its effective date now, so projected
   years already follow it.
5. A proposal that is not law is never encoded as the default. If you want to explore it, model it as a
   named variant.
6. Add a line to the log in section 7.

## 5. Flipping `projected` to `enacted`

A file is `enacted` only when **every** value in it comes from a published primary source for that year:
the statute itself, or the agency's official annual publication (Rev. Proc., notice, Federal Register
notice, fact sheet with the final figures).

Steps:

1. Replace each projected value with the published one. Do not leave a mix: if one section of the file is
   still unpublished, the whole file stays `projected` and the unpublished part is named in `notes` or
   `flags`.
2. Set `"status": "enacted"`, and update `source`, `retrieved`, `lawRefs` and `sha256` to the published
   document.
3. Run section 3.4. Enacted files are what the v1.0 gate checks (plan §16: the current data year is
   `enacted` where published).
4. Check the app: the value no longer carries the projected marking, and "How this is calculated" shows the
   new source and date.

Years beyond the latest enacted one are not stored as hand-written files. The engine projects them by
indexing the latest enacted parameters (chained CPI where the law says so) and flags them `projected`
(plan §8.3). After adding a new enacted year, look at one projected year in the app to confirm it now
indexes from the new base.

Never flip a file back from `enacted` to `projected`. If an enacted value turns out to be wrong, correct it,
explain in `notes`, and cut a new data release.

## 6. Appendix A re-check list

Plan Appendix A lists the baseline law the engine encodes. **Re-check every item against the enacted text
and current IRS, SSA and CMS guidance each time a data year is loaded.** Tick each line in the pull request
that adds the year.

**OBBBA (P.L. 119-21, July 2025)**

- [ ] Individual rate structure: brackets and rates as published for the year.
- [ ] Standard deduction amounts.
- [ ] Age-65+ senior deduction: still within its 2025 to 2028 window for this year? Amount and MAGI
      phase-out.
- [ ] SALT cap: amount, MAGI phase-down and the scheduled reversion year.
- [ ] Temporary deductions for tip and overtime income: in force this year?
- [ ] Estate and gift exemption: indexed amount.
- [ ] HSA eligibility for bronze and catastrophic marketplace plans.
- [ ] Repayment of excess advance premium tax credit: current rule.

**SECURE 2.0**

- [ ] RMD starting age: 73 for those born 1951 to 1959, 75 for 1960 or later.
- [ ] Age 60 to 63 super catch-up amounts.
- [ ] Mandatory Roth catch-up above the wage threshold: threshold for the year.
- [ ] 529-to-Roth rollover: lifetime cap and account-age rule.
- [ ] No lifetime RMDs on Roth 401(k)s.
- [ ] Inherited-IRA 10-year rule, including annual-RMD requirements under the final regulations.

**Social Security**

- [ ] Social Security Fairness Act: WEP and GPO remain repealed.
- [ ] COLA, wage base, bend points and earnings-test thresholds for the year.

**ACA premium tax credit**

- [ ] Which credit regime is in force for the plan year: is there a 400% FPL cliff? Which
      applicable-percentage table applies?
- [ ] Any extension or change is encoded as its own versioned rule, not by editing an earlier year.
- [ ] The poverty guidelines used are the prior year's (HC-04).

**Medicare**

- [ ] Part D out-of-pocket cap (Inflation Reduction Act), indexed amount.
- [ ] IRMAA tiers: thresholds for the year; MAGI lookback is still two years.
- [ ] Part B and Part D base premiums.

**States (O1)**

- [ ] Brackets, standard deduction or exemptions, and retirement-income exclusions for each O1 state.

## 7. Update log

Add a row for every pass through this runbook, including legislation checks that found nothing.

| Date | Data release | What changed | Files | Status set | Validation | Notes |
| ---- | ------------ | ------------ | ----- | ---------- | ---------- | ----- |
|      |              |              |       |            |            |       |
