# Tax-Calculator oracle fixtures

Test-time oracle for the simulator's TypeScript federal tax engine. A fixed set
of fixture households is run through a pinned release of PSL
[Tax-Calculator](https://github.com/PSLmodels/Tax-Calculator) (`taxcalc`) and
the inputs plus expected outputs are saved as JSON:

| File                                          | Contents                                                                     |
| --------------------------------------------- | ---------------------------------------------------------------------------- |
| `tests/validation/fixtures/taxcalc-2026.json` | 294 households, tax year 2026 (enacted/published parameters)                 |
| `tests/validation/fixtures/taxcalc-2027.json` | the same 294 households, tax year 2027 (**projected** parameters, see below) |
| `generate_fixtures.py`                        | builds the households, runs taxcalc, writes the JSON                         |
| `requirements.txt`                            | exact pinned versions (`taxcalc==6.8.5`, Python 3.12)                        |

Python is only needed to regenerate. The TypeScript test just reads the JSON,
which is committed.

## Oracle version and OBBBA

`taxcalc` **6.8.5** (newest release on PyPI on 2026-11-10). Its current-law
baseline **does include OBBBA** (P.L. 119-21) and the published 2026
inflation adjustments; `Policy.LAST_KNOWN_YEAR` is 2026. The 2026 values it
uses (also stored in `meta.policy` of the fixture file):

| Parameter (2026)                                    | Single          | MFJ             | MFS             | HoH             |
| --------------------------------------------------- | --------------- | --------------- | --------------- | --------------- |
| Standard deduction                                  | 16,100          | 32,200          | 16,100          | 24,150          |
| Additional std deduction per person 65+             | 2,050           | 1,650           | 1,650           | 2,050           |
| 10% bracket top                                     | 12,400          | 24,800          | 12,400          | 17,700          |
| 12% bracket top                                     | 50,400          | 100,800         | 50,400          | 67,450          |
| 22% bracket top                                     | 105,700         | 211,400         | 105,700         | 105,700         |
| 24% bracket top                                     | 201,775         | 403,550         | 201,775         | 201,750         |
| 32% bracket top                                     | 256,225         | 512,450         | 256,225         | 256,200         |
| 35% bracket top (37% above)                         | 640,600         | 768,700         | 384,350         | 640,600         |
| 0% LTCG/QD top (taxable income)                     | 49,450          | 98,900          | 49,450          | 66,200          |
| 15% LTCG/QD top (20% above)                         | 545,500         | 613,700         | 306,850         | 579,600         |
| Senior deduction (per person 65+)                   | 6,000           | 6,000           | none            | 6,000           |
| Senior deduction phase-out start (6% of MAGI above) | 75,000          | 150,000         | n/a             | 75,000          |
| SALT cap                                            | 40,400          | 40,400          | 20,200          | 40,400          |
| SALT cap phase-down start (30% of AGI above)        | 505,000         | 505,000         | 252,500         | 505,000         |
| SALT cap floor                                      | 10,000          | 10,000          | 5,000           | 10,000          |
| Non-itemizer cash-charity deduction max             | 1,000           | 2,000           | 1,000           | 1,000           |
| AMT exemption                                       | 90,100          | 140,200         | 70,100          | 90,100          |
| AMT exemption phase-out start (50% of AMTI above)   | 500,000         | 1,000,000       | 500,000         | 500,000         |
| AMT 28% rate starts at (26% below)                  | 244,500         | 244,500         | 122,250         | 244,500         |
| CTC phase-out start ($50 per $1,000 or part)        | 200,000         | 400,000         | 200,000         | 200,000         |
| NIIT threshold (3.8%)                               | 200,000         | 250,000         | 125,000         | 200,000         |
| Additional Medicare threshold (0.9%)                | 200,000         | 250,000         | 125,000         | 200,000         |
| SS benefit thresholds (50% / 85% tiers)             | 25,000 / 34,000 | 32,000 / 44,000 | 25,000 / 34,000 | 25,000 / 34,000 |
| QBI taxable-income threshold                        | 201,750         | 403,500         | 201,775         | 201,750         |

Other 2026 values: CTC 2,200 per child, refundable (ACTC) up to 1,700 per
child at 15% of earnings above 2,500; OASDI wage base 184,500; itemized
charity floor 0.5% of AGI; itemized-deduction limitation 2/37 (taxcalc uses
0.05405405) of the lesser of itemized deductions or income above the 37%
bracket start; QBI minimum deduction 400 when QBI is at least 1,000; EITC
maximum 664 / 4,427 / 7,316 / 8,231 for 0 / 1 / 2 / 3+ children.

### 2027 parameters are projections

taxcalc's parameters extend to 2036, but values after 2026 are taxcalc's own
inflation-indexed projections (unrounded, e.g. single standard deduction
16,571.73, wage base 190,957.50), **not** IRS/SSA published figures.
`taxcalc-2027.json` has `meta.parametersAreProjected: true`. It is only a
valid oracle if the TypeScript engine is run with the parameter values in that
file's `meta.policy`; do not compare it against an engine loaded with the
official 2027 figures. Statutory un-indexed amounts (senior deduction 6,000
and its thresholds, NIIT / Additional Medicare thresholds, SS thresholds, CTC
phase-out thresholds) are the same in both years.

## Regenerating

Windows (PowerShell or Git Bash), from the repo root:

```
py -3.12 -m venv tests/validation/taxcalc/.venv
tests/validation/taxcalc/.venv/Scripts/python -m pip install --upgrade pip
tests/validation/taxcalc/.venv/Scripts/python -m pip install -r tests/validation/taxcalc/requirements.txt
tests/validation/taxcalc/.venv/Scripts/python tests/validation/taxcalc/generate_fixtures.py
```

Linux CI:

```
python3.12 -m venv tests/validation/taxcalc/.venv
tests/validation/taxcalc/.venv/bin/python -m pip install --upgrade pip
tests/validation/taxcalc/.venv/bin/python -m pip install -r tests/validation/taxcalc/requirements.txt
tests/validation/taxcalc/.venv/bin/python tests/validation/taxcalc/generate_fixtures.py
```

Options:

- `--years 2026` to write one year (default `2026 2027`).
- `--check` regenerates in memory and compares with the committed files,
  ignoring `meta.generated`; exit code 1 if they differ. Use this in CI to
  prove the committed fixtures match the pinned oracle.
- `FIXTURE_DATE=2026-11-10` environment variable overrides `meta.generated`.

The run is deterministic: one `random.Random(SEED)` (seed 20261110) drives
all jitter and the random-mix households, and household order is fixed, so
ids (`h001`...) are stable until the household list in the script is edited.
Appending new cases to the end of a group shifts the ids and jittered amounts
of everything after it.

## Fixture households

294 households per year: 104 single, 108 MFJ, 43 HoH, 39 MFS. Each has a
`group`, and `tags` derived from the taxcalc result. `meta.coverage` holds the
counts.

| Group                | Count | What it exercises                                                                                         |
| -------------------- | ----- | --------------------------------------------------------------------------------------------------------- |
| `wages-only`         | 49    | every status across the wage scale, incl. exactly at the wage base and the Additional Medicare thresholds |
| `two-earner`         | 12    | MFJ wage splits around the per-person wage base and the joint 250k threshold                              |
| `children`           | 26    | 1-3 children: EITC, refundable ACTC (incl. the 3+ children rule), CTC phase-out                           |
| `age-senior`         | 26    | under 50, 50-64, 65+, couples with one spouse 65+; senior deduction below / inside / past phase-out       |
| `social-security`    | 27    | provisional income below, in the 50% tier, in the 85% tier, at the 85% cap                                |
| `interest-dividends` | 10    | interest, ordinary vs qualified dividends                                                                 |
| `capital-gains`      | 26    | LTCG in / straddling the 0%, 15%, 20% brackets; short-term gains; net capital losses                      |
| `niit`               | 12    | NII smaller and larger than the MAGI excess                                                               |
| `self-employment`    | 26    | SE around the $400 floor, with wages, across the wage base, both spouses, QBI limits                      |
| `itemized`           | 21    | SALT under / at cap, phase-down, floor; charity floor; 37%-bracket limitation; non-itemizer charity       |
| `amt`                | 12    | high-income returns, 10 of which owe AMT without any preference items                                     |
| `edge`               | 23    | zero and tiny incomes, exact bracket / threshold boundaries                                               |
| `random-mix`         | 24    | seeded random combinations                                                                                |

Tag counts (2026): `senior-deduction` 55, `ctc` 38, `niit` 37, `eitc` 31,
`itemizes` 29, `se-tax` 27, `qbi` 25, `actc` 18, `ss-phase-in` 17,
`ss-85pct-cap` 17, `amt` 13.

## File layout

```
meta        taxcalcVersion, generated, seed, year, householdCount, includesObbba,
            parametersAreProjected, policy {...}, coverage {...}, notes
households  [ { id, group, description, notes[], tags[],
                input{...}, taxcalcInput{...}, expected{...}, taxcalcDetail{...} } ]
```

All inputs are whole dollars. Outputs are rounded to cents.

### `input` to `taxcalcInput`

| `input` field                                   | taxcalc variable(s)                                            |
| ----------------------------------------------- | -------------------------------------------------------------- |
| `filingStatus` single / mfj / mfs / hoh         | `MARS` 1 / 2 / 3 / 4                                           |
| `ages[0]`, `ages[1]`                            | `age_head`, `age_spouse` (0 unless MFJ)                        |
| `childrenUnder17`                               | `n24`, `nu18`, `EIC` (capped at 3); `XTOT` = adults + children |
| `wages[0]`, `wages[1]`                          | `e00200p`, `e00200s`; `e00200` = sum                           |
| `selfEmployment[0]`, `[1]`                      | `e00900p`, `e00900s`; `e00900` = sum (Schedule C net profit)   |
| `taxableInterest`                               | `e00300`                                                       |
| `ordinaryDividends` (total, includes qualified) | `e00600`                                                       |
| `qualifiedDividends`                            | `e00650`                                                       |
| `longTermGains`, `shortTermGains`               | `p23250`, `p22250`                                             |
| `pensionsTaxable`                               | `e01700` (and `e01500`)                                        |
| `iraDistributions`                              | `e01400`                                                       |
| `socialSecurity` (gross benefits)               | `e02400`                                                       |
| `itemized.stateLocalIncomeTax`                  | `e18400`                                                       |
| `itemized.realEstateTax`                        | `e18500`                                                       |
| `itemized.mortgageInterest`                     | `e19200`                                                       |
| `itemized.charity` (cash)                       | `e19800`                                                       |

MFS and HoH records describe one adult, so `ages`, `wages` and
`selfEmployment` have one element; MFJ has two. Everything else taxcalc reads
is zero (`DSI`, `MIDR`, blindness, `nu06`, `nu13`, pass-through W-2 wages and
property, all other credits and adjustments).

### `expected` from taxcalc output

| `expected` field              | taxcalc variable                   | Meaning                                                                                                                                                                                |
| ----------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agi`                         | `c00100`                           | adjusted gross income                                                                                                                                                                  |
| `taxableSocialSecurity`       | `c02500`                           | Social Security benefits included in AGI                                                                                                                                               |
| `standardOrItemizedDeduction` | `max(standard, c04470)`            | deduction actually taken. `standard` = basic + additional 65+ amounts + non-itemizer charity (see below); `c04470` = itemized after all limits. Excludes the senior and QBI deductions |
| `seniorDeduction`             | `senior_deduction`                 | OBBBA deduction for people 65+, after phase-out                                                                                                                                        |
| `qbiDeduction`                | `qbided`                           | qualified business income deduction                                                                                                                                                    |
| `taxableIncome`               | `c04800`                           | `max(0, agi - deduction - seniorDeduction - qbiDeduction)`                                                                                                                             |
| `regularTaxBeforeCredits`     | `taxbc`                            | regular tax: rate schedule, or the qualified dividends / capital gain worksheet. Before AMT and credits                                                                                |
| `amt`                         | `c09600`                           | alternative minimum tax in excess of regular tax                                                                                                                                       |
| `niit`                        | `niit`                             | 3.8% net investment income tax                                                                                                                                                         |
| `childTaxCreditNonrefundable` | `c07220`                           | CTC used against tax                                                                                                                                                                   |
| `additionalChildTaxCredit`    | `c11070`                           | refundable part of the CTC                                                                                                                                                             |
| `eitc`                        | `eitc` (= `c59660`)                | earned income credit, refundable                                                                                                                                                       |
| `incomeTax`                   | `iitax`                            | see identity below; may be negative                                                                                                                                                    |
| `employeePayrollTax`          | `ptax_was - ptax_er_p - ptax_er_s` | employee share of OASDI + Medicare on wages                                                                                                                                            |
| `selfEmploymentTax`           | `setax`                            | Schedule SE tax, both halves                                                                                                                                                           |
| `additionalMedicareTax`       | `ptax_amc`                         | Form 8959 0.9% tax on wages and SE earnings                                                                                                                                            |
| `payrollTaxTaxcalcTotal`      | `payrolltax`                       | taxcalc's own total, **includes the employer share**                                                                                                                                   |

`taxcalcDetail` carries extra intermediate values for diagnosing a mismatch:
`itemizes`, `standardDeductionIfTaken`, `itemizedDeductionsAfterLimits`,
`itemizedDeductionsBeforeLimits`, `saltDeductedAfterCap`,
`mortgageInterestDeducted`, `charityDeducted`, `deductibleHalfOfSeTax`
(`c03260`), `netCapitalGainInAgi` (`c01000`), `provisionalIncomeYmod`
(`ymod`), `earnedIncomeForCredits` (`earned`),
`ordinaryScheduleTaxOnAllTaxableIncome` (`c05200`), `amtTaxableIncome`
(`c62100`), `taxBeforeCreditsInclAmt` (`c05800`), `nonrefundableCreditsUsed`
(`c07100`), `refundableCredits` (`refund`), `employerPayrollTax`,
`ficaEmployeePlusEmployer` (`ptax_was`).

### Where each tax lives

For every fixture household these identities hold (asserted when generating):

```
incomeTax = max(0, regularTaxBeforeCredits + amt - childTaxCreditNonrefundable)
            + niit - eitc - additionalChildTaxCredit

payrollTaxTaxcalcTotal = ficaEmployeePlusEmployer      (ptax_was)
                         + selfEmploymentTax           (setax)
                         + additionalMedicareTax       (ptax_amc)

employeePayrollTax = employerPayrollTax = ficaEmployeePlusEmployer / 2

tax the household itself pays outside incomeTax
  = employeePayrollTax + selfEmploymentTax + additionalMedicareTax
  = payrollTaxTaxcalcTotal - employerPayrollTax
```

- `ptax_was` is employee **plus** employer FICA on wages: 12.4% OASDI on each
  person's wages up to the wage base plus 2.9% Medicare on all wages.
- taxcalc first adds SE tax and Additional Medicare Tax into `othertaxes` and
  `c09200` (they are on Form 1040 Schedule 2), then, because the policy
  parameter `soi_iitax` defaults to false, subtracts both from `iitax` and
  adds them to `payrolltax`. So in these fixtures `incomeTax` contains
  **neither** SE tax **nor** Additional Medicare Tax. NIIT and AMT are in
  `incomeTax`.
- `incomeTax` is net of refundable credits. To compare an engine that does not
  model the EITC, compare against `incomeTax + eitc`.

## Modelling differences a comparison must handle

1. **No tax tables, no dollar rounding.** taxcalc applies the rate schedules
   continuously at every income level and keeps cents throughout. A real
   return under 100,000 of taxable income uses the Tax Table ($50 bins) and
   rounds lines to dollars. The engine has to compute continuously to match
   within $1.
2. **EITC is inside `incomeTax`.** 31 households have `eitc > 0`. Add it back
   if the engine does not model it. taxcalc also grants the EITC to MFS filers
   (`EITC_sep_filers_elig` true), which under law requires living apart from
   the spouse: households h039, h085 and h274 in the 2026 file. Childless EITC
   requires age 25-64. It is lost when investment income exceeds 12,200.
3. **Credit take-up.** taxcalc randomly withholds EITC/ACTC from some eligible
   units to mimic non-claiming. The generator sets `credit_claim_urn = 0`, so
   every eligible household claims in full.
4. **CTC phase-out rounding.** Generated with `exact_calculations=True`, so the
   excess over the threshold is rounded up to the next 1,000 as on Schedule
   8812 (h269 at exactly 400,000 keeps 4,400; h270 at 400,001 gets 4,350).
5. **QBI deduction** (25 households with SE income). taxcalc computes
   `20% x (Schedule C profit - deductible half of SE tax)`, capped at
   `20% x (taxable income before QBI - net capital gain - qualified
dividends)`. Above the taxable-income threshold it treats the business as a
   non-service business with zero W-2 wages and zero property, so the
   deduction phases down linearly to zero across the 75,000 / 150,000 range.
   Then the OBBBA minimum applies: if QBI is at least 1,000 the deduction is
   never less than 400, **even when taxable income before QBI is zero** (h193)
   or the wage cap has eliminated it (h198, h208). Use `qbiDeduction` to match
   or back out. The $400 also lowers `amtTaxableIncome`.
6. **Senior deduction.** 6,000 per person 65+, reduced by 6% of AGI above
   75,000 (150,000 MFJ) per person; MFS gets none. It is separate from
   `standardOrItemizedDeduction`, is available to itemizers, and is not
   subtracted in taxcalc's AMT income.
7. **Non-itemizer charity.** From 2026 a non-itemizer deducts up to 1,000
   (2,000 MFJ) of cash gifts. taxcalc adds it to `standard`, and compares that
   total with itemized deductions to decide whether to itemize (h233, h234 and
   random-mix h272, h276 carry the tag `non-itemizer-charity`).
8. **Itemized deductions.** State income tax and real estate tax are summed
   then capped. The cap falls by 30% of AGI above 505,000 down to the floor.
   Charity is reduced by 0.5% of AGI and limited to 60% of AGI. Mortgage
   interest is deducted as entered (no debt limit). In the 37% bracket the
   total is cut by 0.05405405 x min(itemized, AGI - 37% bracket start); note
   taxcalc measures that excess from AGI, not from taxable income.
9. **MFS.** One adult per record. `MIDR = 0`, so MFS filers get the standard
   deduction. taxcalc gives MFS filers the 25,000 / 34,000 Social Security
   thresholds (correct only if the spouses lived apart all year; otherwise the
   law's threshold is zero). The MFS households with benefits carry a note.
10. **HoH.** Some HoH households have `childrenUnder17 = 0`. They get HoH
    brackets and standard deduction, no dependent, no 500 other-dependent
    credit.
11. **Children.** Every child is CTC-eligible and an EITC qualifying child
    (up to 3). No child is under 6 for any purpose that matters, and there is
    no dependent-care or education credit.
12. **Capital gains.** Net loss is limited to 3,000 (1,500 MFS) with no
    carryforward tracking. No 25% or 28% rate gains. NIIT base = interest +
    ordinary dividends + net capital gain after the loss limit, against
    AGI.
13. **Self-employment.** Net earnings = 92.35% of profit, per person. Under
    400 of net earnings means no SE tax (h190 at 433 profit owes none, h191 at
    434 owes 61.32). OASDI applies up to the wage base less that person's
    wages. Half of SE tax is deducted in AGI and reduces earned income for
    EITC/ACTC and the QBI base.
14. **AMT.** AMT income = AGI - QBI deduction for standard-deduction filers,
    and AGI - QBI deduction - itemized deductions + SALT deducted for
    itemizers. No preference items. Capital gains keep their preferential
    rates inside AMT. The exemption phases out at 50% (OBBBA) and, for MFS, is
    zero once AMT income exceeds 639,200.
15. **2027.** Parameters are projections (see above).

## Worked checks (2026)

Hand arithmetic against 2026 law, compared with the fixture values.

**h004 - single, age 34, wages 60,000**

- Taxable income 60,000 - 16,100 = 43,900
- Tax 12,400 x 10% + (43,900 - 12,400) x 12% = 1,240 + 3,780 = **5,020.00**
- Employee FICA 60,000 x 7.65% = **4,590.00**; taxcalc total 9,180.00

**h100 - MFJ, ages 66/62, pension 48,804, IRA 14,778**

- AGI 63,582. Standard deduction 32,200 + 1,650 (one spouse 65+) = 33,850
- Senior deduction 6,000 (one senior, AGI under 150,000)
- Taxable income 63,582 - 33,850 - 6,000 = 23,732; tax at 10% = **2,373.20**

**h129 - MFJ, ages 72/70, pension 23,881, IRA 10,024, Social Security 45,600**

- Provisional income 33,905 + 22,800 = 56,705
- Taxable benefits = 85% x (56,705 - 44,000) + min(22,800, 50% x 12,000)
  = 10,799.25 + 6,000 = **16,799.25** (cap 85% x 45,600 = 38,760 not binding)
- AGI 50,704.25; deductions 32,200 + 3,300 + senior 12,000
- Taxable income 3,204.25; tax **320.43**

**h270 - MFJ, 2 children, wages 400,001 (one earner)**

- Taxable income 400,001 - 32,200 = 367,801
- Tax 2,480 + 9,120 + 24,332 + (367,801 - 211,400) x 24% = **73,468.24**
- CTC 2 x 2,200 = 4,400 less 50 x 1 (excess of 1 rounds up to 1,000) = **4,350**
- Income tax **69,118.24**
- Employee FICA 184,500 x 6.2% + 400,001 x 1.45% = 11,439 + 5,800.01 = **17,239.01**
- Additional Medicare (400,001 - 250,000) x 0.9% = **1,350.01**

**h200 - single, wages 154,053, self-employment 58,934**

- Net SE earnings 58,934 x 0.9235 = 54,425.55
- OASDI room 184,500 - 154,053 = 30,447, x 12.4% = 3,775.43; Medicare
  54,425.55 x 2.9% = 1,578.34; SE tax **5,353.77**
- AGI 154,053 + 58,934 - 2,676.885 = **210,310.12**
- QBI deduction 20% x (58,934 - 2,676.885) = **11,251.42**
- Taxable income 210,310.12 - 16,100 - 11,251.42 = **182,958.69**
- Additional Medicare: wages under 200,000; SE earnings above the remaining
  45,947 = 8,478.55, x 0.9% = **76.31**

**h218 - single, wages 546,653, state tax 50,694, real estate tax 24,010,
mortgage interest 29,771, charity 19,504**

- SALT cap 40,400 - 30% x (546,653 - 505,000) = **27,904.10**
- Charity 19,504 - 0.5% x 546,653 = **16,770.74**
- Itemized 27,904.10 + 29,771 + 16,770.74 = **74,445.83**

**h236 - single, wages 146,874, long-term gains 607,967 (AMT)**

- Taxable income 754,841 - 16,100 = 738,741, of which 130,774 ordinary
- Regular tax: ordinary 1,240 + 4,560 + 12,166 + 6,017.76 = 23,983.76; gains
  at 15% on 545,500 - 130,774 = 414,726 (62,208.90) and 20% on 193,241
  (38,648.20); total **124,840.86**
- AMT income 754,841; exemption 90,100 - 50% x 254,841 = 0
- Tentative minimum tax 26% x 146,874 + 62,208.90 + 38,648.20 = 139,044.34
- AMT 139,044.34 - 124,840.86 = **14,203.48**
- NIIT 3.8% x min(607,967, 554,841) = **21,083.96**
- Income tax 124,840.86 + 14,203.48 + 21,083.96 = **160,128.30**

All of the above equal the values in `taxcalc-2026.json`.
